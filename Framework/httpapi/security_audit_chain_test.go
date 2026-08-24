package httpapi

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestHashChainAuditSinkWritesAndVerifiesLinkedRecords(t *testing.T) {
	var output bytes.Buffer
	sink, err := NewHashChainAuditSink(HashChainAuditSinkConfig{Writer: &output})
	if err != nil {
		t.Fatalf("NewHashChainAuditSink() error = %v", err)
	}
	base := SecurityAuditRecord{
		Timestamp: time.Date(2026, time.August, 21, 12, 0, 0, 0, time.FixedZone("CST", 8*60*60)),
		Event:     "bearer", Outcome: "failure", Reason: "token_invalid", Target: "api", RequestID: "request-1",
		TraceID: "trace-1", SpanID: "span-1",
	}
	if err := sink.WriteSecurityAudit(context.Background(), base); err != nil {
		t.Fatalf("first WriteSecurityAudit() error = %v", err)
	}
	base.RequestID = "request-2"
	if err := sink.WriteSecurityAudit(context.Background(), base); err != nil {
		t.Fatalf("second WriteSecurityAudit() error = %v", err)
	}
	base.Event = "authorization"
	base.Reason = "resource_denied"
	base.Target = "application_query"
	base.RequestID = "request-3"
	if err := sink.WriteSecurityAudit(context.Background(), base); err != nil {
		t.Fatalf("resource authorization WriteSecurityAudit() error = %v", err)
	}
	base.Reason = "resource_invalid"
	base.Target = "application_command"
	base.RequestID = "request-4"
	if err := sink.WriteSecurityAudit(context.Background(), base); err != nil {
		t.Fatalf("invalid resource authorization WriteSecurityAudit() error = %v", err)
	}
	base.Event = "login"
	base.Outcome = "success"
	base.Reason = "oidc_callback_valid"
	base.Target = "oidc_browser"
	base.RequestID = "request-5"
	if err := sink.WriteSecurityAudit(context.Background(), base); err != nil {
		t.Fatalf("OIDC callback WriteSecurityAudit() error = %v", err)
	}
	base.Event = "session"
	base.Reason = "session_revoked"
	base.RequestID = "request-6"
	if err := sink.WriteSecurityAudit(context.Background(), base); err != nil {
		t.Fatalf("session revoke WriteSecurityAudit() error = %v", err)
	}
	if count, err := VerifyHashChain(bytes.NewReader(output.Bytes())); err != nil || count != 6 {
		t.Fatalf("VerifyHashChain() = %d, %v", count, err)
	}
	if !strings.Contains(output.String(), `"sequence":1`) || !strings.Contains(output.String(), `"sequence":2`) || !strings.Contains(output.String(), `"sequence":3`) || !strings.Contains(output.String(), `"sequence":4`) || !strings.Contains(output.String(), `"sequence":5`) || !strings.Contains(output.String(), `"sequence":6`) {
		t.Fatalf("sequence fields missing: %s", output.String())
	}
}

func TestHashChainAuditSinkRejectsTamperingAndInvalidRecords(t *testing.T) {
	var output bytes.Buffer
	sink, err := NewHashChainAuditSink(HashChainAuditSinkConfig{Writer: &output})
	if err != nil {
		t.Fatalf("NewHashChainAuditSink() error = %v", err)
	}
	record := SecurityAuditRecord{
		Timestamp: time.Now().UTC(), Event: "bearer", Outcome: "failure", Reason: "token_invalid", Target: "api", RequestID: "request",
	}
	if err := sink.WriteSecurityAudit(context.Background(), record); err != nil {
		t.Fatalf("WriteSecurityAudit() error = %v", err)
	}
	tampered := strings.Replace(output.String(), "token_invalid", "token_missing", 1)
	if _, err := VerifyHashChain(strings.NewReader(tampered)); !errors.Is(err, ErrAuditChainCorrupt) {
		t.Fatalf("tampered VerifyHashChain() error = %v", err)
	}
	invalid := record
	invalid.RequestID = ""
	if err := sink.WriteSecurityAudit(context.Background(), invalid); !errors.Is(err, ErrAuditChainRecordInvalid) {
		t.Fatalf("invalid WriteSecurityAudit() error = %v", err)
	}
}

