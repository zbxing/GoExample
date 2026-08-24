package httpapi

import (
	"bufio"
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
)

const (
	defaultAuditChainRecordBytes = 16 << 10
	maxAuditChainRecordBytes     = 1 << 20
)

var (
	ErrAuditChainWriterUnavailable   = errors.New("audit chain writer is unavailable")
	ErrAuditChainRecordInvalid       = errors.New("audit chain record is invalid")
	ErrAuditChainRecordTooLarge      = errors.New("audit chain record is too large")
	ErrAuditChainCorrupt             = errors.New("audit chain is corrupt")
	ErrAuditEncryptionKeyInvalid     = errors.New("audit encryption key is invalid")
	ErrAuditEncryptionKeyUnavailable = errors.New("audit encryption key is unavailable")
	ErrAuditEncryptionRecordInvalid  = errors.New("audit encryption record is invalid")
	ErrAuditEncryptionCorrupt        = errors.New("encrypted audit chain is corrupt")
)

// HashChainAuditSink serializes low-sensitivity audit records as newline-
// delimited JSON records linked by SHA-256 digests. The writer must provide
// bounded, durable delivery; the adapter cannot make an arbitrary writer
// durable or immutable by itself.
type HashChainAuditSink struct {
	writer   io.Writer
	maxBytes int
	gate     chan struct{}
	sequence uint64
	previous [sha256.Size]byte
}

// HashChainAuditSinkConfig configures the local tamper-evident audit adapter.
type HashChainAuditSinkConfig struct {
	Writer         io.Writer
	MaxRecordBytes int
}

type auditChainPayload struct {
	Sequence     uint64              `json:"sequence"`
	PreviousHash string              `json:"previous_hash"`
	Record       SecurityAuditRecord `json:"record"`
}

type auditChainEnvelope struct {
	Sequence     uint64              `json:"sequence"`
	PreviousHash string              `json:"previous_hash"`
	Record       SecurityAuditRecord `json:"record"`
	Hash         string              `json:"hash"`
}

const (
	auditEncryptionVersion  = 1
	maxAuditEncryptionKeyID = 64
)

// AuditEncryptionKeyring supplies the keys needed to decrypt an encrypted
// chain. Keeping the key ID in each envelope allows bounded key rotation
// without rewriting prior records.
type AuditEncryptionKeyring map[string][]byte

// EncryptedAuditWriter encrypts each newline-delimited hash-chain record with
// AES-256-GCM before it reaches the deployment writer. The deployment remains
// responsible for protecting the keyring and making the writer durable.
type EncryptedAuditWriter struct {
	writer   io.Writer
	keyID    string
	key      []byte
	maxBytes int
	gate     chan struct{}
}

// EncryptedAuditWriterConfig configures the encrypted audit writer. Keys must
// be exactly 32 bytes and key IDs must be bounded printable tokens.
type EncryptedAuditWriterConfig struct {
	Writer         io.Writer
	KeyID          string
	Key            []byte
	MaxRecordBytes int
}

