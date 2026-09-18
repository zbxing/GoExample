package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestJWKSVerifierValidatesRS256ClaimsAndRefreshesRotatedKey(t *testing.T) {
	now := time.Date(2026, time.August, 21, 12, 0, 0, 0, time.UTC)
	firstKey := generateRSAKey(t, 2048)
	secondKey := generateRSAKey(t, 2048)
	var document atomic.Value
	document.Store(jwksJSON(t, "first", &firstKey.PublicKey))
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write(document.Load().([]byte))
	}))
	defer server.Close()

	verifier, err := NewJWKSVerifier(context.Background(), JWKSConfig{
		Issuer:          "https://issuer.example",
		Audience:        "goexample-api",
		JWKSURL:         server.URL,
		RefreshInterval: time.Minute,
		MaxTokenAge:     10 * time.Minute,
		Now:             func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewJWKSVerifier() error = %v", err)
	}

	firstToken := signOIDCTestToken(t, firstKey, "first", now)
	claims, err := verifier.VerifyToken(context.Background(), firstToken)
	if err != nil {
		t.Fatalf("VerifyToken(first) error = %v", err)
	}
	if claims.Subject != "oidc-user-1" || claims.Username != "operator" || claims.RoleIDs[0] != "demo" {
		t.Fatalf("claims = %#v", claims)
	}

	document.Store(jwksJSON(t, "second", &secondKey.PublicKey))
	now = now.Add(unknownKeyRefreshInterval + time.Second)
	secondToken := signOIDCTestToken(t, secondKey, "second", now)
	if _, err := verifier.VerifyToken(context.Background(), secondToken); err != nil {
		t.Fatalf("VerifyToken(rotated) error = %v", err)
	}
	if got := requests.Load(); got != 2 {
		t.Fatalf("JWKS requests = %d, want 2", got)
	}
	if _, err := verifier.VerifyToken(context.Background(), firstToken); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("retired key error = %v", err)
	}
}

func TestJWKSVerifierValidatesIDTokenNonceAudienceAndAge(t *testing.T) {
	now := time.Date(2026, time.August, 23, 5, 0, 0, 0, time.UTC)
	key := generateRSAKey(t, 2048)
	server := newJWKSServer(t, jwksJSON(t, "id-token", &key.PublicKey))
	verifier := newTestJWKSVerifier(t, server.URL, func() time.Time { return now })
	claims := IDTokenClaims{
		Nonce: "nonce-123",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "https://issuer.example",
			Subject:   "subject-123",
			Audience:  jwt.ClaimStrings{"goexample-api"},
			ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(now.Add(-time.Minute)),
		},
		AuthTime: jwt.NewNumericDate(now.Add(-2 * time.Minute)),
	}
	token := signIDToken(t, key, "id-token", claims)
	verified, err := verifier.VerifyIDToken(context.Background(), token, "nonce-123")
	if err != nil {
		t.Fatalf("VerifyIDToken() error = %v", err)
	}
	if verified.Subject != "subject-123" || verified.Nonce != "nonce-123" {
		t.Fatalf("verified ID token claims = %#v", verified)
	}

	invalid := []struct {
		name   string
		mutate func(*IDTokenClaims)
	}{
		{name: "nonce mismatch", mutate: func(claims *IDTokenClaims) { claims.Nonce = "other" }},
		{name: "missing subject", mutate: func(claims *IDTokenClaims) { claims.Subject = "" }},
		{name: "missing nonce", mutate: func(claims *IDTokenClaims) { claims.Nonce = "" }},
		{name: "multiple audiences without azp", mutate: func(claims *IDTokenClaims) { claims.Audience = jwt.ClaimStrings{"goexample-api", "other-client"} }},
		{name: "wrong azp", mutate: func(claims *IDTokenClaims) {
			claims.Audience = jwt.ClaimStrings{"goexample-api", "other-client"}
			claims.Azp = "other-client"
		}},
		{name: "stale issued at", mutate: func(claims *IDTokenClaims) {
			claims.IssuedAt = jwt.NewNumericDate(now.Add(-defaultOIDCMaxTokenAge - time.Minute))
		}},
		{name: "future auth time", mutate: func(claims *IDTokenClaims) { claims.AuthTime = jwt.NewNumericDate(now.Add(time.Minute)) }},
	}
	for _, test := range invalid {
		t.Run(test.name, func(t *testing.T) {
			candidate := claims
			test.mutate(&candidate)
			if _, err := verifier.VerifyIDToken(context.Background(), signIDToken(t, key, "id-token", candidate), "nonce-123"); !errors.Is(err, ErrInvalidToken) {
				t.Fatalf("VerifyIDToken() error = %v", err)
			}
		})
	}
}

