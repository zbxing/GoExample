package natsjetstream

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode"

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

func TestValidLiteralSubjectPreservesBoundaries(t *testing.T) {
	valid := []string{
		"events.primary",
		"事件.主題",
		"events._private",
		"events." + string([]byte{0xff}),
	}
	for _, subject := range valid {
		if !validLiteralSubject(subject) {
			t.Errorf("validLiteralSubject(%q) = false, want true", subject)
		}
	}
	invalid := []string{
		"",
		".events",
		"events.",
		"events..primary",
		"*events.primary",
		"events*primary.orders",
		"events.*",
		">events.primary",
		"events>primary.orders",
		"events.>",
		"events with-space",
		"events.\u0000primary",
		"events.\u007fprimary",
		"events.\u2003primary",
		strings.Repeat("a", 256),
	}
	for _, subject := range invalid {
		if validLiteralSubject(subject) {
			t.Errorf("validLiteralSubject(%q) = true, want false", subject)
		}
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
	const required = 2750 * time.Millisecond
	for name, test := range map[string]struct {
		config  jetstream.ConsumerConfig
		wantErr error
	}{
		"ack wait above budget": {
			config: jetstream.ConsumerConfig{Durable: "WORKER", AckPolicy: jetstream.AckExplicitPolicy, AckWait: 3 * time.Second, MaxDeliver: -1},
		},
		"exact boundary": {
			config: jetstream.ConsumerConfig{Durable: "WORKER", AckPolicy: jetstream.AckExplicitPolicy, AckWait: required, MaxDeliver: -1},
		},
		"short ack wait": {
			config:  jetstream.ConsumerConfig{Durable: "WORKER", AckPolicy: jetstream.AckExplicitPolicy, AckWait: required - time.Nanosecond, MaxDeliver: -1},
			wantErr: ErrAckWaitTooShort,
		},
		"all backoff intervals sufficient": {
			config: jetstream.ConsumerConfig{
				Durable:    "WORKER",
				AckPolicy:  jetstream.AckExplicitPolicy,
				AckWait:    time.Millisecond,
				BackOff:    []time.Duration{3 * time.Second, required},
				MaxDeliver: -1,
			},
		},
		"later backoff interval too short": {
			config: jetstream.ConsumerConfig{
				Durable:    "WORKER",
				AckPolicy:  jetstream.AckExplicitPolicy,
				AckWait:    time.Hour,
				BackOff:    []time.Duration{3 * time.Second, required - time.Nanosecond},
				MaxDeliver: -1,
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
		Durable:    "WORKER",
		AckPolicy:  jetstream.AckExplicitPolicy,
		AckWait:    2 * time.Minute,
		MaxDeliver: -1,
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
		"non-explicit ack": {ctx: context.Background(), consumer: &fakeConsumer{info: &jetstream.ConsumerInfo{Config: jetstream.ConsumerConfig{AckPolicy: jetstream.AckNonePolicy}}}, client: client, margin: time.Second, wantErr: ErrConsumerAckPolicy},
		"zero ack wait":    {ctx: context.Background(), consumer: &fakeConsumer{info: &jetstream.ConsumerInfo{Config: jetstream.ConsumerConfig{Durable: "WORKER", AckPolicy: jetstream.AckExplicitPolicy, MaxDeliver: -1}}}, client: client, margin: time.Second, wantErr: ErrConsumerPreflight},
		"negative backoff": {ctx: context.Background(), consumer: &fakeConsumer{info: &jetstream.ConsumerInfo{Config: jetstream.ConsumerConfig{Durable: "WORKER", AckPolicy: jetstream.AckExplicitPolicy, BackOff: []time.Duration{-time.Second}, MaxDeliver: -1}}}, client: client, margin: time.Second, wantErr: ErrConsumerPreflight},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := PreflightConsumer(test.ctx, test.consumer, test.client, queueclient.DeliveryRetryConfig{}, test.margin)
			if !errors.Is(err, test.wantErr) || strings.Contains(err.Error(), "private") {
				t.Fatalf("PreflightConsumer() error = %v", err)
			}
		})
	}
}

func TestPreflightConsumerRequiresExplicitAckPolicy(t *testing.T) {
	client, err := queueclient.New(queueclient.Config{System: queueclient.SystemNATS})
	if err != nil {
		t.Fatalf("queueclient.New() error = %v", err)
	}
	valid := jetstream.ConsumerConfig{
		Durable:       "PRIVATE_ACK_WORKER",
		AckPolicy:     jetstream.AckExplicitPolicy,
		DeliverPolicy: jetstream.DeliverAllPolicy,
		ReplayPolicy:  jetstream.ReplayInstantPolicy,
		AckWait:       2 * time.Minute,
		MaxDeliver:    -1,
		FilterSubject: "private.events.primary",
	}
	for name, test := range map[string]struct {
		policy  jetstream.AckPolicy
		wantErr error
	}{
		"explicit": {
			policy: jetstream.AckExplicitPolicy,
		},
		"all": {
			policy:  jetstream.AckAllPolicy,
			wantErr: ErrConsumerAckPolicy,
		},
		"none": {
			policy:  jetstream.AckNonePolicy,
			wantErr: ErrConsumerAckPolicy,
		},
		"flow control": {
			policy:  jetstream.AckFlowControlPolicy,
			wantErr: ErrConsumerAckPolicy,
		},
		"unknown": {
			policy:  jetstream.AckPolicy(255),
			wantErr: ErrConsumerAckPolicy,
		},
	} {
		t.Run(name, func(t *testing.T) {
			config := valid
			config.AckPolicy = test.policy
			consumer := &fakeConsumer{info: &jetstream.ConsumerInfo{Config: config}}
			budget, preflightErr := PreflightConsumer(
				context.Background(),
				consumer,
				client,
				queueclient.DeliveryRetryConfig{},
				time.Second,
			)
			if !errors.Is(preflightErr, test.wantErr) || budget <= 0 {
				t.Fatalf("PreflightConsumer() = %s, %v", budget, preflightErr)
			}
			if consumer.infoCalls != 1 {
				t.Fatalf("Consumer.Info() calls = %d, want 1", consumer.infoCalls)
			}
			if preflightErr != nil {
				for _, privateValue := range []string{
					config.Durable,
					config.FilterSubject,
					strconv.Itoa(int(config.AckPolicy)),
					"private-server-url",
				} {
					if strings.Contains(preflightErr.Error(), privateValue) {
						t.Fatalf("PreflightConsumer() exposed acknowledgement configuration: %v", preflightErr)
					}
				}
			}
		})
	}

	incompatible := valid
	incompatible.AckPolicy = jetstream.AckAllPolicy
	incompatible.DeliverSubject = "private.delivery.inbox"
	incompatible.PriorityPolicy = jetstream.PriorityPolicyPinned
	incompatible.PriorityGroups = []string{"PRIVATE_PRIORITY_GROUP"}
	consumer := &fakeConsumer{info: &jetstream.ConsumerInfo{Config: incompatible, Paused: true}}
	adapter, err := New(
		&fakePublisher{},
		consumer,
		Config{Subject: valid.FilterSubject, DeadLetterSubject: "private.events.dlq"},
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	budget, preflightErr := adapter.PreflightConsumer(
		context.Background(),
		client,
		queueclient.DeliveryRetryConfig{},
		time.Second,
	)
	if !errors.Is(preflightErr, ErrConsumerAckPolicy) || budget <= 0 || consumer.infoCalls != 1 {
		t.Fatalf("Adapter.PreflightConsumer() = %s, %v; Info calls = %d", budget, preflightErr, consumer.infoCalls)
	}
}

func TestPreflightConsumerRejectsPausedState(t *testing.T) {
	client, err := queueclient.New(queueclient.Config{System: queueclient.SystemNATS})
	if err != nil {
		t.Fatalf("queueclient.New() error = %v", err)
	}
	valid := jetstream.ConsumerConfig{
		Durable:       "PRIVATE_WORKER_NAME",
		AckPolicy:     jetstream.AckExplicitPolicy,
		DeliverPolicy: jetstream.DeliverAllPolicy,
		ReplayPolicy:  jetstream.ReplayInstantPolicy,
		AckWait:       2 * time.Minute,
		MaxDeliver:    -1,
		FilterSubject: "private.events.primary",
	}
	const privatePauseRemaining = 37 * time.Minute
	for name, test := range map[string]struct {
		paused  bool
		wantErr error
	}{
		"unpaused": {},
		"paused":   {paused: true, wantErr: ErrConsumerPaused},
	} {
		t.Run(name, func(t *testing.T) {
			consumer := &fakeConsumer{info: &jetstream.ConsumerInfo{
				Config:         valid,
				Paused:         test.paused,
				PauseRemaining: privatePauseRemaining,
			}}
			budget, preflightErr := PreflightConsumer(
				context.Background(),
				consumer,
				client,
				queueclient.DeliveryRetryConfig{},
				time.Second,
			)
			if !errors.Is(preflightErr, test.wantErr) || budget <= 0 {
				t.Fatalf("PreflightConsumer() = %s, %v", budget, preflightErr)
			}
			if consumer.infoCalls != 1 {
				t.Fatalf("Consumer.Info() calls = %d, want 1", consumer.infoCalls)
			}
			if preflightErr != nil && (strings.Contains(preflightErr.Error(), valid.Durable) ||
				strings.Contains(preflightErr.Error(), privatePauseRemaining.String())) {
				t.Fatalf("PreflightConsumer() exposed pause configuration: %v", preflightErr)
			}
		})
	}

	pausedConsumer := &fakeConsumer{info: &jetstream.ConsumerInfo{
		Config:         valid,
		Paused:         true,
		PauseRemaining: privatePauseRemaining,
	}}
	adapter, err := New(
		&fakePublisher{},
		pausedConsumer,
		Config{Subject: valid.FilterSubject, DeadLetterSubject: "private.events.dlq"},
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	budget, preflightErr := adapter.PreflightConsumer(
		context.Background(),
		client,
		queueclient.DeliveryRetryConfig{},
		time.Second,
	)
	if !errors.Is(preflightErr, ErrConsumerPaused) || budget <= 0 || pausedConsumer.infoCalls != 1 {
		t.Fatalf("Adapter.PreflightConsumer() = %s, %v; Info calls = %d", budget, preflightErr, pausedConsumer.infoCalls)
	}

	invalidAck := valid
	invalidAck.AckPolicy = jetstream.AckNonePolicy
	_, preflightErr = PreflightConsumer(
		context.Background(),
		&fakeConsumer{info: &jetstream.ConsumerInfo{Config: invalidAck, Paused: true}},
		client,
		queueclient.DeliveryRetryConfig{},
		time.Second,
	)
	if !errors.Is(preflightErr, ErrConsumerAckPolicy) {
		t.Fatalf("PreflightConsumer(paused invalid ack) error = %v", preflightErr)
	}
}

func TestPreflightConsumerRequiresPullMode(t *testing.T) {
	client, err := queueclient.New(queueclient.Config{System: queueclient.SystemNATS})
	if err != nil {
		t.Fatalf("queueclient.New() error = %v", err)
	}
	valid := jetstream.ConsumerConfig{
		Durable:       "PRIVATE_WORKER_NAME",
		AckPolicy:     jetstream.AckExplicitPolicy,
		DeliverPolicy: jetstream.DeliverAllPolicy,
		ReplayPolicy:  jetstream.ReplayInstantPolicy,
		AckWait:       2 * time.Minute,
		MaxDeliver:    -1,
		FilterSubject: "private.events.primary",
	}
	for name, test := range map[string]struct {
		deliverySubject string
		wantErr         error
	}{
		"pull": {},
		"push": {deliverySubject: "private.delivery.inbox", wantErr: ErrConsumerNotPull},
	} {
		t.Run(name, func(t *testing.T) {
			config := valid
			config.DeliverSubject = test.deliverySubject
			consumer := &fakeConsumer{info: &jetstream.ConsumerInfo{Config: config}}
			budget, preflightErr := PreflightConsumer(
				context.Background(),
				consumer,
				client,
				queueclient.DeliveryRetryConfig{},
				time.Second,
			)
			if !errors.Is(preflightErr, test.wantErr) || budget <= 0 {
				t.Fatalf("PreflightConsumer() = %s, %v", budget, preflightErr)
			}
			if consumer.infoCalls != 1 {
				t.Fatalf("Consumer.Info() calls = %d, want 1", consumer.infoCalls)
			}
			if preflightErr != nil && (strings.Contains(preflightErr.Error(), config.Durable) ||
				strings.Contains(preflightErr.Error(), config.FilterSubject) ||
				strings.Contains(preflightErr.Error(), config.DeliverSubject)) {
				t.Fatalf("PreflightConsumer() exposed consumer configuration: %v", preflightErr)
			}
		})
	}

	push := valid
	push.DeliverSubject = "private.delivery.inbox"
	pushConsumer := &fakeConsumer{info: &jetstream.ConsumerInfo{Config: push}}
	adapter, err := New(
		&fakePublisher{},
		pushConsumer,
		Config{Subject: valid.FilterSubject, DeadLetterSubject: "private.events.dlq"},
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	budget, preflightErr := adapter.PreflightConsumer(
		context.Background(),
		client,
		queueclient.DeliveryRetryConfig{},
		time.Second,
	)
	if !errors.Is(preflightErr, ErrConsumerNotPull) || budget <= 0 || pushConsumer.infoCalls != 1 {
		t.Fatalf("Adapter.PreflightConsumer() = %s, %v; Info calls = %d", budget, preflightErr, pushConsumer.infoCalls)
	}

	pausedPush := push
	_, preflightErr = PreflightConsumer(
		context.Background(),
		&fakeConsumer{info: &jetstream.ConsumerInfo{Config: pausedPush, Paused: true}},
		client,
		queueclient.DeliveryRetryConfig{},
		time.Second,
	)
	if !errors.Is(preflightErr, ErrConsumerPaused) {
		t.Fatalf("PreflightConsumer(paused push consumer) error = %v", preflightErr)
	}
}

func TestPreflightConsumerRequiresDefaultPriorityPolicy(t *testing.T) {
	client, err := queueclient.New(queueclient.Config{System: queueclient.SystemNATS})
	if err != nil {
		t.Fatalf("queueclient.New() error = %v", err)
	}
	valid := jetstream.ConsumerConfig{
		Durable:       "PRIVATE_WORKER_NAME",
		AckPolicy:     jetstream.AckExplicitPolicy,
		DeliverPolicy: jetstream.DeliverAllPolicy,
		ReplayPolicy:  jetstream.ReplayInstantPolicy,
		AckWait:       2 * time.Minute,
		MaxDeliver:    -1,
		FilterSubject: "private.events.primary",
	}
	for name, test := range map[string]struct {
		policy  jetstream.PriorityPolicy
		groups  []string
		wantErr error
	}{
		"default": {},
		"pinned": {
			policy:  jetstream.PriorityPolicyPinned,
			groups:  []string{"private-pinned-group"},
			wantErr: ErrConsumerPriorityPolicy,
		},
		"overflow": {
			policy:  jetstream.PriorityPolicyOverflow,
			groups:  []string{"private-overflow-group"},
			wantErr: ErrConsumerPriorityPolicy,
		},
		"prioritized": {
			policy:  jetstream.PriorityPolicyPrioritized,
			groups:  []string{"private-prioritized-group"},
			wantErr: ErrConsumerPriorityPolicy,
		},
		"unknown": {
			policy:  jetstream.PriorityPolicy(255),
			wantErr: ErrConsumerPriorityPolicy,
		},
		"group without policy": {
			groups:  []string{"private-orphan-group"},
			wantErr: ErrConsumerPriorityPolicy,
		},
	} {
		t.Run(name, func(t *testing.T) {
			config := valid
			config.PriorityPolicy = test.policy
			config.PriorityGroups = test.groups
			consumer := &fakeConsumer{info: &jetstream.ConsumerInfo{Config: config}}
			budget, preflightErr := PreflightConsumer(
				context.Background(),
				consumer,
				client,
				queueclient.DeliveryRetryConfig{},
				time.Second,
			)
			if !errors.Is(preflightErr, test.wantErr) || budget <= 0 {
				t.Fatalf("PreflightConsumer() = %s, %v", budget, preflightErr)
			}
			if consumer.infoCalls != 1 {
				t.Fatalf("Consumer.Info() calls = %d, want 1", consumer.infoCalls)
			}
			if preflightErr != nil {
				for _, privateValue := range append([]string{config.Durable, strconv.Itoa(int(config.PriorityPolicy))}, config.PriorityGroups...) {
					if privateValue != "" && strings.Contains(preflightErr.Error(), privateValue) {
						t.Fatalf("PreflightConsumer() exposed priority configuration: %v", preflightErr)
					}
				}
			}
		})
	}

	pinned := valid
	pinned.PriorityPolicy = jetstream.PriorityPolicyPinned
	pinned.PriorityGroups = []string{"private-adapter-group"}
	pinnedConsumer := &fakeConsumer{info: &jetstream.ConsumerInfo{Config: pinned}}
	adapter, err := New(
		&fakePublisher{},
		pinnedConsumer,
		Config{Subject: valid.FilterSubject, DeadLetterSubject: "private.events.dlq"},
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	budget, preflightErr := adapter.PreflightConsumer(
		context.Background(),
		client,
		queueclient.DeliveryRetryConfig{},
		time.Second,
	)
	if !errors.Is(preflightErr, ErrConsumerPriorityPolicy) || budget <= 0 || pinnedConsumer.infoCalls != 1 {
		t.Fatalf("Adapter.PreflightConsumer() = %s, %v; Info calls = %d", budget, preflightErr, pinnedConsumer.infoCalls)
	}

	pausedPinned := pinned
	_, preflightErr = PreflightConsumer(
		context.Background(),
		&fakeConsumer{info: &jetstream.ConsumerInfo{Config: pausedPinned, Paused: true}},
		client,
		queueclient.DeliveryRetryConfig{},
		time.Second,
	)
	if !errors.Is(preflightErr, ErrConsumerPaused) {
		t.Fatalf("PreflightConsumer(paused priority consumer) error = %v", preflightErr)
	}

	pushPinned := pinned
	pushPinned.DeliverSubject = "private.delivery.inbox"
	_, preflightErr = PreflightConsumer(
		context.Background(),
		&fakeConsumer{info: &jetstream.ConsumerInfo{Config: pushPinned}},
		client,
		queueclient.DeliveryRetryConfig{},
		time.Second,
	)
	if !errors.Is(preflightErr, ErrConsumerNotPull) {
		t.Fatalf("PreflightConsumer(push priority consumer) error = %v", preflightErr)
	}
}

func TestPreflightConsumerRequiresPersistentRedeliveryConfiguration(t *testing.T) {
	client, err := queueclient.New(queueclient.Config{System: queueclient.SystemNATS})
	if err != nil {
		t.Fatalf("queueclient.New() error = %v", err)
	}
	valid := jetstream.ConsumerConfig{
		Durable:    "WORKER",
		AckPolicy:  jetstream.AckExplicitPolicy,
		AckWait:    2 * time.Minute,
		MaxDeliver: -1,
	}
	for name, test := range map[string]struct {
		mutate  func(*jetstream.ConsumerConfig)
		wantErr error
	}{
		"empty durable": {
			mutate:  func(config *jetstream.ConsumerConfig) { config.Durable = "" },
			wantErr: ErrConsumerNotPersistent,
		},
		"memory storage": {
			mutate:  func(config *jetstream.ConsumerConfig) { config.MemoryStorage = true },
			wantErr: ErrConsumerNotPersistent,
		},
		"inactive cleanup": {
			mutate:  func(config *jetstream.ConsumerConfig) { config.InactiveThreshold = time.Minute },
			wantErr: ErrConsumerNotPersistent,
		},
		"negative unsupported maximum": {
			mutate:  func(config *jetstream.ConsumerConfig) { config.MaxDeliver = -2 },
			wantErr: ErrMaxDeliverTooLow,
		},
		"zero maximum": {
			mutate:  func(config *jetstream.ConsumerConfig) { config.MaxDeliver = 0 },
			wantErr: ErrMaxDeliverTooLow,
		},
		"initial delivery only": {
			mutate:  func(config *jetstream.ConsumerConfig) { config.MaxDeliver = 1 },
			wantErr: ErrMaxDeliverTooLow,
		},
		"unlimited deliveries": {
			mutate: func(config *jetstream.ConsumerConfig) { config.MaxDeliver = -1 },
		},
		"minimum deliveries": {
			mutate: func(config *jetstream.ConsumerConfig) { config.MaxDeliver = 2 },
		},
		"higher finite deliveries": {
			mutate: func(config *jetstream.ConsumerConfig) { config.MaxDeliver = 5 },
		},
	} {
		t.Run(name, func(t *testing.T) {
			config := valid
			test.mutate(&config)
			budget, preflightErr := PreflightConsumer(
				context.Background(),
				&fakeConsumer{info: &jetstream.ConsumerInfo{Config: config}},
				client,
				queueclient.DeliveryRetryConfig{},
				time.Second,
			)
			if preflightErr != test.wantErr || budget <= 0 {
				t.Fatalf("PreflightConsumer() = %s, %v", budget, preflightErr)
			}
			if preflightErr != nil && ((config.Durable != "" && strings.Contains(preflightErr.Error(), config.Durable)) || strings.Contains(preflightErr.Error(), strconv.Itoa(config.MaxDeliver))) {
				t.Fatalf("PreflightConsumer() exposed configuration: %v", preflightErr)
			}
		})
	}
}

func TestPreflightConsumerRequiresFullMessagePayload(t *testing.T) {
	client, err := queueclient.New(queueclient.Config{System: queueclient.SystemNATS})
	if err != nil {
		t.Fatalf("queueclient.New() error = %v", err)
	}
	valid := jetstream.ConsumerConfig{
		Durable:    "PRIVATE_WORKER_NAME",
		AckPolicy:  jetstream.AckExplicitPolicy,
		AckWait:    2 * time.Minute,
		MaxDeliver: -1,
	}
	for name, test := range map[string]struct {
		headersOnly bool
		wantErr     error
	}{
		"full payload": {},
		"headers only": {
			headersOnly: true,
			wantErr:     ErrConsumerPayloadUnavailable,
		},
	} {
		t.Run(name, func(t *testing.T) {
			config := valid
			config.HeadersOnly = test.headersOnly
			budget, preflightErr := PreflightConsumer(
				context.Background(),
				&fakeConsumer{info: &jetstream.ConsumerInfo{Config: config}},
				client,
				queueclient.DeliveryRetryConfig{},
				time.Second,
			)
			if preflightErr != test.wantErr || budget <= 0 {
				t.Fatalf("PreflightConsumer() = %s, %v", budget, preflightErr)
			}
			if preflightErr != nil && (strings.Contains(preflightErr.Error(), config.Durable) || strings.Contains(preflightErr.Error(), strconv.FormatBool(config.HeadersOnly))) {
				t.Fatalf("PreflightConsumer() exposed configuration: %v", preflightErr)
			}
		})
	}
}

func TestPreflightConsumerRequiresCompleteDeliveryPolicy(t *testing.T) {
	client, err := queueclient.New(queueclient.Config{System: queueclient.SystemNATS})
	if err != nil {
		t.Fatalf("queueclient.New() error = %v", err)
	}
	valid := jetstream.ConsumerConfig{
		Durable:    "PRIVATE_WORKER_NAME",
		AckPolicy:  jetstream.AckExplicitPolicy,
		AckWait:    2 * time.Minute,
		MaxDeliver: -1,
	}
	for name, test := range map[string]struct {
		policy  jetstream.DeliverPolicy
		wantErr error
	}{
		"all":              {policy: jetstream.DeliverAllPolicy},
		"last":             {policy: jetstream.DeliverLastPolicy, wantErr: ErrConsumerDeliveryPolicy},
		"new":              {policy: jetstream.DeliverNewPolicy, wantErr: ErrConsumerDeliveryPolicy},
		"start sequence":   {policy: jetstream.DeliverByStartSequencePolicy, wantErr: ErrConsumerDeliveryPolicy},
		"start time":       {policy: jetstream.DeliverByStartTimePolicy, wantErr: ErrConsumerDeliveryPolicy},
		"last per subject": {policy: jetstream.DeliverLastPerSubjectPolicy, wantErr: ErrConsumerDeliveryPolicy},
	} {
		t.Run(name, func(t *testing.T) {
			config := valid
			config.DeliverPolicy = test.policy
			budget, preflightErr := PreflightConsumer(
				context.Background(),
				&fakeConsumer{info: &jetstream.ConsumerInfo{Config: config}},
				client,
				queueclient.DeliveryRetryConfig{},
				time.Second,
			)
			if !errors.Is(preflightErr, test.wantErr) || budget <= 0 {
				t.Fatalf("PreflightConsumer() = %s, %v", budget, preflightErr)
			}
			if preflightErr != nil && (strings.Contains(preflightErr.Error(), config.Durable) ||
				strings.Contains(preflightErr.Error(), strconv.Itoa(int(config.DeliverPolicy)))) {
				t.Fatalf("PreflightConsumer() exposed delivery policy configuration: %v", preflightErr)
			}
		})
	}
}

func TestPreflightConsumerRequiresInstantReplayPolicy(t *testing.T) {
	client, err := queueclient.New(queueclient.Config{System: queueclient.SystemNATS})
	if err != nil {
		t.Fatalf("queueclient.New() error = %v", err)
	}
	valid := jetstream.ConsumerConfig{
		Durable:       "PRIVATE_WORKER_NAME",
		AckPolicy:     jetstream.AckExplicitPolicy,
		DeliverPolicy: jetstream.DeliverAllPolicy,
		AckWait:       2 * time.Minute,
		MaxDeliver:    -1,
	}
	for name, test := range map[string]struct {
		policy  jetstream.ReplayPolicy
		wantErr error
	}{
		"instant":  {policy: jetstream.ReplayInstantPolicy},
		"original": {policy: jetstream.ReplayOriginalPolicy, wantErr: ErrConsumerReplayPolicy},
		"unknown":  {policy: jetstream.ReplayPolicy(255), wantErr: ErrConsumerReplayPolicy},
	} {
		t.Run(name, func(t *testing.T) {
			config := valid
			config.ReplayPolicy = test.policy
			budget, preflightErr := PreflightConsumer(
				context.Background(),
				&fakeConsumer{info: &jetstream.ConsumerInfo{Config: config}},
				client,
				queueclient.DeliveryRetryConfig{},
				time.Second,
			)
			if !errors.Is(preflightErr, test.wantErr) || budget <= 0 {
				t.Fatalf("PreflightConsumer() = %s, %v", budget, preflightErr)
			}
			if preflightErr != nil && (strings.Contains(preflightErr.Error(), config.Durable) ||
				strings.Contains(preflightErr.Error(), strconv.Itoa(int(config.ReplayPolicy)))) {
				t.Fatalf("PreflightConsumer() exposed replay policy configuration: %v", preflightErr)
			}
		})
	}
}

func TestAdapterPreflightConsumerRequiresExactSubjectFilter(t *testing.T) {
	client, err := queueclient.New(queueclient.Config{System: queueclient.SystemNATS})
	if err != nil {
		t.Fatalf("queueclient.New() error = %v", err)
	}
	const expectedSubject = "private.events.primary"
	valid := jetstream.ConsumerConfig{
		Durable:    "PRIVATE_WORKER_NAME",
		AckPolicy:  jetstream.AckExplicitPolicy,
		AckWait:    2 * time.Minute,
		MaxDeliver: -1,
	}
	for name, test := range map[string]struct {
		filterSubject  string
		filterSubjects []string
		wantErr        error
	}{
		"exact filter subject": {
			filterSubject: expectedSubject,
		},
		"exact single filter subjects": {
			filterSubjects: []string{expectedSubject},
		},
		"unfiltered": {
			wantErr: ErrConsumerSubjectMismatch,
		},
		"wildcard": {
			filterSubject: "private.events.*",
			wantErr:       ErrConsumerSubjectMismatch,
		},
		"different literal": {
			filterSubject: "private.events.secondary",
			wantErr:       ErrConsumerSubjectMismatch,
		},
		"multiple filters": {
			filterSubjects: []string{expectedSubject, "private.events.secondary"},
			wantErr:        ErrConsumerSubjectMismatch,
		},
		"both filter fields": {
			filterSubject:  expectedSubject,
			filterSubjects: []string{expectedSubject},
			wantErr:        ErrConsumerSubjectMismatch,
		},
	} {
		t.Run(name, func(t *testing.T) {
			config := valid
			config.FilterSubject = test.filterSubject
			config.FilterSubjects = test.filterSubjects
			consumer := &fakeConsumer{info: &jetstream.ConsumerInfo{Config: config}}
			adapter, newErr := New(
				&fakePublisher{},
				consumer,
				Config{Subject: expectedSubject, DeadLetterSubject: "private.events.dlq"},
			)
			if newErr != nil {
				t.Fatalf("New() error = %v", newErr)
			}
			budget, preflightErr := adapter.PreflightConsumer(
				context.Background(),
				client,
				queueclient.DeliveryRetryConfig{},
				time.Second,
			)
			if preflightErr != test.wantErr || budget <= 0 {
				t.Fatalf("Adapter.PreflightConsumer() = %s, %v", budget, preflightErr)
			}
			if consumer.infoCalls != 1 {
				t.Fatalf("Consumer.Info() calls = %d, want 1", consumer.infoCalls)
			}
			if preflightErr != nil && (strings.Contains(preflightErr.Error(), expectedSubject) ||
				strings.Contains(preflightErr.Error(), config.FilterSubject) && config.FilterSubject != "") {
				t.Fatalf("Adapter.PreflightConsumer() exposed subject configuration: %v", preflightErr)
			}
		})
	}

	var nilAdapter *Adapter
	if _, err := nilAdapter.PreflightConsumer(context.Background(), client, queueclient.DeliveryRetryConfig{}, time.Second); !errors.Is(err, ErrInvalidConfiguration) {
		t.Fatalf("nil Adapter.PreflightConsumer() error = %v", err)
	}
	if _, err := nilAdapter.PreflightConsumer(nil, client, queueclient.DeliveryRetryConfig{}, time.Second); !errors.Is(err, ErrInvalidContext) {
		t.Fatalf("nil Adapter.PreflightConsumer(nil) error = %v", err)
	}
	adapter, err := New(
		&fakePublisher{},
		&receiveOnlyConsumer{},
		Config{Subject: expectedSubject, DeadLetterSubject: "private.events.dlq"},
	)
	if err != nil {
		t.Fatalf("New(receive-only consumer) error = %v", err)
	}
	if _, err := adapter.PreflightConsumer(context.Background(), client, queueclient.DeliveryRetryConfig{}, time.Second); !errors.Is(err, ErrInvalidConfiguration) {
		t.Fatalf("receive-only Adapter.PreflightConsumer() error = %v", err)
	}
}

func TestAdapterPreflightConsumerRequiresCompatibleRequestExpiration(t *testing.T) {
	client, err := queueclient.New(queueclient.Config{System: queueclient.SystemNATS})
	if err != nil {
		t.Fatalf("queueclient.New() error = %v", err)
	}
	const (
		expectedSubject = "private.events.primary"
		fetchMaxWait    = time.Second
	)
	valid := jetstream.ConsumerConfig{
		Durable:       "PRIVATE_WORKER_NAME",
		AckPolicy:     jetstream.AckExplicitPolicy,
		DeliverPolicy: jetstream.DeliverAllPolicy,
		ReplayPolicy:  jetstream.ReplayInstantPolicy,
		AckWait:       2 * time.Minute,
		MaxDeliver:    -1,
		FilterSubject: expectedSubject,
	}
	for name, test := range map[string]struct {
		maximum time.Duration
		wantErr error
	}{
		"unlimited":      {},
		"exact boundary": {maximum: fetchMaxWait},
		"above boundary": {maximum: 2 * fetchMaxWait},
		"short by 1ns":   {maximum: fetchMaxWait - time.Nanosecond, wantErr: ErrConsumerRequestExpires},
	} {
		t.Run(name, func(t *testing.T) {
			config := valid
			config.MaxRequestExpires = test.maximum
			consumer := &fakeConsumer{info: &jetstream.ConsumerInfo{Config: config}}
			adapter, newErr := New(
				&fakePublisher{},
				consumer,
				Config{
					Subject:           expectedSubject,
					DeadLetterSubject: "private.events.dlq",
					FetchMaxWait:      fetchMaxWait,
				},
			)
			if newErr != nil {
				t.Fatalf("New() error = %v", newErr)
			}
			budget, preflightErr := adapter.PreflightConsumer(
				context.Background(),
				client,
				queueclient.DeliveryRetryConfig{},
				time.Second,
			)
			if !errors.Is(preflightErr, test.wantErr) || budget <= 0 {
				t.Fatalf("Adapter.PreflightConsumer() = %s, %v", budget, preflightErr)
			}
			if consumer.infoCalls != 1 {
				t.Fatalf("Consumer.Info() calls = %d, want 1", consumer.infoCalls)
			}
			if preflightErr != nil && (strings.Contains(preflightErr.Error(), config.Durable) ||
				strings.Contains(preflightErr.Error(), expectedSubject) ||
				strings.Contains(preflightErr.Error(), test.maximum.String())) {
				t.Fatalf("Adapter.PreflightConsumer() exposed expiration configuration: %v", preflightErr)
			}
		})
	}

	short := valid
	short.MaxRequestExpires = fetchMaxWait - time.Nanosecond
	budget, preflightErr := PreflightConsumer(
		context.Background(),
		&fakeConsumer{info: &jetstream.ConsumerInfo{Config: short}},
		client,
		queueclient.DeliveryRetryConfig{},
		time.Second,
	)
	if preflightErr != nil || budget <= 0 {
		t.Fatalf("package PreflightConsumer() = %s, %v", budget, preflightErr)
	}

	invalidReplay := short
	invalidReplay.ReplayPolicy = jetstream.ReplayOriginalPolicy
	adapter, err := New(
		&fakePublisher{},
		&fakeConsumer{info: &jetstream.ConsumerInfo{Config: invalidReplay}},
		Config{Subject: expectedSubject, DeadLetterSubject: "private.events.dlq", FetchMaxWait: fetchMaxWait},
	)
	if err != nil {
		t.Fatalf("New(invalid replay) error = %v", err)
	}
	if _, err := adapter.PreflightConsumer(context.Background(), client, queueclient.DeliveryRetryConfig{}, time.Second); !errors.Is(err, ErrConsumerReplayPolicy) {
		t.Fatalf("Adapter.PreflightConsumer(invalid replay and expiration) error = %v", err)
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

func TestAdapterPublishDeduplicatedUsesOnlyBoundedTypedMessageID(t *testing.T) {
	publisher := &fakePublisher{}
	adapter, err := New(publisher, &fakeConsumer{}, Config{
		Subject:           "events.primary",
		DeadLetterSubject: "events.dlq",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	var nilAdapter *Adapter
	if err := nilAdapter.PublishDeduplicated(context.Background(), "stable-event-id", queueclient.Message{}); !errors.Is(err, ErrInvalidConfiguration) {
		t.Fatalf("nil PublishDeduplicated() error = %v", err)
	}
	if err := adapter.PublishDeduplicated(nil, "stable-event-id", queueclient.Message{}); !errors.Is(err, ErrInvalidContext) {
		t.Fatalf("PublishDeduplicated(nil context) error = %v", err)
	}

	const stableID = "order-123e4567-e89b-12d3-a456-426614174000"
	message := queueclient.Message{Headers: map[string]string{
		"Tenant":              "tenant-a",
		jetstream.MsgIDHeader: "caller-controlled",
	}}
	if err := adapter.PublishDeduplicated(context.Background(), stableID, message); err != nil {
		t.Fatalf("PublishDeduplicated() error = %v", err)
	}
	published := publisher.snapshot()
	if len(published) != 1 || published[0].Header.Get("Tenant") != "tenant-a" ||
		published[0].Header.Get(jetstream.MsgIDHeader) != stableID {
		t.Fatalf("deduplicated publish headers = %#v", published)
	}

	for name, messageID := range map[string]string{
		"empty":        "",
		"space":        "event id",
		"leading":      " event-id",
		"control":      "event\rid",
		"non ascii":    "event-é",
		"over maximum": strings.Repeat("a", maximumPublishMessageID+1),
	} {
		t.Run(name, func(t *testing.T) {
			isolatedPublisher := &fakePublisher{}
			isolatedAdapter, newErr := New(isolatedPublisher, &fakeConsumer{}, Config{
				Subject:           "events.primary",
				DeadLetterSubject: "events.dlq",
			})
			if newErr != nil {
				t.Fatalf("New() error = %v", newErr)
			}
			publishErr := isolatedAdapter.PublishDeduplicated(context.Background(), messageID, queueclient.Message{})
			if !errors.Is(publishErr, ErrInvalidMessageID) ||
				(messageID != "" && strings.Contains(publishErr.Error(), messageID)) {
				t.Fatalf("PublishDeduplicated() error = %v", publishErr)
			}
			if calls := len(isolatedPublisher.snapshot()); calls != 0 {
				t.Fatalf("publisher calls = %d, want 0", calls)
			}
		})
	}

	if err := adapter.PublishDeduplicated(
		context.Background(),
		strings.Repeat("a", maximumPublishMessageID),
		queueclient.Message{},
	); err != nil {
		t.Fatalf("PublishDeduplicated(maximum ID) error = %v", err)
	}
}

func TestAdapterPublishRequiresStructuredServerAcknowledgement(t *testing.T) {
	for name, test := range map[string]struct {
		ack     *jetstream.PubAck
		wantErr error
	}{
		"nil acknowledgement":       {wantErr: ErrPublish},
		"missing stream":            {ack: &jetstream.PubAck{Sequence: 1}, wantErr: ErrPublish},
		"missing sequence":          {ack: &jetstream.PubAck{Stream: "EVENTS"}, wantErr: ErrPublish},
		"duplicate acknowledgement": {ack: &jetstream.PubAck{Stream: "EVENTS", Sequence: 1, Duplicate: true}},
	} {
		t.Run(name, func(t *testing.T) {
			publisher := &fakePublisher{publishAck: func(*nats.Msg) *jetstream.PubAck { return test.ack }}
			adapter, err := New(publisher, &fakeConsumer{}, Config{
				Subject:           "events.primary",
				DeadLetterSubject: "events.dlq",
			})
			if err != nil {
				t.Fatalf("New() error = %v", err)
			}
			if err := adapter.Publish(context.Background(), queueclient.Message{}); !errors.Is(err, test.wantErr) {
				t.Fatalf("Publish() error = %v, want %v", err, test.wantErr)
			}
			if err := adapter.PublishDeduplicated(context.Background(), "stable-event-id", queueclient.Message{}); !errors.Is(err, test.wantErr) {
				t.Fatalf("PublishDeduplicated() error = %v, want %v", err, test.wantErr)
			}
		})
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

func TestAdapterDeadLetterRejectsInvalidPublishAcknowledgementBeforeSourceAck(t *testing.T) {
	tests := map[string]struct {
		ack      *jetstream.PubAck
		wantErr  error
		wantAcks int
	}{
		"nil acknowledgement":       {wantErr: ErrDeadLetter},
		"missing stream":            {ack: &jetstream.PubAck{Sequence: 1}, wantErr: ErrDeadLetter},
		"missing sequence":          {ack: &jetstream.PubAck{Stream: "DLQ"}, wantErr: ErrDeadLetter},
		"duplicate acknowledgement": {ack: &jetstream.PubAck{Stream: "DLQ", Sequence: 1, Duplicate: true}, wantAcks: 1},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			message := &fakeMessage{
				data:     []byte("dead-letter"),
				metadata: &jetstream.MsgMetadata{Stream: "EVENTS", Consumer: "WORKER", Sequence: jetstream.SequencePair{Stream: 11}},
			}
			publisher := &fakePublisher{publishAck: func(*nats.Msg) *jetstream.PubAck { return test.ack }}
			adapter, err := New(publisher, &fakeConsumer{messages: []jetstream.Msg{message}}, Config{
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
			if err := delivery.DeadLetter(context.Background()); !errors.Is(err, test.wantErr) {
				t.Fatalf("DeadLetter() error = %v, want %v", err, test.wantErr)
			}
			if message.doubleAckCalls != test.wantAcks {
				t.Fatalf("source DoubleAck() calls = %d, want %d", message.doubleAckCalls, test.wantAcks)
			}
			if len(publisher.snapshot()) != 1 {
				t.Fatalf("DLQ publishes = %d, want 1", len(publisher.snapshot()))
			}
		})
	}
}

func TestAdapterQuarantinesInvalidMessageBeforeReceivingMoreWork(t *testing.T) {
	publisher := &fakePublisher{}
	invalid := &fakeMessage{
		data: []byte("invalid-body"),
		headers: nats.Header{
			"Tenant":                       []string{"one", "two"},
			"Correlation":                  []string{"safe"},
			jetstream.ExpectedStreamHeader: []string{"private-stream"},
		},
		metadata: &jetstream.MsgMetadata{Stream: "EVENTS", Consumer: "WORKER", Sequence: jetstream.SequencePair{Stream: 8}},
	}
	valid := &fakeMessage{
		data:     []byte("valid-body"),
		headers:  nats.Header{"Tenant": []string{"tenant-a"}},
		metadata: &jetstream.MsgMetadata{Stream: "EVENTS", Consumer: "WORKER", Sequence: jetstream.SequencePair{Stream: 9}},
	}
	adapter, err := New(publisher, &fakeConsumer{messages: []jetstream.Msg{invalid, valid}}, Config{
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
	if string(delivery.Message.Body) != "valid-body" || delivery.Message.Headers["Tenant"] != "tenant-a" {
		t.Fatalf("delivery message = %#v", delivery.Message)
	}
	if invalid.doubleAckCalls != 1 {
		t.Fatalf("invalid source DoubleAck() calls = %d", invalid.doubleAckCalls)
	}
	published := publisher.snapshot()
	if len(published) != 1 {
		t.Fatalf("quarantine publishes = %d", len(published))
	}
	quarantined := published[0]
	if quarantined.Subject != "events.dlq" || string(quarantined.Data) != "invalid-body" {
		t.Fatalf("quarantined message = %#v", quarantined)
	}
	if quarantined.Header.Get("Tenant") != "" || quarantined.Header.Get("Correlation") != "safe" {
		t.Fatalf("quarantined application headers = %#v", quarantined.Header)
	}
	if quarantined.Header.Get(jetstream.ExpectedStreamHeader) != "" || quarantined.Header.Get(jetstream.MsgIDHeader) == "" {
		t.Fatalf("quarantined control headers = %#v", quarantined.Header)
	}
}

func TestAdapterInvalidMessageQuarantineFailsClosed(t *testing.T) {
	newInvalid := func() *fakeMessage {
		return &fakeMessage{
			data:     []byte("invalid"),
			headers:  nats.Header{"Tenant": []string{"one", "two"}},
			metadata: &jetstream.MsgMetadata{Stream: "EVENTS", Consumer: "WORKER", Sequence: jetstream.SequencePair{Stream: 10}},
		}
	}

	t.Run("publish failure leaves source pending", func(t *testing.T) {
		message := newInvalid()
		adapter, err := New(&fakePublisher{publishErr: errors.New("private publish failure")}, &fakeConsumer{messages: []jetstream.Msg{message}}, Config{Subject: "events.primary", DeadLetterSubject: "events.dlq"})
		if err != nil {
			t.Fatalf("New() error = %v", err)
		}
		if _, err := adapter.ReceiveDelivery(context.Background()); !errors.Is(err, ErrDeadLetter) {
			t.Fatalf("ReceiveDelivery() error = %v", err)
		}
		if message.doubleAckCalls != 0 {
			t.Fatalf("source was acked after failed quarantine publish: %d", message.doubleAckCalls)
		}
	})

	t.Run("ack failure reports settlement failure", func(t *testing.T) {
		message := newInvalid()
		message.doubleAckErr = errors.New("private ack failure")
		publisher := &fakePublisher{}
		adapter, err := New(publisher, &fakeConsumer{messages: []jetstream.Msg{message}}, Config{Subject: "events.primary", DeadLetterSubject: "events.dlq"})
		if err != nil {
			t.Fatalf("New() error = %v", err)
		}
		if _, err := adapter.ReceiveDelivery(context.Background()); !errors.Is(err, ErrDeadLetter) {
			t.Fatalf("ReceiveDelivery() error = %v", err)
		}
		if len(publisher.snapshot()) != 1 || message.doubleAckCalls != 1 {
			t.Fatalf("quarantine settlement = publishes:%d acks:%d", len(publisher.snapshot()), message.doubleAckCalls)
		}
	})

	t.Run("missing metadata remains invalid", func(t *testing.T) {
		message := newInvalid()
		message.metadata = nil
		publisher := &fakePublisher{}
		adapter, err := New(publisher, &fakeConsumer{messages: []jetstream.Msg{message}}, Config{Subject: "events.primary", DeadLetterSubject: "events.dlq"})
		if err != nil {
			t.Fatalf("New() error = %v", err)
		}
		if _, err := adapter.ReceiveDelivery(context.Background()); !errors.Is(err, ErrInvalidMessage) {
			t.Fatalf("ReceiveDelivery() error = %v", err)
		}
		if len(publisher.snapshot()) != 0 || message.doubleAckCalls != 0 {
			t.Fatalf("invalid metadata settlement = publishes:%d acks:%d", len(publisher.snapshot()), message.doubleAckCalls)
		}
	})
}

func TestAdapterInvalidMessageQuarantineRejectsInvalidPublishAcknowledgementBeforeSourceAck(t *testing.T) {
	tests := map[string]struct {
		ack      *jetstream.PubAck
		wantErr  error
		wantAcks int
	}{
		"nil acknowledgement":       {wantErr: ErrDeadLetter},
		"missing stream":            {ack: &jetstream.PubAck{Sequence: 1}, wantErr: ErrDeadLetter},
		"missing sequence":          {ack: &jetstream.PubAck{Stream: "DLQ"}, wantErr: ErrDeadLetter},
		"duplicate acknowledgement": {ack: &jetstream.PubAck{Stream: "DLQ", Sequence: 1, Duplicate: true}, wantAcks: 1},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			invalid := &fakeMessage{
				data:     []byte("invalid"),
				headers:  nats.Header{"Tenant": []string{"one", "two"}},
				metadata: &jetstream.MsgMetadata{Stream: "EVENTS", Consumer: "WORKER", Sequence: jetstream.SequencePair{Stream: 12}},
			}
			valid := &fakeMessage{
				data:     []byte("valid"),
				metadata: &jetstream.MsgMetadata{Stream: "EVENTS", Consumer: "WORKER", Sequence: jetstream.SequencePair{Stream: 13}},
			}
			consumer := &fakeConsumer{messages: []jetstream.Msg{invalid, valid}}
			publisher := &fakePublisher{publishAck: func(*nats.Msg) *jetstream.PubAck { return test.ack }}
			adapter, err := New(publisher, consumer, Config{Subject: "events.primary", DeadLetterSubject: "events.dlq"})
			if err != nil {
				t.Fatalf("New() error = %v", err)
			}

			delivery, receiveErr := adapter.ReceiveDelivery(context.Background())
			if !errors.Is(receiveErr, test.wantErr) {
				t.Fatalf("ReceiveDelivery() error = %v, want %v", receiveErr, test.wantErr)
			}
			if test.wantErr == nil && string(delivery.Message.Body) != "valid" {
				t.Fatalf("delivery body = %q, want valid", delivery.Message.Body)
			}
			if invalid.doubleAckCalls != test.wantAcks {
				t.Fatalf("source DoubleAck() calls = %d, want %d", invalid.doubleAckCalls, test.wantAcks)
			}
			wantPending := 1
			if test.wantErr == nil {
				wantPending = 0
			}
			if len(consumer.messages) != wantPending {
				t.Fatalf("pending consumer messages = %d, want %d", len(consumer.messages), wantPending)
			}
		})
	}
}

func TestDeadLetterIDUsesStableDigestInput(t *testing.T) {
	metadata := &jetstream.MsgMetadata{
		Stream:   "EVENTS",
		Consumer: "WORKER",
		Sequence: jetstream.SequencePair{Stream: 123},
	}
	const want = "goexample-dlq-efaeedf7a35aa078f331962fa190dd261e787466138989d52873ee20cd59d78b"
	if got := deadLetterID(metadata); got != want {
		t.Fatalf("deadLetterID() = %q, want %q", got, want)
	}
}

func TestDeadLetterIDUsesBoundedAllocations(t *testing.T) {
	metadata := &jetstream.MsgMetadata{
		Stream:   "EVENTS",
		Consumer: "WORKER",
		Sequence: jetstream.SequencePair{Stream: 123},
	}
	if allocations := testing.AllocsPerRun(1000, func() {
		_ = deadLetterID(metadata)
	}); allocations > 1 {
		t.Fatalf("deadLetterID allocations = %.1f, want at most 1", allocations)
	}
}

func TestDeadLetterIDPreservesLongMetadataContract(t *testing.T) {
	metadata := &jetstream.MsgMetadata{
		Stream:   strings.Repeat("S", 300),
		Consumer: strings.Repeat("C", 300),
		Sequence: jetstream.SequencePair{Stream: 987654321},
	}
	digest := sha256.New()
	_, _ = digest.Write([]byte(metadata.Stream))
	_, _ = digest.Write([]byte{0})
	_, _ = digest.Write([]byte(metadata.Consumer))
	_, _ = digest.Write([]byte{0})
	var sequence [20]byte
	_, _ = digest.Write(strconv.AppendUint(sequence[:0], metadata.Sequence.Stream, 10))
	want := "goexample-dlq-" + hex.EncodeToString(digest.Sum(nil))
	if got := deadLetterID(metadata); got != want {
		t.Fatalf("deadLetterID(long metadata) = %q, want %q", got, want)
	}
}

func BenchmarkDeadLetterID(b *testing.B) {
	metadata := &jetstream.MsgMetadata{
		Stream:   "EVENTS",
		Consumer: "WORKER",
		Sequence: jetstream.SequencePair{Stream: 123},
	}
	b.ReportAllocs()
	for range b.N {
		_ = deadLetterID(metadata)
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

func TestCopyApplicationHeadersReusesDestinationAndFiltersControlHeaders(t *testing.T) {
	destination := nats.Header{"Existing": []string{"keep"}}
	copyApplicationHeaders(destination, map[string]string{
		"Tenant":                       "tenant-a",
		jetstream.MsgIDHeader:          "caller-controlled",
		jetstream.ExpectedStreamHeader: "private-stream",
	})
	if destination.Get("Existing") != "keep" || destination.Get("Tenant") != "tenant-a" {
		t.Fatalf("destination headers = %#v", destination)
	}
	if destination.Get(jetstream.MsgIDHeader) != "" || destination.Get(jetstream.ExpectedStreamHeader) != "" {
		t.Fatalf("control headers were copied: %#v", destination)
	}
}

func TestJetStreamControlHeaderAcceptsCanonicalAndMixedCaseNames(t *testing.T) {
	for _, control := range jetStreamControlHeaders {
		if !jetStreamControlHeader(control) {
			t.Fatalf("canonical control header %q was not recognized", control)
		}
		mixedCase := strings.ToUpper(control[:1]) + strings.ToLower(control[1:])
		if !jetStreamControlHeader(mixedCase) {
			t.Fatalf("mixed-case control header %q was not recognized", mixedCase)
		}
	}
	for _, application := range []string{"Tenant", "Nats-Msg", "Nats-Expected"} {
		if jetStreamControlHeader(application) {
			t.Fatalf("application header %q was incorrectly classified as control", application)
		}
	}
}

func TestFromJetStreamMessageControlOnlyHeadersRemainNil(t *testing.T) {
	message := &fakeMessage{
		data:    []byte("payload"),
		headers: nats.Header{jetstream.MsgIDHeader: []string{"message-id"}},
	}
	result, err := fromJetStreamMessage(message)
	if err != nil {
		t.Fatalf("fromJetStreamMessage() error = %v", err)
	}
	if result.Headers != nil {
		t.Fatalf("control-only headers = %#v, want nil", result.Headers)
	}
}

func TestFromJetStreamMessageMultipleControlHeadersRemainNil(t *testing.T) {
	headers := nats.Header{
		strings.ToUpper(jetstream.MsgIDHeader[:1]) + strings.ToLower(jetstream.MsgIDHeader[1:]):                         []string{"message-id"},
		strings.ToUpper(jetstream.ExpectedStreamHeader[:1]) + strings.ToLower(jetstream.ExpectedStreamHeader[1:]):       []string{"stream"},
		strings.ToUpper(jetstream.ExpectedLastSeqHeader[:1]) + strings.ToLower(jetstream.ExpectedLastSeqHeader[1:]):     []string{"7"},
		strings.ToUpper(jetstream.ExpectedLastMsgIDHeader[:1]) + strings.ToLower(jetstream.ExpectedLastMsgIDHeader[1:]): []string{"previous-id"},
	}
	result, err := fromJetStreamMessage(&fakeMessage{data: []byte("payload"), headers: headers})
	if err != nil {
		t.Fatalf("fromJetStreamMessage() error = %v", err)
	}
	if result.Headers != nil {
		t.Fatalf("multiple control headers = %#v, want nil", result.Headers)
	}
	if string(result.Body) != "payload" {
		t.Fatalf("body = %q, want payload", result.Body)
	}
}

func TestFromJetStreamMessageRejectsMultiValueBeforeBodyClone(t *testing.T) {
	result, err := fromJetStreamMessage(&fakeMessage{
		data: []byte("private-payload"),
		headers: nats.Header{
			"Tenant": []string{"tenant-a"},
			"Region": []string{"one", "two"},
		},
	})
	if !errors.Is(err, ErrInvalidMessage) {
		t.Fatalf("fromJetStreamMessage() error = %v, want invalid message", err)
	}
	if result.Body != nil || result.Headers != nil {
		t.Fatalf("invalid message retained data: body=%q headers=%v", result.Body, result.Headers)
	}
}

func BenchmarkCopyApplicationHeaders(b *testing.B) {
	cases := map[string]map[string]string{
		"empty":    nil,
		"single":   {"Tenant": "tenant-a"},
		"multiple": {"Tenant": "tenant-a", "Region": "region-a"},
	}
	for name, headers := range cases {
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				destination := nats.Header{}
				copyApplicationHeaders(destination, headers)
			}
		})
		b.Run(name+"-legacy", func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				_ = legacyApplicationHeaders(headers)
			}
		})
	}
}

func BenchmarkJetStreamControlHeader(b *testing.B) {
	cases := map[string]string{
		"canonical":   jetstream.MsgIDHeader,
		"mixed-case":  strings.ToUpper(jetstream.ExpectedLastSeqHeader[:1]) + strings.ToLower(jetstream.ExpectedLastSeqHeader[1:]),
		"application": "X-Tenant",
	}
	for name, header := range cases {
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				if jetStreamControlHeader(header) && name == "application" {
					b.Fatal("application header classified as control")
				}
			}
		})
	}
}

func BenchmarkValidLiteralSubject(b *testing.B) {
	cases := map[string]string{
		"valid":          "events.primary.orders",
		"unicode":        "事件.订单.创建",
		"empty-token":    "events..orders",
		"whitespace":     "events.\u2003orders",
		"wildcard-start": "*events.primary.orders",
		"wildcard-token": "events.primary*orders",
		"wildcard-end":   "events.primary.orders>",
	}
	for name, subject := range cases {
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				benchmarkSubjectResult = validLiteralSubject(subject)
			}
		})
		b.Run(name+"-v122", func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				benchmarkSubjectResult = v122ValidLiteralSubject(subject)
			}
		})
		b.Run(name+"-v121", func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				benchmarkSubjectResult = legacyValidLiteralSubject(subject)
			}
		})
	}
}

