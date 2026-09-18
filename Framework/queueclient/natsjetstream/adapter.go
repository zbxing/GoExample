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
	"unicode/utf8"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/zbxing/goexample/Framework/queueclient"
)

const (
	defaultFetchMaxWait       = time.Second
	minimumFetchMaxWait       = 10 * time.Millisecond
	maximumFetchMaxWait       = 30 * time.Second
	initialHeaderMapCapacity  = 8
	maximumPublishMessageID   = 256
	minimumConsumerDeliveries = 2
)

var jetStreamControlHeaders = [...]string{
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
}

var jetStreamControlHeaderSet = map[string]struct{}{
	jetstream.MsgIDHeader:                   {},
	jetstream.ExpectedStreamHeader:          {},
	jetstream.ExpectedLastSeqHeader:         {},
	jetstream.ExpectedLastSubjSeqHeader:     {},
	jetstream.ExpectedLastSubjSeqSubjHeader: {},
	jetstream.ExpectedLastMsgIDHeader:       {},
	jetstream.MsgTTLHeader:                  {},
	jetstream.MsgRollup:                     {},
	jetstream.MarkerReasonHeader:            {},
	jetstream.ScheduleHeader:                {},
	jetstream.ScheduleTargetHeader:          {},
}

var (
	// ErrInvalidConfiguration indicates an incomplete or unsafe adapter config.
	ErrInvalidConfiguration = errors.New("nats jetstream adapter configuration is invalid")
	// ErrInvalidContext indicates that an operation received a nil context.
	ErrInvalidContext = errors.New("nats jetstream operation context is nil")
	// ErrPublish indicates that JetStream did not confirm a publish. Backend
	// details are deliberately not exposed by this adapter.
	ErrPublish = errors.New("nats jetstream publish failed")
	// ErrInvalidMessageID indicates that a deduplicated publish did not provide
	// a bounded printable ASCII identifier.
	ErrInvalidMessageID = errors.New("nats jetstream publish message ID is invalid")
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
	// ErrConsumerAckPolicy indicates that the server reports an acknowledgement
	// policy incompatible with the adapter's per-message settlement contract.
	ErrConsumerAckPolicy = errors.New("nats jetstream consumer acknowledgement policy is incompatible")
	// ErrConsumerPaused indicates that the server reports the consumer is
	// currently paused and therefore cannot deliver work.
	ErrConsumerPaused = errors.New("nats jetstream consumer is paused")
	// ErrConsumerNotPull indicates that the server reports a push consumer,
	// which is incompatible with the adapter's bounded pull receive path.
	ErrConsumerNotPull = errors.New("nats jetstream consumer is not pull based")
	// ErrConsumerPriorityPolicy indicates that the server reports a priority
	// consumer requiring pull request options the adapter does not provide.
	ErrConsumerPriorityPolicy = errors.New("nats jetstream consumer priority policy is incompatible")
	// ErrAckWaitTooShort indicates that at least one server-reported redelivery
	// interval is shorter than queueclient's worst-case delivery budget.
	ErrAckWaitTooShort = errors.New("nats jetstream acknowledgement wait is too short")
	// ErrConsumerNotPersistent indicates that the server-reported consumer
	// cannot retain delivery state across an inactive process or broker restart.
	ErrConsumerNotPersistent = errors.New("nats jetstream consumer is not persistent")
	// ErrMaxDeliverTooLow indicates that the server-reported consumer does not
	// allow at least one redelivery after the initial delivery.
	ErrMaxDeliverTooLow = errors.New("nats jetstream consumer maximum deliveries is too low")
	// ErrConsumerPayloadUnavailable indicates that the server-reported consumer
	// is configured to omit message payloads from delivery.
	ErrConsumerPayloadUnavailable = errors.New("nats jetstream consumer payload is unavailable")
	// ErrConsumerDeliveryPolicy indicates that the server-reported consumer can
	// skip messages retained before the consumer starts.
	ErrConsumerDeliveryPolicy = errors.New("nats jetstream consumer delivery policy is not reliable")
	// ErrConsumerReplayPolicy indicates that the server-reported consumer can
	// preserve historical message intervals while replaying retained backlog.
	ErrConsumerReplayPolicy = errors.New("nats jetstream consumer replay policy is not reliable")
	// ErrConsumerRequestExpires indicates that the server-reported consumer's
	// pull request expiration limit is shorter than the adapter's bounded wait.
	ErrConsumerRequestExpires = errors.New("nats jetstream consumer request expiration is incompatible")
	// ErrConsumerSubjectMismatch indicates that the server-reported consumer
	// is not restricted to the adapter's exact application subject.
	ErrConsumerSubjectMismatch = errors.New("nats jetstream consumer subject does not match adapter")
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

// PreflightConsumer verifies the adapter's actual consumer and additionally
// requires pull mode with the default priority policy, exactly one
// server-reported filter equal to the adapter's literal application subject,
// and a pull expiration limit compatible with FetchMaxWait. This binds the
// receive path to the publish and server request boundaries.
func (adapter *Adapter) PreflightConsumer(
	ctx context.Context,
	client *queueclient.Client,
	retry queueclient.DeliveryRetryConfig,
	safetyMargin time.Duration,
) (time.Duration, error) {
	if ctx == nil {
		return 0, ErrInvalidContext
	}
	if adapter == nil || nilInterface(adapter.consumer) || !validLiteralSubject(adapter.subject) {
		return 0, ErrInvalidConfiguration
	}
	consumer, ok := adapter.consumer.(ConsumerInspector)
	if !ok || nilInterface(consumer) {
		return 0, ErrInvalidConfiguration
	}
	return preflightConsumer(ctx, consumer, client, retry, safetyMargin, adapter.subject, adapter.fetchMaxWait)
}

// PreflightConsumer verifies that a pre-provisioned explicit-ack pull consumer
// uses the default priority policy, is durable and file-backed, is not deleted
// automatically while inactive, starts with all retained matching messages,
// replays them as fast as possible, allows at least one redelivery, delivers
// complete message payloads, and has a server-reported AckWait (or every BackOff
// interval when BackOff overrides AckWait) that covers the queue client's
// handler/retry/settlement budget plus the caller's positive safety margin. It
// returns the required lease when a server-reported reliability check fails.
func PreflightConsumer(
	ctx context.Context,
	consumer ConsumerInspector,
	client *queueclient.Client,
	retry queueclient.DeliveryRetryConfig,
	safetyMargin time.Duration,
) (time.Duration, error) {
	return preflightConsumer(ctx, consumer, client, retry, safetyMargin, "", 0)
}

func preflightConsumer(
	ctx context.Context,
	consumer ConsumerInspector,
	client *queueclient.Client,
	retry queueclient.DeliveryRetryConfig,
	safetyMargin time.Duration,
	expectedSubject string,
	fetchMaxWait time.Duration,
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
	if contextErr := completedAdapterContextError(ctx); contextErr != nil {
		return 0, contextErr
	}
	info, err := consumer.Info(ctx)
	if contextErr := completedAdapterContextError(ctx); contextErr != nil {
		return 0, contextErr
	}
	if err != nil {
		return 0, ErrConsumerPreflight
	}
	if info == nil {
		return 0, ErrConsumerPreflight
	}
	if info.Config.AckPolicy != jetstream.AckExplicitPolicy {
		return required, ErrConsumerAckPolicy
	}
	if info.Paused {
		return required, ErrConsumerPaused
	}
	if info.Config.DeliverSubject != "" {
		return required, ErrConsumerNotPull
	}
	if info.Config.PriorityPolicy != jetstream.PriorityPolicyNone || len(info.Config.PriorityGroups) != 0 {
		return required, ErrConsumerPriorityPolicy
	}
	if info.Config.Durable == "" || info.Config.MemoryStorage || info.Config.InactiveThreshold != 0 {
		return required, ErrConsumerNotPersistent
	}
	if info.Config.DeliverPolicy != jetstream.DeliverAllPolicy {
		return required, ErrConsumerDeliveryPolicy
	}
	if info.Config.ReplayPolicy != jetstream.ReplayInstantPolicy {
		return required, ErrConsumerReplayPolicy
	}
	if info.Config.MaxDeliver != -1 && info.Config.MaxDeliver < minimumConsumerDeliveries {
		return required, ErrMaxDeliverTooLow
	}
	if info.Config.HeadersOnly {
		return required, ErrConsumerPayloadUnavailable
	}
	if expectedSubject != "" && !consumerFiltersExactSubject(info.Config, expectedSubject) {
		return required, ErrConsumerSubjectMismatch
	}
	if fetchMaxWait > 0 && info.Config.MaxRequestExpires > 0 && info.Config.MaxRequestExpires < fetchMaxWait {
		return required, ErrConsumerRequestExpires
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
	if contextErr := completedAdapterContextError(ctx); contextErr != nil {
		return 0, contextErr
	}
	return required, nil
}

func consumerFiltersExactSubject(config jetstream.ConsumerConfig, expectedSubject string) bool {
	if config.FilterSubject != "" {
		return config.FilterSubject == expectedSubject && len(config.FilterSubjects) == 0
	}
	return len(config.FilterSubjects) == 1 && config.FilterSubjects[0] == expectedSubject
}

// Publish synchronously publishes one message and waits for the server ack.
// JetStream control headers supplied as application data are not forwarded.
func (adapter *Adapter) Publish(ctx context.Context, message queueclient.Message) error {
	return adapter.publish(ctx, "", message, false)
}

// PublishDeduplicated synchronously publishes one message with a caller-owned
// stable ID. JetStream suppresses matching IDs only within the target stream's
// configured duplicate window; callers must reuse the ID for the same logical
// event. Application headers cannot override the typed control value.
func (adapter *Adapter) PublishDeduplicated(
	ctx context.Context,
	messageID string,
	message queueclient.Message,
) error {
	return adapter.publish(ctx, messageID, message, true)
}

func (adapter *Adapter) publish(
	ctx context.Context,
	messageID string,
	message queueclient.Message,
	requireMessageID bool,
) error {
	if adapter == nil || nilInterface(adapter.publisher) {
		return ErrInvalidConfiguration
	}
	if ctx == nil {
		return ErrInvalidContext
	}
	if requireMessageID && !validPublishMessageID(messageID) {
		return ErrInvalidMessageID
	}
	if completedAdapterContextError(ctx) != nil {
		return ErrPublish
	}
	brokerMessage := nats.NewMsg(adapter.subject)
	brokerMessage.Data = bytes.Clone(message.Body)
	copyApplicationHeaders(brokerMessage.Header, message.Headers)
	if requireMessageID {
		brokerMessage.Header.Set(jetstream.MsgIDHeader, messageID)
	}
	acknowledgement, err := adapter.publisher.PublishMsg(ctx, brokerMessage)
	if err != nil || !validPublishAcknowledgement(acknowledgement) {
		return ErrPublish
	}
	if completedAdapterContextError(ctx) != nil {
		return ErrPublish
	}
	return nil
}

// ReceiveDelivery waits in context-bound pulls until a message or cancellation
// is observed, then returns private confirmed-ack and DLQ callbacks.
func (adapter *Adapter) ReceiveDelivery(ctx context.Context) (queueclient.Delivery, error) {
	if adapter == nil || nilInterface(adapter.consumer) || nilInterface(adapter.publisher) {
		return queueclient.Delivery{}, ErrInvalidConfiguration
	}
	if ctx == nil {
		return queueclient.Delivery{}, ErrInvalidContext
	}
	for {
		if err := completedAdapterContextError(ctx); err != nil {
			return queueclient.Delivery{}, err
		}
		brokerMessage, err := receiveNext(ctx, adapter.consumer, adapter.fetchMaxWait)
		if err != nil {
			if contextErr := completedAdapterContextError(ctx); contextErr != nil {
				return queueclient.Delivery{}, contextErr
			}
			if errors.Is(err, jetstream.ErrNoMessages) || errors.Is(err, nats.ErrTimeout) {
				continue
			}
			return queueclient.Delivery{}, ErrReceive
		}
		message, err := fromJetStreamMessage(brokerMessage)
		if contextErr := completedAdapterContextError(ctx); contextErr != nil {
			return queueclient.Delivery{}, contextErr
		}
		if err != nil {
			if errors.Is(err, ErrInvalidMessage) {
				if quarantineErr := adapter.quarantineInvalidMessage(ctx, brokerMessage); quarantineErr != nil {
					return queueclient.Delivery{}, quarantineErr
				}
				continue
			}
			return queueclient.Delivery{}, err
		}
		return queueclient.Delivery{
			Message: message,
			ExtendLease: func(extensionContext context.Context) error {
				if extensionContext == nil {
					return ErrInvalidContext
				}
				if err := completedAdapterContextError(extensionContext); err != nil {
					return err
				}
				if err := brokerMessage.InProgress(); err != nil {
					return ErrLeaseExtension
				}
				if err := completedAdapterContextError(extensionContext); err != nil {
					return err
				}
				return nil
			},
			Acknowledge: func(settlementContext context.Context) error {
				if settlementContext == nil {
					return ErrInvalidContext
				}
				if completedAdapterContextError(settlementContext) != nil {
					return ErrAcknowledge
				}
				if err := brokerMessage.DoubleAck(settlementContext); err != nil {
					return ErrAcknowledge
				}
				if completedAdapterContextError(settlementContext) != nil {
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

func receiveNext(ctx context.Context, consumer Consumer, maximumWait time.Duration) (jetstream.Msg, error) {
	// A context with neither cancellation nor a deadline cannot change while a
	// pull is in flight. FetchMaxWait provides the same bounded request expiry
	// without allocating a short-lived child context and timer for every pull.
	// Keep FetchContext for every context that can complete independently so
	// caller cancellation and deadline precedence remain authoritative.
	if ctx.Done() == nil {
		if _, hasDeadline := ctx.Deadline(); !hasDeadline {
			startedAt := time.Now()
			message, err := consumer.Next(jetstream.FetchMaxWait(maximumWait))
			// FetchMaxWait bounds a real broker request. Keep the adapter's
			// authoritative local boundary for test doubles and late SDK results.
			if time.Since(startedAt) >= maximumWait {
				return nil, jetstream.ErrNoMessages
			}
			return message, err
		}
	}
	fetchContext, cancel := context.WithTimeout(ctx, maximumWait)
	defer cancel()
	message, err := consumer.Next(jetstream.FetchContext(fetchContext))
	if contextErr := completedAdapterContextError(ctx); contextErr != nil {
		return nil, contextErr
	}
	if fetchErr := completedAdapterContextError(fetchContext); fetchErr != nil {
		if errors.Is(fetchErr, context.DeadlineExceeded) {
			return nil, jetstream.ErrNoMessages
		}
		return nil, fetchErr
	}
	return message, err
}

func (adapter *Adapter) quarantineInvalidMessage(ctx context.Context, source jetstream.Msg) error {
	if source == nil {
		return ErrInvalidMessage
	}
	if contextErr := completedAdapterContextError(ctx); contextErr != nil {
		return contextErr
	}
	metadata, err := source.Metadata()
	if contextErr := completedAdapterContextError(ctx); contextErr != nil {
		return contextErr
	}
	if err != nil || metadata == nil || metadata.Stream == "" || metadata.Sequence.Stream == 0 {
		return ErrInvalidMessage
	}

	dlqMessage := nats.NewMsg(adapter.deadLetterSubject)
	dlqMessage.Data = bytes.Clone(source.Data())
	for name, values := range source.Headers() {
		if !jetStreamControlHeader(name) && len(values) == 1 {
			dlqMessage.Header.Set(name, values[0])
		}
	}
	dlqMessage.Header.Set(jetstream.MsgIDHeader, deadLetterID(metadata))
	acknowledgement, err := adapter.publisher.PublishMsg(ctx, dlqMessage)
	if contextErr := completedAdapterContextError(ctx); contextErr != nil {
		return contextErr
	}
	if err != nil || !validPublishAcknowledgement(acknowledgement) {
		return ErrDeadLetter
	}
	acknowledgeErr := source.DoubleAck(ctx)
	if contextErr := completedAdapterContextError(ctx); contextErr != nil {
		return contextErr
	}
	if acknowledgeErr != nil {
		return ErrDeadLetter
	}
	return nil
}

func (adapter *Adapter) deadLetter(ctx context.Context, source jetstream.Msg, message queueclient.Message) error {
	if ctx == nil {
		return ErrInvalidContext
	}
	if completedAdapterContextError(ctx) != nil {
		return ErrDeadLetter
	}
	metadata, err := source.Metadata()
	if completedAdapterContextError(ctx) != nil {
		return ErrDeadLetter
	}
	if err != nil || metadata == nil || metadata.Stream == "" || metadata.Sequence.Stream == 0 {
		return ErrInvalidMessage
	}
	dlqMessage := nats.NewMsg(adapter.deadLetterSubject)
	dlqMessage.Data = bytes.Clone(message.Body)
	copyApplicationHeaders(dlqMessage.Header, message.Headers)
	dlqMessage.Header.Set(jetstream.MsgIDHeader, deadLetterID(metadata))
	acknowledgement, err := adapter.publisher.PublishMsg(ctx, dlqMessage)
	if err != nil || !validPublishAcknowledgement(acknowledgement) {
		return ErrDeadLetter
	}
	if completedAdapterContextError(ctx) != nil {
		return ErrDeadLetter
	}
	if err := source.DoubleAck(ctx); err != nil {
		return ErrDeadLetter
	}
	if completedAdapterContextError(ctx) != nil {
		return ErrDeadLetter
	}
	return nil
}

func fromJetStreamMessage(message jetstream.Msg) (queueclient.Message, error) {
	if message == nil {
		return queueclient.Message{}, ErrInvalidMessage
	}
	headers := message.Headers()
	if len(headers) == 0 {
		return queueclient.Message{Body: bytes.Clone(message.Data())}, nil
	}
	if len(headers) == 1 {
		for name, values := range headers {
			if jetStreamControlHeader(name) {
				return queueclient.Message{Body: bytes.Clone(message.Data())}, nil
			}
			if len(values) != 1 {
				return queueclient.Message{}, ErrInvalidMessage
			}
			return queueclient.Message{
				Body:    bytes.Clone(message.Data()),
				Headers: map[string]string{name: values[0]},
			}, nil
		}
	}
	// Small control-only batches are common on JetStream metadata messages.
	// Scan them before allocating an application map; the larger path below
	// already performs the same lazy count when it can benefit from a capacity
	// hint. Control headers are intentionally accepted without inspecting their
	// value cardinality, matching the existing filtering contract.
	if len(headers) <= len(jetStreamControlHeaders) {
		controlOnly := true
		for name := range headers {
			if !jetStreamControlHeader(name) {
				controlOnly = false
				break
			}
		}
		if controlOnly {
			return queueclient.Message{Body: bytes.Clone(message.Data())}, nil
		}
	}
	var clonedHeaders map[string]string
	// Common small sets can be copied in one pass. Only scan first when a large
	// incoming map benefits from an exact capacity hint; keep control-only
	// messages lazy so broker metadata does not force an application map.
	if len(headers) > initialHeaderMapCapacity {
		applicationHeaderCount := 0
		for name := range headers {
			if !jetStreamControlHeader(name) {
				applicationHeaderCount++
			}
		}
		if applicationHeaderCount > 0 {
			clonedHeaders = make(map[string]string, applicationHeaderCount)
		}
	} else {
		clonedHeaders = make(map[string]string)
	}
	result := queueclient.Message{Headers: clonedHeaders}
	for name, values := range headers {
		if jetStreamControlHeader(name) {
			continue
		}
		if len(values) != 1 {
			return queueclient.Message{}, ErrInvalidMessage
		}
		result.Headers[name] = values[0]
	}
	// Delay cloning the body until every header has passed validation. Invalid
	// deliveries are quarantined from the broker message and never expose a
	// queueclient body, so this avoids retaining an otherwise discarded clone.
	result.Body = bytes.Clone(message.Data())
	return result, nil
}

func copyApplicationHeaders(result nats.Header, headers map[string]string) {
	for name, value := range headers {
		if !jetStreamControlHeader(name) {
			result.Set(name, value)
		}
	}
}

func validPublishMessageID(value string) bool {
	if len(value) == 0 || len(value) > maximumPublishMessageID {
		return false
	}
	for index := range len(value) {
		if value[index] < '!' || value[index] > '~' {
			return false
		}
	}
	return true
}

func validPublishAcknowledgement(acknowledgement *jetstream.PubAck) bool {
	if acknowledgement == nil || acknowledgement.Stream == "" || acknowledgement.Sequence == 0 {
		return false
	}
	return true
}

func completedAdapterContextError(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if deadline, ok := ctx.Deadline(); ok && !time.Now().Before(deadline) {
		return context.DeadlineExceeded
	}
	return nil
}

func deadLetterID(metadata *jetstream.MsgMetadata) string {
	// Keep the common subject/consumer values on the stack and hash the exact
	// same NUL-delimited input. The fallback append path preserves behavior for
	// unusually long metadata without imposing a new length limit.
	var input [256]byte
	encoded := input[:0]
	encoded = append(encoded, metadata.Stream...)
	encoded = append(encoded, 0)
	encoded = append(encoded, metadata.Consumer...)
	encoded = append(encoded, 0)
	encoded = strconv.AppendUint(encoded, metadata.Sequence.Stream, 10)
	digest := sha256.Sum256(encoded)
	var encodedDigest [sha256.Size * 2]byte
	hex.Encode(encodedDigest[:], digest[:])

	// strings.Builder owns one final result buffer, avoiding intermediate hex
	// and concatenation strings while keeping the public ID byte-for-byte stable.
	var result strings.Builder
	result.Grow(len("goexample-dlq-") + len(encodedDigest))
	result.WriteString("goexample-dlq-")
	_, _ = result.Write(encodedDigest[:])
	return result.String()
}

func jetStreamControlHeader(name string) bool {
	if _, ok := jetStreamControlHeaderSet[name]; ok {
		return true
	}
	// Most application headers do not share a control-header length. Dispatch
	// by length first so mixed-case compatibility checks only compare candidates
	// that can actually match instead of scanning the complete control list.
	switch len(name) {
	case len(jetstream.MsgIDHeader):
		return strings.EqualFold(name, jetstream.MsgIDHeader) || strings.EqualFold(name, jetstream.MsgRollup)
	case len(jetstream.ExpectedStreamHeader):
		return strings.EqualFold(name, jetstream.ExpectedStreamHeader) || strings.EqualFold(name, jetstream.ScheduleTargetHeader)
	case len(jetstream.ExpectedLastSeqHeader):
		return strings.EqualFold(name, jetstream.ExpectedLastSeqHeader)
	case len(jetstream.ExpectedLastSubjSeqHeader):
		return strings.EqualFold(name, jetstream.ExpectedLastSubjSeqHeader)
	case len(jetstream.ExpectedLastSubjSeqSubjHeader):
		return strings.EqualFold(name, jetstream.ExpectedLastSubjSeqSubjHeader)
	case len(jetstream.ExpectedLastMsgIDHeader):
		return strings.EqualFold(name, jetstream.ExpectedLastMsgIDHeader)
	case len(jetstream.MsgTTLHeader):
		return strings.EqualFold(name, jetstream.MsgTTLHeader)
	case len(jetstream.MarkerReasonHeader):
		return strings.EqualFold(name, jetstream.MarkerReasonHeader)
	case len(jetstream.ScheduleHeader):
		return strings.EqualFold(name, jetstream.ScheduleHeader)
	default:
		return false
	}
}

func validLiteralSubject(subject string) bool {
	if len(subject) == 0 || len(subject) > 255 {
		return false
	}
	// Keep wildcard, token, and Unicode classification in one UTF-8-aware scan.
	tokenHasCharacter := false
	for offset := 0; offset < len(subject); {
		character := subject[offset]
		offset++
		if character == '*' || character == '>' {
			return false
		}
		if character == '.' {
			if !tokenHasCharacter {
				return false
			}
			tokenHasCharacter = false
			continue
		}
		if character < utf8.RuneSelf {
			if character <= ' ' || character == '\x7f' {
				return false
			}
			tokenHasCharacter = true
			continue
		}
		decoded, size := utf8.DecodeRuneInString(subject[offset-1:])
		offset += size - 1
		if unicode.IsSpace(decoded) || unicode.IsControl(decoded) {
			return false
		}
		tokenHasCharacter = true
	}
	return tokenHasCharacter
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
