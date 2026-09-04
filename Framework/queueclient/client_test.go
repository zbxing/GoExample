package queueclient

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"go.opentelemetry.io/otel/baggage"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

func TestNewValidatesFiniteMessagingConfiguration(t *testing.T) {
	for name, config := range map[string]Config{
		"missing system":        {},
		"unknown system":        {System: "secret-broker"},
		"negative publish":      {System: SystemKafka, PublishTimeout: -time.Second},
		"negative process":      {System: SystemKafka, ProcessTimeout: -time.Second},
		"negative body limit":   {System: SystemKafka, MaxMessageBytes: -1},
		"negative header limit": {System: SystemKafka, MaxHeaderBytes: -1},
		"negative header count": {System: SystemKafka, MaxHeaders: -1},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := New(config); err == nil {
				t.Fatal("New() error = nil")
			}
		})
	}

	client, err := New(Config{System: SystemKafka})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if client.publishTimeout != defaultPublishTimeout || client.processTimeout != defaultProcessTimeout {
		t.Fatalf("timeouts = %s/%s", client.publishTimeout, client.processTimeout)
	}
	if client.maxMessageBytes != defaultMaxMessageBytes || client.maxHeaderBytes != defaultMaxHeaderBytes || client.maxHeaders != defaultMaxHeaders {
		t.Fatalf("limits = %d/%d/%d", client.maxMessageBytes, client.maxHeaderBytes, client.maxHeaders)
	}
}

func TestPublishClonesMessageAndInjectsCurrentTraceContext(t *testing.T) {
	client, recorder, provider := newTracedClient(t, Config{System: SystemKafka})
	defer provider.Shutdown(context.Background())

	ctx, parent := provider.Tracer("test").Start(context.Background(), "parent")
	originalBody := []byte("body-secret")
	originalHeaders := map[string]string{
		"Credential":  "header-secret",
		"TraceParent": "caller-supplied-trace-secret",
		"TraceState":  "caller-supplied-state-secret",
	}
	var published Message
	var callbackSpan trace.SpanContext
	err := client.Publish(ctx, Message{Body: originalBody, Headers: originalHeaders}, func(callbackContext context.Context, message Message) error {
		published = message
		callbackSpan = trace.SpanContextFromContext(callbackContext)
		message.Body[0] = 'X'
		message.Headers["Credential"] = "mutated"
		return nil
	})
	if err != nil {
		t.Fatalf("Publish() error = %v", err)
	}
	parent.End()

	if string(originalBody) != "body-secret" || originalHeaders["Credential"] != "header-secret" {
		t.Fatal("Publish() modified caller-owned message")
	}
	if published.Headers["traceparent"] == "" || strings.Contains(published.Headers["traceparent"], "caller-supplied") {
		t.Fatalf("traceparent = %q", published.Headers["traceparent"])
	}
	if _, exists := published.Headers["TraceParent"]; exists {
		t.Fatal("caller-supplied TraceParent was not replaced")
	}
	if !strings.Contains(published.Headers["traceparent"], callbackSpan.SpanID().String()) {
		t.Fatalf("traceparent %q does not contain publish span %s", published.Headers["traceparent"], callbackSpan.SpanID())
	}

	spans := recorder.Ended()
	if len(spans) != 2 {
		t.Fatalf("ended spans = %d, want 2", len(spans))
	}
	publishSpan := spans[0]
	assertMessagingSpan(t, publishSpan, "messaging.send", trace.SpanKindProducer, "kafka", "send", "success")
	if publishSpan.Parent().SpanID() != parent.SpanContext().SpanID() {
		t.Fatalf("publish parent = %s, want %s", publishSpan.Parent().SpanID(), parent.SpanContext().SpanID())
	}
	assertSpanExcludes(t, publishSpan, "body-secret", "header-secret", "credential", "caller-supplied", "traceparent")
}