var benchmarkSubjectResult bool

func v122ValidLiteralSubject(subject string) bool {
	if len(subject) == 0 || len(subject) > 255 || strings.ContainsAny(subject, "*>") {
		return false
	}
	tokenHasCharacter := false
	for _, character := range subject {
		if character == '.' {
			if !tokenHasCharacter {
				return false
			}
			tokenHasCharacter = false
			continue
		}
		if unicode.IsSpace(character) || unicode.IsControl(character) {
			return false
		}
		tokenHasCharacter = true
	}
	return tokenHasCharacter
}

func legacyValidLiteralSubject(subject string) bool {
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

func BenchmarkFromJetStreamMessage(b *testing.B) {
	cases := map[string]nats.Header{
		"empty":        nil,
		"control-only": {jetstream.MsgIDHeader: []string{"message-id"}},
		"control-batch": {
			jetstream.MsgIDHeader:           []string{"message-id"},
			jetstream.ExpectedStreamHeader:  []string{"stream"},
			jetstream.ExpectedLastSeqHeader: []string{"7"},
		},
		"single":    {"Tenant": []string{"tenant-a"}},
		"multiple":  {"Tenant": []string{"tenant-a"}, "Region": []string{"region-a"}},
		"sixteen":   benchmarkHeaders(16),
		"sixtyfour": benchmarkHeaders(64),
	}
	for name, headers := range cases {
		message := &fakeMessage{data: []byte("payload"), headers: headers}
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				if _, err := fromJetStreamMessage(message); err != nil {
					b.Fatal(err)
				}
			}
		})
		b.Run(name+"-legacy", func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				if _, err := legacyFromJetStreamMessage(message); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
	invalid := &fakeMessage{
		data: []byte("payload"),
		headers: nats.Header{
			"Tenant": []string{"one"},
			"Region": []string{"one", "two"},
		},
	}
	b.Run("invalid-multi", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			if _, err := fromJetStreamMessage(invalid); !errors.Is(err, ErrInvalidMessage) {
				b.Fatal(err)
			}
		}
	})
	b.Run("invalid-multi-v120", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			if _, err := legacyFromJetStreamMessageV120(invalid); !errors.Is(err, ErrInvalidMessage) {
				b.Fatal(err)
			}
		}
	})
}