func TestHashChainAuditSinkHonorsCancellationAndWriterBounds(t *testing.T) {
	if _, err := NewHashChainAuditSink(HashChainAuditSinkConfig{}); !errors.Is(err, ErrAuditChainWriterUnavailable) {
		t.Fatalf("nil writer error = %v", err)
	}
	if _, err := NewHashChainAuditSink(HashChainAuditSinkConfig{Writer: io.Discard, MaxRecordBytes: 128}); !errors.Is(err, ErrAuditChainRecordTooLarge) {
		t.Fatalf("small bound error = %v", err)
	}
	var output bytes.Buffer
	sink, err := NewHashChainAuditSink(HashChainAuditSinkConfig{Writer: &output})
	if err != nil {
		t.Fatalf("NewHashChainAuditSink() error = %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err = sink.WriteSecurityAudit(ctx, SecurityAuditRecord{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled WriteSecurityAudit() error = %v", err)
	}
}

func TestHashChainAuditSinkSerializesConcurrentWriters(t *testing.T) {
	var output bytes.Buffer
	sink, err := NewHashChainAuditSink(HashChainAuditSinkConfig{Writer: &output})
	if err != nil {
		t.Fatalf("NewHashChainAuditSink() error = %v", err)
	}
	const writers = 32
	var wait sync.WaitGroup
	errorsObserved := make(chan error, writers)
	for index := 0; index < writers; index++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			errorsObserved <- sink.WriteSecurityAudit(context.Background(), SecurityAuditRecord{
				Timestamp: time.Unix(int64(index+1), 0).UTC(), Event: "bearer", Outcome: "failure",
				Reason: "token_invalid", Target: "api", RequestID: "request",
			})
		}(index)
	}
	wait.Wait()
	close(errorsObserved)
	for err := range errorsObserved {
		if err != nil {
			t.Fatalf("concurrent WriteSecurityAudit() error = %v", err)
		}
	}
	if count, err := VerifyHashChain(bytes.NewReader(output.Bytes())); err != nil || count != writers {
		t.Fatalf("VerifyHashChain() = %d, %v", count, err)
	}
}

func TestEncryptedAuditWriterEncryptsAndSupportsKeyRotation(t *testing.T) {
	var output bytes.Buffer
	firstKey := bytes.Repeat([]byte{0x11}, 32)
	secondKey := bytes.Repeat([]byte{0x22}, 32)
	encrypted, err := NewEncryptedAuditWriter(EncryptedAuditWriterConfig{
		Writer: &output, KeyID: "audit-2026-08", Key: firstKey,
	})
	if err != nil {
		t.Fatalf("NewEncryptedAuditWriter() error = %v", err)
	}
	sink, err := NewHashChainAuditSink(HashChainAuditSinkConfig{Writer: encrypted})
	if err != nil {
		t.Fatalf("NewHashChainAuditSink() error = %v", err)
	}
	record := SecurityAuditRecord{
		Timestamp: time.Now().UTC(), Event: "bearer", Outcome: "failure", Reason: "token_invalid",
		Target: "api", RequestID: "encrypted-request",
	}
	if err := sink.WriteSecurityAudit(context.Background(), record); err != nil {
		t.Fatalf("first WriteSecurityAudit() error = %v", err)
	}
	if err := encrypted.RotateKey("audit-2026-09", secondKey); err != nil {
		t.Fatalf("RotateKey() error = %v", err)
	}
	record.RequestID = "rotated-request"
	if err := sink.WriteSecurityAudit(context.Background(), record); err != nil {
		t.Fatalf("second WriteSecurityAudit() error = %v", err)
	}
	if strings.Contains(output.String(), "token_invalid") || strings.Contains(output.String(), "encrypted-request") {
		t.Fatalf("encrypted output leaked plaintext: %s", output.String())
	}
	if count, err := VerifyEncryptedHashChain(bytes.NewReader(output.Bytes()), AuditEncryptionKeyring{
		"audit-2026-08": firstKey,
		"audit-2026-09": secondKey,
	}); err != nil || count != 2 {
		t.Fatalf("VerifyEncryptedHashChain() = %d, %v", count, err)
	}
}

