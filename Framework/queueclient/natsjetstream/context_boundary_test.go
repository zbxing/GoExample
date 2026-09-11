package natsjetstream

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/zbxing/goexample/Framework/queueclient"
)

func TestAdapterRejectsCompletedContextsWithoutBrokerCalls(t *testing.T) {
	canceledContext, cancel := context.WithCancel(context.Background())
	cancel()

	t.Run("preflight", func(t *testing.T) {
		consumer := &contextBoundaryConsumer{infoResult: validContextBoundaryConsumerInfo()}
		adapter := newContextBoundaryAdapter(t, &contextBoundaryPublisher{}, consumer)
		client := newContextBoundaryQueueClient(t)
		if _, err := adapter.PreflightConsumer(canceledContext, client, queueclient.DeliveryRetryConfig{}, time.Second); !errors.Is(err, context.Canceled) {
			t.Fatalf("PreflightConsumer() error = %v", err)
		}
		if consumer.infoCalls != 0 {
			t.Fatalf("Info() calls = %d, want 0", consumer.infoCalls)
		}
	})

	for name, deduplicated := range map[string]bool{"publish": false, "deduplicated publish": true} {
		t.Run(name, func(t *testing.T) {
			publisher := &contextBoundaryPublisher{}
			adapter := newContextBoundaryAdapter(t, publisher, &contextBoundaryConsumer{})
			var err error
			if deduplicated {
				err = adapter.PublishDeduplicated(canceledContext, "stable-message-id", queueclient.Message{})
			} else {
				err = adapter.Publish(canceledContext, queueclient.Message{})
			}
			if !errors.Is(err, ErrPublish) {
				t.Fatalf("Publish() error = %v", err)
			}
			if publisher.calls != 0 {
				t.Fatalf("PublishMsg() calls = %d, want 0", publisher.calls)
			}
		})
	}

	t.Run("receive", func(t *testing.T) {
		consumer := &contextBoundaryConsumer{}
		adapter := newContextBoundaryAdapter(t, &contextBoundaryPublisher{}, consumer)
		if _, err := adapter.ReceiveDelivery(canceledContext); !errors.Is(err, context.Canceled) {
			t.Fatalf("ReceiveDelivery() error = %v", err)
		}
		if consumer.nextCalls != 0 {
			t.Fatalf("Next() calls = %d, want 0", consumer.nextCalls)
		}
	})

	for name, invoke := range map[string]func(queueclient.Delivery, context.Context) error{
		"extend lease": func(delivery queueclient.Delivery, ctx context.Context) error { return delivery.ExtendLease(ctx) },
		"acknowledge":  func(delivery queueclient.Delivery, ctx context.Context) error { return delivery.Acknowledge(ctx) },
		"dead letter":  func(delivery queueclient.Delivery, ctx context.Context) error { return delivery.DeadLetter(ctx) },
	} {
		t.Run(name, func(t *testing.T) {
			publisher := &contextBoundaryPublisher{}
			message := newContextBoundaryMessage()
			consumer := &contextBoundaryConsumer{nextResult: message}
			adapter := newContextBoundaryAdapter(t, publisher, consumer)
			delivery, err := adapter.ReceiveDelivery(context.Background())
			if err != nil {
				t.Fatalf("ReceiveDelivery() error = %v", err)
			}
			err = invoke(delivery, canceledContext)
			switch name {
			case "extend lease":
				if !errors.Is(err, context.Canceled) || message.inProgressCalls != 0 {
					t.Fatalf("ExtendLease() = %v, calls %d", err, message.inProgressCalls)
				}
			case "acknowledge":
				if !errors.Is(err, ErrAcknowledge) || message.doubleAckCalls != 0 {
					t.Fatalf("Acknowledge() = %v, calls %d", err, message.doubleAckCalls)
				}
			case "dead letter":
				if !errors.Is(err, ErrDeadLetter) || publisher.calls != 0 || message.metadataCalls != 0 || message.doubleAckCalls != 0 {
					t.Fatalf("DeadLetter() = %v, publish/metadata/ack calls %d/%d/%d", err, publisher.calls, message.metadataCalls, message.doubleAckCalls)
				}
			}
		})
	}

	t.Run("elapsed deadline without done signal", func(t *testing.T) {
		publisher := &contextBoundaryPublisher{}
		adapter := newContextBoundaryAdapter(t, publisher, &contextBoundaryConsumer{})
		ctx := contextBoundaryDeadlineOnlyContext{deadline: time.Now().Add(-time.Second)}
		if err := adapter.Publish(ctx, queueclient.Message{}); !errors.Is(err, ErrPublish) {
			t.Fatalf("Publish() error = %v", err)
		}
		if publisher.calls != 0 {
			t.Fatalf("PublishMsg() calls = %d, want 0", publisher.calls)
		}
	})
}