func legacyFromJetStreamMessageV120(message jetstream.Msg) (queueclient.Message, error) {
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
	result := queueclient.Message{
		Body:    bytes.Clone(message.Data()),
		Headers: clonedHeaders,
	}
	for name, values := range headers {
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

func benchmarkHeaders(count int) nats.Header {
	headers := make(nats.Header, count)
	for index := 0; index < count; index++ {
		headers["X-Header-"+strconv.Itoa(index)] = []string{"value"}
	}
	return headers
}

func legacyFromJetStreamMessage(message jetstream.Msg) (queueclient.Message, error) {
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

// legacyApplicationHeaders mirrors the replaced implementation so the
// allocation benchmark retains a directly comparable before/after baseline.
func legacyApplicationHeaders(headers map[string]string) nats.Header {
	result := nats.Header{}
	for name, value := range headers {
		if !jetStreamControlHeader(name) {
			result.Set(name, value)
		}
	}
	return result
}

func TestAdapterReceiveUsesContextBoundedPull(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	consumer := &fakeConsumer{}
	consumer.next = func(options ...jetstream.FetchOpt) (jetstream.Msg, error) {
		if len(options) != 1 {
			t.Fatalf("Consumer.Next() options = %d, want 1", len(options))
		}
		cancel()
		return nil, errors.New("private pull failure")
	}
	adapter, err := New(&fakePublisher{}, consumer, Config{Subject: "events.primary", DeadLetterSubject: "events.dlq"})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if _, err := adapter.ReceiveDelivery(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("ReceiveDelivery() error = %v", err)
	}
	if consumer.nextCalls != 1 || consumer.lastNextOptionCount != 1 {
		t.Fatalf("Consumer.Next() = calls:%d options:%d", consumer.nextCalls, consumer.lastNextOptionCount)
	}
	if _, err := adapter.ReceiveDelivery(nil); !errors.Is(err, ErrInvalidContext) {
		t.Fatalf("ReceiveDelivery(nil) error = %v", err)
	}
}

func TestAdapterReceiveContinuesAfterInternalPullDeadline(t *testing.T) {
	message := &fakeMessage{data: []byte("received")}
	consumer := &fakeConsumer{}
	consumer.next = func(options ...jetstream.FetchOpt) (jetstream.Msg, error) {
		if len(options) != 1 {
			t.Fatalf("Consumer.Next() options = %d, want 1", len(options))
		}
		if consumer.nextCalls == 1 {
			time.Sleep(2 * minimumFetchMaxWait)
			return nil, context.DeadlineExceeded
		}
		return message, nil
	}
	adapter, err := New(&fakePublisher{}, consumer, Config{
		Subject:           "events.primary",
		DeadLetterSubject: "events.dlq",
		FetchMaxWait:      minimumFetchMaxWait,
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	delivery, err := adapter.ReceiveDelivery(context.Background())
	if err != nil || string(delivery.Message.Body) != "received" {
		t.Fatalf("ReceiveDelivery() = %#v, %v", delivery.Message, err)
	}
	if consumer.nextCalls != 2 || consumer.lastNextOptionCount != 1 {
		t.Fatalf("Consumer.Next() = calls:%d options:%d", consumer.nextCalls, consumer.lastNextOptionCount)
	}
}

func TestReceiveNextUsesFetchMaxWaitOnlyForNonCancelableContext(t *testing.T) {
	background := &optionRecordingConsumer{nextResult: &fakeMessage{}}
	if _, err := receiveNext(context.Background(), background, time.Second); err != nil {
		t.Fatalf("receiveNext(background) error = %v", err)
	}
	if background.optionKind != "max-wait" {
		t.Fatalf("receiveNext(background) option = %q, want max-wait", background.optionKind)
	}

	cancellableContext, cancel := context.WithCancel(context.Background())
	defer cancel()
	cancellable := &optionRecordingConsumer{nextResult: &fakeMessage{}}
	if _, err := receiveNext(cancellableContext, cancellable, time.Second); err != nil {
		t.Fatalf("receiveNext(cancellable) error = %v", err)
	}
	if cancellable.optionKind != "context" {
		t.Fatalf("receiveNext(cancellable) option = %q, want context", cancellable.optionKind)
	}

	deadlineOnly := &deadlineOnlyContext{deadline: time.Now().Add(time.Second)}
	deadlineConsumer := &optionRecordingConsumer{nextResult: &fakeMessage{}}
	if _, err := receiveNext(deadlineOnly, deadlineConsumer, time.Second); err != nil {
		t.Fatalf("receiveNext(deadline-only) error = %v", err)
	}
	if deadlineConsumer.optionKind != "context" {
		t.Fatalf("receiveNext(deadline-only) option = %q, want context", deadlineConsumer.optionKind)
	}
}

func BenchmarkDeliveryPullOption(b *testing.B) {
	consumer := &fakeConsumer{next: func(...jetstream.FetchOpt) (jetstream.Msg, error) {
		return &fakeMessage{}, nil
	}}
	b.Run("context-bounded", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			if _, err := receiveNext(context.Background(), consumer, defaultFetchMaxWait); err != nil {
				b.Fatal(err)
			}
		}
	})
	cancellableContext, cancel := context.WithCancel(context.Background())
	defer cancel()
	b.Run("context-cancellable", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			if _, err := receiveNext(cancellableContext, consumer, defaultFetchMaxWait); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("legacy-max-wait", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			if _, err := consumer.Next(jetstream.FetchMaxWait(defaultFetchMaxWait)); err != nil {
				b.Fatal(err)
			}
		}
	})
}

type optionRecordingConsumer struct {
	nextResult jetstream.Msg
	optionKind string
}

func (consumer *optionRecordingConsumer) Next(options ...jetstream.FetchOpt) (jetstream.Msg, error) {
	if len(options) != 1 {
		return nil, fmt.Errorf("got %d options, want 1", len(options))
	}
	consumer.optionKind = classifyFetchOption(options[0])
	return consumer.nextResult, nil
}

func classifyFetchOption(option jetstream.FetchOpt) string {
	// FetchOpt operates on nats.go's private pull request type. Reflection lets
	// this package test inspect the option contract without naming that private
	// type or relying on unstable closure code pointers.
	optionValue := reflect.ValueOf(option)
	requestType := optionValue.Type().In(0)
	request := reflect.New(requestType.Elem())
	optionValue.Call([]reflect.Value{request})
	requestValue := request.Elem()
	if contextField := requestValue.FieldByName("ctx"); contextField.IsValid() && !contextField.IsNil() {
		return "context"
	}
	if maxWaitSet := requestValue.FieldByName("maxWaitSet"); maxWaitSet.IsValid() && maxWaitSet.Bool() {
		return "max-wait"
	}
	return "unknown"
}

type deadlineOnlyContext struct {
	context.Context
	deadline time.Time
}

func (context *deadlineOnlyContext) Deadline() (time.Time, bool) { return context.deadline, true }
func (*deadlineOnlyContext) Done() <-chan struct{}               { return nil }
func (*deadlineOnlyContext) Err() error                          { return nil }

type fakePublisher struct {
	mu         sync.Mutex
	messages   []*nats.Msg
	publishErr error
	publishAck func(*nats.Msg) *jetstream.PubAck
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
	if publisher.publishAck != nil {
		return publisher.publishAck(cloned), nil
	}
	return &jetstream.PubAck{Stream: "TEST", Sequence: uint64(len(publisher.messages))}, nil
}

func (publisher *fakePublisher) snapshot() []*nats.Msg {
	publisher.mu.Lock()
	defer publisher.mu.Unlock()
	return append([]*nats.Msg(nil), publisher.messages...)
}

type fakeConsumer struct {
	messages            []jetstream.Msg
	nextErr             error
	next                func(...jetstream.FetchOpt) (jetstream.Msg, error)
	nextCalls           int
	lastNextOptionCount int
	info                *jetstream.ConsumerInfo
	infoErr             error
	infoCalls           int
}

func (consumer *fakeConsumer) Next(options ...jetstream.FetchOpt) (jetstream.Msg, error) {
	consumer.nextCalls++
	consumer.lastNextOptionCount = len(options)
	if consumer.next != nil {
		return consumer.next(options...)
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
	consumer.infoCalls++
	return consumer.info, consumer.infoErr
}

type receiveOnlyConsumer struct{}

func (*receiveOnlyConsumer) Next(...jetstream.FetchOpt) (jetstream.Msg, error) {
	return nil, jetstream.ErrNoMessages
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