func TestProcessExtractsRemoteTraceContextAndClonesMessage(t *testing.T) {
	client, recorder, provider := newTracedClient(t, Config{System: SystemNATS})
	defer provider.Shutdown(context.Background())

	const remoteTraceID = "4bf92f3577b34da6a3ce929d0e0e4736"
	const remoteSpanID = "00f067aa0ba902b7"
	originalBody := []byte("process-body-secret")
	originalHeaders := map[string]string{
		"TraceParent": "00-" + remoteTraceID + "-" + remoteSpanID + "-01",
		"Tenant":      "tenant-secret",
		"baggage":     "credential=bag-secret",
	}
	var handlerSpan trace.SpanContext
	err := client.Process(context.Background(), Message{Body: originalBody, Headers: originalHeaders}, func(handlerContext context.Context, message Message) error {
		handlerSpan = trace.SpanContextFromContext(handlerContext)
		if baggage.FromContext(handlerContext).Len() != 0 {
			t.Fatal("Process() extracted baggage")
		}
		message.Body[0] = 'X'
		message.Headers["Tenant"] = "mutated"
		return nil
	})
	if err != nil {
		t.Fatalf("Process() error = %v", err)
	}
	if string(originalBody) != "process-body-secret" || originalHeaders["Tenant"] != "tenant-secret" {
		t.Fatal("Process() modified caller-owned message")
	}
	if handlerSpan.TraceID().String() != remoteTraceID {
		t.Fatalf("handler trace = %s, want %s", handlerSpan.TraceID(), remoteTraceID)
	}
	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	processSpan := spans[0]
	assertMessagingSpan(t, processSpan, "messaging.process", trace.SpanKindConsumer, "nats", "process", "success")
	if processSpan.Parent().SpanID().String() != remoteSpanID || !processSpan.Parent().IsRemote() {
		t.Fatalf("process parent = %s remote=%t", processSpan.Parent().SpanID(), processSpan.Parent().IsRemote())
	}
	assertSpanExcludes(t, processSpan, "process-body-secret", "tenant-secret", "bag-secret", "tenant", remoteTraceID, remoteSpanID)
}

func TestTraceCarrierLazilyAllocatesOnlyForTraceHeaders(t *testing.T) {
	withoutTraceHeaders := map[string]string{"Tenant": "tenant"}
	withoutTrace := testing.AllocsPerRun(1000, func() {
		_ = traceCarrier(withoutTraceHeaders)
	})
	if withoutTrace != 0 {
		t.Fatalf("traceCarrier without trace headers allocations = %.1f, want 0", withoutTrace)
	}

	carrier := traceCarrier(map[string]string{
		"TraceParent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
		"TraceState":  "vendor=value",
		"Tenant":      "tenant",
	})
	if carrier["traceparent"] == "" || carrier["tracestate"] != "vendor=value" {
		t.Fatalf("traceCarrier = %#v", carrier)
	}
	mixedCase := map[string]string{
		"TraceParent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
		"TraceState":  "vendor=value",
	}
	allocations := testing.AllocsPerRun(1000, func() {
		carrier := traceCarrier(mixedCase)
		if carrier[traceparentHeader] == "" || carrier[tracestateHeader] == "" {
			t.Fatal("mixed-case trace headers were not canonicalized")
		}
	})
	if allocations != 2 {
		t.Fatalf("traceCarrier mixed-case allocations = %.1f, want map-only 2", allocations)
	}
}