type idTokenClaimsWithAccessTokenHash struct {
	IDTokenClaims
	AccessTokenHash any `json:"at_hash"`
}

func TestJWKSVerifierBindsOptionalIDTokenAccessTokenHash(t *testing.T) {
	now := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
	key := generateRSAKey(t, 2048)
	server := newJWKSServer(t, jwksJSON(t, "at-hash", &key.PublicKey))
	verifier := newTestJWKSVerifier(t, server.URL, func() time.Time { return now })
	const accessToken = "opaque-access-token"
	claims := IDTokenClaims{
		Nonce: "nonce-123",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "https://issuer.example",
			Subject:   "subject-123",
			Audience:  jwt.ClaimStrings{"goexample-api"},
			ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(now.Add(-time.Minute)),
		},
	}
	withHash := func(value any) string {
		t.Helper()
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, idTokenClaimsWithAccessTokenHash{
			IDTokenClaims:   claims,
			AccessTokenHash: value,
		})
		token.Header["kid"] = "at-hash"
		rawToken, err := token.SignedString(key)
		if err != nil {
			t.Fatalf("SignedString(at_hash) error = %v", err)
		}
		return rawToken
	}

	validToken := withHash(oidcAccessTokenHash(accessToken))
	verified, err := verifier.VerifyIDTokenWithAccessToken(context.Background(), validToken, "nonce-123", accessToken)
	if err != nil || verified.Subject != claims.Subject {
		t.Fatalf("VerifyIDTokenWithAccessToken(valid) = %#v, %v", verified, err)
	}
	if _, err := verifier.VerifyIDToken(context.Background(), validToken, "nonce-123"); err != nil {
		t.Fatalf("legacy VerifyIDToken() rejected a valid token with at_hash: %v", err)
	}
	withoutHash := signIDToken(t, key, "at-hash", claims)
	if _, err := verifier.VerifyIDTokenWithAccessToken(context.Background(), withoutHash, "nonce-123", accessToken); err != nil {
		t.Fatalf("VerifyIDTokenWithAccessToken(missing at_hash) error = %v", err)
	}

	invalidClaims := []struct {
		name  string
		value any
	}{
		{name: "mismatch", value: oidcAccessTokenHash("other-access-token")},
		{name: "empty", value: ""},
		{name: "null", value: nil},
		{name: "non-string", value: 7},
		{name: "padded base64url", value: oidcAccessTokenHash(accessToken) + "=="},
	}
	for _, test := range invalidClaims {
		t.Run(test.name, func(t *testing.T) {
			if _, err := verifier.VerifyIDTokenWithAccessToken(context.Background(), withHash(test.value), "nonce-123", accessToken); !errors.Is(err, ErrInvalidToken) {
				t.Fatalf("VerifyIDTokenWithAccessToken() error = %v", err)
			}
		})
	}
	for _, invalidAccessToken := range []string{"", " access-token", "access-token\n", strings.Repeat("x", maxAccessTokenBytes+1)} {
		if _, err := verifier.VerifyIDTokenWithAccessToken(context.Background(), validToken, "nonce-123", invalidAccessToken); !errors.Is(err, ErrInvalidToken) {
			t.Fatalf("invalid access token error = %v", err)
		}
	}
}

