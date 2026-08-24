// Package natsjetstream adapts NATS JetStream to queueclient callbacks while
// keeping broker SDK types out of the broker-neutral queueclient package.
package natsjetstream

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"reflect"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/zbxing/goexample/Framework/queueclient"
)

const (
	defaultFetchMaxWait = time.Second
	minimumFetchMaxWait = 10 * time.Millisecond
	maximumFetchMaxWait = 30 * time.Second
)

var (
	// ErrInvalidConfiguration indicates an incomplete or unsafe adapter config.
	ErrInvalidConfiguration = errors.New("nats jetstream adapter configuration is invalid")
	// ErrInvalidContext indicates that an operation received a nil context.
	ErrInvalidContext = errors.New("nats jetstream operation context is nil")
	// ErrPublish indicates that JetStream did not confirm a publish. Backend
	// details are deliberately not exposed by this adapter.
	ErrPublish = errors.New("nats jetstream publish failed")
	// ErrReceive indicates that the durable consumer could not receive work.
	ErrReceive = errors.New("nats jetstream receive failed")
	// ErrInvalidMessage indicates a message shape that queueclient cannot safely
	// represent, such as a multi-valued NATS header.
	ErrInvalidMessage = errors.New("nats jetstream message is invalid")
	// ErrAcknowledge indicates that JetStream did not confirm the source ack.
	ErrAcknowledge = errors.New("nats jetstream acknowledgement failed")
	// ErrLeaseExtension indicates that JetStream did not accept an in-progress
	// signal. Backend details are deliberately not exposed by this adapter.
	ErrLeaseExtension = errors.New("nats jetstream lease extension failed")
	// ErrDeadLetter indicates that publishing to the DLQ or acknowledging the
	// source message failed.
	ErrDeadLetter = errors.New("nats jetstream dead-letter settlement failed")
	// ErrConsumerPreflight indicates that the server-reported consumer
	// configuration could not be inspected or is incompatible with reliable
	// delivery. Backend details are deliberately not exposed.
	ErrConsumerPreflight = errors.New("nats jetstream consumer preflight failed")
	// ErrAckWaitTooShort indicates that at least one server-reported redelivery
	// interval is shorter than queueclient's worst-case delivery budget.
	ErrAckWaitTooShort = errors.New("nats jetstream acknowledgement wait is too short")
)

// Publisher is the narrow JetStream publish surface required by Adapter.
type Publisher interface {
	PublishMsg(context.Context, *nats.Msg, ...jetstream.PublishOpt) (*jetstream.PubAck, error)
}

// Consumer is the narrow pull-consumer surface required by Adapter.
type Consumer interface {
	Next(...jetstream.FetchOpt) (jetstream.Msg, error)
}

// ConsumerInspector is the server-backed configuration surface required by
// PreflightConsumer. A fresh Info response prevents validation against stale or
// caller-supplied acknowledgement settings.
type ConsumerInspector interface {
	Info(context.Context) (*jetstream.ConsumerInfo, error)
}

// Config binds one application subject and one distinct dead-letter subject.
// Both streams and the explicit-ack pull consumer are provisioned externally.
type Config struct {
	Subject           string
	DeadLetterSubject string
	FetchMaxWait      time.Duration
}

// Adapter maps queueclient messages to one pre-provisioned JetStream producer
// and durable pull consumer.
type Adapter struct {
	publisher         Publisher
	consumer          Consumer
	subject           string
	deadLetterSubject string
	fetchMaxWait      time.Duration
}

// New validates and constructs a JetStream callback adapter. It performs no
// network I/O and never creates, updates, or deletes broker resources.
func New(publisher Publisher, consumer Consumer, config Config) (*Adapter, error) {
	if nilInterface(publisher) || nilInterface(consumer) {
		return nil, ErrInvalidConfiguration
	}
	if !validLiteralSubject(config.Subject) || !validLiteralSubject(config.DeadLetterSubject) ||
		config.Subject == config.DeadLetterSubject {
		return nil, ErrInvalidConfiguration
	}
	if config.FetchMaxWait == 0 {
		config.FetchMaxWait = defaultFetchMaxWait
	}
	if config.FetchMaxWait < minimumFetchMaxWait || config.FetchMaxWait > maximumFetchMaxWait {
		return nil, ErrInvalidConfiguration
	}
	return &Adapter{
		publisher:         publisher,
		consumer:          consumer,
		subject:           config.Subject,
		deadLetterSubject: config.DeadLetterSubject,
		fetchMaxWait:      config.FetchMaxWait,
	}, nil
}

