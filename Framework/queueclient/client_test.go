package queueclient

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
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
	if carrier.Get("traceparent") == "" || carrier.Get("tracestate") != "vendor=value" {
		t.Fatalf("traceCarrier = %#v", carrier)
	}
	mixedCase := map[string]string{
		"TraceParent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
		"TraceState":  "vendor=value",
	}
	allocations := testing.AllocsPerRun(1000, func() {
		carrier := traceCarrier(mixedCase)
		if carrier.Get(traceparentHeader) == "" || carrier.Get(tracestateHeader) == "" {
			t.Fatal("mixed-case trace headers were not canonicalized")
		}
	})
	if allocations != 0 {
		t.Fatalf("traceCarrier mixed-case allocations = %.1f, want 0", allocations)
	}
}

func TestCanonicalTraceHeaderMatchesLegacy(t *testing.T) {
	for _, canonical := range []string{traceparentHeader, tracestateHeader} {
		for mask := 0; mask < 1<<len(canonical); mask++ {
			name := []byte(canonical)
			for index := range name {
				if mask&(1<<index) != 0 {
					name[index] -= 'a' - 'A'
				}
			}
			input := string(name)
			if got, want := canonicalTraceHeader(input), canonicalTraceHeaderLegacy(input); got != want {
				t.Fatalf("canonicalTraceHeader(%q) = %q, want %q", input, got, want)
			}
		}
	}

	for _, input := range []string{
		"",
		"traceparentx",
		"tracestatex",
		"TRACEPARENT\x00",
		"traceparent-",
		"tracestate-",
		"tracéparent",
		"\u212A" + strings.Repeat("x", len(traceparentHeader)-1),
	} {
		if got, want := canonicalTraceHeader(input), canonicalTraceHeaderLegacy(input); got != want {
			t.Fatalf("canonicalTraceHeader(%q) = %q, want %q", input, got, want)
		}
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
	fiveHeaders := map[string]string{
		"Tenant": "tenant",
		"Region": "region",
		"Zone":   "zone",
		"Shard":  "shard",
		"Locale": "locale",
	}
	if allocations := testing.AllocsPerRun(1000, func() {
		if err := validateHeaders(fiveHeaders, defaultMaxHeaders, defaultMaxHeaderBytes); err != nil {
			t.Fatalf("validateHeaders(five headers) error = %v", err)
		}
	}); allocations != 0 {
		t.Fatalf("validateHeaders with five headers allocations = %.1f, want 0", allocations)
	}
	eightHeaders := map[string]string{
		"Tenant":   "tenant",
		"Region":   "region",
		"Zone":     "zone",
		"Shard":    "shard",
		"Locale":   "locale",
		"Version":  "version",
		"Priority": "priority",
		"Source":   "source",
	}
	if allocations := testing.AllocsPerRun(1000, func() {
		if err := validateHeaders(eightHeaders, defaultMaxHeaders, defaultMaxHeaderBytes); err != nil {
			t.Fatalf("validateHeaders(eight headers) error = %v", err)
		}
	}); allocations != 0 {
		t.Fatalf("validateHeaders with eight headers allocations = %.1f, want 0", allocations)
	}
	for _, count := range []int{9, 16, 64} {
		headers := mixedCaseHeaderSet(count)
		if allocations := testing.AllocsPerRun(1000, func() {
			if err := validateHeaders(headers, defaultMaxHeaders, defaultMaxHeaderBytes); err != nil {
				t.Fatalf("validateHeaders(%d headers) error = %v", count, err)
			}
		}); allocations != 0 {
			t.Fatalf("validateHeaders with %d headers allocations = %.1f, want 0", count, allocations)
		}
	}

	duplicateCandidates := map[string]string{"Tenant": "tenant", "tenant": "tenant"}
	if err := validateHeaders(duplicateCandidates, defaultMaxHeaders, defaultMaxHeaderBytes); !errors.Is(err, ErrInvalidHeader) {
		t.Fatalf("validateHeaders duplicate names error = %v, want ErrInvalidHeader", err)
	}
	for name, headers := range map[string]map[string]string{
		"five headers": {
			"Tenant": "tenant",
			"tenant": "duplicate",
			"Region": "region",
			"Zone":   "zone",
			"Shard":  "shard",
		},
		"eight headers": {
			"Tenant":   "tenant",
			"tenant":   "duplicate",
			"Region":   "region",
			"Zone":     "zone",
			"Shard":    "shard",
			"Locale":   "locale",
			"Priority": "priority",
			"Source":   "source",
		},
	} {
		if err := validateHeaders(headers, defaultMaxHeaders, defaultMaxHeaderBytes); !errors.Is(err, ErrInvalidHeader) {
			t.Fatalf("validateHeaders duplicate names with %s error = %v, want ErrInvalidHeader", name, err)
		}
	}
	for name, headers := range map[string]map[string]string{
		"control":   {"Tenant\n": "tenant"},
		"non-ascii": {"T\xC3\xA9nant": "tenant"},
	} {
		if err := validateHeaders(headers, defaultMaxHeaders, defaultMaxHeaderBytes); !errors.Is(err, ErrInvalidHeader) {
			t.Fatalf("validateHeaders %s name error = %v, want ErrInvalidHeader", name, err)
		}
	}
	for name, testCase := range map[string]struct {
		headers    map[string]string
		maxHeaders int
		maxBytes   int
		want       error
	}{
		"five headers invalid name": {
			headers:    map[string]string{"Tenant\n": "tenant", "Region": "region", "Zone": "zone", "Shard": "shard", "Locale": "locale"},
			maxHeaders: defaultMaxHeaders,
			maxBytes:   defaultMaxHeaderBytes,
			want:       ErrInvalidHeader,
		},
		"eight headers invalid name": {
			headers:    map[string]string{"Tenant\n": "tenant", "Region": "region", "Zone": "zone", "Shard": "shard", "Locale": "locale", "Version": "version", "Priority": "priority", "Source": "source"},
			maxHeaders: defaultMaxHeaders,
			maxBytes:   defaultMaxHeaderBytes,
			want:       ErrInvalidHeader,
		},
		"five headers invalid value": {
			headers:    map[string]string{"Tenant": "tenant\r", "Region": "region", "Zone": "zone", "Shard": "shard", "Locale": "locale"},
			maxHeaders: defaultMaxHeaders,
			maxBytes:   defaultMaxHeaderBytes,
			want:       ErrInvalidHeader,
		},
		"eight headers invalid value": {
			headers:    map[string]string{"Tenant": "tenant\x00", "Region": "region", "Zone": "zone", "Shard": "shard", "Locale": "locale", "Version": "version", "Priority": "priority", "Source": "source"},
			maxHeaders: defaultMaxHeaders,
			maxBytes:   defaultMaxHeaderBytes,
			want:       ErrInvalidHeader,
		},
		"five headers byte limit": {
			headers:    fiveHeaders,
			maxHeaders: defaultMaxHeaders,
			maxBytes:   1,
			want:       ErrHeadersTooLarge,
		},
		"eight headers byte limit": {
			headers:    eightHeaders,
			maxHeaders: defaultMaxHeaders,
			maxBytes:   1,
			want:       ErrHeadersTooLarge,
		},
		"five headers count limit": {
			headers:    fiveHeaders,
			maxHeaders: 4,
			maxBytes:   defaultMaxHeaderBytes,
			want:       ErrHeadersTooLarge,
		},
		"eight headers count limit": {
			headers:    eightHeaders,
			maxHeaders: 7,
			maxBytes:   defaultMaxHeaderBytes,
			want:       ErrHeadersTooLarge,
		},
	} {
		if err := validateHeaders(testCase.headers, testCase.maxHeaders, testCase.maxBytes); !errors.Is(err, testCase.want) {
			t.Fatalf("validateHeaders %s error = %v, want %v", name, err, testCase.want)
		}
	}
}

func TestValidateHeadersLargeSetCollisionAndConfiguredFallback(t *testing.T) {
	first, second := collidingHeaderNames()
	headers := mixedCaseHeaderSet(7)
	headers[first] = "first"
	headers[second] = "second"
	if err := validateHeaders(headers, defaultMaxHeaders, defaultMaxHeaderBytes); err != nil {
		t.Fatalf("validateHeaders(colliding names) error = %v", err)
	}
	headers[strings.ToLower(first)] = "duplicate"
	if err := validateHeaders(headers, defaultMaxHeaders, defaultMaxHeaderBytes); !errors.Is(err, ErrInvalidHeader) {
		t.Fatalf("validateHeaders(colliding names with duplicate) error = %v, want ErrInvalidHeader", err)
	}

	configuredHeaders := mixedCaseHeaderSet(defaultMaxHeaders + 1)
	if err := validateHeaders(configuredHeaders, defaultMaxHeaders+1, defaultMaxHeaderBytes); err != nil {
		t.Fatalf("validateHeaders(custom maximum) error = %v", err)
	}
	configuredHeaders[strings.ToLower("X-Mixed-Header-00")] = "duplicate"
	if err := validateHeaders(configuredHeaders, defaultMaxHeaders+2, defaultMaxHeaderBytes); !errors.Is(err, ErrInvalidHeader) {
		t.Fatalf("validateHeaders(custom maximum duplicate) error = %v, want ErrInvalidHeader", err)
	}
}

func TestValidateHeadersLargeSetErrorContracts(t *testing.T) {
	for _, count := range []int{9, 16, 64} {
		t.Run(fmt.Sprintf("%d headers", count), func(t *testing.T) {
			duplicate := mixedCaseHeaderSet(count - 2)
			duplicate["X-Duplicate"] = "first"
			duplicate["x-duplicate"] = "second"
			if err := validateHeaders(duplicate, defaultMaxHeaders, defaultMaxHeaderBytes); !errors.Is(err, ErrInvalidHeader) {
				t.Fatalf("duplicate error = %v, want ErrInvalidHeader", err)
			}

			invalidName := mixedCaseHeaderSet(count - 1)
			invalidName["X-Invalid\n"] = "value"
			if err := validateHeaders(invalidName, defaultMaxHeaders, defaultMaxHeaderBytes); !errors.Is(err, ErrInvalidHeader) {
				t.Fatalf("invalid name error = %v, want ErrInvalidHeader", err)
			}

			invalidValue := mixedCaseHeaderSet(count)
			invalidValue["X-Mixed-Header-00"] = "value\x00"
			if err := validateHeaders(invalidValue, defaultMaxHeaders, defaultMaxHeaderBytes); !errors.Is(err, ErrInvalidHeader) {
				t.Fatalf("invalid value error = %v, want ErrInvalidHeader", err)
			}

			valid := mixedCaseHeaderSet(count)
			if err := validateHeaders(valid, count-1, defaultMaxHeaderBytes); !errors.Is(err, ErrHeadersTooLarge) {
				t.Fatalf("count limit error = %v, want ErrHeadersTooLarge", err)
			}
			if err := validateHeaders(valid, defaultMaxHeaders, 1); !errors.Is(err, ErrHeadersTooLarge) {
				t.Fatalf("byte limit error = %v, want ErrHeadersTooLarge", err)
			}
		})
	}
}

func TestValidHeaderValueMatchesLegacyAndAllValidationBranches(t *testing.T) {
	for value := 0; value <= 255; value++ {
		input := string([]byte{byte(value)})
		want := !strings.ContainsAny(input, "\r\n\x00")
		if got := validHeaderValue(input); got != want {
			t.Fatalf("validHeaderValue(%#x) = %t, want %t", value, got, want)
		}
	}

	for name, value := range map[string]string{
		"empty":           "",
		"ascii":           "tenant-a",
		"utf8":            "tenant-租户",
		"invalid utf8":    string([]byte{0xff, 0xfe, 'a'}),
		"nul prefix":      "\x00value",
		"linefeed middle": "value\nvalue",
		"return suffix":   "value\r",
		"long":            strings.Repeat("header-value-", 256),
	} {
		want := !strings.ContainsAny(value, "\r\n\x00")
		if got := validHeaderValue(value); got != want {
			t.Fatalf("validHeaderValue(%s) = %t, want %t", name, got, want)
		}
	}

	for _, count := range []int{2, 8, 9, defaultMaxHeaders + 1} {
		headers := mixedCaseHeaderSet(count)
		headers["X-Mixed-Header-00"] = "invalid\nvalue"
		maxHeaders := defaultMaxHeaders
		if count > maxHeaders {
			maxHeaders = count
		}
		if err := validateHeaders(headers, maxHeaders, defaultMaxHeaderBytes); !errors.Is(err, ErrInvalidHeader) {
			t.Fatalf("validateHeaders(%d headers) error = %v, want ErrInvalidHeader", count, err)
		}
	}

	valid := "tenant-a"
	if allocations := testing.AllocsPerRun(1000, func() {
		if !validHeaderValue(valid) {
			t.Fatal("validHeaderValue rejected a valid value")
		}
	}); allocations != 0 {
		t.Fatalf("validHeaderValue allocations = %.1f, want 0", allocations)
	}
}

func mixedCaseHeaderSet(count int) map[string]string {
	headers := make(map[string]string, count)
	for index := range count {
		headers[fmt.Sprintf("X-Mixed-Header-%02d", index)] = "value"
	}
	return headers
}

func collidingHeaderNames() (string, string) {
	var names [defaultMaxHeaders * 2]string
	for index := 0; ; index++ {
		name := fmt.Sprintf("X-Collision-%d", index)
		bucket := foldedHeaderNameHash(name) % uint64(len(names))
		if previous := names[bucket]; previous != "" {
			return previous, name
		}
		names[bucket] = name
	}
}

func BenchmarkValidateHeaders(b *testing.B) {
	b.ReportAllocs()
	cases := map[string]map[string]string{
		"empty": nil,
		"single": {
			"Tenant": "tenant",
		},
		"multiple": {
			"Tenant": "tenant",
			"Region": "region",
		},
		"large": {
			"Tenant": "tenant",
			"Region": "region",
			"Zone":   "zone",
		},
		"five": {
			"Tenant": "tenant",
			"Region": "region",
			"Zone":   "zone",
			"Shard":  "shard",
			"Locale": "locale",
		},
		"eight": {
			"Tenant":   "tenant",
			"Region":   "region",
			"Zone":     "zone",
			"Shard":    "shard",
			"Locale":   "locale",
			"Version":  "version",
			"Priority": "priority",
			"Source":   "source",
		},
		"nine":       mixedCaseHeaderSet(9),
		"sixteen":    mixedCaseHeaderSet(16),
		"sixty-four": mixedCaseHeaderSet(64),
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
	for name, headers := range map[string]map[string]string{
		"legacy-five":       cases["five"],
		"legacy-eight":      cases["eight"],
		"legacy-nine":       cases["nine"],
		"legacy-sixteen":    cases["sixteen"],
		"legacy-sixty-four": cases["sixty-four"],
	} {
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				if err := validateHeadersLegacyMap(headers, defaultMaxHeaders, defaultMaxHeaderBytes); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func BenchmarkValidHeaderValue(b *testing.B) {
	for name, value := range map[string]string{
		"short":  "tenant-a",
		"medium": strings.Repeat("header-value-", 8),
		"large":  strings.Repeat("header-value-", 32),
		"long":   strings.Repeat("header-value-", 256),
	} {
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				if !validHeaderValue(value) {
					b.Fatal("validHeaderValue rejected a valid value")
				}
			}
		})
		b.Run(name+"-legacy", func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				if strings.ContainsAny(value, "\r\n\x00") {
					b.Fatal("legacy validation rejected a valid value")
				}
			}
		})
	}
}