func TestJWKSVerifierEnforcesIDTokenAssurancePolicy(t *testing.T) {
	now := time.Date(2026, time.August, 24, 9, 0, 0, 0, time.UTC)
	key := generateRSAKey(t, 2048)
	server := newJWKSServer(t, jwksJSON(t, "assurance", &key.PublicKey))
	requiredAMR := []string{"pwd", "otp"}
	verifier, err := NewJWKSVerifier(context.Background(), JWKSConfig{
		Issuer:      "https://issuer.example",
		Audience:    "goexample-api",
		JWKSURL:     server.URL,
		RequiredACR: "urn:example:assurance:mfa",
		RequiredAMR: requiredAMR,
		MaxAuthAge:  5 * time.Minute,
		Now:         func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewJWKSVerifier() error = %v", err)
	}
	requiredAMR[1] = "sms"

	validClaims := func() IDTokenClaims {
		return IDTokenClaims{
			Nonce:    "nonce-123",
			AuthTime: jwt.NewNumericDate(now.Add(-2 * time.Minute)),
			Acr:      "urn:example:assurance:mfa",
			Amr:      []string{"pwd", "otp", "hwk"},
			RegisteredClaims: jwt.RegisteredClaims{
				Issuer:    "https://issuer.example",
				Subject:   "subject-123",
				Audience:  jwt.ClaimStrings{"goexample-api"},
				ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute)),
				IssuedAt:  jwt.NewNumericDate(now.Add(-time.Minute)),
			},
		}
	}
	verified, err := verifier.VerifyIDToken(context.Background(), signIDToken(t, key, "assurance", validClaims()), "nonce-123")
	if err != nil {
		t.Fatalf("VerifyIDToken() error = %v", err)
	}
	if verified.Acr != "urn:example:assurance:mfa" || len(verified.Amr) != 3 {
		t.Fatalf("verified assurance claims = %#v", verified)
	}
	if _, err := verifier.VerifyToken(context.Background(), signOIDCTestToken(t, key, "assurance", now)); err != nil {
		t.Fatalf("assurance policy changed access-token verification: %v", err)
	}
	freshnessOnly, err := NewJWKSVerifier(context.Background(), JWKSConfig{
		Issuer: "https://issuer.example", Audience: "goexample-api", JWKSURL: server.URL,
		MaxAuthAge: 5 * time.Minute, Now: func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewJWKSVerifier(freshness only) error = %v", err)
	}
	freshnessClaims := validClaims()
	freshnessClaims.Acr = ""
	freshnessClaims.Amr = []string{"provider-specific", "provider-specific"}
	if _, err := freshnessOnly.VerifyIDToken(context.Background(), signIDToken(t, key, "assurance", freshnessClaims), "nonce-123"); err != nil {
		t.Fatalf("freshness-only VerifyIDToken() error = %v", err)
	}
	freshnessClaims.AuthTime = nil
	if _, err := freshnessOnly.VerifyIDToken(context.Background(), signIDToken(t, key, "assurance", freshnessClaims), "nonce-123"); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("freshness-only missing auth_time error = %v", err)
	}

	invalid := []struct {
		name   string
		mutate func(*IDTokenClaims)
	}{
		{name: "missing ACR", mutate: func(claims *IDTokenClaims) { claims.Acr = "" }},
		{name: "wrong ACR", mutate: func(claims *IDTokenClaims) { claims.Acr = "urn:example:assurance:single-factor" }},
		{name: "missing required AMR", mutate: func(claims *IDTokenClaims) { claims.Amr = []string{"pwd"} }},
		{name: "duplicate AMR", mutate: func(claims *IDTokenClaims) { claims.Amr = []string{"pwd", "otp", "otp"} }},
		{name: "missing auth time", mutate: func(claims *IDTokenClaims) { claims.AuthTime = nil }},
		{name: "stale auth time", mutate: func(claims *IDTokenClaims) { claims.AuthTime = jwt.NewNumericDate(now.Add(-6 * time.Minute)) }},
		{name: "malformed ACR", mutate: func(claims *IDTokenClaims) { claims.Acr += "\n" }},
		{name: "unbounded AMR count", mutate: func(claims *IDTokenClaims) {
			claims.Amr = make([]string, maxOIDCAssuranceValues+1)
			for index := range claims.Amr {
				claims.Amr[index] = fmt.Sprintf("method-%d", index)
			}
		}},
	}
	for _, test := range invalid {
		t.Run(test.name, func(t *testing.T) {
			claims := validClaims()
			test.mutate(&claims)
			if _, err := verifier.VerifyIDToken(context.Background(), signIDToken(t, key, "assurance", claims), "nonce-123"); !errors.Is(err, ErrInvalidToken) {
				t.Fatalf("VerifyIDToken() error = %v", err)
			}
		})
	}
}