func TestAdapterRejectsLateSuccessfulBrokerResults(t *testing.T) {
	t.Run("preflight info", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		consumer := &contextBoundaryConsumer{
			info: func(context.Context) (*jetstream.ConsumerInfo, error) {
				cancel()
				return validContextBoundaryConsumerInfo(), nil
			},
		}
		adapter := newContextBoundaryAdapter(t, &contextBoundaryPublisher{}, consumer)
		if _, err := adapter.PreflightConsumer(ctx, newContextBoundaryQueueClient(t), queueclient.DeliveryRetryConfig{}, time.Second); !errors.Is(err, context.Canceled) {
			t.Fatalf("PreflightConsumer() error = %v", err)
		}
	})

	t.Run("publish acknowledgement", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		publisher := &contextBoundaryPublisher{publish: func(context.Context, *nats.Msg) (*jetstream.PubAck, error) {
			cancel()
			return validContextBoundaryPublishAck(), nil
		}}
		adapter := newContextBoundaryAdapter(t, publisher, &contextBoundaryConsumer{})
		if err := adapter.Publish(ctx, queueclient.Message{}); !errors.Is(err, ErrPublish) {
			t.Fatalf("Publish() error = %v", err)
		}
	})

	t.Run("received message", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		consumer := &contextBoundaryConsumer{next: func(...jetstream.FetchOpt) (jetstream.Msg, error) {
			cancel()
			return newContextBoundaryMessage(), nil
		}}
		adapter := newContextBoundaryAdapter(t, &contextBoundaryPublisher{}, consumer)
		if _, err := adapter.ReceiveDelivery(ctx); !errors.Is(err, context.Canceled) {
			t.Fatalf("ReceiveDelivery() error = %v", err)
		}
	})

	t.Run("lease extension", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		message := newContextBoundaryMessage()
		message.inProgress = func() error {
			cancel()
			return nil
		}
		delivery := receiveContextBoundaryDelivery(t, message, &contextBoundaryPublisher{})
		if err := delivery.ExtendLease(ctx); !errors.Is(err, context.Canceled) {
			t.Fatalf("ExtendLease() error = %v", err)
		}
		if message.inProgressCalls != 1 {
			t.Fatalf("InProgress() calls = %d, want 1", message.inProgressCalls)
		}
	})

	t.Run("source acknowledgement", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		message := newContextBoundaryMessage()
		message.doubleAck = func(context.Context) error {
			cancel()
			return nil
		}
		delivery := receiveContextBoundaryDelivery(t, message, &contextBoundaryPublisher{})
		if err := delivery.Acknowledge(ctx); !errors.Is(err, ErrAcknowledge) {
			t.Fatalf("Acknowledge() error = %v", err)
		}
	})

	t.Run("dead-letter publish", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		publisher := &contextBoundaryPublisher{publish: func(context.Context, *nats.Msg) (*jetstream.PubAck, error) {
			cancel()
			return validContextBoundaryPublishAck(), nil
		}}
		message := newContextBoundaryMessage()
		delivery := receiveContextBoundaryDelivery(t, message, publisher)
		if err := delivery.DeadLetter(ctx); !errors.Is(err, ErrDeadLetter) {
			t.Fatalf("DeadLetter() error = %v", err)
		}
		if message.doubleAckCalls != 0 {
			t.Fatalf("DoubleAck() calls = %d, want 0", message.doubleAckCalls)
		}
	})

	t.Run("dead-letter source acknowledgement", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		message := newContextBoundaryMessage()
		message.doubleAck = func(context.Context) error {
			cancel()
			return nil
		}
		delivery := receiveContextBoundaryDelivery(t, message, &contextBoundaryPublisher{})
		if err := delivery.DeadLetter(ctx); !errors.Is(err, ErrDeadLetter) {
			t.Fatalf("DeadLetter() error = %v", err)
		}
	})

	t.Run("invalid-message quarantine publish", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		publisher := &contextBoundaryPublisher{publish: func(context.Context, *nats.Msg) (*jetstream.PubAck, error) {
			cancel()
			return validContextBoundaryPublishAck(), nil
		}}
		message := newContextBoundaryMessage()
		message.headers = nats.Header{"Tenant": []string{"one", "two"}}
		adapter := newContextBoundaryAdapter(t, publisher, &contextBoundaryConsumer{nextResult: message})
		if _, err := adapter.ReceiveDelivery(ctx); !errors.Is(err, context.Canceled) {
			t.Fatalf("ReceiveDelivery() error = %v", err)
		}
		if message.doubleAckCalls != 0 {
			t.Fatalf("DoubleAck() calls = %d, want 0", message.doubleAckCalls)
		}
	})

	t.Run("invalid-message quarantine acknowledgement", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		message := newContextBoundaryMessage()
		message.headers = nats.Header{"Tenant": []string{"one", "two"}}
		message.doubleAck = func(context.Context) error {
			cancel()
			return nil
		}
		adapter := newContextBoundaryAdapter(t, &contextBoundaryPublisher{}, &contextBoundaryConsumer{nextResult: message})
		if _, err := adapter.ReceiveDelivery(ctx); !errors.Is(err, context.Canceled) {
			t.Fatalf("ReceiveDelivery() error = %v", err)
		}
	})
}