type encryptedAuditEnvelope struct {
	Version    int    `json:"version"`
	KeyID      string `json:"key_id"`
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

// NewEncryptedAuditWriter creates an AES-256-GCM writer for hash-chain lines.
// A zero MaxRecordBytes uses the same 16 KiB plaintext line bound as the hash
// chain; configured bounds must be between 512 bytes and 1 MiB.
func NewEncryptedAuditWriter(config EncryptedAuditWriterConfig) (*EncryptedAuditWriter, error) {
	maxBytes := config.MaxRecordBytes
	if maxBytes == 0 {
		maxBytes = defaultAuditChainRecordBytes
	}
	if config.Writer == nil {
		return nil, ErrAuditChainWriterUnavailable
	}
	if maxBytes < 512 || maxBytes > maxAuditChainRecordBytes {
		return nil, ErrAuditChainRecordTooLarge
	}
	if !validAuditEncryptionKeyID(config.KeyID) || len(config.Key) != 32 {
		return nil, ErrAuditEncryptionKeyInvalid
	}
	writer := &EncryptedAuditWriter{
		writer:   config.Writer,
		keyID:    config.KeyID,
		key:      append([]byte(nil), config.Key...),
		maxBytes: maxBytes,
		gate:     make(chan struct{}, 1),
	}
	writer.gate <- struct{}{}
	return writer, nil
}

var _ io.Writer = (*EncryptedAuditWriter)(nil)

// RotateKey changes only the encryption key. The wrapped hash-chain sink keeps
// sequence and digest state, so records before and after rotation remain one
// verifiable chain.
func (writer *EncryptedAuditWriter) RotateKey(keyID string, key []byte) error {
	if writer == nil || writer.writer == nil || writer.gate == nil {
		return ErrAuditChainWriterUnavailable
	}
	if !validAuditEncryptionKeyID(keyID) || len(key) != 32 {
		return ErrAuditEncryptionKeyInvalid
	}
	<-writer.gate
	defer func() { writer.gate <- struct{}{} }()
	writer.keyID = keyID
	writer.key = append(writer.key[:0], key...)
	return nil
}

// Write encrypts exactly one newline-delimited hash-chain record. It returns
// the plaintext byte count on success so it composes with io.Writer callers.
func (writer *EncryptedAuditWriter) Write(plaintext []byte) (int, error) {
	if writer == nil || writer.writer == nil || writer.gate == nil {
		return 0, ErrAuditChainWriterUnavailable
	}
	if len(plaintext) <= 1 || len(plaintext) > writer.maxBytes || plaintext[len(plaintext)-1] != '\n' ||
		bytes.Contains(plaintext[:len(plaintext)-1], []byte{'\n'}) {
		return 0, ErrAuditEncryptionRecordInvalid
	}
	<-writer.gate
	defer func() { writer.gate <- struct{}{} }()
	block, err := aes.NewCipher(writer.key)
	if err != nil {
		return 0, ErrAuditEncryptionKeyInvalid
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return 0, ErrAuditEncryptionKeyInvalid
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return 0, ErrAuditEncryptionRecordInvalid
	}
	ciphertext := gcm.Seal(nil, nonce, plaintext, []byte(writer.keyID))
	envelope, err := json.Marshal(encryptedAuditEnvelope{
		Version: auditEncryptionVersion, KeyID: writer.keyID,
		Nonce:      base64.RawStdEncoding.EncodeToString(nonce),
		Ciphertext: base64.RawStdEncoding.EncodeToString(ciphertext),
	})
	if err != nil || len(envelope)+1 > maxAuditEncryptionEnvelopeBytes(writer.maxBytes) {
		return 0, ErrAuditEncryptionRecordInvalid
	}
	envelope = append(envelope, '\n')
	n, writeErr := writer.writer.Write(envelope)
	if writeErr != nil {
		return 0, writeErr
	}
	if n != len(envelope) {
		return 0, io.ErrShortWrite
	}
	return len(plaintext), nil
}

func maxAuditEncryptionEnvelopeBytes(plaintextBytes int) int {
	// Base64 expansion plus envelope fields stays bounded below the scanner
	// limit while retaining the configured plaintext record limit.
	return plaintextBytes*2 + 4096
}

// VerifyEncryptedHashChain decrypts encrypted records using the supplied
// keyring and then validates the same sequence/hash/record contract as
// VerifyHashChain. Unknown key IDs fail closed.
func VerifyEncryptedHashChain(reader io.Reader, keyring AuditEncryptionKeyring) (int, error) {
	if reader == nil {
		return 0, ErrAuditChainWriterUnavailable
	}
	verifier := newAuditChainVerifier()
	seenNonces := make(map[string]map[string]struct{})
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), maxAuditChainRecordBytes*2+4096)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 || len(line) > maxAuditChainRecordBytes*2+4096 {
			return verifier.count, ErrAuditEncryptionCorrupt
		}
		var envelope encryptedAuditEnvelope
		decoder := json.NewDecoder(bytes.NewReader(line))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&envelope); err != nil || envelope.Version != auditEncryptionVersion ||
			!validAuditEncryptionKeyID(envelope.KeyID) {
			return verifier.count, ErrAuditEncryptionCorrupt
		}
		if err := decoder.Decode(&struct{}{}); err != io.EOF {
			return verifier.count, ErrAuditEncryptionCorrupt
		}
		key, ok := keyring[envelope.KeyID]
		if !ok {
			return verifier.count, ErrAuditEncryptionKeyUnavailable
		}
		if len(key) != 32 {
			return verifier.count, ErrAuditEncryptionKeyInvalid
		}
		nonce, err := base64.RawStdEncoding.DecodeString(envelope.Nonce)
		if err != nil || len(nonce) != 12 {
			return verifier.count, ErrAuditEncryptionCorrupt
		}
		nonceText := base64.RawStdEncoding.EncodeToString(nonce)
		if seenNonces[envelope.KeyID] == nil {
			seenNonces[envelope.KeyID] = make(map[string]struct{})
		}
		if _, exists := seenNonces[envelope.KeyID][nonceText]; exists {
			return verifier.count, ErrAuditEncryptionCorrupt
		}
		seenNonces[envelope.KeyID][nonceText] = struct{}{}
		ciphertext, err := base64.RawStdEncoding.DecodeString(envelope.Ciphertext)
		if err != nil || len(ciphertext) < 16 {
			return verifier.count, ErrAuditEncryptionCorrupt
		}
		block, err := aes.NewCipher(key)
		if err != nil {
			return verifier.count, ErrAuditEncryptionKeyInvalid
		}
		gcm, err := cipher.NewGCM(block)
		if err != nil {
			return verifier.count, ErrAuditEncryptionKeyInvalid
		}
		plaintext, err := gcm.Open(nil, nonce, ciphertext, []byte(envelope.KeyID))
		if err != nil || len(plaintext) == 0 || plaintext[len(plaintext)-1] != '\n' ||
			bytes.Contains(plaintext[:len(plaintext)-1], []byte{'\n'}) {
			return verifier.count, ErrAuditEncryptionCorrupt
		}
		if err := verifier.verifyLine(plaintext[:len(plaintext)-1]); err != nil {
			return verifier.count, ErrAuditEncryptionCorrupt
		}
	}
	if err := scanner.Err(); err != nil {
		return verifier.count, err
	}
	return verifier.count, nil
}