func validateHeadersLegacyMap(headers map[string]string, maxHeaders, maxBytes int) error {
	if len(headers) > maxHeaders {
		return ErrHeadersTooLarge
	}
	seen := make(map[string]struct{}, len(headers))
	totalBytes := 0
	for name, value := range headers {
		if !validHeaderName(name) || strings.ContainsAny(value, "\r\n\x00") {
			return ErrInvalidHeader
		}
		normalizedName := strings.ToLower(name)
		if _, exists := seen[normalizedName]; exists {
			return ErrInvalidHeader
		}
		seen[normalizedName] = struct{}{}
		if len(name) > maxBytes-totalBytes {
			return ErrHeadersTooLarge
		}
		totalBytes += len(name)
		if len(value) > maxBytes-totalBytes {
			return ErrHeadersTooLarge
		}
		totalBytes += len(value)
	}
	return nil
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
	legacyBenchmarks := map[string]map[string]string{
		"with-trace-legacy":      withTrace,
		"with-mixed-case-legacy": mixedCaseTrace,
	}
	for name, headers := range legacyBenchmarks {
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				_ = traceCarrierLegacy(headers)
			}
		})
	}
}

func BenchmarkCanonicalTraceHeader(b *testing.B) {
	inputs := map[string]string{
		"canonical-traceparent": traceparentHeader,
		"canonical-tracestate":  tracestateHeader,
		"mixed-traceparent":     "TraceParent",
		"mixed-tracestate":      "TraceState",
	}
	for name, input := range inputs {
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				if canonicalTraceHeader(input) == "" {
					b.Fatal("trace header was not recognized")
				}
			}
		})
		b.Run(name+"-legacy", func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				if canonicalTraceHeaderLegacy(input) == "" {
					b.Fatal("trace header was not recognized")
				}
			}
		})
	}
}

