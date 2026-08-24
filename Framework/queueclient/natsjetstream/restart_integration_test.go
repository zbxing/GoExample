package natsjetstream

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go/jetstream"
	"github.com/zbxing/goexample/Framework/queueclient"
)

func TestRealNATSJetStreamRestartRecovery(t *testing.T) {
	serverBinary := strings.TrimSpace(os.Getenv("NATS_SERVER_BINARY"))
	if serverBinary == "" {
		t.Skip("NATS_SERVER_BINARY is not set; skipping real JetStream restart contract")
	}
	serverBinary, err := filepath.Abs(serverBinary)
	if err != nil {
		t.Fatalf("resolve NATS_SERVER_BINARY: %v", err)
	}
	if info, err := os.Stat(serverBinary); err != nil || !info.Mode().IsRegular() {
		t.Fatalf("NATS_SERVER_BINARY is not a regular file: %v", err)
	}

	evidenceDirectory := strings.TrimSpace(os.Getenv("NATS_RESTART_EVIDENCE_DIR"))
	if evidenceDirectory == "" {
		evidenceDirectory = t.TempDir()
	} else if evidenceDirectory, err = filepath.Abs(evidenceDirectory); err != nil {
		t.Fatalf("resolve NATS_RESTART_EVIDENCE_DIR: %v", err)
	}
	if err := os.MkdirAll(evidenceDirectory, 0o750); err != nil {
		t.Fatalf("create restart evidence directory: %v", err)
	}

	testContext, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	storageDirectory := filepath.Join(t.TempDir(), "jetstream")
	port := reserveRestartPort(t)
	serverURL := "nats://127.0.0.1:" + strconv.Itoa(port)
	server := startRestartServer(t, serverBinary, storageDirectory, port, filepath.Join(evidenceDirectory, "nats-before-restart.log"))
	t.Cleanup(func() {
		if server != nil {
			_ = server.stop()
		}
	})

	connection := connectRealJetStream(t, testContext, serverURL)
	js, err := jetstream.New(connection)
	if err != nil {
		t.Fatalf("jetstream.New(before restart) error = %v", err)
	}
	const (
		sourceStream    = "GOEXAMPLE_RESTART_SOURCE"
		dlqStream       = "GOEXAMPLE_RESTART_DLQ"
		sourceSubject   = "goexample.restart.source"
		dlqSubject      = "goexample.restart.dlq"
		consumerName    = "GOEXAMPLE_RESTART_WORKER"
		dlqConsumerName = "GOEXAMPLE_RESTART_DLQ_READER"
	)
	createContractStream(t, testContext, js, sourceStream, sourceSubject)
	createContractStream(t, testContext, js, dlqStream, dlqSubject)
	sourceConsumer, err := js.CreateConsumer(testContext, sourceStream, jetstream.ConsumerConfig{
		Name:              consumerName,
		Durable:           consumerName,
		AckPolicy:         jetstream.AckExplicitPolicy,
		AckWait:           200 * time.Millisecond,
		MaxDeliver:        5,
		FilterSubject:     sourceSubject,
		ReplayPolicy:      jetstream.ReplayInstantPolicy,
		MaxAckPending:     1,
		MaxRequestBatch:   1,
		MaxRequestExpires: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("CreateConsumer(source) error = %v", err)
	}
	if _, err := js.CreateConsumer(testContext, dlqStream, jetstream.ConsumerConfig{
		Name:              dlqConsumerName,
		Durable:           dlqConsumerName,
		AckPolicy:         jetstream.AckExplicitPolicy,
		FilterSubject:     dlqSubject,
		MaxAckPending:     1,
		MaxRequestBatch:   1,
		MaxRequestExpires: 5 * time.Second,
	}); err != nil {
		t.Fatalf("CreateConsumer(DLQ) error = %v", err)
	}
	adapter, client := newRestartContractClient(t, js, sourceConsumer, sourceSubject, dlqSubject)
	shortLeaseRejected := false
	if budget, err := PreflightConsumer(testContext, sourceConsumer, client, contractWorkerRetry, contractLeaseSafetyMargin); errors.Is(err, ErrAckWaitTooShort) && budget > 0 {
		shortLeaseRejected = true
	} else {
		t.Fatalf("PreflightConsumer(short restart AckWait) = %s, %v", budget, err)
	}
	for _, message := range []struct {
		body   string
		tenant string
	}{
		{body: "restart-redelivery", tenant: "tenant-redelivery"},
		{body: "restart-acknowledge", tenant: "tenant-ack"},
		{body: "restart-dead-letter", tenant: "tenant-dlq"},
	} {
		publishContractMessage(t, testContext, client, adapter, message.body, message.tenant)
	}
	first, err := sourceConsumer.Next(jetstream.FetchMaxWait(3 * time.Second))
	if err != nil {
		t.Fatalf("Next(before restart) error = %v", err)
	}
	if string(first.Data()) != "restart-redelivery" {
		t.Fatalf("first message before restart = %q", first.Data())
	}
	firstMetadata, err := first.Metadata()
	if err != nil {
		t.Fatalf("Metadata(before restart) error = %v", err)
	}
	if firstMetadata.NumDelivered != 1 {
		t.Fatalf("NumDelivered before restart = %d, want 1", firstMetadata.NumDelivered)
	}

	connection.Close()
	if err := server.stop(); err != nil {
		t.Fatalf("stop NATS before restart: %v", err)
	}
	server = startRestartServer(t, serverBinary, storageDirectory, port, filepath.Join(evidenceDirectory, "nats-after-restart.log"))
	connection = connectRealJetStream(t, testContext, serverURL)
	js, err = jetstream.New(connection)
	if err != nil {
		t.Fatalf("jetstream.New(after restart) error = %v", err)
	}
	recoveredStream, err := js.Stream(testContext, sourceStream)
	if err != nil {
		t.Fatalf("Stream(after restart) error = %v", err)
	}
	streamInfo, err := recoveredStream.Info(testContext)
	if err != nil {
		t.Fatalf("Stream.Info(after restart) error = %v", err)
	}
	if streamInfo.State.Msgs != 3 {
		t.Fatalf("persisted source messages = %d, want 3", streamInfo.State.Msgs)
	}
	sourceConsumer, err = js.Consumer(testContext, sourceStream, consumerName)
	if err != nil {
		t.Fatalf("Consumer(source after restart) error = %v", err)
	}
	dlqConsumer, err := js.Consumer(testContext, dlqStream, dlqConsumerName)
	if err != nil {
		t.Fatalf("Consumer(DLQ after restart) error = %v", err)
	}
	time.Sleep(250 * time.Millisecond)
	redelivered, err := sourceConsumer.Next(jetstream.FetchMaxWait(3 * time.Second))
	if err != nil {
		t.Fatalf("Next(after restart) error = %v", err)
	}
	redeliveryMetadata, err := redelivered.Metadata()
	if err != nil {
		t.Fatalf("Metadata(after restart) error = %v", err)
	}
	if string(redelivered.Data()) != "restart-redelivery" || redelivered.Headers().Get("Tenant") != "tenant-redelivery" {
		t.Fatalf("restart redelivery body/header = %q/%q", redelivered.Data(), redelivered.Headers().Get("Tenant"))
	}
	if redeliveryMetadata.Sequence.Stream != firstMetadata.Sequence.Stream {
		t.Fatalf("restart stream sequence = %d, want %d", redeliveryMetadata.Sequence.Stream, firstMetadata.Sequence.Stream)
	}
	if redeliveryMetadata.NumDelivered == 0 {
		t.Fatal("restart delivery count must be nonzero")
	}
	if err := redelivered.DoubleAck(testContext); err != nil {
		t.Fatalf("DoubleAck(restart redelivery) error = %v", err)
	}

	adapter, client = newRestartContractClient(t, js, sourceConsumer, sourceSubject, dlqSubject)
	sourceConsumer, requiredLease := calibrateContractConsumer(t, testContext, js, sourceStream, sourceConsumer, client)
	adapter, err = New(js, sourceConsumer, Config{
		Subject:           sourceSubject,
		DeadLetterSubject: dlqSubject,
		FetchMaxWait:      100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("New(calibrated restart adapter) error = %v", err)
	}
	observer := newContractDeliveryObserver()
	workerContext, cancelWorkers := context.WithCancel(testContext)
	workers, err := queueclient.NewWorkerGroup(client, queueclient.WorkerConfig{
		ReceiveDelivery:  adapter.ReceiveDelivery,
		DeliveryObserver: observer,
		Handle: func(_ context.Context, message queueclient.Message) error {
			switch string(message.Body) {
			case "restart-acknowledge":
				return nil
			case "restart-dead-letter":
				return queueclient.ErrDeliveryNotRetryable
			default:
				return errors.New("unexpected restart contract message")
			}
		},
		Retry: contractWorkerRetry,
	})
	if err != nil {
		t.Fatalf("NewWorkerGroup(after restart) error = %v", err)
	}
	if err := workers.Start(workerContext); err != nil {
		t.Fatalf("Start(after restart) error = %v", err)
	}
	waitContractEvent(t, testContext, observer.acknowledged, "post-restart acknowledgement")
	waitContractEvent(t, testContext, observer.deadLettered, "post-restart dead letter")
	cancelWorkers()
	if err := workers.Wait(); err != nil {
		t.Fatalf("Wait(after restart) error = %v", err)
	}

	dlqMessage, err := dlqConsumer.Next(jetstream.FetchMaxWait(3 * time.Second))
	if err != nil {
		t.Fatalf("Next(DLQ after restart) error = %v", err)
	}
	if string(dlqMessage.Data()) != "restart-dead-letter" || dlqMessage.Headers().Get("Tenant") != "tenant-dlq" {
		t.Fatalf("restart DLQ body/header = %q/%q", dlqMessage.Data(), dlqMessage.Headers().Get("Tenant"))
	}
	if !strings.HasPrefix(dlqMessage.Headers().Get(jetstream.MsgIDHeader), "goexample-dlq-") {
		t.Fatalf("restart DLQ message ID = %q", dlqMessage.Headers().Get(jetstream.MsgIDHeader))
	}
	if err := dlqMessage.DoubleAck(testContext); err != nil {
		t.Fatalf("DoubleAck(restart DLQ) error = %v", err)
	}

	sourceInfo, err := sourceConsumer.Info(testContext)
	if err != nil {
		t.Fatalf("Info(source after settlement) error = %v", err)
	}
	if sourceInfo.NumAckPending != 0 || sourceInfo.NumPending != 0 {
		t.Fatalf("source pending after restart = ack:%d messages:%d", sourceInfo.NumAckPending, sourceInfo.NumPending)
	}
	connection.Close()
	if err := server.stop(); err != nil {
		t.Fatalf("stop NATS after restart: %v", err)
	}
	server = nil

	report := restartContractReport{
		SchemaVersion:              1,
		Status:                     "passed",
		Storage:                    "file",
		Replicas:                   1,
		AbruptRestarts:             1,
		PersistedMessages:          streamInfo.State.Msgs,
		RecoveredStreamSequence:    redeliveryMetadata.Sequence.Stream,
		DeliveryCountBeforeRestart: firstMetadata.NumDelivered,
		DeliveryCountAfterRestart:  redeliveryMetadata.NumDelivered,
		RedeliveryObserved:         true,
		Acknowledged:               1,
		DeadLettered:               1,
		SourceAckPending:           sourceInfo.NumAckPending,
		SourceMessagesPending:      sourceInfo.NumPending,
		ShortLeaseRejected:         shortLeaseRejected,
		LeasePreflightPassed:       true,
		RequiredLeaseNanos:         requiredLease.Nanoseconds(),
		WorkerAckWaitNanos:         contractWorkerAckWait.Nanoseconds(),
	}
	writeRestartReport(t, filepath.Join(evidenceDirectory, "restart-report.json"), report)
}

func newRestartContractClient(
	t *testing.T,
	js jetstream.JetStream,
	consumer jetstream.Consumer,
	sourceSubject string,
	dlqSubject string,
) (*Adapter, *queueclient.Client) {
	t.Helper()
	adapter, err := New(js, consumer, Config{
		Subject:           sourceSubject,
		DeadLetterSubject: dlqSubject,
		FetchMaxWait:      100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("New(restart adapter) error = %v", err)
	}
	client, err := queueclient.New(queueclient.Config{
		System:         queueclient.SystemNATS,
		PublishTimeout: 3 * time.Second,
		ProcessTimeout: 3 * time.Second,
	})
	if err != nil {
		t.Fatalf("queueclient.New(restart) error = %v", err)
	}
	return adapter, client
}

type restartContractServer struct {
	command *exec.Cmd
	logFile *os.File
}

func startRestartServer(t *testing.T, binary string, storageDirectory string, port int, logPath string) *restartContractServer {
	t.Helper()
	if err := os.MkdirAll(storageDirectory, 0o750); err != nil {
		t.Fatalf("create JetStream storage directory: %v", err)
	}
	logFile, err := os.Create(logPath)
	if err != nil {
		t.Fatalf("create NATS restart log: %v", err)
	}
	command := exec.Command(
		binary,
		"-js",
		"-sd", storageDirectory,
		"-a", "127.0.0.1",
		"-p", strconv.Itoa(port),
		"-n", "goexample-jetstream-restart-contract",
	)
	command.Stdout = logFile
	command.Stderr = logFile
	if err := command.Start(); err != nil {
		_ = logFile.Close()
		t.Fatalf("start NATS restart contract: %v", err)
	}
	return &restartContractServer{command: command, logFile: logFile}
}

func (server *restartContractServer) stop() error {
	if server == nil || server.command == nil || server.command.Process == nil {
		return nil
	}
	killError := server.command.Process.Kill()
	_ = server.command.Wait()
	closeError := server.logFile.Close()
	server.command = nil
	server.logFile = nil
	if killError != nil && !errors.Is(killError, os.ErrProcessDone) {
		return killError
	}
	return closeError
}

func reserveRestartPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve NATS restart port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatalf("release NATS restart port: %v", err)
	}
	return port
}

type restartContractReport struct {
	SchemaVersion              int    `json:"schemaVersion"`
	Status                     string `json:"status"`
	Storage                    string `json:"storage"`
	Replicas                   int    `json:"replicas"`
	AbruptRestarts             int    `json:"abruptRestarts"`
	PersistedMessages          uint64 `json:"persistedMessages"`
	RecoveredStreamSequence    uint64 `json:"recoveredStreamSequence"`
	DeliveryCountBeforeRestart uint64 `json:"deliveryCountBeforeRestart"`
	DeliveryCountAfterRestart  uint64 `json:"deliveryCountAfterRestart"`
	RedeliveryObserved         bool   `json:"redeliveryObserved"`
	Acknowledged               int    `json:"acknowledged"`
	DeadLettered               int    `json:"deadLettered"`
	SourceAckPending           int    `json:"sourceAckPending"`
	SourceMessagesPending      uint64 `json:"sourceMessagesPending"`
	ShortLeaseRejected         bool   `json:"shortLeaseRejected"`
	LeasePreflightPassed       bool   `json:"leasePreflightPassed"`
	RequiredLeaseNanos         int64  `json:"requiredLeaseNanos"`
	WorkerAckWaitNanos         int64  `json:"workerAckWaitNanos"`
}

func writeRestartReport(t *testing.T, path string, report restartContractReport) {
	t.Helper()
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatalf("marshal restart report: %v", err)
	}
	encoded = append(encoded, '\n')
	if err := os.WriteFile(path, encoded, 0o640); err != nil {
		t.Fatalf("write restart report: %v", err)
	}
}