func TestCompletedAdapterContextErrorObservesCancellationAndElapsedDeadline(t *testing.T) {
	if err := completedAdapterContextError(context.Background()); err != nil {
		t.Fatalf("completedAdapterContextError(live) = %v", err)
	}
	canceledContext, cancel := context.WithCancel(context.Background())
	cancel()
	if err := completedAdapterContextError(canceledContext); !errors.Is(err, context.Canceled) {
		t.Fatalf("completedAdapterContextError(canceled) = %v", err)
	}
	elapsedContext := contextBoundaryDeadlineOnlyContext{deadline: time.Now().Add(-time.Second)}
	if err := completedAdapterContextError(elapsedContext); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("completedAdapterContextError(elapsed) = %v", err)
	}
	if allocations := testing.AllocsPerRun(1000, func() {
		if completedAdapterContextError(context.Background()) != nil {
			t.Fatal("live context unexpectedly completed")
		}
	}); allocations != 0 {
		t.Fatalf("live allocations = %f, want 0", allocations)
	}
}

func TestReceiveNextRejectsResultAfterInternalFetchDeadline(t *testing.T) {
	consumer := &contextBoundaryConsumer{next: func(...jetstream.FetchOpt) (jetstream.Msg, error) {
		time.Sleep(5 * time.Millisecond)
		return newContextBoundaryMessage(), nil
	}}
	message, err := receiveNext(context.Background(), consumer, time.Millisecond)
	if !errors.Is(err, jetstream.ErrNoMessages) || message != nil {
		t.Fatalf("receiveNext() = %v, %v", message, err)
	}
}

