package natsjetstream

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/zbxing/goexample/Framework/queueclient"
)

var contractWorkerRetry = queueclient.DeliveryRetryConfig{
	MaxAttempts:       2,
	InitialBackoff:    10 * time.Millisecond,
	MaxBackoff:        20 * time.Millisecond,
	SettlementTimeout: 2 * time.Second,
}

var contractLeaseExtensionRetry = queueclient.DeliveryRetryConfig{
	MaxAttempts:            1,
	InitialBackoff:         10 * time.Millisecond,
	MaxBackoff:             10 * time.Millisecond,
	SettlementTimeout:      400 * time.Millisecond,
	LeaseExtensionInterval: 100 * time.Millisecond,
	LeaseExtensionTimeout:  50 * time.Millisecond,
}

const (
	contractLeaseSafetyMargin = 500 * time.Millisecond
	contractWorkerAckWait     = 9 * time.Second
	contractExtendedAckWait   = 800 * time.Millisecond
	contractExtendedHandling  = 1500 * time.Millisecond
	contractExtensionMargin   = 200 * time.Millisecond
)

func TestRealNATSJetStreamDurableDelivery(t *testing.T) {
	serverURL := strings.TrimSpace(os.Getenv("NATS_TEST_URL"))
	if serverURL == "" {
		t.Skip("NATS_TEST_URL is not set; skipping real JetStream contract")
	}

	testContext, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	connection := connectRealJetStream(t, testContext, serverURL)
	defer connection.Close()
	js, err := jetstream.New(connection)
	if err != nil {
		t.Fatalf("jetstream.New() error = %v", err)
	}

	suffix := strings.ToUpper(strconv.FormatInt(time.Now().UnixNano(), 36))
	sourceStream := "GOEXAMPLE_SOURCE_" + suffix
	dlqStream := "GOEXAMPLE_DLQ_" + suffix
	sourceSubject := "goexample.source." + strings.ToLower(suffix)
	dlqSubject := "goexample.dlq." + strings.ToLower(suffix)
	createContractStream(t, testContext, js, sourceStream, sourceSubject)
	createContractStream(t, testContext, js, dlqStream, dlqSubject)
	t.Cleanup(func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_ = js.DeleteStream(cleanupContext, sourceStream)
		_ = js.DeleteStream(cleanupContext, dlqStream)
	})

	sourceConsumer, err := js.CreateOrUpdateConsumer(testContext, sourceStream, jetstream.ConsumerConfig{
		Name:              "WORKER_" + suffix,
		Durable:           "WORKER_" + suffix,
		AckPolicy:         jetstream.AckExplicitPolicy,
		AckWait:           150 * time.Millisecond,
		MaxDeliver:        5,
		FilterSubject:     sourceSubject,
		ReplayPolicy:      jetstream.ReplayInstantPolicy,
		MaxAckPending:     8,
		MaxRequestBatch:   1,
		MaxRequestExpires: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("CreateOrUpdateConsumer(source) error = %v", err)
	}
	dlqConsumer, err := js.CreateOrUpdateConsumer(testContext, dlqStream, jetstream.ConsumerConfig{
		Name:              "DLQ_READER_" + suffix,
		Durable:           "DLQ_READER_" + suffix,
		AckPolicy:         jetstream.AckExplicitPolicy,
		FilterSubject:     dlqSubject,
		MaxAckPending:     8,
		MaxRequestBatch:   1,
		MaxRequestExpires: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("CreateOrUpdateConsumer(DLQ) error = %v", err)
	}

	adapter, err := New(js, sourceConsumer, Config{
		Subject:           sourceSubject,
		DeadLetterSubject: dlqSubject,
		FetchMaxWait:      100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	client, err := queueclient.New(queueclient.Config{
		System:         queueclient.SystemNATS,
		PublishTimeout: 3 * time.Second,
		ProcessTimeout: 3 * time.Second,
	})
	if err != nil {
		t.Fatalf("queueclient.New() error = %v", err)
	}
	if budget, err := PreflightConsumer(testContext, sourceConsumer, client, contractWorkerRetry, contractLeaseSafetyMargin); !errors.Is(err, ErrAckWaitTooShort) || budget == 0 {
		t.Fatalf("PreflightConsumer(short AckWait) = %s, %v", budget, err)
	}

	publishContractMessage(t, testContext, client, adapter, "redeliver", "tenant-redelivery")
	first, err := adapter.ReceiveDelivery(testContext)
	if err != nil {
		t.Fatalf("ReceiveDelivery(first) error = %v", err)
	}
	if string(first.Message.Body) != "redeliver" || first.Message.Headers["Tenant"] != "tenant-redelivery" {
		t.Fatalf("first delivery = %#v", first.Message)
	}
	redelivered, err := sourceConsumer.Next(jetstream.FetchMaxWait(3 * time.Second))
	if err != nil {
		t.Fatalf("Next(redelivery) error = %v", err)
	}
	metadata, err := redelivered.Metadata()
	if err != nil {
		t.Fatalf("Metadata(redelivery) error = %v", err)
	}
	if metadata.NumDelivered < 2 {
		t.Fatalf("NumDelivered = %d, want at least 2", metadata.NumDelivered)
	}
	if err := redelivered.DoubleAck(testContext); err != nil {
		t.Fatalf("DoubleAck(redelivery) error = %v", err)
	}
	sourceConsumer, requiredLease := calibrateContractConsumer(t, testContext, js, sourceStream, sourceConsumer, client)
	if requiredLease > contractWorkerAckWait {
		t.Fatalf("required delivery lease = %s, AckWait = %s", requiredLease, contractWorkerAckWait)
	}
	adapter, err = New(js, sourceConsumer, Config{
		Subject:           sourceSubject,
		DeadLetterSubject: dlqSubject,
		FetchMaxWait:      100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("New(calibrated consumer) error = %v", err)
	}

	publishContractMessage(t, testContext, client, adapter, "acknowledge", "tenant-ack")
	publishContractMessage(t, testContext, client, adapter, "dead-letter", "tenant-dlq")
	observer := newContractDeliveryObserver()
	workerContext, cancelWorkers := context.WithCancel(testContext)
	workers, err := queueclient.NewWorkerGroup(client, queueclient.WorkerConfig{
		ReceiveDelivery:  adapter.ReceiveDelivery,
		DeliveryObserver: observer,
		Handle: func(_ context.Context, message queueclient.Message) error {
			switch string(message.Body) {
			case "acknowledge":
				return nil
			case "dead-letter":
				return queueclient.ErrDeliveryNotRetryable
			default:
				return errors.New("unexpected contract message")
			}
		},
		Retry: contractWorkerRetry,
	})
	if err != nil {
		t.Fatalf("NewWorkerGroup() error = %v", err)
	}
	if err := workers.Start(workerContext); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	waitContractEvent(t, testContext, observer.acknowledged, "acknowledgement")
	waitContractEvent(t, testContext, observer.deadLettered, "dead letter")
	cancelWorkers()
	if err := workers.Wait(); err != nil {
		t.Fatalf("Wait() error = %v", err)
	}

	dlqMessage, err := dlqConsumer.Next(jetstream.FetchMaxWait(3 * time.Second))
	if err != nil {
		t.Fatalf("Next(DLQ) error = %v", err)
	}
	if string(dlqMessage.Data()) != "dead-letter" || dlqMessage.Headers().Get("Tenant") != "tenant-dlq" {
		t.Fatalf("DLQ message body/header = %q/%q", dlqMessage.Data(), dlqMessage.Headers().Get("Tenant"))
	}
	if messageID := dlqMessage.Headers().Get(jetstream.MsgIDHeader); !strings.HasPrefix(messageID, "goexample-dlq-") {
		t.Fatalf("DLQ message ID = %q", messageID)
	}
	if err := dlqMessage.DoubleAck(testContext); err != nil {
		t.Fatalf("DoubleAck(DLQ) error = %v", err)
	}

	deadline := time.Now().Add(3 * time.Second)
	for {
		info, err := sourceConsumer.Info(testContext)
		if err != nil {
			t.Fatalf("Info(source consumer) error = %v", err)
		}
		if info.NumAckPending == 0 && info.NumPending == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("source consumer pending = ack:%d messages:%d", info.NumAckPending, info.NumPending)
		}
		time.Sleep(20 * time.Millisecond)
	}

	info, err := sourceConsumer.Info(testContext)
	if err != nil {
		t.Fatalf("Info(source consumer before dynamic lease contract) error = %v", err)
	}
	extendedConfig := info.Config
	extendedConfig.AckWait = contractExtendedAckWait
	extendedConfig.BackOff = nil
	extendedConsumer, err := js.UpdateConsumer(testContext, sourceStream, extendedConfig)
	if err != nil {
		t.Fatalf("UpdateConsumer(dynamic delivery lease) error = %v", err)
	}
	extendedLease, err := PreflightConsumer(
		testContext,
		extendedConsumer,
		client,
		contractLeaseExtensionRetry,
		contractExtensionMargin,
	)
	if err != nil {
		t.Fatalf("PreflightConsumer(dynamic delivery lease) = %s, %v", extendedLease, err)
	}
	if extendedLease >= contractExtendedAckWait || contractExtendedHandling <= contractExtendedAckWait {
		t.Fatalf("dynamic lease/ack wait/handling = %s/%s/%s", extendedLease, contractExtendedAckWait, contractExtendedHandling)
	}
	extendedAdapter, err := New(js, extendedConsumer, Config{
		Subject:           sourceSubject,
		DeadLetterSubject: dlqSubject,
		FetchMaxWait:      100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("New(dynamic lease adapter) error = %v", err)
	}
	publishContractMessage(t, testContext, client, extendedAdapter, "extend-lease", "tenant-lease")
	extensionObserver := newContractLeaseObserver()
	extendedDeliveryObserver := newContractDeliveryObserver()
	extendedWorkerContext, cancelExtendedWorkers := context.WithCancel(testContext)
	extendedWorkers, err := queueclient.NewWorkerGroup(client, queueclient.WorkerConfig{
		ReceiveDelivery:  extendedAdapter.ReceiveDelivery,
		DeliveryObserver: extendedDeliveryObserver,
		LeaseObserver:    extensionObserver,
		Handle: func(ctx context.Context, message queueclient.Message) error {
			if string(message.Body) != "extend-lease" || message.Headers["Tenant"] != "tenant-lease" {
				return errors.New("unexpected dynamic lease message")
			}
			timer := time.NewTimer(contractExtendedHandling)
			defer timer.Stop()
			select {
			case <-timer.C:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		},
		Retry: contractLeaseExtensionRetry,
	})
	if err != nil {
		t.Fatalf("NewWorkerGroup(dynamic lease) error = %v", err)
	}
	if err := extendedWorkers.Start(extendedWorkerContext); err != nil {
		t.Fatalf("Start(dynamic lease) error = %v", err)
	}
	waitContractEvent(t, testContext, extendedDeliveryObserver.acknowledged, "dynamic lease acknowledgement")
	cancelExtendedWorkers()
	if err := extendedWorkers.Wait(); err != nil {
		t.Fatalf("Wait(dynamic lease) error = %v", err)
	}
	if extensionObserver.extended.Load() < 5 || extensionObserver.failed.Load() != 0 {
		t.Fatalf("dynamic lease events = extended:%d failed:%d", extensionObserver.extended.Load(), extensionObserver.failed.Load())
	}
	if message, err := extendedConsumer.Next(jetstream.FetchMaxWait(contractExtendedAckWait + 200*time.Millisecond)); err == nil || (!errors.Is(err, jetstream.ErrNoMessages) && !errors.Is(err, nats.ErrTimeout)) {
		if err == nil {
			_ = message.DoubleAck(testContext)
		}
		t.Fatalf("Next(after dynamic lease acknowledgement) = %v, %v", message, err)
	}
	info, err = extendedConsumer.Info(testContext)
	if err != nil {
		t.Fatalf("Info(source consumer after dynamic lease contract) error = %v", err)
	}
	if info.NumAckPending != 0 || info.NumPending != 0 {
		t.Fatalf("dynamic lease consumer pending = ack:%d messages:%d", info.NumAckPending, info.NumPending)
	}
}

func calibrateContractConsumer(
	t *testing.T,
	ctx context.Context,
	js jetstream.JetStream,
	streamName string,
	consumer jetstream.Consumer,
	client *queueclient.Client,
) (jetstream.Consumer, time.Duration) {
	t.Helper()
	info, err := consumer.Info(ctx)
	if err != nil {
		t.Fatalf("Info(consumer before lease calibration) error = %v", err)
	}
	config := info.Config
	config.AckWait = contractWorkerAckWait
	config.BackOff = nil
	updated, err := js.UpdateConsumer(ctx, streamName, config)
	if err != nil {
		t.Fatalf("UpdateConsumer(delivery lease) error = %v", err)
	}
	required, err := PreflightConsumer(ctx, updated, client, contractWorkerRetry, contractLeaseSafetyMargin)
	if err != nil {
		t.Fatalf("PreflightConsumer(calibrated AckWait) error = %v", err)
	}
	return updated, required
}

func createContractStream(t *testing.T, ctx context.Context, js jetstream.JetStream, name, subject string) {
	t.Helper()
	if _, err := js.CreateStream(ctx, jetstream.StreamConfig{
		Name:       name,
		Subjects:   []string{subject},
		Retention:  jetstream.LimitsPolicy,
		MaxMsgs:    100,
		MaxBytes:   1 << 20,
		MaxAge:     time.Minute,
		Discard:    jetstream.DiscardNew,
		Storage:    jetstream.FileStorage,
		Replicas:   1,
		Duplicates: time.Minute,
	}); err != nil {
		t.Fatalf("CreateStream(%s) error = %v", name, err)
	}
}

func publishContractMessage(
	t *testing.T,
	ctx context.Context,
	client *queueclient.Client,
	adapter *Adapter,
	body string,
	tenant string,
) {
	t.Helper()
	if err := client.Publish(ctx, queueclient.Message{
		Body:    []byte(body),
		Headers: map[string]string{"Tenant": tenant},
	}, adapter.Publish); err != nil {
		t.Fatalf("Publish(%s) error = %v", body, err)
	}
}

func connectRealJetStream(t *testing.T, ctx context.Context, serverURL string) *nats.Conn {
	t.Helper()
	for {
		connection, err := nats.Connect(
			serverURL,
			nats.Name("goexample-jetstream-contract"),
			nats.Timeout(500*time.Millisecond),
			nats.NoReconnect(),
		)
		if err == nil {
			return connection
		}
		select {
		case <-ctx.Done():
			t.Fatal("real JetStream did not become ready before the contract deadline")
		case <-time.After(100 * time.Millisecond):
		}
	}
}

type contractDeliveryObserver struct {
	acknowledged chan struct{}
	deadLettered chan struct{}
	ackOnce      sync.Once
	dlqOnce      sync.Once
}

func newContractDeliveryObserver() *contractDeliveryObserver {
	return &contractDeliveryObserver{
		acknowledged: make(chan struct{}),
		deadLettered: make(chan struct{}),
	}
}

func (observer *contractDeliveryObserver) DeliveryAcknowledged() {
	observer.ackOnce.Do(func() { close(observer.acknowledged) })
}

func (*contractDeliveryObserver) DeliveryRetried() {}

func (observer *contractDeliveryObserver) DeliveryDeadLettered() {
	observer.dlqOnce.Do(func() { close(observer.deadLettered) })
}

func (*contractDeliveryObserver) DeliverySettlementFailed() {}

type contractLeaseObserver struct {
	extended atomic.Int32
	failed   atomic.Int32
}

func newContractLeaseObserver() *contractLeaseObserver {
	return &contractLeaseObserver{}
}

func (observer *contractLeaseObserver) DeliveryLeaseExtended() {
	observer.extended.Add(1)
}

func (observer *contractLeaseObserver) DeliveryLeaseExtensionFailed() {
	observer.failed.Add(1)
}

func waitContractEvent(t *testing.T, ctx context.Context, event <-chan struct{}, name string) {
	t.Helper()
	select {
	case <-event:
	case <-ctx.Done():
		t.Fatalf("timed out waiting for JetStream %s", name)
	}
}