func TestJWKSVerifierRejectsAlgorithmClaimsAndUnboundedTokens(t *testing.T) {
	now := time.Date(2026, time.August, 21, 12, 0, 0, 0, time.UTC)
	key := generateRSAKey(t, 2048)
	server := newJWKSServer(t, jwksJSON(t, "current", &key.PublicKey))
	verifier := newTestJWKSVerifier(t, server.URL, func() time.Time { return now })

	wrongAlgorithm := jwt.NewWithClaims(jwt.SigningMethodHS256, oidcTestClaims(now))
	wrongAlgorithm.Header["kid"] = "current"
	rawWrongAlgorithm, err := wrongAlgorithm.SignedString([]byte("not-an-rsa-key"))
	if err != nil {
		t.Fatalf("SignedString(HS256) error = %v", err)
	}

	tests := []struct {
		name  string
		token string
	}{
		{name: "empty", token: ""},
		{name: "oversized", token: strings.Repeat("x", maxAccessTokenBytes+1)},
		{name: "wrong algorithm", token: rawWrongAlgorithm},
		{name: "wrong audience", token: signOIDCTestTokenWithClaims(t, key, "current", mutateOIDCClaims(now, func(claims *Claims) { claims.Audience = jwt.ClaimStrings{"other-api"} }))},
		{name: "missing token id", token: signOIDCTestTokenWithClaims(t, key, "current", mutateOIDCClaims(now, func(claims *Claims) { claims.ID = "" }))},
		{name: "overage", token: signOIDCTestTokenWithClaims(t, key, "current", mutateOIDCClaims(now, func(claims *Claims) {
			claims.IssuedAt = jwt.NewNumericDate(now.Add(-20 * time.Minute))
			claims.NotBefore = jwt.NewNumericDate(now.Add(-20 * time.Minute))
		}))},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := verifier.VerifyToken(context.Background(), test.token); !errors.Is(err, ErrInvalidToken) {
				t.Fatalf("VerifyToken() error = %v", err)
			}
		})
	}
}

func TestJWKSVerifierCollapsesUnknownKeyRefreshes(t *testing.T) {
	now := time.Date(2026, time.August, 21, 12, 0, 0, 0, time.UTC)
	knownKey := generateRSAKey(t, 2048)
	unknownKey := generateRSAKey(t, 2048)
	knownDocument := jwksJSON(t, "known", &knownKey.PublicKey)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write(knownDocument)
	}))
	defer server.Close()
	verifier := newTestJWKSVerifier(t, server.URL, func() time.Time { return now })
	now = now.Add(unknownKeyRefreshInterval + time.Second)
	rawToken := signOIDCTestToken(t, unknownKey, "unknown", now)

	const callers = 24
	var wait sync.WaitGroup
	errorsObserved := make(chan error, callers)
	for range callers {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, err := verifier.VerifyToken(context.Background(), rawToken)
			errorsObserved <- err
		}()
	}
	wait.Wait()
	close(errorsObserved)
	for err := range errorsObserved {
		if !errors.Is(err, ErrInvalidToken) {
			t.Fatalf("VerifyToken() error = %v", err)
		}
	}
	if got := requests.Load(); got != 2 {
		t.Fatalf("JWKS requests = %d, want initial plus one collapsed refresh", got)
	}
}

func TestJWKSVerifierFailsClosedOnExpiredCacheAndCanceledRefresh(t *testing.T) {
	now := time.Date(2026, time.August, 21, 12, 0, 0, 0, time.UTC)
	key := generateRSAKey(t, 2048)
	var block atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if block.Load() {
			<-request.Context().Done()
			return
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write(jwksJSON(t, "current", &key.PublicKey))
	}))
	defer server.Close()
	verifier := newTestJWKSVerifier(t, server.URL, func() time.Time { return now })
	rawToken := signOIDCTestToken(t, key, "current", now)

	now = now.Add(defaultJWKSRefreshInterval + time.Second)
	block.Store(true)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	started := time.Now()
	if _, err := verifier.VerifyToken(ctx, rawToken); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("VerifyToken() error = %v", err)
	}
	if elapsed := time.Since(started); elapsed > 500*time.Millisecond {
		t.Fatalf("canceled refresh took %s", elapsed)
	}
}