func TestValidateHeadersLazilyAllocatesDuplicateSet(t *testing.T) {
	withoutHeaders := testing.AllocsPerRun(1000, func() {
		if err := validateHeaders(nil, defaultMaxHeaders, defaultMaxHeaderBytes); err != nil {
			t.Fatalf("validateHeaders(nil) error = %v", err)
		}
	})
	if withoutHeaders != 0 {
		t.Fatalf("validateHeaders without headers allocations = %.1f, want 0", withoutHeaders)
	}

	singleHeader := map[string]string{"Tenant": "tenant"}
	withSingleHeader := testing.AllocsPerRun(1000, func() {
		if err := validateHeaders(singleHeader, defaultMaxHeaders, defaultMaxHeaderBytes); err != nil {
			t.Fatalf("validateHeaders(single header) error = %v", err)
		}
	})
	if withSingleHeader != 0 {
		t.Fatalf("validateHeaders with one header allocations = %.1f, want 0", withSingleHeader)
	}

	multipleHeaders := map[string]string{"Tenant": "tenant", "Region": "region"}
	withMultipleHeaders := testing.AllocsPerRun(1000, func() {
		if err := validateHeaders(multipleHeaders, defaultMaxHeaders, defaultMaxHeaderBytes); err != nil {
			t.Fatalf("validateHeaders(multiple headers) error = %v", err)
		}
	})
	if withMultipleHeaders != 0 {
		t.Fatalf("validateHeaders with two headers allocations = %.1f, want 0", withMultipleHeaders)
	}

	largeHeaderSet := map[string]string{"Tenant": "tenant", "Region": "region", "Zone": "zone"}
	withLargeHeaderSet := testing.AllocsPerRun(1000, func() {
		if err := validateHeaders(largeHeaderSet, defaultMaxHeaders, defaultMaxHeaderBytes); err != nil {
			t.Fatalf("validateHeaders(large header set) error = %v", err)
		}
	})
	if withLargeHeaderSet != 0 {
		t.Fatalf("validateHeaders with three headers allocations = %.1f, want 0", withLargeHeaderSet)
	}
	fourHeaders := map[string]string{"Tenant": "tenant", "Region": "region", "Zone": "zone", "Shard": "shard"}
	if allocations := testing.AllocsPerRun(1000, func() {
		if err := validateHeaders(fourHeaders, defaultMaxHeaders, defaultMaxHeaderBytes); err != nil {
			t.Fatalf("validateHeaders(four headers) error = %v", err)
		}
	}); allocations != 0 {
		t.Fatalf("validateHeaders with four headers allocations = %.1f, want 0", allocations)
	}

	duplicateCandidates := map[string]string{"Tenant": "tenant", "tenant": "tenant"}
	if err := validateHeaders(duplicateCandidates, defaultMaxHeaders, defaultMaxHeaderBytes); !errors.Is(err, ErrInvalidHeader) {
		t.Fatalf("validateHeaders duplicate names error = %v, want ErrInvalidHeader", err)
	}
	for name, headers := range map[string]map[string]string{
		"control":   {"Tenant\n": "tenant"},
		"non-ascii": {"T\xC3\xA9nant": "tenant"},
	} {
		if err := validateHeaders(headers, defaultMaxHeaders, defaultMaxHeaderBytes); !errors.Is(err, ErrInvalidHeader) {
			t.Fatalf("validateHeaders %s name error = %v, want ErrInvalidHeader", name, err)
		}
	}
}

func BenchmarkValidateHeaders(b *testing.B) {
	b.ReportAllocs()
	cases := map[string]map[string]string{
		"empty":  nil,
		"single": {"Tenant": "tenant"},
		"multiple": {
			"Tenant": "tenant",
			"Region": "region",
		},
		"large": {
			"Tenant": "tenant",
			"Region": "region",
			"Zone":   "zone",
		},
	}
	for name, headers := range cases {
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				if err := validateHeaders(headers, defaultMaxHeaders, defaultMaxHeaderBytes); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func BenchmarkTraceCarrier(b *testing.B) {
	withoutTrace := map[string]string{"Tenant": "tenant"}
	withTrace := map[string]string{
		"traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
		"tracestate":  "vendor=value",
		"Tenant":      "tenant",
	}
	mixedCaseTrace := map[string]string{
		"TraceParent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
		"TraceState":  "vendor=value",
		"Tenant":      "tenant",
	}
	b.Run("without-trace", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			_ = traceCarrier(withoutTrace)
		}
	})
	b.Run("with-trace", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			_ = traceCarrier(withTrace)
		}
	})
	b.Run("with-mixed-case-trace", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			_ = traceCarrier(mixedCaseTrace)
		}
	})
}

