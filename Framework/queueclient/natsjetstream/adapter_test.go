package natsjetstream

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/zbxing/goexample/Framework/queueclient"
)

func TestNewValidatesDependenciesSubjectsAndFetchBudget(t *testing.T) {
	publisher := &fakePublisher{}
	consumer := &fakeConsumer{}
	valid := Config{Subject: "events.primary", DeadLetterSubject: "events.dlq"}
	var nilPublisher *fakePublisher
	var nilConsumer *fakeConsumer
	for name, test := range map[string]struct {
		publisher Publisher
		consumer  Consumer
		config    Config
	}{
		"nil publisher":        {consumer: consumer, config: valid},
		"typed nil publisher":  {publisher: nilPublisher, consumer: consumer, config: valid},
		"nil consumer":         {publisher: publisher, config: valid},
		"typed nil consumer":   {publisher: publisher, consumer: nilConsumer, config: valid},
		"wildcard subject":     {publisher: publisher, consumer: consumer, config: Config{Subject: "events.*", DeadLetterSubject: "events.dlq"}},
		"empty token":          {publisher: publisher, consumer: consumer, config: Config{Subject: "events..primary", DeadLetterSubject: "events.dlq"}},
		"same dead letter":     {publisher: publisher, consumer: consumer, config: Config{Subject: "events.primary", DeadLetterSubject: "events.primary"}},
		"short fetch wait":     {publisher: publisher, consumer: consumer, config: Config{Subject: "events.primary", DeadLetterSubject: "events.dlq", FetchMaxWait: time.Millisecond}},
		"unbounded fetch wait": {publisher: publisher, consumer: consumer, config: Config{Subject: "events.primary", DeadLetterSubject: "events.dlq", FetchMaxWait: time.Minute}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := New(test.publisher, test.consumer, test.config); !errors.Is(err, ErrInvalidConfiguration) {
				t.Fatalf("New() error = %v", err)
			}
		})
	}
	adapter, err := New(publisher, consumer, valid)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if adapter.fetchMaxWait != defaultFetchMaxWait {
		t.Fatalf("default fetch wait = %s", adapter.fetchMaxWait)
	}
}

func TestPreflightConsumerUsesServerAckWaitAndBackoff(t *testing.T) {
	client, err := queueclient.New(queueclient.Config{
		System:         queueclient.SystemNATS,
		ProcessTimeout: time.Second,
	})
	if err != nil {
		t.Fatalf("queueclient.New() error = %v", err)
	}
	retry := queueclient.DeliveryRetryConfig{
		MaxAttempts:       2,
		InitialBackoff:    100 * time.Millisecond,
		MaxBackoff:        200 * time.Millisecond,
		SettlementTimeout: 500 * time.Millisecond,
	}
	const required = 2700 * time.Millisecond
	for name, test := range map[string]struct {
		config  jetstream.ConsumerConfig
		wantErr error
	}{
		"ack wait above budget": {
			config: jetstream.ConsumerConfig{AckPolicy: jetstream.AckExplicitPolicy, AckWait: 3 * time.Second},
		},
		"exact boundary": {
			config: jetstream.ConsumerConfig{AckPolicy: jetstream.AckExplicitPolicy, AckWait: required},
		},
		"short ack wait": {
			config:  jetstream.ConsumerConfig{AckPolicy: jetstream.AckExplicitPolicy, AckWait: required - time.Nanosecond},
			wantErr: ErrAckWaitTooShort,
		},
		"all backoff intervals sufficient": {
			config: jetstream.ConsumerConfig{
				AckPolicy: jetstream.AckExplicitPolicy,
				AckWait:   time.Millisecond,
				BackOff:   []time.Duration{3 * time.Second, required},
			},
		},
		"later backoff interval too short": {
			config: jetstream.ConsumerConfig{
				AckPolicy: jetstream.AckExplicitPolicy,
				AckWait:   time.Hour,
				BackOff:   []time.Duration{3 * time.Second, required - time.Nanosecond},
			},
			wantErr: ErrAckWaitTooShort,
		},
	} {
		t.Run(name, func(t *testing.T) {
			budget, err := PreflightConsumer(context.Background(), &fakeConsumer{
				info: &jetstream.ConsumerInfo{Config: test.config},
			}, client, retry, 100*time.Millisecond)
			if !errors.Is(err, test.wantErr) || budget != required {
				t.Fatalf("PreflightConsumer() = %s, %v", budget, err)
			}
		})
	}
}