func TestNewJWKSVerifierRejectsUnsafeConfigurationAndDocuments(t *testing.T) {
	validKey := generateRSAKey(t, 2048)
	mutateConfig := func(config JWKSConfig, mutate func(*JWKSConfig)) JWKSConfig {
		mutate(&config)
		return config
	}
	base := JWKSConfig{
		Issuer:          "https://issuer.example",
		Audience:        "goexample-api",
		JWKSURL:         "https://issuer.example/.well-known/jwks.json",
		HTTPTimeout:     time.Second,
		RefreshInterval: time.Minute,
		MaxTokenAge:     10 * time.Minute,
	}
	configTests := []struct {
		name   string
		config JWKSConfig
	}{
		{name: "missing issuer", config: mutateConfig(base, func(config *JWKSConfig) { config.Issuer = "" })},
		{name: "credential URL", config: mutateConfig(base, func(config *JWKSConfig) { config.JWKSURL = "https://user:secret@issuer.example/jwks" })},
		{name: "query URL", config: mutateConfig(base, func(config *JWKSConfig) { config.JWKSURL += "?secret=value" })},
		{name: "unbounded timeout", config: mutateConfig(base, func(config *JWKSConfig) { config.HTTPTimeout = 11 * time.Second })},
		{name: "rapid refresh", config: mutateConfig(base, func(config *JWKSConfig) { config.RefreshInterval = time.Second })},
		{name: "unbounded token age", config: mutateConfig(base, func(config *JWKSConfig) { config.MaxTokenAge = 25 * time.Hour })},
		{name: "required ACR without auth age", config: mutateConfig(base, func(config *JWKSConfig) { config.RequiredACR = "urn:example:mfa" })},
		{name: "invalid required ACR", config: mutateConfig(base, func(config *JWKSConfig) {
			config.RequiredACR = " urn:example:mfa"
			config.MaxAuthAge = time.Minute
		})},
		{name: "duplicate required AMR", config: mutateConfig(base, func(config *JWKSConfig) {
			config.RequiredAMR = []string{"pwd", "pwd"}
			config.MaxAuthAge = time.Minute
		})},
		{name: "unbounded auth age", config: mutateConfig(base, func(config *JWKSConfig) { config.MaxAuthAge = 25 * time.Hour })},
	}
	for _, test := range configTests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := NewJWKSVerifier(context.Background(), test.config); err == nil || strings.Contains(err.Error(), "secret") {
				t.Fatalf("NewJWKSVerifier() error = %v", err)
			}
		})
	}

	encodeDocument := func(document map[string]any) []byte {
		body, err := json.Marshal(document)
		if err != nil {
			t.Fatalf("json.Marshal() error = %v", err)
		}
		return body
	}
	keyForBits := func(bits int) map[string]any {
		key := validKey
		if bits != 2048 {
			key = generateRSAKey(t, bits)
		}
		return jwkMap("current", &key.PublicKey)
	}
	documentTests := []struct {
		name string
		body []byte
	}{
		{name: "malformed", body: []byte(`{"keys":`)},
		{name: "empty", body: []byte(`{"keys":[]}`)},
		{name: "weak RSA", body: encodeDocument(map[string]any{"keys": []any{keyForBits(1024)}})},
		{name: "duplicate kid", body: encodeDocument(map[string]any{"keys": []any{keyForBits(2048), keyForBits(2048)}})},
		{name: "oversized", body: []byte(strings.Repeat("x", maxJWKSResponseBytes+1))},
	}
	for _, test := range documentTests {
		t.Run(test.name, func(t *testing.T) {
			server := newJWKSServer(t, test.body)
			_, err := NewJWKSVerifier(context.Background(), JWKSConfig{
				Issuer: "https://issuer.example", Audience: "goexample-api", JWKSURL: server.URL,
			})
			if !errors.Is(err, ErrJWKSUnavailable) {
				t.Fatalf("NewJWKSVerifier() error = %v", err)
			}
		})
	}
}

func newTestJWKSVerifier(t *testing.T, endpoint string, now func() time.Time) *JWKSVerifier {
	t.Helper()
	verifier, err := NewJWKSVerifier(context.Background(), JWKSConfig{
		Issuer: "https://issuer.example", Audience: "goexample-api", JWKSURL: endpoint, Now: now,
	})
	if err != nil {
		t.Fatalf("NewJWKSVerifier() error = %v", err)
	}
	return verifier
}

func newJWKSServer(t *testing.T, body []byte) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write(body)
	}))
	t.Cleanup(server.Close)
	return server
}

