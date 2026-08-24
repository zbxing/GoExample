package natsjetstream

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/zbxing/goexample/Framework/queueclient"
)

const (
	streamSnapshotResponseType = "io.nats.jetstream.api.v1.stream_snapshot_response"
	streamRestoreResponseType  = "io.nats.jetstream.api.v1.stream_restore_response"
	streamCreateResponseType   = "io.nats.jetstream.api.v1.stream_create_response"
	maximumSnapshotBytes       = 64 << 20
	snapshotChunkSize          = 32 << 10
	snapshotRestoreBudget      = 15 * time.Second
)

func TestRealNATSJetStreamSnapshotRestoreRecovery(t *testing.T) {
	serverBinary := strings.TrimSpace(os.Getenv("NATS_SERVER_BINARY"))
	if serverBinary == "" {
		t.Skip("NATS_SERVER_BINARY is not set; skipping real JetStream snapshot/restore contract")
	}
	serverBinary, err := filepath.Abs(serverBinary)
	if err != nil {
		t.Fatalf("resolve NATS_SERVER_BINARY: %v", err)
	}
	if info, err := os.Stat(serverBinary); err != nil || !info.Mode().IsRegular() {
		t.Fatalf("NATS_SERVER_BINARY is not a regular file: %v", err)
	}

	evidenceDirectory := strings.TrimSpace(os.Getenv("NATS_SNAPSHOT_EVIDENCE_DIR"))
	if evidenceDirectory == "" {
		evidenceDirectory = t.TempDir()
	} else if evidenceDirectory, err = filepath.Abs(evidenceDirectory); err != nil {
		t.Fatalf("resolve NATS_SNAPSHOT_EVIDENCE_DIR: %v", err)
	}
	if err := os.MkdirAll(evidenceDirectory, 0o750); err != nil {
		t.Fatalf("create snapshot evidence directory: %v", err)
	}

	testContext, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	port := reserveRestartPort(t)
	serverURL := "nats://127.0.0.1:" + strconv.Itoa(port)
	server := startRestartServer(
		t,
		serverBinary,
		filepath.Join(t.TempDir(), "jetstream"),
		port,
		filepath.Join(evidenceDirectory, "nats-snapshot-restore.log"),
	)
	t.Cleanup(func() {
		if server != nil {
			_ = server.stop()
		}
	})

	connection := connectRealJetStream(t, testContext, serverURL)
	defer connection.Close()
	js, err := jetstream.New(connection)
	if err != nil {
		t.Fatalf("jetstream.New(snapshot contract) error = %v", err)
	}
	const (
		sourceStream    = "GOEXAMPLE_SNAPSHOT_SOURCE"
		dlqStream       = "GOEXAMPLE_SNAPSHOT_DLQ"
		sourceSubject   = "goexample.snapshot.source"
		dlqSubject      = "goexample.snapshot.dlq"
		consumerName    = "GOEXAMPLE_SNAPSHOT_WORKER"
		dlqConsumerName = "GOEXAMPLE_SNAPSHOT_DLQ_READER"
	)
	createContractStream(t, testContext, js, sourceStream, sourceSubject)
	createContractStream(t, testContext, js, dlqStream, dlqSubject)
	sourceConsumer, err := js.CreateConsumer(testContext, sourceStream, jetstream.ConsumerConfig{
		Name:              consumerName,
		Durable:           consumerName,
		AckPolicy:         jetstream.AckExplicitPolicy,
		AckWait:           800 * time.Millisecond,
		MaxDeliver:        5,
		FilterSubject:     sourceSubject,
		ReplayPolicy:      jetstream.ReplayInstantPolicy,
		MaxAckPending:     1,
		MaxRequestBatch:   1,
		MaxRequestExpires: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("CreateConsumer(snapshot source) error = %v", err)
	}
	dlqConsumer, err := js.CreateConsumer(testContext, dlqStream, jetstream.ConsumerConfig{
		Name:              dlqConsumerName,
		Durable:           dlqConsumerName,
		AckPolicy:         jetstream.AckExplicitPolicy,
		FilterSubject:     dlqSubject,
		MaxAckPending:     1,
		MaxRequestBatch:   1,
		MaxRequestExpires: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("CreateConsumer(snapshot DLQ) error = %v", err)
	}
	adapter, client := newSnapshotContractClient(t, js, sourceConsumer, sourceSubject, dlqSubject)
	deadLetterBody := deterministicSnapshotPayload(48 << 10)
	for _, message := range []struct {
		body   []byte
		tenant string
	}{
		{body: []byte("snapshot-checkpoint-acknowledged"), tenant: "tenant-checkpoint-ack"},
		{body: []byte("snapshot-checkpoint-unacknowledged"), tenant: "tenant-checkpoint-redelivery"},
		{body: deadLetterBody, tenant: "tenant-checkpoint-dlq"},
	} {
		if err := client.Publish(testContext, queueclient.Message{
			Body:    message.body,
			Headers: map[string]string{"Tenant": message.tenant},
		}, adapter.Publish); err != nil {
			t.Fatalf("Publish(snapshot checkpoint) error = %v", err)
		}
	}

	acknowledgedBeforeSnapshot, err := sourceConsumer.Next(jetstream.FetchMaxWait(3 * time.Second))
	if err != nil {
		t.Fatalf("Next(checkpoint acknowledgement) error = %v", err)
	}
	acknowledgedMetadata, err := acknowledgedBeforeSnapshot.Metadata()
	if err != nil {
		t.Fatalf("Metadata(checkpoint acknowledgement) error = %v", err)
	}
	if acknowledgedMetadata.Sequence.Stream != 1 {
		t.Fatalf("checkpoint acknowledged sequence = %d, want 1", acknowledgedMetadata.Sequence.Stream)
	}
	if err := acknowledgedBeforeSnapshot.DoubleAck(testContext); err != nil {
		t.Fatalf("DoubleAck(checkpoint acknowledgement) error = %v", err)
	}

	unacknowledgedBeforeSnapshot, err := sourceConsumer.Next(jetstream.FetchMaxWait(3 * time.Second))
	if err != nil {
		t.Fatalf("Next(checkpoint unacknowledged) error = %v", err)
	}
	unacknowledgedMetadata, err := unacknowledgedBeforeSnapshot.Metadata()
	if err != nil {
		t.Fatalf("Metadata(checkpoint unacknowledged) error = %v", err)
	}
	if unacknowledgedMetadata.Sequence.Stream != 2 || unacknowledgedMetadata.NumDelivered != 1 {
		t.Fatalf(
			"checkpoint unacknowledged metadata = sequence:%d delivered:%d, want 2/1",
			unacknowledgedMetadata.Sequence.Stream,
			unacknowledgedMetadata.NumDelivered,
		)
	}
	consumerBeforeSnapshot, err := sourceConsumer.Info(testContext)
	if err != nil {
		t.Fatalf("Info(consumer before snapshot) error = %v", err)
	}
	if consumerBeforeSnapshot.NumAckPending != 1 || consumerBeforeSnapshot.NumPending != 1 {
		t.Fatalf(
			"consumer state before snapshot = ack:%d pending:%d, want 1/1",
			consumerBeforeSnapshot.NumAckPending,
			consumerBeforeSnapshot.NumPending,
		)
	}

	snapshot, snapshotMetadata := takeStreamSnapshot(t, testContext, connection, sourceStream)
	if snapshotMetadata.State.Messages != 3 || snapshotMetadata.State.FirstSequence != 1 ||
		snapshotMetadata.State.LastSequence != 3 || snapshotMetadata.Chunks < 2 {
		t.Fatalf("snapshot stream state = %+v, want messages/first/last 3/1/3", snapshotMetadata.State)
	}
	snapshotDigest := sha256.Sum256(snapshot)
	snapshotSHA256 := hex.EncodeToString(snapshotDigest[:])
	if err := verifySnapshotArchive(snapshot, int64(len(snapshot)), snapshotSHA256); err != nil {
		t.Fatalf("verify snapshot archive: %v", err)
	}
	tamperedSnapshot := bytes.Clone(snapshot)
	tamperedSnapshot[len(tamperedSnapshot)/2] ^= 0xff
	tamperedSnapshotRejected := verifySnapshotArchive(tamperedSnapshot, int64(len(snapshot)), snapshotSHA256) != nil
	if !tamperedSnapshotRejected {
		t.Fatal("tampered snapshot archive was accepted")
	}
	if err := os.WriteFile(filepath.Join(evidenceDirectory, "source-stream.snapshot"), snapshot, 0o640); err != nil {
		t.Fatalf("write source stream snapshot: %v", err)
	}

	publishContractMessage(t, testContext, client, adapter, "post-snapshot-excluded", "tenant-post-snapshot")
	streamBeforeDelete, err := js.Stream(testContext, sourceStream)
	if err != nil {
		t.Fatalf("Stream(before snapshot restore) error = %v", err)
	}
	streamBeforeDeleteInfo, err := streamBeforeDelete.Info(testContext)
	if err != nil {
		t.Fatalf("Info(before snapshot restore) error = %v", err)
	}
	if streamBeforeDeleteInfo.State.Msgs != 4 {
		t.Fatalf("source messages before delete = %d, want 4", streamBeforeDeleteInfo.State.Msgs)
	}
	if err := js.DeleteStream(testContext, sourceStream); err != nil {
		t.Fatalf("DeleteStream(snapshot source) error = %v", err)
	}
	if _, err := js.Stream(testContext, sourceStream); !errors.Is(err, jetstream.ErrStreamNotFound) {
		t.Fatalf("Stream(after delete) error = %v, want stream not found", err)
	}

	restoreStarted := time.Now()
	restoreStreamSnapshot(t, testContext, connection, sourceStream, snapshotMetadata, snapshot)
	restoreElapsed := time.Since(restoreStarted)
	if restoreElapsed > snapshotRestoreBudget {
		t.Fatalf("snapshot restore elapsed = %s, budget = %s", restoreElapsed, snapshotRestoreBudget)
	}
	restoredStream, err := js.Stream(testContext, sourceStream)
	if err != nil {
		t.Fatalf("Stream(after snapshot restore) error = %v", err)
	}
	restoredStreamInfo, err := restoredStream.Info(testContext)
	if err != nil {
		t.Fatalf("Info(after snapshot restore) error = %v", err)
	}
	if restoredStreamInfo.State.Msgs != 3 || restoredStreamInfo.State.FirstSeq != 1 || restoredStreamInfo.State.LastSeq != 3 {
		t.Fatalf("restored stream state = %+v, want messages/first/last 3/1/3", restoredStreamInfo.State)
	}
	restoredConsumer, err := js.Consumer(testContext, sourceStream, consumerName)
	if err != nil {
		t.Fatalf("Consumer(after snapshot restore) error = %v", err)
	}
	restoredConsumerInfo, err := restoredConsumer.Info(testContext)
	if err != nil {
		t.Fatalf("Info(consumer after snapshot restore) error = %v", err)
	}
	if restoredConsumerInfo.NumAckPending != 1 || restoredConsumerInfo.NumPending != 1 {
		t.Fatalf(
			"restored consumer state = ack:%d pending:%d, want 1/1",
			restoredConsumerInfo.NumAckPending,
			restoredConsumerInfo.NumPending,
		)
	}

	restoredAdapter, _ := newSnapshotContractClient(t, js, restoredConsumer, sourceSubject, dlqSubject)
	recoveredMessage, err := restoredConsumer.Next(jetstream.FetchMaxWait(3 * time.Second))
	if err != nil {
		t.Fatalf("Next(restored unacknowledged) error = %v", err)
	}
	recoveredMetadata, err := recoveredMessage.Metadata()
	if err != nil {
		t.Fatalf("Metadata(restored unacknowledged) error = %v", err)
	}
	if string(recoveredMessage.Data()) != "snapshot-checkpoint-unacknowledged" ||
		recoveredMessage.Headers().Get("Tenant") != "tenant-checkpoint-redelivery" ||
		recoveredMetadata.Sequence.Stream != unacknowledgedMetadata.Sequence.Stream {
		t.Fatalf(
			"restored unacknowledged delivery = body:%q tenant:%q sequence:%d",
			recoveredMessage.Data(),
			recoveredMessage.Headers().Get("Tenant"),
			recoveredMetadata.Sequence.Stream,
		)
	}
	if err := recoveredMessage.DoubleAck(testContext); err != nil {
		t.Fatalf("DoubleAck(restored unacknowledged) error = %v", err)
	}

	deadLetterDelivery, err := restoredAdapter.ReceiveDelivery(testContext)
	if err != nil {
		t.Fatalf("ReceiveDelivery(restored dead letter) error = %v", err)
	}
	if !bytes.Equal(deadLetterDelivery.Message.Body, deadLetterBody) ||
		deadLetterDelivery.Message.Headers["Tenant"] != "tenant-checkpoint-dlq" {
		t.Fatalf("restored dead-letter delivery = %#v", deadLetterDelivery.Message)
	}
	if err := deadLetterDelivery.DeadLetter(testContext); err != nil {
		t.Fatalf("DeadLetter(restored delivery) error = %v", err)
	}
	dlqMessage, err := dlqConsumer.Next(jetstream.FetchMaxWait(3 * time.Second))
	if err != nil {
		t.Fatalf("Next(DLQ after snapshot restore) error = %v", err)
	}
	if !bytes.Equal(dlqMessage.Data(), deadLetterBody) ||
		dlqMessage.Headers().Get("Tenant") != "tenant-checkpoint-dlq" {
		t.Fatalf("snapshot restore DLQ bytes/header = %d/%q", len(dlqMessage.Data()), dlqMessage.Headers().Get("Tenant"))
	}
	if !strings.HasPrefix(dlqMessage.Headers().Get(jetstream.MsgIDHeader), "goexample-dlq-") {
		t.Fatalf("snapshot restore DLQ message ID = %q", dlqMessage.Headers().Get(jetstream.MsgIDHeader))
	}
	if err := dlqMessage.DoubleAck(testContext); err != nil {
		t.Fatalf("DoubleAck(snapshot restore DLQ) error = %v", err)
	}
	settledConsumerInfo, err := restoredConsumer.Info(testContext)
	if err != nil {
		t.Fatalf("Info(consumer after snapshot settlement) error = %v", err)
	}
	if settledConsumerInfo.NumAckPending != 0 || settledConsumerInfo.NumPending != 0 {
		t.Fatalf(
			"snapshot restored consumer pending = ack:%d messages:%d",
			settledConsumerInfo.NumAckPending,
			settledConsumerInfo.NumPending,
		)
	}

	writeSnapshotReport(t, filepath.Join(evidenceDirectory, "snapshot-restore-report.json"), snapshotRestoreReport{
		SchemaVersion:                 1,
		Status:                        "passed",
		Storage:                       "file",
		Replicas:                      1,
		SnapshotIncludesConsumers:     true,
		SnapshotCheckedMessages:       true,
		SnapshotBytes:                 int64(len(snapshot)),
		SnapshotSHA256:                snapshotSHA256,
		SnapshotChunks:                snapshotMetadata.Chunks,
		CheckpointMessages:            snapshotMetadata.State.Messages,
		CheckpointFirstSequence:       snapshotMetadata.State.FirstSequence,
		CheckpointLastSequence:        snapshotMetadata.State.LastSequence,
		PostCheckpointMessages:        1,
		MessagesBeforeDelete:          streamBeforeDeleteInfo.State.Msgs,
		RestoredMessages:              restoredStreamInfo.State.Msgs,
		PostCheckpointExcluded:        restoredStreamInfo.State.Msgs == snapshotMetadata.State.Messages,
		TamperedSnapshotRejected:      tamperedSnapshotRejected,
		ConsumerRestored:              true,
		AckPendingBeforeSnapshot:      consumerBeforeSnapshot.NumAckPending,
		MessagesPendingBeforeSnapshot: consumerBeforeSnapshot.NumPending,
		AckPendingAfterRestore:        restoredConsumerInfo.NumAckPending,
		MessagesPendingAfterRestore:   restoredConsumerInfo.NumPending,
		UnacknowledgedSequence:        unacknowledgedMetadata.Sequence.Stream,
		RecoveredSequence:             recoveredMetadata.Sequence.Stream,
		SameSequenceRedelivered:       recoveredMetadata.Sequence.Stream == unacknowledgedMetadata.Sequence.Stream,
		AcknowledgedAfterRestore:      1,
		DeadLetteredAfterRestore:      1,
		SourceAckPending:              settledConsumerInfo.NumAckPending,
		SourceMessagesPending:         settledConsumerInfo.NumPending,
		RestoreElapsedNanos:           restoreElapsed.Nanoseconds(),
		RestoreBudgetNanos:            snapshotRestoreBudget.Nanoseconds(),
	})
}

func newSnapshotContractClient(
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
		t.Fatalf("New(snapshot adapter) error = %v", err)
	}
	client, err := queueclient.New(queueclient.Config{
		System:         queueclient.SystemNATS,
		PublishTimeout: 3 * time.Second,
		ProcessTimeout: 3 * time.Second,
	})
	if err != nil {
		t.Fatalf("queueclient.New(snapshot) error = %v", err)
	}
	return adapter, client
}

type jetStreamAPIError struct {
	Code        int    `json:"code"`
	ErrorCode   int    `json:"err_code"`
	Description string `json:"description"`
}

type jetStreamAPIResponse struct {
	Type  string             `json:"type"`
	Error *jetStreamAPIError `json:"error,omitempty"`
}

type snapshotStreamState struct {
	Messages      uint64 `json:"messages"`
	Bytes         uint64 `json:"bytes"`
	FirstSequence uint64 `json:"first_seq"`
	LastSequence  uint64 `json:"last_seq"`
}

type streamSnapshotMetadata struct {
	Config   json.RawMessage
	State    snapshotStreamState
	RawState json.RawMessage
	Chunks   int
}

type streamSnapshotAPIResponse struct {
	jetStreamAPIResponse
	Config json.RawMessage `json:"config"`
	State  json.RawMessage `json:"state"`
}

func takeStreamSnapshot(
	t *testing.T,
	ctx context.Context,
	connection *nats.Conn,
	streamName string,
) ([]byte, streamSnapshotMetadata) {
	t.Helper()
	deliverSubject := nats.NewInbox()
	subscription, err := connection.SubscribeSync(deliverSubject)
	if err != nil {
		t.Fatalf("SubscribeSync(snapshot chunks) error = %v", err)
	}
	defer subscription.Unsubscribe()
	if err := connection.FlushWithContext(ctx); err != nil {
		t.Fatalf("FlushWithContext(snapshot subscription) error = %v", err)
	}
	request, err := json.Marshal(struct {
		DeliverSubject string `json:"deliver_subject"`
		NoConsumers    bool   `json:"no_consumers"`
		ChunkSize      int    `json:"chunk_size"`
		WindowSize     int    `json:"window_size"`
		CheckMessages  bool   `json:"jsck"`
	}{
		DeliverSubject: deliverSubject,
		NoConsumers:    false,
		ChunkSize:      snapshotChunkSize,
		WindowSize:     snapshotChunkSize * 4,
		CheckMessages:  true,
	})
	if err != nil {
		t.Fatalf("marshal stream snapshot request: %v", err)
	}
	message, err := connection.RequestWithContext(ctx, "$JS.API.STREAM.SNAPSHOT."+streamName, request)
	if err != nil {
		t.Fatalf("request stream snapshot: %v", err)
	}
	var response streamSnapshotAPIResponse
	if err := json.Unmarshal(message.Data, &response); err != nil {
		t.Fatalf("unmarshal stream snapshot response: %v", err)
	}
	requireJetStreamAPIResponse(t, response.jetStreamAPIResponse, streamSnapshotResponseType)
	if len(response.Config) == 0 || len(response.State) == 0 {
		t.Fatal("stream snapshot response omitted config or state")
	}
	var state snapshotStreamState
	if err := json.Unmarshal(response.State, &state); err != nil {
		t.Fatalf("unmarshal stream snapshot state: %v", err)
	}

	archive := make([]byte, 0, snapshotChunkSize)
	chunks := 0
	for {
		chunk, err := subscription.NextMsgWithContext(ctx)
		if err != nil {
			t.Fatalf("receive stream snapshot chunk: %v", err)
		}
		if len(chunk.Data) == 0 {
			break
		}
		if len(archive) > maximumSnapshotBytes-len(chunk.Data) {
			t.Fatalf("stream snapshot exceeds %d bytes", maximumSnapshotBytes)
		}
		archive = append(archive, chunk.Data...)
		chunks++
		if chunk.Reply != "" {
			if err := chunk.Respond(nil); err != nil {
				t.Fatalf("acknowledge stream snapshot chunk: %v", err)
			}
		}
	}
	if len(archive) == 0 || chunks == 0 {
		t.Fatal("stream snapshot archive is empty")
	}
	return archive, streamSnapshotMetadata{
		Config:   bytes.Clone(response.Config),
		State:    state,
		RawState: bytes.Clone(response.State),
		Chunks:   chunks,
	}
}

func restoreStreamSnapshot(
	t *testing.T,
	ctx context.Context,
	connection *nats.Conn,
	streamName string,
	metadata streamSnapshotMetadata,
	archive []byte,
) {
	t.Helper()
	request, err := json.Marshal(struct {
		Config json.RawMessage `json:"config"`
		State  json.RawMessage `json:"state"`
	}{Config: metadata.Config, State: metadata.RawState})
	if err != nil {
		t.Fatalf("marshal stream restore request: %v", err)
	}
	message, err := connection.RequestWithContext(ctx, "$JS.API.STREAM.RESTORE."+streamName, request)
	if err != nil {
		t.Fatalf("request stream restore: %v", err)
	}
	var response struct {
		jetStreamAPIResponse
		DeliverSubject string `json:"deliver_subject"`
	}
	if err := json.Unmarshal(message.Data, &response); err != nil {
		t.Fatalf("unmarshal stream restore response: %v", err)
	}
	requireJetStreamAPIResponse(t, response.jetStreamAPIResponse, streamRestoreResponseType)
	if response.DeliverSubject == "" {
		t.Fatal("stream restore response omitted deliver subject")
	}
	for offset := 0; offset < len(archive); offset += snapshotChunkSize {
		end := min(offset+snapshotChunkSize, len(archive))
		chunkResponse, err := connection.RequestWithContext(ctx, response.DeliverSubject, archive[offset:end])
		if err != nil {
			t.Fatalf("upload stream restore chunk: %v", err)
		}
		if len(chunkResponse.Data) > 0 {
			var apiResponse jetStreamAPIResponse
			if err := json.Unmarshal(chunkResponse.Data, &apiResponse); err != nil {
				t.Fatalf("unmarshal stream restore chunk response: %v", err)
			}
			if apiResponse.Error != nil {
				t.Fatalf("stream restore chunk failed: code=%d err_code=%d", apiResponse.Error.Code, apiResponse.Error.ErrorCode)
			}
		}
	}
	completeResponse, err := connection.RequestWithContext(ctx, response.DeliverSubject, nil)
	if err != nil {
		t.Fatalf("complete stream restore: %v", err)
	}
	var complete jetStreamAPIResponse
	if err := json.Unmarshal(completeResponse.Data, &complete); err != nil {
		t.Fatalf("unmarshal stream restore completion: %v", err)
	}
	requireJetStreamAPIResponse(t, complete, streamCreateResponseType)
}

func requireJetStreamAPIResponse(t *testing.T, response jetStreamAPIResponse, expectedType string) {
	t.Helper()
	if response.Error != nil {
		t.Fatalf(
			"JetStream API request failed: code=%d err_code=%d",
			response.Error.Code,
			response.Error.ErrorCode,
		)
	}
	if response.Type != expectedType {
		t.Fatalf("JetStream API response type = %q, want %q", response.Type, expectedType)
	}
}

func verifySnapshotArchive(archive []byte, expectedBytes int64, expectedSHA256 string) error {
	if len(archive) == 0 || int64(len(archive)) != expectedBytes || len(expectedSHA256) != sha256.Size*2 {
		return errors.New("snapshot archive metadata mismatch")
	}
	digest := sha256.Sum256(archive)
	if !strings.EqualFold(hex.EncodeToString(digest[:]), expectedSHA256) {
		return errors.New("snapshot archive digest mismatch")
	}
	return nil
}

func deterministicSnapshotPayload(size int) []byte {
	payload := make([]byte, size)
	state := uint64(0x9e3779b97f4a7c15)
	for index := range payload {
		state ^= state << 13
		state ^= state >> 7
		state ^= state << 17
		payload[index] = byte(state)
	}
	return payload
}

type snapshotRestoreReport struct {
	SchemaVersion                 int    `json:"schemaVersion"`
	Status                        string `json:"status"`
	Storage                       string `json:"storage"`
	Replicas                      int    `json:"replicas"`
	SnapshotIncludesConsumers     bool   `json:"snapshotIncludesConsumers"`
	SnapshotCheckedMessages       bool   `json:"snapshotCheckedMessages"`
	SnapshotBytes                 int64  `json:"snapshotBytes"`
	SnapshotSHA256                string `json:"snapshotSHA256"`
	SnapshotChunks                int    `json:"snapshotChunks"`
	CheckpointMessages            uint64 `json:"checkpointMessages"`
	CheckpointFirstSequence       uint64 `json:"checkpointFirstSequence"`
	CheckpointLastSequence        uint64 `json:"checkpointLastSequence"`
	PostCheckpointMessages        uint64 `json:"postCheckpointMessages"`
	MessagesBeforeDelete          uint64 `json:"messagesBeforeDelete"`
	RestoredMessages              uint64 `json:"restoredMessages"`
	PostCheckpointExcluded        bool   `json:"postCheckpointExcluded"`
	TamperedSnapshotRejected      bool   `json:"tamperedSnapshotRejected"`
	ConsumerRestored              bool   `json:"consumerRestored"`
	AckPendingBeforeSnapshot      int    `json:"ackPendingBeforeSnapshot"`
	MessagesPendingBeforeSnapshot uint64 `json:"messagesPendingBeforeSnapshot"`
	AckPendingAfterRestore        int    `json:"ackPendingAfterRestore"`
	MessagesPendingAfterRestore   uint64 `json:"messagesPendingAfterRestore"`
	UnacknowledgedSequence        uint64 `json:"unacknowledgedSequence"`
	RecoveredSequence             uint64 `json:"recoveredSequence"`
	SameSequenceRedelivered       bool   `json:"sameSequenceRedelivered"`
	AcknowledgedAfterRestore      int    `json:"acknowledgedAfterRestore"`
	DeadLetteredAfterRestore      int    `json:"deadLetteredAfterRestore"`
	SourceAckPending              int    `json:"sourceAckPending"`
	SourceMessagesPending         uint64 `json:"sourceMessagesPending"`
	RestoreElapsedNanos           int64  `json:"restoreElapsedNanos"`
	RestoreBudgetNanos            int64  `json:"restoreBudgetNanos"`
}

func writeSnapshotReport(t *testing.T, path string, report snapshotRestoreReport) {
	t.Helper()
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatalf("marshal snapshot restore report: %v", err)
	}
	encoded = append(encoded, '\n')
	if err := os.WriteFile(path, encoded, 0o640); err != nil {
		t.Fatalf("write snapshot restore report: %v", err)
	}
}

func (state snapshotStreamState) String() string {
	return fmt.Sprintf(
		"messages:%d bytes:%d first:%d last:%d",
		state.Messages,
		state.Bytes,
		state.FirstSequence,
		state.LastSequence,
	)
}