func TestFailuresTimeoutsAndCancellationUseFixedPrivateResults(t *testing.T) {
	client, recorder, provider := newTracedClient(t, Config{
		System:         SystemRabbitMQ,
		PublishTimeout: 20 * time.Millisecond,
		ProcessTimeout: 20 * time.Millisecond,
	})
	defer provider.Shutdown(context.Background())

	backendErr := errors.New("backend credential secret failure")
	if err := client.Publish(context.Background(), Message{Body: []byte("payload-secret")}, func(context.Context, Message) error {
		return backendErr
	}); !errors.Is(err, backendErr) {
		t.Fatalf("Publish(failure) error = %v", err)
	}
	if err := client.Publish(context.Background(), Message{}, func(ctx context.Context, _ Message) error {
		<-ctx.Done()
		return ctx.Err()
	}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Publish(timeout) error = %v", err)
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if err := client.Process(canceled, Message{}, func(ctx context.Context, _ Message) error {
		return ctx.Err()
	}); !errors.Is(err, context.Canceled) {
		t.Fatalf("Process(canceled) error = %v", err)
	}

	spans := recorder.Ended()
	if len(spans) != 3 {
		t.Fatalf("ended spans = %d, want 3", len(spans))
	}
	for index, result := range []string{"failure", "timeout", "canceled"} {
		assertMessagingResult(t, spans[index], result)
		assertSpanExcludes(t, spans[index], "backend credential", "payload-secret", "secret failure")
		if spans[index].Status().Code != codes.Error {
			t.Fatalf("span %d status = %v", index, spans[index].Status().Code)
		}
	}
	if spans[0].Status().Description != "messaging operation failed" {
		t.Fatalf("failure description = %q", spans[0].Status().Description)
	}
}

func TestMessageLimitsRejectBeforeBrokerOrHandlerExecution(t *testing.T) {
	client, recorder, provider := newTracedClient(t, Config{
		System:          SystemAWSSQS,
		MaxMessageBytes: 4,
		MaxHeaderBytes:  16,
		MaxHeaders:      2,
	})
	defer provider.Shutdown(context.Background())

	callbackCalls := 0
	callback := func(context.Context, Message) error {
		callbackCalls++
		return nil
	}
	tests := []struct {
		name    string
		message Message
	}{
		{name: "body", message: Message{Body: []byte("12345")}},
		{name: "header count", message: Message{Headers: map[string]string{"a": "1", "b": "2", "c": "3"}}},
		{name: "header bytes", message: Message{Headers: map[string]string{"header": "01234567890"}}},
		{name: "duplicate header", message: Message{Headers: map[string]string{"Tenant": "a", "tenant": "b"}}},
		{name: "newline", message: Message{Headers: map[string]string{"tenant": "secret\r\nvalue"}}},
		{name: "non-ASCII name", message: Message{Headers: map[string]string{"租户": "secret"}}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := client.Process(context.Background(), test.message, callback); err == nil {
				t.Fatal("Process() error = nil")
			}
		})
	}
	if callbackCalls != 0 {
		t.Fatalf("callback calls = %d, want 0", callbackCalls)
	}
	if got := len(recorder.Ended()); got != len(tests) {
		t.Fatalf("ended spans = %d, want %d", got, len(tests))
	}
}

func TestPublishCountsInjectedTraceHeadersAgainstConfiguredLimits(t *testing.T) {
	client, recorder, provider := newTracedClient(t, Config{
		System:         SystemKafka,
		MaxHeaderBytes: 128,
		MaxHeaders:     1,
	})
	defer provider.Shutdown(context.Background())

	ctx, parent := provider.Tracer("test").Start(context.Background(), "parent")
	called := false
	err := client.Publish(ctx, Message{Headers: map[string]string{"tenant": "header-secret"}}, func(context.Context, Message) error {
		called = true
		return nil
	})
	parent.End()
	if !errors.Is(err, ErrHeadersTooLarge) {
		t.Fatalf("Publish() error = %v, want header limit", err)
	}
	if called {
		t.Fatal("Publish() invoked broker after trace injection exceeded header limit")
	}
	spans := recorder.Ended()
	if len(spans) != 2 {
		t.Fatalf("ended spans = %d, want 2", len(spans))
	}
	assertMessagingResult(t, spans[0], "failure")
	assertSpanExcludes(t, spans[0], "header-secret", "tenant")
}