// NewHashChainAuditSink creates a serialized audit sink. A zero MaxRecordBytes
// uses a 16 KiB bound; configured bounds must be between 512 bytes and 1 MiB.
func NewHashChainAuditSink(config HashChainAuditSinkConfig) (*HashChainAuditSink, error) {
	if config.Writer == nil {
		return nil, ErrAuditChainWriterUnavailable
	}
	maxBytes := config.MaxRecordBytes
	if maxBytes == 0 {
		maxBytes = defaultAuditChainRecordBytes
	}
	if maxBytes < 512 || maxBytes > maxAuditChainRecordBytes {
		return nil, ErrAuditChainRecordTooLarge
	}
	sink := &HashChainAuditSink{
		writer:   config.Writer,
		maxBytes: maxBytes,
		gate:     make(chan struct{}, 1),
	}
	sink.gate <- struct{}{}
	return sink, nil
}

var _ SecurityAuditSink = (*HashChainAuditSink)(nil)

// WriteSecurityAudit appends one linked JSON record. A canceled context can
// stop a caller waiting behind another write, but cannot interrupt a writer
// that ignores context; deployments must provide a bounded writer.
func (sink *HashChainAuditSink) WriteSecurityAudit(ctx context.Context, record SecurityAuditRecord) error {
	if sink == nil || sink.writer == nil || sink.gate == nil {
		return ErrAuditChainWriterUnavailable
	}
	if ctx == nil {
		return ErrAuditChainRecordInvalid
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-sink.gate:
	}
	defer func() { sink.gate <- struct{}{} }()
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validateAuditChainRecord(record); err != nil {
		return err
	}
	record.Timestamp = record.Timestamp.UTC()
	sequence := sink.sequence + 1
	previousHash := hex.EncodeToString(sink.previous[:])
	payload := auditChainPayload{Sequence: sequence, PreviousHash: previousHash, Record: record}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return ErrAuditChainRecordInvalid
	}
	digest := auditChainDigest(previousHash, payloadBytes)
	envelopeBytes, err := json.Marshal(auditChainEnvelope{
		Sequence: sequence, PreviousHash: previousHash, Record: record, Hash: hex.EncodeToString(digest[:]),
	})
	if err != nil || len(envelopeBytes)+1 > sink.maxBytes {
		return ErrAuditChainRecordTooLarge
	}
	line := append(envelopeBytes, '\n')
	if n, writeErr := sink.writer.Write(line); writeErr != nil {
		return writeErr
	} else if n != len(line) {
		return io.ErrShortWrite
	}
	sink.sequence = sequence
	sink.previous = digest
	return nil
}

// VerifyHashChain validates newline-delimited records emitted by
// HashChainAuditSink and returns the number of valid records.
func VerifyHashChain(reader io.Reader) (int, error) {
	if reader == nil {
		return 0, ErrAuditChainWriterUnavailable
	}
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), maxAuditChainRecordBytes)
	verifier := newAuditChainVerifier()
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 || len(line) > maxAuditChainRecordBytes {
			return verifier.count, ErrAuditChainCorrupt
		}
		if err := verifier.verifyLine(line); err != nil {
			return verifier.count, ErrAuditChainCorrupt
		}
	}
	if err := scanner.Err(); err != nil {
		return verifier.count, err
	}
	return verifier.count, nil
}