// PreflightConsumer verifies that a pre-provisioned explicit-ack consumer's
// server-reported AckWait, or every BackOff interval when BackOff overrides
// AckWait, covers the queue client's handler/retry/settlement budget plus the
// caller's positive safety margin. It returns the required lease even when the
// configured lease is too short.
func PreflightConsumer(
	ctx context.Context,
	consumer ConsumerInspector,
	client *queueclient.Client,
	retry queueclient.DeliveryRetryConfig,
	safetyMargin time.Duration,
) (time.Duration, error) {
	if ctx == nil {
		return 0, ErrInvalidContext
	}
	if nilInterface(consumer) {
		return 0, ErrInvalidConfiguration
	}
	required, err := client.MinimumDeliveryLease(retry, safetyMargin)
	if err != nil {
		return 0, ErrInvalidConfiguration
	}
	info, err := consumer.Info(ctx)
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return 0, contextErr
		}
		return 0, ErrConsumerPreflight
	}
	if info == nil || info.Config.AckPolicy != jetstream.AckExplicitPolicy {
		return 0, ErrConsumerPreflight
	}

	waits := info.Config.BackOff
	if len(waits) == 0 {
		waits = []time.Duration{info.Config.AckWait}
	}
	for _, wait := range waits {
		if wait <= 0 {
			return 0, ErrConsumerPreflight
		}
		if wait < required {
			return required, ErrAckWaitTooShort
		}
	}
	return required, nil
}

// Publish synchronously publishes one message and waits for the server ack.
// JetStream control headers supplied as application data are not forwarded.
func (adapter *Adapter) Publish(ctx context.Context, message queueclient.Message) error {
	if adapter == nil || nilInterface(adapter.publisher) {
		return ErrInvalidConfiguration
	}
	if ctx == nil {
		return ErrInvalidContext
	}
	brokerMessage := nats.NewMsg(adapter.subject)
	brokerMessage.Data = bytes.Clone(message.Body)
	brokerMessage.Header = applicationHeaders(message.Headers)
	if _, err := adapter.publisher.PublishMsg(ctx, brokerMessage); err != nil {
		return ErrPublish
	}
	return nil
}

// ReceiveDelivery waits in bounded pulls until a message or cancellation is
// observed, then returns private confirmed-ack and DLQ callbacks.
func (adapter *Adapter) ReceiveDelivery(ctx context.Context) (queueclient.Delivery, error) {
	if adapter == nil || nilInterface(adapter.consumer) || nilInterface(adapter.publisher) {
		return queueclient.Delivery{}, ErrInvalidConfiguration
	}
	if ctx == nil {
		return queueclient.Delivery{}, ErrInvalidContext
	}
	for {
		if err := ctx.Err(); err != nil {
			return queueclient.Delivery{}, err
		}
		brokerMessage, err := adapter.consumer.Next(jetstream.FetchMaxWait(adapter.fetchMaxWait))
		if err != nil {
			if contextErr := ctx.Err(); contextErr != nil {
				return queueclient.Delivery{}, contextErr
			}
			if errors.Is(err, jetstream.ErrNoMessages) || errors.Is(err, nats.ErrTimeout) {
				continue
			}
			return queueclient.Delivery{}, ErrReceive
		}
		message, err := fromJetStreamMessage(brokerMessage)
		if err != nil {
			return queueclient.Delivery{}, err
		}
		return queueclient.Delivery{
			Message: message,
			ExtendLease: func(extensionContext context.Context) error {
				if extensionContext == nil {
					return ErrInvalidContext
				}
				if err := extensionContext.Err(); err != nil {
					return err
				}
				if err := brokerMessage.InProgress(); err != nil {
					return ErrLeaseExtension
				}
				if err := extensionContext.Err(); err != nil {
					return err
				}
				return nil
			},
			Acknowledge: func(settlementContext context.Context) error {
				if settlementContext == nil {
					return ErrInvalidContext
				}
				if err := brokerMessage.DoubleAck(settlementContext); err != nil {
					return ErrAcknowledge
				}
				return nil
			},
			DeadLetter: func(settlementContext context.Context) error {
				return adapter.deadLetter(settlementContext, brokerMessage, message)
			},
		}, nil
	}
}

