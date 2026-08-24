package queueclient

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

func TestRealNATSPublishProcessTracePropagation(t *testing.T) {
	serverURL := strings.TrimSpace(os.Getenv("NATS_TEST_URL"))
	if serverURL == "" {
		t.Skip("NATS_TEST_URL is not set; skipping real NATS contract")
	}

	testContext, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	connection := connectRealNATS(t, testContext, serverURL)
	defer connection.Close()

	subject := nats.NewInbox()
	subscription, err := connection.SubscribeSync(subject)
	if err != nil {
		t.Fatalf("SubscribeSync() error = %v", err)
	}
	defer subscription.Unsubscribe()
	if err := connection.FlushWithContext(testContext); err != nil {
		t.Fatalf("subscription flush error = %v", err)
	}

	client, recorder, provider := newTracedClient(t, Config{
		System:         SystemNATS,
		PublishTimeout: 3 * time.Second,
		ProcessTimeout: 3 * time.Second,
	})
	defer provider.Shutdown(context.Background())

	parentContext, parentSpan := provider.Tracer("nats-contract").Start(testContext, "nats.contract.parent")
	payload := []byte("real-nats-body-secret")
	headers := map[string]string{"Tenant": "real-nats-header-secret"}
	err = client.Publish(parentContext, Message{Body: payload, Headers: headers}, func(publishContext context.Context, message Message) error {
		brokerMessage := nats.NewMsg(subject)
		brokerMessage.Data = message.Body
		brokerMessage.Header = nats.Header{}
		for name, value := range message.Headers {
			brokerMessage.Header.Set(name, value)
		}
		if err := connection.PublishMsg(brokerMessage); err != nil {
			return err
		}
		return connection.FlushWithContext(publishContext)
	})
	if err != nil {
		parentSpan.End()
		t.Fatalf("Publish() error = %v", err)
	}

	received, err := subscription.NextMsgWithContext(testContext)
	if err != nil {
		parentSpan.End()
		t.Fatalf("NextMsgWithContext() error = %v", err)
	}
	receivedHeaders := make(map[string]string, len(received.Header))
	for name, values := range received.Header {
		if len(values) != 1 {
			parentSpan.End()
			t.Fatalf("received NATS header %q has %d values, want 1", name, len(values))
		}
		receivedHeaders[name] = values[0]
	}

	var handlerSpan trace.SpanContext
	err = client.Process(testContext, Message{Body: received.Data, Headers: receivedHeaders}, func(handlerContext context.Context, message Message) error {
		handlerSpan = trace.SpanContextFromContext(handlerContext)
		if string(message.Body) != string(payload) {
			t.Fatalf("received body = %q", message.Body)
		}
		if message.Headers["Tenant"] != headers["Tenant"] {
			t.Fatalf("received Tenant header = %q", message.Headers["Tenant"])
		}
		return nil
	})
	parentSpan.End()
	if err != nil {
		t.Fatalf("Process() error = %v", err)
	}

	var producerSpan, consumerSpan sdktrace.ReadOnlySpan
	for _, span := range recorder.Ended() {
		switch span.Name() {
		case "messaging.send":
			producerSpan = span
		case "messaging.process":
			consumerSpan = span
		}
	}
	if producerSpan == nil || consumerSpan == nil {
		t.Fatalf("messaging spans were not both recorded: %v", recorder.Ended())
	}
	assertMessagingSpan(t, producerSpan, "messaging.send", trace.SpanKindProducer, "nats", "send", "success")
	assertMessagingSpan(t, consumerSpan, "messaging.process", trace.SpanKindConsumer, "nats", "process", "success")
	if producerSpan.Parent().SpanID() != parentSpan.SpanContext().SpanID() {
		t.Fatalf("producer parent = %s, want %s", producerSpan.Parent().SpanID(), parentSpan.SpanContext().SpanID())
	}
	if consumerSpan.Parent().SpanID() != producerSpan.SpanContext().SpanID() || !consumerSpan.Parent().IsRemote() {
		t.Fatalf("consumer parent = %s remote=%t, want producer %s", consumerSpan.Parent().SpanID(), consumerSpan.Parent().IsRemote(), producerSpan.SpanContext().SpanID())
	}
	if handlerSpan.TraceID() != producerSpan.SpanContext().TraceID() {
		t.Fatalf("handler trace = %s, want %s", handlerSpan.TraceID(), producerSpan.SpanContext().TraceID())
	}
	for _, span := range []sdktrace.ReadOnlySpan{producerSpan, consumerSpan} {
		assertSpanExcludes(t, span, string(payload), headers["Tenant"], "tenant", subject, "traceparent")
	}
}

func connectRealNATS(t *testing.T, ctx context.Context, serverURL string) *nats.Conn {
	t.Helper()
	for {
		connection, err := nats.Connect(
			serverURL,
			nats.Name("goexample-queue-contract"),
			nats.Timeout(500*time.Millisecond),
			nats.NoReconnect(),
		)
		if err == nil {
			return connection
		}
		select {
		case <-ctx.Done():
			t.Fatal("real NATS did not become ready before the contract deadline")
		case <-time.After(100 * time.Millisecond):
		}
	}
}