func newContextBoundaryAdapter(t *testing.T, publisher Publisher, consumer Consumer) *Adapter {
	t.Helper()
	adapter, err := New(publisher, consumer, Config{
		Subject:           "events.primary",
		DeadLetterSubject: "events.dlq",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	return adapter
}

func newContextBoundaryQueueClient(t *testing.T) *queueclient.Client {
	t.Helper()
	client, err := queueclient.New(queueclient.Config{System: queueclient.SystemNATS})
	if err != nil {
		t.Fatalf("queueclient.New() error = %v", err)
	}
	return client
}

func receiveContextBoundaryDelivery(t *testing.T, message jetstream.Msg, publisher Publisher) queueclient.Delivery {
	t.Helper()
	adapter := newContextBoundaryAdapter(t, publisher, &contextBoundaryConsumer{nextResult: message})
	delivery, err := adapter.ReceiveDelivery(context.Background())
	if err != nil {
		t.Fatalf("ReceiveDelivery() error = %v", err)
	}
	return delivery
}

func validContextBoundaryConsumerInfo() *jetstream.ConsumerInfo {
	return &jetstream.ConsumerInfo{Config: jetstream.ConsumerConfig{
		Durable:    "WORKER",
		AckPolicy:  jetstream.AckExplicitPolicy,
		AckWait:    2 * time.Minute,
		MaxDeliver: -1,
	}}
}

func validContextBoundaryPublishAck() *jetstream.PubAck {
	return &jetstream.PubAck{Stream: "EVENTS", Sequence: 1}
}

func newContextBoundaryMessage() *contextBoundaryMessage {
	return &contextBoundaryMessage{fakeMessage: &fakeMessage{
		data:     []byte("payload"),
		headers:  nats.Header{"Tenant": []string{"tenant-a"}},
		metadata: &jetstream.MsgMetadata{Stream: "EVENTS", Consumer: "WORKER", Sequence: jetstream.SequencePair{Stream: 1}},
	}}
}

type contextBoundaryPublisher struct {
	calls   int
	publish func(context.Context, *nats.Msg) (*jetstream.PubAck, error)
}

func (publisher *contextBoundaryPublisher) PublishMsg(ctx context.Context, message *nats.Msg, _ ...jetstream.PublishOpt) (*jetstream.PubAck, error) {
	publisher.calls++
	if publisher.publish != nil {
		return publisher.publish(ctx, message)
	}
	return validContextBoundaryPublishAck(), nil
}

type contextBoundaryConsumer struct {
	nextCalls  int
	infoCalls  int
	nextResult jetstream.Msg
	infoResult *jetstream.ConsumerInfo
	next       func(...jetstream.FetchOpt) (jetstream.Msg, error)
	info       func(context.Context) (*jetstream.ConsumerInfo, error)
}

func (consumer *contextBoundaryConsumer) Next(options ...jetstream.FetchOpt) (jetstream.Msg, error) {
	consumer.nextCalls++
	if consumer.next != nil {
		return consumer.next(options...)
	}
	if consumer.nextResult == nil {
		return nil, jetstream.ErrNoMessages
	}
	return consumer.nextResult, nil
}

func (consumer *contextBoundaryConsumer) Info(ctx context.Context) (*jetstream.ConsumerInfo, error) {
	consumer.infoCalls++
	if consumer.info != nil {
		return consumer.info(ctx)
	}
	return consumer.infoResult, nil
}

type contextBoundaryMessage struct {
	*fakeMessage
	metadataCalls int
	inProgress    func() error
	doubleAck     func(context.Context) error
}

func (message *contextBoundaryMessage) Metadata() (*jetstream.MsgMetadata, error) {
	message.metadataCalls++
	return message.fakeMessage.Metadata()
}

func (message *contextBoundaryMessage) InProgress() error {
	message.inProgressCalls++
	if message.inProgress != nil {
		return message.inProgress()
	}
	return message.inProgressErr
}

func (message *contextBoundaryMessage) DoubleAck(ctx context.Context) error {
	message.doubleAckCalls++
	if message.doubleAck != nil {
		return message.doubleAck(ctx)
	}
	return message.doubleAckErr
}

type contextBoundaryDeadlineOnlyContext struct {
	deadline time.Time
}

func (ctx contextBoundaryDeadlineOnlyContext) Deadline() (time.Time, bool) { return ctx.deadline, true }
func (contextBoundaryDeadlineOnlyContext) Done() <-chan struct{}           { return nil }
func (contextBoundaryDeadlineOnlyContext) Err() error                      { return nil }
func (contextBoundaryDeadlineOnlyContext) Value(any) any                   { return nil }