func TestCallbackPanicEndsSpanAndIsRethrown(t *testing.T) {
	client, recorder, provider := newTracedClient(t, Config{System: SystemGCPPubSub})
	defer provider.Shutdown(context.Background())

	panicValue := "queue panic secret value"
	func() {
		defer func() {
			if recovered := recover(); recovered != panicValue {
				t.Fatalf("recovered panic = %v", recovered)
			}
		}()
		_ = client.Process(context.Background(), Message{}, func(context.Context, Message) error {
			panic(panicValue)
		})
	}()
	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	assertMessagingResult(t, spans[0], "failure")
	assertSpanExcludes(t, spans[0], "queue panic secret")
}

func TestNilClientContextAndCallbacksFailWithoutPanic(t *testing.T) {
	var client *Client
	if err := client.Publish(context.Background(), Message{}, func(context.Context, Message) error { return nil }); !errors.Is(err, errNilClient) {
		t.Fatalf("nil Client.Publish() error = %v", err)
	}
	valid, err := New(Config{System: SystemKafka})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if err := valid.Publish(nil, Message{}, func(context.Context, Message) error { return nil }); !errors.Is(err, errNilContext) {
		t.Fatalf("Publish(nil context) error = %v", err)
	}
	if err := valid.Publish(context.Background(), Message{}, nil); !errors.Is(err, errNilCallback) {
		t.Fatalf("Publish(nil callback) error = %v", err)
	}
	if err := valid.Process(context.Background(), Message{}, nil); !errors.Is(err, errNilCallback) {
		t.Fatalf("Process(nil handler) error = %v", err)
	}
}

func newTracedClient(t *testing.T, config Config) (*Client, *tracetest.SpanRecorder, *sdktrace.TracerProvider) {
	t.Helper()
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	config.TracerProvider = provider
	client, err := New(config)
	if err != nil {
		_ = provider.Shutdown(context.Background())
		t.Fatalf("New() error = %v", err)
	}
	return client, recorder, provider
}

func assertMessagingSpan(t *testing.T, span sdktrace.ReadOnlySpan, name string, kind trace.SpanKind, system, operation, result string) {
	t.Helper()
	if span.Name() != name {
		t.Fatalf("span name = %q, want %q", span.Name(), name)
	}
	if span.SpanKind() != kind {
		t.Fatalf("span kind = %v, want %v", span.SpanKind(), kind)
	}
	if got := spanAttribute(span, "messaging.system.name"); got != system {
		t.Fatalf("messaging.system.name = %q, want %q", got, system)
	}
	if got := spanAttribute(span, "messaging.operation.type"); got != operation {
		t.Fatalf("messaging.operation.type = %q, want %q", got, operation)
	}
	assertMessagingResult(t, span, result)
	if len(span.Attributes()) != 3 {
		t.Fatalf("span attributes = %v, want exactly 3", span.Attributes())
	}
}

func assertMessagingResult(t *testing.T, span sdktrace.ReadOnlySpan, result string) {
	t.Helper()
	if got := spanAttribute(span, "goexample.messaging.result"); got != result {
		t.Fatalf("messaging result = %q, want %q", got, result)
	}
}

func spanAttribute(span sdktrace.ReadOnlySpan, name string) string {
	for _, item := range span.Attributes() {
		if string(item.Key) == name {
			return item.Value.AsString()
		}
	}
	return ""
}

func assertSpanExcludes(t *testing.T, span sdktrace.ReadOnlySpan, forbidden ...string) {
	t.Helper()
	var content strings.Builder
	content.WriteString(span.Name())
	content.WriteString(" ")
	content.WriteString(span.Status().Description)
	for _, item := range span.Attributes() {
		content.WriteString(fmt.Sprintf(" %s=%s", item.Key, item.Value.Emit()))
	}
	for _, event := range span.Events() {
		content.WriteString(" ")
		content.WriteString(event.Name)
		for _, item := range event.Attributes {
			content.WriteString(fmt.Sprintf(" %s=%s", item.Key, item.Value.Emit()))
		}
	}
	observed := strings.ToLower(content.String())
	for _, value := range forbidden {
		if strings.Contains(observed, strings.ToLower(value)) {
			t.Fatalf("span contains forbidden value %q: %s", value, content.String())
		}
	}
}