func canonicalTraceHeaderLegacy(name string) string {
	switch len(name) {
	case len(traceparentHeader):
		if strings.EqualFold(name, traceparentHeader) {
			return traceparentHeader
		}
	case len(tracestateHeader):
		if strings.EqualFold(name, tracestateHeader) {
			return tracestateHeader
		}
	}
	return ""
}

func traceCarrierLegacy(headers map[string]string) traceHeaderCarrier {
	var carrier traceHeaderCarrier
	for name, value := range headers {
		if canonical := canonicalTraceHeaderLegacy(name); canonical != "" {
			switch canonical {
			case traceparentHeader:
				carrier.traceparent = value
			case tracestateHeader:
				carrier.tracestate = value
			}
		}
	}
	return carrier
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

func TestQueueCallbacksRespectCancellationBeforeAndAfterInvocation(t *testing.T) {
	client, err := New(Config{
		System:         SystemKafka,
		PublishTimeout: 20 * time.Millisecond,
		ProcessTimeout: 20 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	for _, test := range []struct {
		name string
		ctx  context.Context
		want error
	}{
		func() struct {
			name string
			ctx  context.Context
			want error
		} {
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			return struct {
				name string
				ctx  context.Context
				want error
			}{name: "publish canceled", ctx: ctx, want: context.Canceled}
		}(),
		func() struct {
			name string
			ctx  context.Context
			want error
		} {
			ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Millisecond))
			<-ctx.Done()
			cancel()
			return struct {
				name string
				ctx  context.Context
				want error
			}{name: "process deadline", ctx: ctx, want: context.DeadlineExceeded}
		}(),
	} {
		t.Run(test.name, func(t *testing.T) {
			var calls atomic.Int32
			callback := func(context.Context, Message) error {
				calls.Add(1)
				return nil
			}
			var got error
			if strings.HasPrefix(test.name, "publish") {
				got = client.Publish(test.ctx, Message{}, callback)
			} else {
				got = client.Process(test.ctx, Message{}, callback)
			}
			if !errors.Is(got, test.want) {
				t.Fatalf("callback result = %v, want %v", got, test.want)
			}
			if calls.Load() != 0 {
				t.Fatalf("callback calls = %d, want 0", calls.Load())
			}
		})
	}

	for _, test := range []struct {
		name string
		call func(context.Context, Message, func(context.Context, Message) error) error
	}{
		{name: "publish", call: client.Publish},
		{name: "process", call: client.Process},
	} {
		t.Run(test.name+" late nil", func(t *testing.T) {
			started := make(chan struct{})
			got := test.call(context.Background(), Message{}, func(ctx context.Context, _ Message) error {
				close(started)
				<-ctx.Done()
				return nil
			})
			if !errors.Is(got, context.DeadlineExceeded) {
				t.Fatalf("late nil result = %v, want deadline exceeded", got)
			}
			select {
			case <-started:
			default:
				t.Fatal("callback did not start")
			}
		})
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