func TestPreflightConsumerRejectsInvalidOrUnavailableConfiguration(t *testing.T) {
	client, err := queueclient.New(queueclient.Config{System: queueclient.SystemNATS})
	if err != nil {
		t.Fatalf("queueclient.New() error = %v", err)
	}
	validInfo := &jetstream.ConsumerInfo{Config: jetstream.ConsumerConfig{
		AckPolicy: jetstream.AckExplicitPolicy,
		AckWait:   2 * time.Minute,
	}}
	var typedNil *fakeConsumer
	for name, test := range map[string]struct {
		ctx      context.Context
		consumer ConsumerInspector
		client   *queueclient.Client
		margin   time.Duration
		wantErr  error
	}{
		"nil context":      {consumer: &fakeConsumer{info: validInfo}, client: client, margin: time.Second, wantErr: ErrInvalidContext},
		"nil inspector":    {ctx: context.Background(), client: client, margin: time.Second, wantErr: ErrInvalidConfiguration},
		"typed nil":        {ctx: context.Background(), consumer: typedNil, client: client, margin: time.Second, wantErr: ErrInvalidConfiguration},
		"nil client":       {ctx: context.Background(), consumer: &fakeConsumer{info: validInfo}, margin: time.Second, wantErr: ErrInvalidConfiguration},
		"zero margin":      {ctx: context.Background(), consumer: &fakeConsumer{info: validInfo}, client: client, wantErr: ErrInvalidConfiguration},
		"negative margin":  {ctx: context.Background(), consumer: &fakeConsumer{info: validInfo}, client: client, margin: -time.Second, wantErr: ErrInvalidConfiguration},
		"info failure":     {ctx: context.Background(), consumer: &fakeConsumer{infoErr: errors.New("private-server-url")}, client: client, margin: time.Second, wantErr: ErrConsumerPreflight},
		"nil info":         {ctx: context.Background(), consumer: &fakeConsumer{}, client: client, margin: time.Second, wantErr: ErrConsumerPreflight},
		"non-explicit ack": {ctx: context.Background(), consumer: &fakeConsumer{info: &jetstream.ConsumerInfo{}}, client: client, margin: time.Second, wantErr: ErrConsumerPreflight},
		"zero ack wait":    {ctx: context.Background(), consumer: &fakeConsumer{info: &jetstream.ConsumerInfo{Config: jetstream.ConsumerConfig{AckPolicy: jetstream.AckExplicitPolicy}}}, client: client, margin: time.Second, wantErr: ErrConsumerPreflight},
		"negative backoff": {ctx: context.Background(), consumer: &fakeConsumer{info: &jetstream.ConsumerInfo{Config: jetstream.ConsumerConfig{AckPolicy: jetstream.AckExplicitPolicy, BackOff: []time.Duration{-time.Second}}}}, client: client, margin: time.Second, wantErr: ErrConsumerPreflight},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := PreflightConsumer(test.ctx, test.consumer, test.client, queueclient.DeliveryRetryConfig{}, test.margin)
			if !errors.Is(err, test.wantErr) || strings.Contains(err.Error(), "private") {
				t.Fatalf("PreflightConsumer() error = %v", err)
			}
		})
	}
}