func generateRSAKey(t *testing.T, bits int) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, bits)
	if err != nil {
		t.Fatalf("rsa.GenerateKey() error = %v", err)
	}
	return key
}

func jwksJSON(t *testing.T, keyID string, key *rsa.PublicKey) []byte {
	t.Helper()
	body, err := json.Marshal(map[string]any{"keys": []any{jwkMap(keyID, key)}})
	if err != nil {
		t.Fatalf("json.Marshal(JWKS) error = %v", err)
	}
	return body
}

func jwkMap(keyID string, key *rsa.PublicKey) map[string]any {
	return map[string]any{
		"kty": "RSA",
		"use": "sig",
		"alg": jwt.SigningMethodRS256.Alg(),
		"kid": keyID,
		"n":   base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
		"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
	}
}

func signOIDCTestToken(t *testing.T, key *rsa.PrivateKey, keyID string, now time.Time) string {
	t.Helper()
	return signOIDCTestTokenWithClaims(t, key, keyID, oidcTestClaims(now))
}

func signOIDCTestTokenWithClaims(t *testing.T, key *rsa.PrivateKey, keyID string, claims Claims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = keyID
	rawToken, err := token.SignedString(key)
	if err != nil {
		t.Fatalf("SignedString(RS256) error = %v", err)
	}
	return rawToken
}

func signIDToken(t *testing.T, key *rsa.PrivateKey, keyID string, claims IDTokenClaims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = keyID
	rawToken, err := token.SignedString(key)
	if err != nil {
		t.Fatalf("SignedString(ID token) error = %v", err)
	}
	return rawToken
}

func oidcTestClaims(now time.Time) Claims {
	return Claims{
		Username: "operator", DisplayName: "OIDC Operator", Email: "operator@example.test",
		RoleIDs: []string{"demo"}, RoleNames: []string{"Demo"},
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "https://issuer.example", Subject: "oidc-user-1", Audience: jwt.ClaimStrings{"goexample-api"},
			ExpiresAt: jwt.NewNumericDate(now.Add(10 * time.Minute)), NotBefore: jwt.NewNumericDate(now.Add(-time.Second)),
			IssuedAt: jwt.NewNumericDate(now), ID: fmt.Sprintf("token-%d", now.Unix()),
		},
	}
}

func mutateOIDCClaims(now time.Time, mutate func(*Claims)) Claims {
	claims := oidcTestClaims(now)
	mutate(&claims)
	return claims
}

var benchmarkAssuranceResult bool

func BenchmarkValidIDTokenAssurance(b *testing.B) {
	actual := make([]string, maxOIDCAssuranceValues)
	for index := range actual {
		actual[index] = fmt.Sprintf("method-%d", index)
	}
	required := []string{"method-1", "method-7", "method-15"}
	cases := []struct {
		name      string
		actualAMR []string
		required  []string
	}{
		{name: "full", actualAMR: actual, required: required},
		{name: "single", actualAMR: actual[:1], required: actual[:1]},
		{name: "invalid-duplicate", actualAMR: []string{"method-1", "method-1"}, required: required[:1]},
	}
	for _, test := range cases {
		b.Run(test.name, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				benchmarkAssuranceResult = validIDTokenAssurance("", test.actualAMR, "", test.required)
			}
		})
		b.Run(test.name+"-legacy", func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				benchmarkAssuranceResult = legacyValidIDTokenAssurance("", test.actualAMR, "", test.required)
			}
		})
	}
}

func legacyValidIDTokenAssurance(actualACR string, actualAMR []string, requiredACR string, requiredAMR []string) bool {
	if requiredACR == "" && len(requiredAMR) == 0 {
		return true
	}
	if actualACR != "" && !validOIDCAssuranceValue(actualACR) {
		return false
	}
	if requiredACR != "" && actualACR != requiredACR {
		return false
	}
	if len(actualAMR) > maxOIDCAssuranceValues {
		return false
	}
	seen := make(map[string]struct{}, len(actualAMR))
	for _, method := range actualAMR {
		if !validOIDCAssuranceValue(method) {
			return false
		}
		if _, exists := seen[method]; exists {
			return false
		}
		seen[method] = struct{}{}
	}
	for _, method := range requiredAMR {
		if _, exists := seen[method]; !exists {
			return false
		}
	}
	return true
}