type auditChainVerifier struct {
	count    int
	previous [sha256.Size]byte
}

func newAuditChainVerifier() *auditChainVerifier { return &auditChainVerifier{} }

func (verifier *auditChainVerifier) verifyLine(line []byte) error {
	var envelope auditChainEnvelope
	decoder := json.NewDecoder(bytes.NewReader(line))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&envelope); err != nil || envelope.Sequence != uint64(verifier.count+1) {
		return ErrAuditChainCorrupt
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return ErrAuditChainCorrupt
	}
	if err := validateAuditChainRecord(envelope.Record); err != nil {
		return ErrAuditChainCorrupt
	}
	previousHash := hex.EncodeToString(verifier.previous[:])
	if envelope.PreviousHash != previousHash || len(envelope.Hash) != sha256.Size*2 {
		return ErrAuditChainCorrupt
	}
	payloadBytes, err := json.Marshal(auditChainPayload{
		Sequence: envelope.Sequence, PreviousHash: envelope.PreviousHash, Record: envelope.Record,
	})
	if err != nil {
		return ErrAuditChainCorrupt
	}
	digest := auditChainDigest(envelope.PreviousHash, payloadBytes)
	if envelope.Hash != hex.EncodeToString(digest[:]) {
		return ErrAuditChainCorrupt
	}
	verifier.previous = digest
	verifier.count++
	return nil
}

func auditChainDigest(previousHash string, payload []byte) [sha256.Size]byte {
	hash := sha256.New()
	_, _ = hash.Write([]byte(previousHash))
	_, _ = hash.Write(payload)
	var digest [sha256.Size]byte
	copy(digest[:], hash.Sum(nil))
	return digest
}

func validateAuditChainRecord(record SecurityAuditRecord) error {
	if record.Timestamp.IsZero() || record.RequestID == "" ||
		!boundedAuditValue(record.RequestID) || !boundedAuditValue(record.Event) ||
		!boundedAuditValue(record.Outcome) || !boundedAuditValue(record.Reason) ||
		!boundedAuditValue(record.Target) || !boundedAuditValue(record.TraceID) ||
		!boundedAuditValue(record.SpanID) || !boundedAuditValue(record.ActorID) {
		return ErrAuditChainRecordInvalid
	}
	if !auditEventReasonTargetValid(record) {
		return ErrAuditChainRecordInvalid
	}
	if record.ActorID != "" && !(record.Event == "login" && record.Outcome == "success") {
		return ErrAuditChainRecordInvalid
	}
	return nil
}

func boundedAuditValue(value string) bool {
	if len(value) > 128 {
		return false
	}
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return false
		}
	}
	return true
}

func validAuditEncryptionKeyID(value string) bool {
	if value == "" || len(value) > maxAuditEncryptionKeyID {
		return false
	}
	for index := 0; index < len(value); index++ {
		character := value[index]
		if character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' || character == '-' || character == '_' || character == '.' {
			continue
		}
		return false
	}
	return true
}

func auditEventReasonTargetValid(record SecurityAuditRecord) bool {
	allowed := map[string]map[string]map[string]bool{
		"login": {
			"success": {"credentials_valid": true, "oidc_started": true, "oidc_callback_valid": true, "oidc_session_started": true},
			"failure": {"invalid_credentials": true, "token_issue_failed": true, "oidc_start_failed": true, "oidc_callback_invalid": true, "oidc_exchange_failed": true, "oidc_session_failed": true},
			"limited": {"rate_limited": true},
		},
		"bearer":        {"failure": {"token_missing": true, "token_invalid": true}},
		"session":       {"success": {"session_revoked": true}, "failure": {"session_missing": true, "session_invalid": true, "session_revoke_failed": true}},
		"authorization": {"failure": {"role_required": true, "resource_invalid": true, "resource_denied": true}},
		"diagnostics":   {"success": {"token_valid": true}, "failure": {"token_invalid": true}},
	}
	reasons, ok := allowed[record.Event]
	if !ok || !reasons[record.Outcome][record.Reason] {
		return false
	}
	validTargets := map[string]bool{
		"demo_auth": true, "oidc_browser": true, "api": true, "application_query": true,
		"application_command": true, "metrics": true, "pprof": true,
	}
	return validTargets[record.Target]
}
