package natsjetstream

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
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
	contractLeaseSafetyMargin       = 500 * time.Millisecond
	contractWorkerAckWait           = 9 * time.Second
	contractExtendedAckWait         = 800 * time.Millisecond
	contractExtendedHandling        = 1500 * time.Millisecond
	contractExtensionMargin         = 200 * time.Millisecond
	contractDuplicateWindow         = time.Minute
	contractDeduplicatedPublishRuns = 2
	contractDeduplicatedStored      = 1
	contractFetchMaxWait            = 100 * time.Millisecond
	contractShortRequestExpires     = 50 * time.Millisecond
	contractMaxRequestExpires       = 5 * time.Second
	contractCancellationFetchWait   = 5 * time.Second
	contractCancellationReturnLimit = time.Second
)

func TestRealNATSJetStreamDurableDelivery(t *testing.T) {
	serverURL := strings.TrimSpace(os.Getenv("NATS_TEST_URL"))
	if serverURL == "" {
		t.Skip("NATS_TEST_URL is not set; skipping real JetStream contract")
	}
	evidenceDirectory := strings.TrimSpace(os.Getenv("NATS_DELIVERY_EVIDENCE_DIR"))
	if evidenceDirectory == "" {
		evidenceDirectory = t.TempDir()
	} else {
		var err error
		evidenceDirectory, err = filepath.Abs(evidenceDirectory)
		if err != nil {
			t.Fatalf("resolve NATS_DELIVERY_EVIDENCE_DIR: %v", err)
		}
	}
	if err := os.MkdirAll(evidenceDirectory, 0o750); err != nil {
		t.Fatalf("create delivery evidence directory: %v", err)
	}
	reportPath := filepath.Join(evidenceDirectory, "delivery-report.json")
	if err := os.Remove(reportPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("remove stale delivery report: %v", err)
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
	deduplicationStream := "GOEXAMPLE_DEDUP_" + suffix
	sourceConsumerName := "WORKER_" + suffix
	sourceSubjectPrefix := "goexample.source." + strings.ToLower(suffix)
	sourceStreamSubject := sourceSubjectPrefix + ".>"
	sourceSubject := sourceSubjectPrefix + ".primary"
	foreignSubject := sourceSubjectPrefix + ".foreign"
	pushDeliverySubject := "goexample.delivery." + strings.ToLower(suffix)
	dlqSubject := "goexample.dlq." + strings.ToLower(suffix)
	deduplicationSubject := "goexample.dedup." + strings.ToLower(suffix)
	createContractStream(t, testContext, js, sourceStream, sourceStreamSubject)
	createContractStream(t, testContext, js, dlqStream, dlqSubject)
	createContractStream(t, testContext, js, deduplicationStream, deduplicationSubject)
	t.Cleanup(func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_ = js.DeleteStream(cleanupContext, sourceStream)
		_ = js.DeleteStream(cleanupContext, dlqStream)
		_ = js.DeleteStream(cleanupContext, deduplicationStream)
	})

	client, err := queueclient.New(queueclient.Config{
		System:         queueclient.SystemNATS,
		PublishTimeout: 3 * time.Second,
		ProcessTimeout: 3 * time.Second,
	})
	if err != nil {
		t.Fatalf("queueclient.New() error = %v", err)
	}

	sourceConsumer, err := js.CreateOrUpdateConsumer(testContext, sourceStream, jetstream.ConsumerConfig{
		Name:              sourceConsumerName,
		Durable:           sourceConsumerName,
		AckPolicy:         jetstream.AckExplicitPolicy,
		DeliverPolicy:     jetstream.DeliverAllPolicy,
		AckWait:           contractWorkerAckWait,
		MaxDeliver:        5,
		FilterSubject:     sourceSubject,
		ReplayPolicy:      jetstream.ReplayInstantPolicy,
		MaxAckPending:     8,
		MaxRequestBatch:   1,
		MaxRequestExpires: contractMaxRequestExpires,
		DeliverSubject:    pushDeliverySubject,
	})
	if err != nil {
		t.Fatalf("CreateOrUpdateConsumer(push source) error = %v", err)
	}
	modeAdapter, err := New(js, sourceConsumer, Config{
		Subject:           sourceSubject,
		DeadLetterSubject: dlqSubject,
		FetchMaxWait:      contractFetchMaxWait,
	})
	if err != nil {
		t.Fatalf("New(push source consumer) error = %v", err)
	}
	pushBudget, pushError := modeAdapter.PreflightConsumer(
		testContext,
		client,
		contractWorkerRetry,
		contractLeaseSafetyMargin,
	)
	pushConsumerRejected := errors.Is(pushError, ErrConsumerNotPull) && pushBudget > 0
	if !pushConsumerRejected {
		t.Fatalf("Adapter.PreflightConsumer(push consumer) = %s, %v", pushBudget, pushError)
	}
	pushInfo, err := sourceConsumer.Info(testContext)
	if err != nil {
		t.Fatalf("Info(push source consumer) error = %v", err)
	}
	pullModeConfig := pushInfo.Config
	pullModeConfig.DeliverSubject = ""
	if err := js.DeleteConsumer(testContext, sourceStream, pullModeConfig.Name); err != nil {
		t.Fatalf("DeleteConsumer(push source) error = %v", err)
	}
	sourceConsumer, err = js.CreateOrUpdateConsumer(testContext, sourceStream, pullModeConfig)
	if err != nil {
		t.Fatalf("CreateOrUpdateConsumer(rebuilt pull source) error = %v", err)
	}
	modeAdapter, err = New(js, sourceConsumer, Config{
		Subject:           sourceSubject,
		DeadLetterSubject: dlqSubject,
		FetchMaxWait:      contractFetchMaxWait,
	})
	if err != nil {
		t.Fatalf("New(rebuilt pull source consumer) error = %v", err)
	}
	pullBudget, pullError := modeAdapter.PreflightConsumer(
		testContext,
		client,
		contractWorkerRetry,
		contractLeaseSafetyMargin,
	)
	pullModeInfo, infoError := sourceConsumer.Info(testContext)
	rebuiltPullConsumerPreflightPassed := pullError == nil && pullBudget == pushBudget &&
		infoError == nil && pullModeInfo.Config.DeliverSubject == ""
	if !rebuiltPullConsumerPreflightPassed {
		t.Fatalf("Adapter.PreflightConsumer(rebuilt pull consumer) = %s, %v; info = %v", pullBudget, pullError, infoError)
	}
	priorityConfig := pullModeInfo.Config
	priorityConfig.PriorityPolicy = jetstream.PriorityPolicyPinned
	priorityConfig.PinnedTTL = time.Second
	priorityConfig.PriorityGroups = []string{"PRIMARY"}
	if err := js.DeleteConsumer(testContext, sourceStream, sourceConsumerName); err != nil {
		t.Fatalf("DeleteConsumer(rebuilt pull source) error = %v", err)
	}
	sourceConsumer, err = js.CreateOrUpdateConsumer(testContext, sourceStream, priorityConfig)
	if err != nil {
		t.Fatalf("CreateOrUpdateConsumer(priority source) error = %v", err)
	}
	priorityAdapter, err := New(js, sourceConsumer, Config{
		Subject:           sourceSubject,
		DeadLetterSubject: dlqSubject,
		FetchMaxWait:      contractFetchMaxWait,
	})
	if err != nil {
		t.Fatalf("New(priority source consumer) error = %v", err)
	}
	priorityBudget, priorityError := priorityAdapter.PreflightConsumer(
		testContext,
		client,
		contractWorkerRetry,
		contractLeaseSafetyMargin,
	)
	priorityConsumerRejected := errors.Is(priorityError, ErrConsumerPriorityPolicy) && priorityBudget == pushBudget
	if !priorityConsumerRejected {
		t.Fatalf("Adapter.PreflightConsumer(priority consumer) = %s, %v", priorityBudget, priorityError)
	}
	priorityInfo, err := sourceConsumer.Info(testContext)
	if err != nil {
		t.Fatalf("Info(priority source consumer) error = %v", err)
	}
	defaultPriorityConfig := priorityInfo.Config
	defaultPriorityConfig.PriorityPolicy = jetstream.PriorityPolicyNone
	defaultPriorityConfig.PinnedTTL = 0
	defaultPriorityConfig.PriorityGroups = nil
	if err := js.DeleteConsumer(testContext, sourceStream, sourceConsumerName); err != nil {
		t.Fatalf("DeleteConsumer(priority source) error = %v", err)
	}
	sourceConsumer, err = js.CreateOrUpdateConsumer(testContext, sourceStream, defaultPriorityConfig)
	if err != nil {
		t.Fatalf("CreateOrUpdateConsumer(default priority source) error = %v", err)
	}
	defaultPriorityAdapter, err := New(js, sourceConsumer, Config{
		Subject:           sourceSubject,
		DeadLetterSubject: dlqSubject,
		FetchMaxWait:      contractFetchMaxWait,
	})
	if err != nil {
		t.Fatalf("New(default priority source consumer) error = %v", err)
	}
	defaultPriorityBudget, defaultPriorityError := defaultPriorityAdapter.PreflightConsumer(
		testContext,
		client,
		contractWorkerRetry,
		contractLeaseSafetyMargin,
	)
	defaultPriorityInfo, defaultPriorityInfoError := sourceConsumer.Info(testContext)
	rebuiltDefaultPriorityConsumerPreflightPassed := defaultPriorityError == nil && defaultPriorityBudget == priorityBudget &&
		defaultPriorityInfoError == nil && defaultPriorityInfo.Config.PriorityPolicy == jetstream.PriorityPolicyNone &&
		len(defaultPriorityInfo.Config.PriorityGroups) == 0
	if !rebuiltDefaultPriorityConsumerPreflightPassed {
		t.Fatalf("Adapter.PreflightConsumer(default priority consumer) = %s, %v; info = %v", defaultPriorityBudget, defaultPriorityError, defaultPriorityInfoError)
	}
	ackAllConfig := defaultPriorityInfo.Config
	ackAllConfig.AckPolicy = jetstream.AckAllPolicy
	if err := js.DeleteConsumer(testContext, sourceStream, sourceConsumerName); err != nil {
		t.Fatalf("DeleteConsumer(default priority source) error = %v", err)
	}
	sourceConsumer, err = js.CreateOrUpdateConsumer(testContext, sourceStream, ackAllConfig)
	if err != nil {
		t.Fatalf("CreateOrUpdateConsumer(AckAll source) error = %v", err)
	}
	ackAllAdapter, err := New(js, sourceConsumer, Config{
		Subject:           sourceSubject,
		DeadLetterSubject: dlqSubject,
		FetchMaxWait:      contractFetchMaxWait,
	})
	if err != nil {
		t.Fatalf("New(AckAll source consumer) error = %v", err)
	}
	ackAllBudget, ackAllError := ackAllAdapter.PreflightConsumer(
		testContext,
		client,
		contractWorkerRetry,
		contractLeaseSafetyMargin,
	)
	ackAllConsumerRejected := errors.Is(ackAllError, ErrConsumerAckPolicy) && ackAllBudget == defaultPriorityBudget
	if !ackAllConsumerRejected {
		t.Fatalf("Adapter.PreflightConsumer(AckAll consumer) = %s, %v", ackAllBudget, ackAllError)
	}
	ackAllInfo, err := sourceConsumer.Info(testContext)
	if err != nil {
		t.Fatalf("Info(AckAll source consumer) error = %v", err)
	}
	explicitAckConfig := ackAllInfo.Config
	explicitAckConfig.AckPolicy = jetstream.AckExplicitPolicy
	if err := js.DeleteConsumer(testContext, sourceStream, sourceConsumerName); err != nil {
		t.Fatalf("DeleteConsumer(AckAll source) error = %v", err)
	}
	sourceConsumer, err = js.CreateOrUpdateConsumer(testContext, sourceStream, explicitAckConfig)
	if err != nil {
		t.Fatalf("CreateOrUpdateConsumer(explicit Ack source) error = %v", err)
	}
	explicitAckAdapter, err := New(js, sourceConsumer, Config{
		Subject:           sourceSubject,
		DeadLetterSubject: dlqSubject,
		FetchMaxWait:      contractFetchMaxWait,
	})
	if err != nil {
		t.Fatalf("New(explicit Ack source consumer) error = %v", err)
	}
	explicitAckBudget, explicitAckError := explicitAckAdapter.PreflightConsumer(
		testContext,
		client,
		contractWorkerRetry,
		contractLeaseSafetyMargin,
	)
	explicitAckInfo, explicitAckInfoError := sourceConsumer.Info(testContext)
	rebuiltExplicitAckConsumerPreflightPassed := explicitAckError == nil && explicitAckBudget == ackAllBudget &&
		explicitAckInfoError == nil && explicitAckInfo.Config.AckPolicy == jetstream.AckExplicitPolicy
	if !rebuiltExplicitAckConsumerPreflightPassed {
		t.Fatalf("Adapter.PreflightConsumer(explicit Ack consumer) = %s, %v; info = %v", explicitAckBudget, explicitAckError, explicitAckInfoError)
	}
	if err := js.DeleteConsumer(testContext, sourceStream, sourceConsumerName); err != nil {
		t.Fatalf("DeleteConsumer(explicit Ack source) error = %v", err)
	}

	sourceConsumer, err = js.CreateOrUpdateConsumer(testContext, sourceStream, jetstream.ConsumerConfig{
		Name:              sourceConsumerName,
		Durable:           sourceConsumerName,
		AckPolicy:         jetstream.AckExplicitPolicy,
		DeliverPolicy:     jetstream.DeliverNewPolicy,
		AckWait:           150 * time.Millisecond,
		MaxDeliver:        1,
		HeadersOnly:       true,
		FilterSubject:     sourceStreamSubject,
		ReplayPolicy:      jetstream.ReplayInstantPolicy,
		MaxAckPending:     8,
		MaxRequestBatch:   1,
		MaxRequestExpires: contractMaxRequestExpires,
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
		MaxRequestExpires: contractMaxRequestExpires,
	})
	if err != nil {
		t.Fatalf("CreateOrUpdateConsumer(DLQ) error = %v", err)
	}

	deliverNewBudget, deliverNewError := PreflightConsumer(
		testContext,
		sourceConsumer,
		client,
		contractWorkerRetry,
		contractLeaseSafetyMargin,
	)
	deliverNewPolicyRejected := errors.Is(deliverNewError, ErrConsumerDeliveryPolicy) && deliverNewBudget > 0
	if !deliverNewPolicyRejected {
		t.Fatalf("PreflightConsumer(DeliverNew) = %s, %v", deliverNewBudget, deliverNewError)
	}
	deliverNewInfo, err := sourceConsumer.Info(testContext)
	if err != nil {
		t.Fatalf("Info(source consumer before DeliverAll rebuild) error = %v", err)
	}
	deliverAllConfig := deliverNewInfo.Config
	deliverAllConfig.DeliverPolicy = jetstream.DeliverAllPolicy
	deliverAllConfig.ReplayPolicy = jetstream.ReplayOriginalPolicy
	if err := js.DeleteConsumer(testContext, sourceStream, deliverAllConfig.Name); err != nil {
		t.Fatalf("DeleteConsumer(DeliverNew) error = %v", err)
	}
	sourceConsumer, err = js.CreateOrUpdateConsumer(testContext, sourceStream, deliverAllConfig)
	if err != nil {
		t.Fatalf("CreateOrUpdateConsumer(DeliverAll) error = %v", err)
	}
	replayOriginalBudget, replayOriginalError := PreflightConsumer(
		testContext,
		sourceConsumer,
		client,
		contractWorkerRetry,
		contractLeaseSafetyMargin,
	)
	replayOriginalPolicyRejected := errors.Is(replayOriginalError, ErrConsumerReplayPolicy) && replayOriginalBudget > 0
	if !replayOriginalPolicyRejected {
		t.Fatalf("PreflightConsumer(ReplayOriginal) = %s, %v", replayOriginalBudget, replayOriginalError)
	}
	replayOriginalInfo, err := sourceConsumer.Info(testContext)
	if err != nil {
		t.Fatalf("Info(source consumer before ReplayInstant rebuild) error = %v", err)
	}
	replayInstantConfig := replayOriginalInfo.Config
	replayInstantConfig.ReplayPolicy = jetstream.ReplayInstantPolicy
	if err := js.DeleteConsumer(testContext, sourceStream, replayInstantConfig.Name); err != nil {
		t.Fatalf("DeleteConsumer(ReplayOriginal) error = %v", err)
	}
	sourceConsumer, err = js.CreateOrUpdateConsumer(testContext, sourceStream, replayInstantConfig)
	if err != nil {
		t.Fatalf("CreateOrUpdateConsumer(ReplayInstant) error = %v", err)
	}
	limitedDeliveryBudget, limitedDeliveryError := PreflightConsumer(
		testContext,
		sourceConsumer,
		client,
		contractWorkerRetry,
		contractLeaseSafetyMargin,
	)
	limitedDeliveryRejected := errors.Is(limitedDeliveryError, ErrMaxDeliverTooLow) && limitedDeliveryBudget > 0
	if !limitedDeliveryRejected {
		t.Fatalf("PreflightConsumer(MaxDeliver=1) = %s, %v", limitedDeliveryBudget, limitedDeliveryError)
	}
	limitedInfo, err := sourceConsumer.Info(testContext)
	if err != nil {
		t.Fatalf("Info(source consumer before MaxDeliver update) error = %v", err)
	}
	persistentConfig := limitedInfo.Config
	persistentConfig.MaxDeliver = 5
	sourceConsumer, err = js.UpdateConsumer(testContext, sourceStream, persistentConfig)
	if err != nil {
		t.Fatalf("UpdateConsumer(MaxDeliver) error = %v", err)
	}
	headersOnlyBudget, headersOnlyError := PreflightConsumer(
		testContext,
		sourceConsumer,
		client,
		contractWorkerRetry,
		contractLeaseSafetyMargin,
	)
	headersOnlyRejected := errors.Is(headersOnlyError, ErrConsumerPayloadUnavailable) && headersOnlyBudget > 0
	if !headersOnlyRejected {
		t.Fatalf("PreflightConsumer(HeadersOnly=true) = %s, %v", headersOnlyBudget, headersOnlyError)
	}
	headersOnlyInfo, err := sourceConsumer.Info(testContext)
	if err != nil {
		t.Fatalf("Info(source consumer before HeadersOnly update) error = %v", err)
	}
	fullPayloadConfig := headersOnlyInfo.Config
	fullPayloadConfig.HeadersOnly = false
	sourceConsumer, err = js.UpdateConsumer(testContext, sourceStream, fullPayloadConfig)
	if err != nil {
		t.Fatalf("UpdateConsumer(HeadersOnly) error = %v", err)
	}
	adapter, err := New(js, sourceConsumer, Config{
		Subject:           sourceSubject,
		DeadLetterSubject: dlqSubject,
		FetchMaxWait:      100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	broadFilterBudget, broadFilterError := adapter.PreflightConsumer(
		testContext,
		client,
		contractWorkerRetry,
		contractLeaseSafetyMargin,
	)
	broadSubjectFilterRejected := errors.Is(broadFilterError, ErrConsumerSubjectMismatch) && broadFilterBudget > 0
	if !broadSubjectFilterRejected {
		t.Fatalf("Adapter.PreflightConsumer(broad subject filter) = %s, %v", broadFilterBudget, broadFilterError)
	}
	broadFilterInfo, err := sourceConsumer.Info(testContext)
	if err != nil {
		t.Fatalf("Info(source consumer before subject filter update) error = %v", err)
	}
	exactFilterConfig := broadFilterInfo.Config
	exactFilterConfig.FilterSubject = sourceSubject
	exactFilterConfig.FilterSubjects = nil
	sourceConsumer, err = js.UpdateConsumer(testContext, sourceStream, exactFilterConfig)
	if err != nil {
		t.Fatalf("UpdateConsumer(subject filter) error = %v", err)
	}
	shortRequestExpiresConfig := exactFilterConfig
	shortRequestExpiresConfig.MaxRequestExpires = contractShortRequestExpires
	sourceConsumer, err = js.UpdateConsumer(testContext, sourceStream, shortRequestExpiresConfig)
	if err != nil {
		t.Fatalf("UpdateConsumer(short request expiration) error = %v", err)
	}
	_, brokerRequestExpiresError := sourceConsumer.Next(jetstream.FetchMaxWait(contractFetchMaxWait))
	brokerRequestExpiresRejected := brokerRequestExpiresError != nil &&
		!errors.Is(brokerRequestExpiresError, nats.ErrTimeout) &&
		!errors.Is(brokerRequestExpiresError, jetstream.ErrNoMessages) &&
		strings.Contains(brokerRequestExpiresError.Error(), "MaxRequestExpires")
	if !brokerRequestExpiresRejected {
		t.Fatalf("Next(over maximum request expiration) error = %v", brokerRequestExpiresError)
	}
	adapter, err = New(js, sourceConsumer, Config{
		Subject:           sourceSubject,
		DeadLetterSubject: dlqSubject,
		FetchMaxWait:      contractFetchMaxWait,
	})
	if err != nil {
		t.Fatalf("New(exact subject consumer) error = %v", err)
	}
	shortRequestExpiresBudget, shortRequestExpiresError := adapter.PreflightConsumer(
		testContext,
		client,
		contractWorkerRetry,
		contractLeaseSafetyMargin,
	)
	shortRequestExpiresRejected := errors.Is(shortRequestExpiresError, ErrConsumerRequestExpires) && shortRequestExpiresBudget > 0
	if !shortRequestExpiresRejected {
		t.Fatalf("Adapter.PreflightConsumer(short request expiration) = %s, %v", shortRequestExpiresBudget, shortRequestExpiresError)
	}
	shortRequestExpiresInfo, err := sourceConsumer.Info(testContext)
	if err != nil {
		t.Fatalf("Info(source consumer before request expiration update) error = %v", err)
	}
	compatibleRequestExpiresConfig := shortRequestExpiresInfo.Config
	compatibleRequestExpiresConfig.MaxRequestExpires = contractMaxRequestExpires
	sourceConsumer, err = js.UpdateConsumer(testContext, sourceStream, compatibleRequestExpiresConfig)
	if err != nil {
		t.Fatalf("UpdateConsumer(compatible request expiration) error = %v", err)
	}
	adapter, err = New(js, sourceConsumer, Config{
		Subject:           sourceSubject,
		DeadLetterSubject: dlqSubject,
		FetchMaxWait:      contractFetchMaxWait,
	})
	if err != nil {
		t.Fatalf("New(compatible request expiration) error = %v", err)
	}
	deduplicationAdapter, err := New(js, sourceConsumer, Config{
		Subject:           deduplicationSubject,
		DeadLetterSubject: dlqSubject,
		FetchMaxWait:      contractFetchMaxWait,
	})
	if err != nil {
		t.Fatalf("New(deduplication adapter) error = %v", err)
	}
	deduplicationID := "goexample-event-" + strings.ToLower(suffix)
	for range contractDeduplicatedPublishRuns {
		if err := client.Publish(testContext, queueclient.Message{
			Body:    []byte("deduplicated"),
			Headers: map[string]string{"Tenant": "tenant-deduplication"},
		}, func(publishContext context.Context, message queueclient.Message) error {
			return deduplicationAdapter.PublishDeduplicated(publishContext, deduplicationID, message)
		}); err != nil {
			t.Fatalf("PublishDeduplicated() error = %v", err)
		}
	}
	deduplicationHandle, err := js.Stream(testContext, deduplicationStream)
	if err != nil {
		t.Fatalf("Stream(deduplication) error = %v", err)
	}
	deduplicationInfo, err := deduplicationHandle.Info(testContext)
	if err != nil {
		t.Fatalf("Info(deduplication stream) error = %v", err)
	}
	if deduplicationInfo.State.Msgs != contractDeduplicatedStored {
		t.Fatalf("deduplicated stored messages = %d, want %d", deduplicationInfo.State.Msgs, contractDeduplicatedStored)
	}
	shortLeaseBudget, shortLeaseError := PreflightConsumer(
		testContext,
		sourceConsumer,
		client,
		contractWorkerRetry,
		contractLeaseSafetyMargin,
	)
	shortLeaseRejected := errors.Is(shortLeaseError, ErrAckWaitTooShort) && shortLeaseBudget > 0
	if !shortLeaseRejected {
		t.Fatalf("PreflightConsumer(short AckWait) = %s, %v", shortLeaseBudget, shortLeaseError)
	}

	if _, err := js.Publish(testContext, foreignSubject, []byte("must-not-reach-primary-adapter")); err != nil {
		t.Fatalf("Publish(foreign subject) error = %v", err)
	}
	publishContractMessage(t, testContext, client, adapter, "redeliver", "tenant-redelivery")
	first, err := adapter.ReceiveDelivery(testContext)
	if err != nil {
		t.Fatalf("ReceiveDelivery(first) error = %v", err)
	}
	foreignSubjectExcluded := string(first.Message.Body) == "redeliver" && first.Message.Headers["Tenant"] == "tenant-redelivery"
	if !foreignSubjectExcluded {
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
		FetchMaxWait:      contractFetchMaxWait,
	})
	if err != nil {
		t.Fatalf("New(calibrated consumer) error = %v", err)
	}
	pauseResponse, err := js.PauseConsumer(testContext, sourceStream, sourceConsumerName, time.Now().Add(time.Minute))
	if err != nil {
		t.Fatalf("PauseConsumer(source) error = %v", err)
	}
	if !pauseResponse.Paused || pauseResponse.PauseRemaining <= 0 {
		t.Fatalf("PauseConsumer(source) response = paused:%t remaining:%s", pauseResponse.Paused, pauseResponse.PauseRemaining)
	}
	pausedBudget, pausedError := adapter.PreflightConsumer(
		testContext,
		client,
		contractWorkerRetry,
		contractLeaseSafetyMargin,
	)
	pausedConsumerRejected := errors.Is(pausedError, ErrConsumerPaused) && pausedBudget == requiredLease
	if !pausedConsumerRejected {
		t.Fatalf("Adapter.PreflightConsumer(paused consumer) = %s, %v; want %s", pausedBudget, pausedError, requiredLease)
	}
	resumeResponse, err := js.ResumeConsumer(testContext, sourceStream, sourceConsumerName)
	if err != nil {
		t.Fatalf("ResumeConsumer(source) error = %v", err)
	}
	if resumeResponse.Paused || resumeResponse.PauseRemaining != 0 {
		t.Fatalf("ResumeConsumer(source) response = paused:%t remaining:%s", resumeResponse.Paused, resumeResponse.PauseRemaining)
	}
	verifiedSubjectLease, subjectPreflightError := adapter.PreflightConsumer(
		testContext,
		client,
		contractWorkerRetry,
		contractLeaseSafetyMargin,
	)
	exactSubjectPreflightPassed := subjectPreflightError == nil && verifiedSubjectLease == requiredLease
	if !exactSubjectPreflightPassed {
		t.Fatalf("Adapter.PreflightConsumer(exact subject filter) = %s, %v; want %s", verifiedSubjectLease, subjectPreflightError, requiredLease)
	}
	exactSubjectInfo, err := sourceConsumer.Info(testContext)
	if err != nil {
		t.Fatalf("Info(source consumer after DeliverAll preflight) error = %v", err)
	}
	resumedConsumerPreflightPassed := exactSubjectPreflightPassed && !exactSubjectInfo.Paused
	if !resumedConsumerPreflightPassed {
		t.Fatalf("resumed consumer preflight/status = %t/%t", exactSubjectPreflightPassed, exactSubjectInfo.Paused)
	}
	deliverAllPolicyPreflightPassed := exactSubjectPreflightPassed && exactSubjectInfo.Config.DeliverPolicy == jetstream.DeliverAllPolicy
	if !deliverAllPolicyPreflightPassed {
		t.Fatalf("DeliverAll preflight/config = %t/%d", exactSubjectPreflightPassed, exactSubjectInfo.Config.DeliverPolicy)
	}
	replayInstantPolicyPreflightPassed := exactSubjectPreflightPassed && exactSubjectInfo.Config.ReplayPolicy == jetstream.ReplayInstantPolicy
	if !replayInstantPolicyPreflightPassed {
		t.Fatalf("ReplayInstant preflight/config = %t/%d", exactSubjectPreflightPassed, exactSubjectInfo.Config.ReplayPolicy)
	}
	compatibleRequestExpiresPreflightPassed := exactSubjectPreflightPassed &&
		exactSubjectInfo.Config.MaxRequestExpires == contractMaxRequestExpires
	if !compatibleRequestExpiresPreflightPassed {
		t.Fatalf("compatible request expiration preflight/config = %t/%s", exactSubjectPreflightPassed, exactSubjectInfo.Config.MaxRequestExpires)
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
		FetchMaxWait:      contractFetchMaxWait,
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
	cancellationAdapter, err := New(js, sourceConsumer, Config{
		Subject:           sourceSubject,
		DeadLetterSubject: dlqSubject,
		FetchMaxWait:      contractCancellationFetchWait,
	})
	if err != nil {
		t.Fatalf("New(cancellation adapter) error = %v", err)
	}
	receiveContext, cancelReceive := context.WithCancel(testContext)
	receiveResult := make(chan error, 1)
	go func() {
		_, receiveErr := cancellationAdapter.ReceiveDelivery(receiveContext)
		receiveResult <- receiveErr
	}()
	waitContractConsumerWaiting(t, testContext, sourceConsumer, receiveResult)
	cancellationStarted := time.Now()
	cancelReceive()
	var receiveCancellationError error
	select {
	case receiveCancellationError = <-receiveResult:
	case <-time.After(contractCancellationReturnLimit):
		t.Fatal("ReceiveDelivery did not return promptly after parent cancellation")
	}
	receiveCancellationLatency := time.Since(cancellationStarted)
	receiveCancellationPropagated := errors.Is(receiveCancellationError, context.Canceled) &&
		receiveCancellationLatency >= 0 && receiveCancellationLatency <= contractCancellationReturnLimit
	if !receiveCancellationPropagated {
		t.Fatalf("ReceiveDelivery(canceled waiting pull) = %s, %v", receiveCancellationLatency, receiveCancellationError)
	}
	writeDeliveryReport(t, reportPath, deliveryContractReport{
		SchemaVersion:                      14,
		Status:                             "passed",
		Storage:                            "file",
		Replicas:                           1,
		PushConsumerRejected:               pushConsumerRejected,
		RebuiltPullConsumerPreflightPassed: rebuiltPullConsumerPreflightPassed,
		ConsumerDeliverSubject:             pullModeInfo.Config.DeliverSubject,
		PriorityConsumerRejected:           priorityConsumerRejected,
		RebuiltDefaultPriorityPassed:       rebuiltDefaultPriorityConsumerPreflightPassed,
		ConsumerPriorityPolicy:             int(defaultPriorityInfo.Config.PriorityPolicy),
		ConsumerPriorityGroupCount:         len(defaultPriorityInfo.Config.PriorityGroups),
		AckAllConsumerRejected:             ackAllConsumerRejected,
		RebuiltExplicitAckPassed:           rebuiltExplicitAckConsumerPreflightPassed,
		ConsumerAckPolicy:                  int(explicitAckInfo.Config.AckPolicy),
		ReceiveCancellationWaitingObserved: true,
		ReceiveCancellationPropagated:      receiveCancellationPropagated,
		ReceiveCancellationError:           receiveCancellationError.Error(),
		ReceiveCancellationLatencyNanos:    receiveCancellationLatency.Nanoseconds(),
		ReceiveCancellationFetchWaitNanos:  contractCancellationFetchWait.Nanoseconds(),
		ReceiveCancellationLimitNanos:      contractCancellationReturnLimit.Nanoseconds(),
		PersistentConsumerPreflightPassed:  true,
		DeliverNewPolicyRejected:           deliverNewPolicyRejected,
		DeliverAllPolicyPreflightPassed:    deliverAllPolicyPreflightPassed,
		ConsumerDeliverPolicy:              int(info.Config.DeliverPolicy),
		ReplayOriginalPolicyRejected:       replayOriginalPolicyRejected,
		ReplayInstantPolicyPreflightPassed: replayInstantPolicyPreflightPassed,
		ConsumerReplayPolicy:               int(info.Config.ReplayPolicy),
		BrokerRequestExpiresRejected:       brokerRequestExpiresRejected,
		ShortRequestExpiresRejected:        shortRequestExpiresRejected,
		CompatibleRequestExpiresPassed:     compatibleRequestExpiresPreflightPassed,
		AdapterFetchMaxWaitNanos:           contractFetchMaxWait.Nanoseconds(),
		ConsumerMaxRequestExpiresNanos:     info.Config.MaxRequestExpires.Nanoseconds(),
		PausedConsumerRejected:             pausedConsumerRejected,
		ResumedConsumerPreflightPassed:     resumedConsumerPreflightPassed,
		ConsumerPaused:                     exactSubjectInfo.Paused,
		LimitedDeliveryRejected:            limitedDeliveryRejected,
		ConsumerMaxDeliver:                 info.Config.MaxDeliver,
		HeadersOnlyRejected:                headersOnlyRejected,
		FullPayloadPreflightPassed:         true,
		ConsumerHeadersOnly:                info.Config.HeadersOnly,
		BroadSubjectFilterRejected:         broadSubjectFilterRejected,
		ExactSubjectPreflightPassed:        exactSubjectPreflightPassed,
		ConsumerFilterSubject:              info.Config.FilterSubject,
		ForeignSubjectExcluded:             foreignSubjectExcluded,
		SourceMessagesPublished:            4,
		DeduplicatedPublishAttempts:        contractDeduplicatedPublishRuns,
		DeduplicatedStoredMessages:         int(deduplicationInfo.State.Msgs),
		DuplicateWindowNanos:               contractDuplicateWindow.Nanoseconds(),
		DeduplicationVerified:              true,
		RedeliveryObserved:                 true,
		RedeliveryCount:                    metadata.NumDelivered,
		Acknowledged:                       1,
		DeadLettered:                       1,
		DLQPublishConfirmed:                true,
		DLQAcknowledged:                    1,
		ShortLeaseRejected:                 shortLeaseRejected,
		StaticLeasePreflightPassed:         true,
		RequiredLeaseNanos:                 requiredLease.Nanoseconds(),
		WorkerAckWaitNanos:                 contractWorkerAckWait.Nanoseconds(),
		DynamicLeasePreflightPassed:        true,
		DynamicRequiredLeaseNanos:          extendedLease.Nanoseconds(),
		DynamicAckWaitNanos:                contractExtendedAckWait.Nanoseconds(),
		DynamicHandlingNanos:               contractExtendedHandling.Nanoseconds(),
		LeaseExtensionIntervalNanos:        contractLeaseExtensionRetry.LeaseExtensionInterval.Nanoseconds(),
		LeaseExtensions:                    extensionObserver.extended.Load(),
		LeaseExtensionFailures:             extensionObserver.failed.Load(),
		DynamicRedeliveryAfterAck:          false,
		SourceAckPending:                   info.NumAckPending,
		SourceMessagesPending:              info.NumPending,
	})
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
		Duplicates: contractDuplicateWindow,
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

func waitContractConsumerWaiting(
	t *testing.T,
	ctx context.Context,
	consumer ConsumerInspector,
	receiveResult <-chan error,
) {
	t.Helper()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		info, err := consumer.Info(ctx)
		if err == nil && info != nil && info.NumWaiting > 0 {
			return
		}
		select {
		case receiveErr := <-receiveResult:
			t.Fatalf("ReceiveDelivery returned before the pull was waiting: %v", receiveErr)
		case <-ticker.C:
		case <-ctx.Done():
			t.Fatal("timed out waiting for an active JetStream pull request")
		}
	}
}

type deliveryContractReport struct {
	SchemaVersion                      int    `json:"schemaVersion"`
	Status                             string `json:"status"`
	Storage                            string `json:"storage"`
	Replicas                           int    `json:"replicas"`
	PushConsumerRejected               bool   `json:"pushConsumerRejected"`
	RebuiltPullConsumerPreflightPassed bool   `json:"rebuiltPullConsumerPreflightPassed"`
	ConsumerDeliverSubject             string `json:"consumerDeliverSubject"`
	PriorityConsumerRejected           bool   `json:"priorityConsumerRejected"`
	RebuiltDefaultPriorityPassed       bool   `json:"rebuiltDefaultPriorityConsumerPreflightPassed"`
	ConsumerPriorityPolicy             int    `json:"consumerPriorityPolicy"`
	ConsumerPriorityGroupCount         int    `json:"consumerPriorityGroupCount"`
	AckAllConsumerRejected             bool   `json:"ackAllConsumerRejected"`
	RebuiltExplicitAckPassed           bool   `json:"rebuiltExplicitAckConsumerPreflightPassed"`
	ConsumerAckPolicy                  int    `json:"consumerAckPolicy"`
	ReceiveCancellationWaitingObserved bool   `json:"receiveCancellationWaitingObserved"`
	ReceiveCancellationPropagated      bool   `json:"receiveCancellationPropagated"`
	ReceiveCancellationError           string `json:"receiveCancellationError"`
	ReceiveCancellationLatencyNanos    int64  `json:"receiveCancellationLatencyNanos"`
	ReceiveCancellationFetchWaitNanos  int64  `json:"receiveCancellationFetchMaxWaitNanos"`
	ReceiveCancellationLimitNanos      int64  `json:"receiveCancellationReturnLimitNanos"`
	PersistentConsumerPreflightPassed  bool   `json:"persistentConsumerPreflightPassed"`
	DeliverNewPolicyRejected           bool   `json:"deliverNewPolicyRejected"`
	DeliverAllPolicyPreflightPassed    bool   `json:"deliverAllPolicyPreflightPassed"`
	ConsumerDeliverPolicy              int    `json:"consumerDeliverPolicy"`
	ReplayOriginalPolicyRejected       bool   `json:"replayOriginalPolicyRejected"`
	ReplayInstantPolicyPreflightPassed bool   `json:"replayInstantPolicyPreflightPassed"`
	ConsumerReplayPolicy               int    `json:"consumerReplayPolicy"`
	BrokerRequestExpiresRejected       bool   `json:"brokerRequestExpiresRejected"`
	ShortRequestExpiresRejected        bool   `json:"shortRequestExpiresRejected"`
	CompatibleRequestExpiresPassed     bool   `json:"compatibleRequestExpiresPreflightPassed"`
	AdapterFetchMaxWaitNanos           int64  `json:"adapterFetchMaxWaitNanos"`
	ConsumerMaxRequestExpiresNanos     int64  `json:"consumerMaxRequestExpiresNanos"`
	PausedConsumerRejected             bool   `json:"pausedConsumerRejected"`
	ResumedConsumerPreflightPassed     bool   `json:"resumedConsumerPreflightPassed"`
	ConsumerPaused                     bool   `json:"consumerPaused"`
	LimitedDeliveryRejected            bool   `json:"limitedDeliveryRejected"`
	ConsumerMaxDeliver                 int    `json:"consumerMaxDeliver"`
	HeadersOnlyRejected                bool   `json:"headersOnlyRejected"`
	FullPayloadPreflightPassed         bool   `json:"fullPayloadPreflightPassed"`
	ConsumerHeadersOnly                bool   `json:"consumerHeadersOnly"`
	BroadSubjectFilterRejected         bool   `json:"broadSubjectFilterRejected"`
	ExactSubjectPreflightPassed        bool   `json:"exactSubjectPreflightPassed"`
	ConsumerFilterSubject              string `json:"consumerFilterSubject"`
	ForeignSubjectExcluded             bool   `json:"foreignSubjectExcluded"`
	SourceMessagesPublished            int    `json:"sourceMessagesPublished"`
	DeduplicatedPublishAttempts        int    `json:"deduplicatedPublishAttempts"`
	DeduplicatedStoredMessages         int    `json:"deduplicatedStoredMessages"`
	DuplicateWindowNanos               int64  `json:"duplicateWindowNanos"`
	DeduplicationVerified              bool   `json:"deduplicationVerified"`
	RedeliveryObserved                 bool   `json:"redeliveryObserved"`
	RedeliveryCount                    uint64 `json:"redeliveryCount"`
	Acknowledged                       int    `json:"acknowledged"`
	DeadLettered                       int    `json:"deadLettered"`
	DLQPublishConfirmed                bool   `json:"dlqPublishConfirmed"`
	DLQAcknowledged                    int    `json:"dlqAcknowledged"`
	ShortLeaseRejected                 bool   `json:"shortLeaseRejected"`
	StaticLeasePreflightPassed         bool   `json:"staticLeasePreflightPassed"`
	RequiredLeaseNanos                 int64  `json:"requiredLeaseNanos"`
	WorkerAckWaitNanos                 int64  `json:"workerAckWaitNanos"`
	DynamicLeasePreflightPassed        bool   `json:"dynamicLeasePreflightPassed"`
	DynamicRequiredLeaseNanos          int64  `json:"dynamicRequiredLeaseNanos"`
	DynamicAckWaitNanos                int64  `json:"dynamicAckWaitNanos"`
	DynamicHandlingNanos               int64  `json:"dynamicHandlingNanos"`
	LeaseExtensionIntervalNanos        int64  `json:"leaseExtensionIntervalNanos"`
	LeaseExtensions                    int32  `json:"leaseExtensions"`
	LeaseExtensionFailures             int32  `json:"leaseExtensionFailures"`
	DynamicRedeliveryAfterAck          bool   `json:"dynamicRedeliveryAfterAck"`
	SourceAckPending                   int    `json:"sourceAckPending"`
	SourceMessagesPending              uint64 `json:"sourceMessagesPending"`
}

func writeDeliveryReport(t *testing.T, reportPath string, report deliveryContractReport) {
	t.Helper()
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatalf("marshal delivery report: %v", err)
	}
	encoded = append(encoded, '\n')
	if err := os.WriteFile(reportPath, encoded, 0o640); err != nil {
		t.Fatalf("write delivery report: %v", err)
	}
}