func TestAdapterPublishesReceivesAndAcknowledgesClonedMessages(t *testing.T) {
	publisher := &fakePublisher{}
	brokerMessage := &fakeMessage{
		data: []byte("received"),
		headers: nats.Header{
			"Tenant":              []string{"tenant-a"},
			jetstream.MsgIDHeader: []string{"broker-private-id"},
		},
		metadata: &jetstream.MsgMetadata{Stream: "EVENTS", Consumer: "WORKER", Sequence: jetstream.SequencePair{Stream: 1}},
	}
	consumer := &fakeConsumer{messages: []jetstream.Msg{brokerMessage}}
	adapter, err := New(publisher, consumer, Config{Subject: "events.primary", DeadLetterSubject: "events.dlq"})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	body := []byte("published")
	headers := map[string]string{"Tenant": "tenant-a", jetstream.MsgIDHeader: "caller-controlled"}
	if err := adapter.Publish(context.Background(), queueclient.Message{Body: body, Headers: headers}); err != nil {
		t.Fatalf("Publish() error = %v", err)
	}
	body[0] = 'X'
	headers["Tenant"] = "mutated"
	published := publisher.snapshot()
	if len(published) != 1 || string(published[0].Data) != "published" || published[0].Header.Get("Tenant") != "tenant-a" {
		t.Fatalf("published messages = %#v", published)
	}
	if published[0].Header.Get(jetstream.MsgIDHeader) != "" {
		t.Fatalf("caller JetStream control header was forwarded: %#v", published[0].Header)
	}

	delivery, err := adapter.ReceiveDelivery(context.Background())
	if err != nil {
		t.Fatalf("ReceiveDelivery() error = %v", err)
	}
	if string(delivery.Message.Body) != "received" || delivery.Message.Headers["Tenant"] != "tenant-a" {
		t.Fatalf("delivery message = %#v", delivery.Message)
	}
	if _, ok := delivery.Message.Headers[jetstream.MsgIDHeader]; ok {
		t.Fatalf("broker control header reached application: %#v", delivery.Message.Headers)
	}
	delivery.Message.Body[0] = 'X'
	if string(brokerMessage.data) != "received" {
		t.Fatalf("delivery body aliased broker data: %q", brokerMessage.data)
	}
	if err := delivery.ExtendLease(context.Background()); err != nil {
		t.Fatalf("ExtendLease() error = %v", err)
	}
	if brokerMessage.inProgressCalls != 1 {
		t.Fatalf("InProgress() calls = %d", brokerMessage.inProgressCalls)
	}
	if err := delivery.Acknowledge(context.Background()); err != nil {
		t.Fatalf("Acknowledge() error = %v", err)
	}
	if brokerMessage.doubleAckCalls != 1 {
		t.Fatalf("DoubleAck() calls = %d", brokerMessage.doubleAckCalls)
	}
}