func TestEncryptedAuditWriterRejectsTamperingUnknownKeysAndInvalidConfig(t *testing.T) {
	key := bytes.Repeat([]byte{0x33}, 32)
	if _, err := NewEncryptedAuditWriter(EncryptedAuditWriterConfig{Writer: io.Discard, KeyID: "bad key", Key: key}); !errors.Is(err, ErrAuditEncryptionKeyInvalid) {
		t.Fatalf("invalid key ID error = %v", err)
	}
	if _, err := NewEncryptedAuditWriter(EncryptedAuditWriterConfig{Writer: io.Discard, KeyID: "key", Key: []byte("short")}); !errors.Is(err, ErrAuditEncryptionKeyInvalid) {
		t.Fatalf("invalid key length error = %v", err)
	}
	var output bytes.Buffer
	encrypted, err := NewEncryptedAuditWriter(EncryptedAuditWriterConfig{Writer: &output, KeyID: "key", Key: key})
	if err != nil {
		t.Fatalf("NewEncryptedAuditWriter() error = %v", err)
	}
	if _, err := encrypted.Write([]byte("not-a-record")); !errors.Is(err, ErrAuditEncryptionRecordInvalid) {
		t.Fatalf("invalid plaintext error = %v", err)
	}
	if _, err := encrypted.Write([]byte("\n")); !errors.Is(err, ErrAuditEncryptionRecordInvalid) {
		t.Fatalf("empty plaintext error = %v", err)
	}
	sink, err := NewHashChainAuditSink(HashChainAuditSinkConfig{Writer: encrypted})
	if err != nil {
		t.Fatalf("NewHashChainAuditSink() error = %v", err)
	}
	if err := sink.WriteSecurityAudit(context.Background(), SecurityAuditRecord{
		Timestamp: time.Now().UTC(), Event: "bearer", Outcome: "failure", Reason: "token_invalid",
		Target: "api", RequestID: "request",
	}); err != nil {
		t.Fatalf("WriteSecurityAudit() error = %v", err)
	}
	if err := sink.WriteSecurityAudit(context.Background(), SecurityAuditRecord{
		Timestamp: time.Now().UTC(), Event: "bearer", Outcome: "failure", Reason: "token_invalid",
		Target: "api", RequestID: "request-2",
	}); err != nil {
		t.Fatalf("second WriteSecurityAudit() error = %v", err)
	}
	tampered := append([]byte(nil), output.Bytes()...)
	tampered[len(tampered)-3] ^= 1
	if _, err := VerifyEncryptedHashChain(bytes.NewReader(tampered), AuditEncryptionKeyring{"key": key}); !errors.Is(err, ErrAuditEncryptionCorrupt) {
		t.Fatalf("tampered VerifyEncryptedHashChain() error = %v", err)
	}
	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	var firstEnvelope, secondEnvelope encryptedAuditEnvelope
	if err := json.Unmarshal([]byte(lines[0]), &firstEnvelope); err != nil {
		t.Fatalf("decode first envelope: %v", err)
	}
	if err := json.Unmarshal([]byte(lines[1]), &secondEnvelope); err != nil {
		t.Fatalf("decode second envelope: %v", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatalf("aes.NewCipher() error = %v", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("cipher.NewGCM() error = %v", err)
	}
	firstNonce, err := base64.RawStdEncoding.DecodeString(firstEnvelope.Nonce)
	if err != nil {
		t.Fatalf("decode first nonce: %v", err)
	}
	secondNonce, err := base64.RawStdEncoding.DecodeString(secondEnvelope.Nonce)
	if err != nil {
		t.Fatalf("decode second nonce: %v", err)
	}
	secondCiphertext, err := base64.RawStdEncoding.DecodeString(secondEnvelope.Ciphertext)
	if err != nil {
		t.Fatalf("decode second ciphertext: %v", err)
	}
	secondPlaintext, err := gcm.Open(nil, secondNonce, secondCiphertext, []byte("key"))
	if err != nil {
		t.Fatalf("decrypt second envelope: %v", err)
	}
	secondEnvelope.Nonce = base64.RawStdEncoding.EncodeToString(firstNonce)
	secondEnvelope.Ciphertext = base64.RawStdEncoding.EncodeToString(gcm.Seal(nil, firstNonce, secondPlaintext, []byte("key")))
	duplicateNonce, err := json.Marshal(secondEnvelope)
	if err != nil {
		t.Fatalf("encode duplicate nonce envelope: %v", err)
	}
	duplicateNonce = append(append([]byte(lines[0]), '\n'), duplicateNonce...)
	if _, err := VerifyEncryptedHashChain(bytes.NewReader(duplicateNonce), AuditEncryptionKeyring{"key": key}); !errors.Is(err, ErrAuditEncryptionCorrupt) {
		t.Fatalf("duplicate nonce VerifyEncryptedHashChain() error = %v", err)
	}
	if _, err := VerifyEncryptedHashChain(bytes.NewReader(output.Bytes()), AuditEncryptionKeyring{"other": key}); !errors.Is(err, ErrAuditEncryptionKeyUnavailable) {
		t.Fatalf("unknown key VerifyEncryptedHashChain() error = %v", err)
	}
	if err := encrypted.RotateKey("key", []byte("short")); !errors.Is(err, ErrAuditEncryptionKeyInvalid) {
		t.Fatalf("invalid rotated key error = %v", err)
	}
}