func (adapter *Adapter) deadLetter(ctx context.Context, source jetstream.Msg, message queueclient.Message) error {
	if ctx == nil {
		return ErrInvalidContext
	}
	metadata, err := source.Metadata()
	if err != nil || metadata == nil || metadata.Stream == "" || metadata.Sequence.Stream == 0 {
		return ErrInvalidMessage
	}
	dlqMessage := nats.NewMsg(adapter.deadLetterSubject)
	dlqMessage.Data = bytes.Clone(message.Body)
	dlqMessage.Header = applicationHeaders(message.Headers)
	dlqMessage.Header.Set(jetstream.MsgIDHeader, deadLetterID(metadata))
	if _, err := adapter.publisher.PublishMsg(ctx, dlqMessage); err != nil {
		return ErrDeadLetter
	}
	if err := source.DoubleAck(ctx); err != nil {
		return ErrDeadLetter
	}
	return nil
}

func fromJetStreamMessage(message jetstream.Msg) (queueclient.Message, error) {
	if message == nil {
		return queueclient.Message{}, ErrInvalidMessage
	}
	result := queueclient.Message{
		Body:    bytes.Clone(message.Data()),
		Headers: make(map[string]string),
	}
	for name, values := range message.Headers() {
		if jetStreamControlHeader(name) {
			continue
		}
		if len(values) != 1 {
			return queueclient.Message{}, ErrInvalidMessage
		}
		result.Headers[name] = values[0]
	}
	return result, nil
}

func applicationHeaders(headers map[string]string) nats.Header {
	result := nats.Header{}
	for name, value := range headers {
		if !jetStreamControlHeader(name) {
			result.Set(name, value)
		}
	}
	return result
}

func deadLetterID(metadata *jetstream.MsgMetadata) string {
	digest := sha256.New()
	digest.Write([]byte(metadata.Stream))
	digest.Write([]byte{0})
	digest.Write([]byte(metadata.Consumer))
	digest.Write([]byte{0})
	digest.Write([]byte(strconv.FormatUint(metadata.Sequence.Stream, 10)))
	return "goexample-dlq-" + hex.EncodeToString(digest.Sum(nil))
}

func jetStreamControlHeader(name string) bool {
	for _, control := range []string{
		jetstream.MsgIDHeader,
		jetstream.ExpectedStreamHeader,
		jetstream.ExpectedLastSeqHeader,
		jetstream.ExpectedLastSubjSeqHeader,
		jetstream.ExpectedLastSubjSeqSubjHeader,
		jetstream.ExpectedLastMsgIDHeader,
		jetstream.MsgTTLHeader,
		jetstream.MsgRollup,
		jetstream.MarkerReasonHeader,
		jetstream.ScheduleHeader,
		jetstream.ScheduleTargetHeader,
	} {
		if strings.EqualFold(name, control) {
			return true
		}
	}
	return false
}

func validLiteralSubject(subject string) bool {
	if len(subject) == 0 || len(subject) > 255 || strings.ContainsAny(subject, "*>") {
		return false
	}
	for _, token := range strings.Split(subject, ".") {
		if token == "" {
			return false
		}
		for _, character := range token {
			if unicode.IsSpace(character) || unicode.IsControl(character) {
				return false
			}
		}
	}
	return true
}

func nilInterface(value any) bool {
	if value == nil {
		return true
	}
	reflected := reflect.ValueOf(value)
	switch reflected.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return reflected.IsNil()
	default:
		return false
	}
}