func TestAdapterDeadLetterIsPublishBeforeAckAndDedupeStable(t *testing.T) {
	publisher := &fakePublisher{publishErr: errors.New("private publish failure")}
	brokerMessage := &fakeMessage{
		data: []byte("dead-letter-body"),
		headers: nats.Header{
			"Tenant":                       []string{"tenant-a"},
			jetstream.ExpectedStreamHeader: []string{"private-stream"},
		},
		metadata: &jetstream.MsgMetadata{Stream: "EVENTS", Consumer: "WORKER", Sequence: jetstream.SequencePair{Stream: 7}},
	}
	adapter, err := New(publisher, &fakeConsumer{messages: []jetstream.Msg{brokerMessage}}, Config{
		Subject:           "events.primary",
		DeadLetterSubject: "events.dlq",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	delivery, err := adapter.ReceiveDelivery(context.Background())
	if err != nil {
		t.Fatalf("ReceiveDelivery() error = %v", err)
	}
	if err := delivery.DeadLetter(context.Background()); !errors.Is(err, ErrDeadLetter) {
		t.Fatalf("DeadLetter(publish failure) error = %v", err)
	}
	if brokerMessage.doubleAckCalls != 0 {
		t.Fatalf("source was acked after failed DLQ publish: %d", brokerMessage.doubleAckCalls)
	}

	publisher.publishErr = nil
	brokerMessage.doubleAckErr = errors.New("private ack failure")
	if err := delivery.DeadLetter(context.Background()); !errors.Is(err, ErrDeadLetter) {
		t.Fatalf("DeadLetter(ack failure) error = %v", err)
	}
	brokerMessage.doubleAckErr = nil
	if err := delivery.DeadLetter(context.Background()); err != nil {
		t.Fatalf("DeadLetter(retry) error = %v", err)
	}
	published := publisher.snapshot()
	if len(published) != 2 {
		t.Fatalf("DLQ publishes = %d", len(published))
	}
	firstID := published[0].Header.Get(jetstream.MsgIDHeader)
	if firstID == "" || firstID != published[1].Header.Get(jetstream.MsgIDHeader) || strings.Contains(firstID, "EVENTS") {
		t.Fatalf("DLQ dedupe IDs = %q/%q", firstID, published[1].Header.Get(jetstream.MsgIDHeader))
	}
	for _, message := range published {
		if message.Subject != "events.dlq" || string(message.Data) != "dead-letter-body" || message.Header.Get("Tenant") != "tenant-a" {
			t.Fatalf("DLQ message = %#v", message)
		}
		if message.Header.Get(jetstream.ExpectedStreamHeader) != "" {
			t.Fatalf("source publish control header reached DLQ: %#v", message.Header)
		}
	}
	if brokerMessage.doubleAckCalls != 2 {
		t.Fatalf("source DoubleAck() calls = %d", brokerMessage.doubleAckCalls)
	}
}

func TestAdapterErrorsAreFixedAndInvalidHeadersFailClosed(t *testing.T) {
	publisher := &fakePublisher{publishErr: errors.New("credential-secret")}
	adapter, err := New(publisher, &fakeConsumer{}, Config{Subject: "events.primary", DeadLetterSubject: "events.dlq"})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if err := adapter.Publish(context.Background(), queueclient.Message{}); !errors.Is(err, ErrPublish) || strings.Contains(err.Error(), "credential") {
		t.Fatalf("Publish() error = %v", err)
	}

	adapter.consumer = &fakeConsumer{nextErr: errors.New("server-url-secret")}
	if _, err := adapter.ReceiveDelivery(context.Background()); !errors.Is(err, ErrReceive) || strings.Contains(err.Error(), "server-url") {
		t.Fatalf("ReceiveDelivery() error = %v", err)
	}

	adapter.consumer = &fakeConsumer{messages: []jetstream.Msg{&fakeMessage{
		data:    []byte("invalid"),
		headers: nats.Header{"Tenant": []string{"one", "two"}},
	}}}
	if _, err := adapter.ReceiveDelivery(context.Background()); !errors.Is(err, ErrInvalidMessage) {
		t.Fatalf("ReceiveDelivery(multi-value header) error = %v", err)
	}

	ackMessage := &fakeMessage{
		inProgressErr: errors.New("lease-secret"),
		doubleAckErr:  errors.New("ack-secret"),
	}
	adapter.consumer = &fakeConsumer{messages: []jetstream.Msg{ackMessage}}
	delivery, err := adapter.ReceiveDelivery(context.Background())
	if err != nil {
		t.Fatalf("ReceiveDelivery(ack) error = %v", err)
	}
	if err := delivery.Acknowledge(context.Background()); !errors.Is(err, ErrAcknowledge) || strings.Contains(err.Error(), "secret") {
		t.Fatalf("Acknowledge() error = %v", err)
	}
	if err := delivery.Acknowledge(nil); !errors.Is(err, ErrInvalidContext) {
		t.Fatalf("Acknowledge(nil) error = %v", err)
	}
	if err := delivery.ExtendLease(context.Background()); !errors.Is(err, ErrLeaseExtension) || strings.Contains(err.Error(), "secret") {
		t.Fatalf("ExtendLease() error = %v", err)
	}
	if err := delivery.ExtendLease(nil); !errors.Is(err, ErrInvalidContext) {
		t.Fatalf("ExtendLease(nil) error = %v", err)
	}
}

func TestAdapterReceiveHonorsCancellationBetweenBoundedPulls(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	consumer := &fakeConsumer{}
	consumer.next = func() (jetstream.Msg, error) {
		cancel()
		return nil, jetstream.ErrNoMessages
	}
	adapter, err := New(&fakePublisher{}, consumer, Config{Subject: "events.primary", DeadLetterSubject: "events.dlq"})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if _, err := adapter.ReceiveDelivery(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("ReceiveDelivery() error = %v", err)
	}
	if _, err := adapter.ReceiveDelivery(nil); !errors.Is(err, ErrInvalidContext) {
		t.Fatalf("ReceiveDelivery(nil) error = %v", err)
	}
}

type fakePublisher struct {
	mu         sync.Mutex
	messages   []*nats.Msg
	publishErr error
}

func (publisher *fakePublisher) PublishMsg(_ context.Context, message *nats.Msg, _ ...jetstream.PublishOpt) (*jetstream.PubAck, error) {
	if publisher.publishErr != nil {
		return nil, publisher.publishErr
	}
	publisher.mu.Lock()
	defer publisher.mu.Unlock()
	cloned := nats.NewMsg(message.Subject)
	cloned.Data = bytes.Clone(message.Data)
	cloned.Header = nats.Header{}
	for name, values := range message.Header {
		cloned.Header[name] = append([]string(nil), values...)
	}
	publisher.messages = append(publisher.messages, cloned)
	return &jetstream.PubAck{Stream: "TEST", Sequence: uint64(len(publisher.messages))}, nil
}

func (publisher *fakePublisher) snapshot() []*nats.Msg {
	publisher.mu.Lock()
	defer publisher.mu.Unlock()
	return append([]*nats.Msg(nil), publisher.messages...)
}

type fakeConsumer struct {
	messages []jetstream.Msg
	nextErr  error
	next     func() (jetstream.Msg, error)
	info     *jetstream.ConsumerInfo
	infoErr  error
}

func (consumer *fakeConsumer) Next(...jetstream.FetchOpt) (jetstream.Msg, error) {
	if consumer.next != nil {
		return consumer.next()
	}
	if consumer.nextErr != nil {
		return nil, consumer.nextErr
	}
	if len(consumer.messages) == 0 {
		return nil, jetstream.ErrNoMessages
	}
	message := consumer.messages[0]
	consumer.messages = consumer.messages[1:]
	return message, nil
}

func (consumer *fakeConsumer) Info(context.Context) (*jetstream.ConsumerInfo, error) {
	return consumer.info, consumer.infoErr
}

type fakeMessage struct {
	data            []byte
	headers         nats.Header
	metadata        *jetstream.MsgMetadata
	metadataErr     error
	inProgressCalls int
	inProgressErr   error
	doubleAckCalls  int
	doubleAckErr    error
}

func (message *fakeMessage) Metadata() (*jetstream.MsgMetadata, error) {
	return message.metadata, message.metadataErr
}

func (message *fakeMessage) Data() []byte             { return message.data }
func (message *fakeMessage) Headers() nats.Header     { return message.headers }
func (*fakeMessage) Subject() string                  { return "events.primary" }
func (*fakeMessage) Reply() string                    { return "" }
func (*fakeMessage) Ack() error                       { return nil }
func (*fakeMessage) Nak() error                       { return nil }
func (*fakeMessage) NakWithDelay(time.Duration) error { return nil }
func (message *fakeMessage) InProgress() error {
	message.inProgressCalls++
	return message.inProgressErr
}
func (*fakeMessage) Term() error                 { return nil }
func (*fakeMessage) TermWithReason(string) error { return nil }

func (message *fakeMessage) DoubleAck(context.Context) error {
	message.doubleAckCalls++
	return message.doubleAckErr
}
