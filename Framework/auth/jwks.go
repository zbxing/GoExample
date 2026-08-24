package auth

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	defaultJWKSHTTPTimeout     = 3 * time.Second
	defaultJWKSRefreshInterval = 5 * time.Minute
	defaultOIDCMaxTokenAge     = 15 * time.Minute
	unknownKeyRefreshInterval  = 5 * time.Second
	maxJWKSResponseBytes       = 1 << 20
	maxJWKSKeys                = 100
	maxAccessTokenBytes        = 16 << 10
	maxOIDCAssuranceValues     = 16
	maxOIDCAssuranceValueBytes = 256
	minRSAKeyBits              = 2048
	maxRSAKeyBits              = 8192
)

var ErrJWKSUnavailable = errors.New("JWKS endpoint is unavailable or invalid")

type JWKSConfig struct {
	Issuer          string
	Audience        string
	JWKSURL         string
	HTTPTimeout     time.Duration
	RefreshInterval time.Duration
	MaxTokenAge     time.Duration
	RequiredACR     string
	RequiredAMR     []string
	MaxAuthAge      time.Duration
	HTTPClient      *http.Client
	Now             func() time.Time
}

// IDTokenClaims contains the bounded OIDC claims needed after an authorization
// code exchange. It intentionally excludes provider-specific profile data.
type IDTokenClaims struct {
	jwt.RegisteredClaims
	Nonce    string           `json:"nonce"`
	AuthTime *jwt.NumericDate `json:"auth_time,omitempty"`
	Acr      string           `json:"acr,omitempty"`
	Amr      []string         `json:"amr,omitempty"`
	Azp      string           `json:"azp,omitempty"`
}

type JWKSVerifier struct {
	issuer          string
	audience        string
	jwksURL         string
	httpTimeout     time.Duration
	refreshInterval time.Duration
	maxTokenAge     time.Duration
	requiredACR     string
	requiredAMR     []string
	maxAuthAge      time.Duration
	httpClient      *http.Client
	now             func() time.Time

	refreshMu   sync.Mutex
	stateMu     sync.RWMutex
	keys        map[string]*rsa.PublicKey
	refreshedAt time.Time
}

var _ TokenVerifier = (*JWKSVerifier)(nil)

type jwksDocument struct {
	Keys []jwk `json:"keys"`
}

type jwk struct {
	KeyType   string `json:"kty"`
	Use       string `json:"use"`
	Algorithm string `json:"alg"`
	KeyID     string `json:"kid"`
	Modulus   string `json:"n"`
	Exponent  string `json:"e"`
}

func NewJWKSVerifier(ctx context.Context, config JWKSConfig) (*JWKSVerifier, error) {
	if ctx == nil {
		return nil, errors.New("JWKS initialization context cannot be nil")
	}
	config = withJWKSDefaults(config)
	if err := validateJWKSConfig(config); err != nil {
		return nil, err
	}
	client := &http.Client{}
	if config.HTTPClient != nil {
		*client = *config.HTTPClient
	}
	client.Timeout = config.HTTPTimeout
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	verifier := &JWKSVerifier{
		issuer:          strings.TrimSpace(config.Issuer),
		audience:        strings.TrimSpace(config.Audience),
		jwksURL:         strings.TrimSpace(config.JWKSURL),
		httpTimeout:     config.HTTPTimeout,
		refreshInterval: config.RefreshInterval,
		maxTokenAge:     config.MaxTokenAge,
		requiredACR:     config.RequiredACR,
		requiredAMR:     append([]string(nil), config.RequiredAMR...),
		maxAuthAge:      config.MaxAuthAge,
		httpClient:      client,
		now:             config.Now,
	}
	if err := verifier.refresh(ctx, refreshInitial); err != nil {
		return nil, err
	}
	return verifier, nil
}

func (verifier *JWKSVerifier) Enabled() bool {
	return verifier != nil && verifier.httpClient != nil
}

func (verifier *JWKSVerifier) VerifyToken(ctx context.Context, rawToken string) (Claims, error) {
	if !verifier.Enabled() || ctx == nil || len(rawToken) == 0 || len(rawToken) > maxAccessTokenBytes {
		return Claims{}, ErrInvalidToken
	}
	claims := &Claims{}
	token, err := verifier.parseSignedClaims(ctx, rawToken, claims, true)
	if err != nil || !token.Valid || !validClaims(*claims, verifier.now().UTC(), verifier.maxTokenAge) {
		return Claims{}, ErrInvalidToken
	}
	return *claims, nil
}

// VerifyIDToken validates the signed ID token returned by an OIDC token
// endpoint. The caller supplies the nonce from AuthorizationRequest.Complete.
// Token exchange and provider-specific profile mapping remain outside the
// Framework boundary.
func (verifier *JWKSVerifier) VerifyIDToken(ctx context.Context, rawToken, expectedNonce string) (IDTokenClaims, error) {
	if !verifier.Enabled() || ctx == nil || len(rawToken) == 0 || len(rawToken) > maxAccessTokenBytes || !boundedNonEmpty(expectedNonce) {
		return IDTokenClaims{}, ErrInvalidToken
	}
	claims := &IDTokenClaims{}
	token, err := verifier.parseSignedClaims(ctx, rawToken, claims, false)
	if err != nil || !token.Valid || !validIDTokenClaims(
		*claims,
		expectedNonce,
		verifier.now().UTC(),
		verifier.maxTokenAge,
		verifier.audience,
		verifier.requiredACR,
		verifier.requiredAMR,
		verifier.maxAuthAge,
	) {
		return IDTokenClaims{}, ErrInvalidToken
	}
	return *claims, nil
}

func (verifier *JWKSVerifier) parseSignedClaims(ctx context.Context, rawToken string, claims jwt.Claims, requireNotBefore bool) (*jwt.Token, error) {
	options := []jwt.ParserOption{
		jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg()}),
		jwt.WithIssuer(verifier.issuer),
		jwt.WithAudience(verifier.audience),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithLeeway(jwtClockLeeway),
		jwt.WithTimeFunc(verifier.now),
	}
	if requireNotBefore {
		options = append(options, jwt.WithNotBeforeRequired())
	}
	return jwt.ParseWithClaims(
		rawToken,
		claims,
		func(token *jwt.Token) (any, error) {
			if token.Method != jwt.SigningMethodRS256 {
				return nil, ErrInvalidToken
			}
			keyID, ok := token.Header["kid"].(string)
			if !ok || !boundedNonEmpty(keyID) {
				return nil, ErrInvalidToken
			}
			return verifier.key(ctx, keyID)
		},
		options...,
	)
}

func validIDTokenClaims(claims IDTokenClaims, expectedNonce string, now time.Time, maxAge time.Duration, audience, requiredACR string, requiredAMR []string, maxAuthAge time.Duration) bool {
	if !boundedNonEmpty(claims.Subject) || !boundedNonEmpty(claims.Nonce) || ValidateAuthorizationNonce(expectedNonce, claims.Nonce) != nil {
		return false
	}
	if claims.IssuedAt == nil || now.Before(claims.IssuedAt.Time) || now.Sub(claims.IssuedAt.Time) > maxAge+jwtClockLeeway {
		return false
	}
	authAgeLimit := maxAge
	if maxAuthAge > 0 {
		authAgeLimit = maxAuthAge
		if claims.AuthTime == nil {
			return false
		}
	}
	if claims.AuthTime != nil && (now.Before(claims.AuthTime.Time) || now.Sub(claims.AuthTime.Time) > authAgeLimit+jwtClockLeeway) {
		return false
	}
	if len(claims.Audience) > 1 && claims.Azp != audience {
		return false
	}
	if len(claims.Audience) == 1 && claims.Azp != "" && claims.Azp != audience {
		return false
	}
	if !validIDTokenAssurance(claims.Acr, claims.Amr, requiredACR, requiredAMR) {
		return false
	}
	return true
}

func validIDTokenAssurance(actualACR string, actualAMR []string, requiredACR string, requiredAMR []string) bool {
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

func validOIDCAssuranceValue(value string) bool {
	return value != "" && len(value) <= maxOIDCAssuranceValueBytes && strings.TrimSpace(value) == value && !strings.ContainsAny(value, "\x00\t\r\n")
}

type refreshReason uint8

const (
	refreshInitial refreshReason = iota
	refreshExpired
	refreshUnknownKey
)

func (verifier *JWKSVerifier) key(ctx context.Context, keyID string) (*rsa.PublicKey, error) {
	key, refreshedAt := verifier.cachedKey(keyID)
	if key != nil && verifier.now().UTC().Sub(refreshedAt) < verifier.refreshInterval {
		return key, nil
	}
	reason := refreshExpired
	if key == nil {
		reason = refreshUnknownKey
	}
	if err := verifier.refresh(ctx, reason); err != nil {
		return nil, ErrInvalidToken
	}
	key, _ = verifier.cachedKey(keyID)
	if key == nil {
		return nil, ErrInvalidToken
	}
	return key, nil
}

func (verifier *JWKSVerifier) cachedKey(keyID string) (*rsa.PublicKey, time.Time) {
	verifier.stateMu.RLock()
	defer verifier.stateMu.RUnlock()
	return verifier.keys[keyID], verifier.refreshedAt
}

func (verifier *JWKSVerifier) refresh(ctx context.Context, reason refreshReason) error {
	verifier.refreshMu.Lock()
	defer verifier.refreshMu.Unlock()

	_, refreshedAt := verifier.cachedKey("")
	age := verifier.now().UTC().Sub(refreshedAt)
	switch reason {
	case refreshExpired:
		if !refreshedAt.IsZero() && age < verifier.refreshInterval {
			return nil
		}
	case refreshUnknownKey:
		if !refreshedAt.IsZero() && age < unknownKeyRefreshInterval {
			return nil
		}
	}

	requestContext, cancel := context.WithTimeout(ctx, verifier.httpTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestContext, http.MethodGet, verifier.jwksURL, http.NoBody)
	if err != nil {
		return ErrJWKSUnavailable
	}
	request.Header.Set("Accept", "application/json")
	response, err := verifier.httpClient.Do(request)
	if err != nil {
		return ErrJWKSUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return ErrJWKSUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxJWKSResponseBytes+1))
	if err != nil || len(body) == 0 || len(body) > maxJWKSResponseBytes {
		return ErrJWKSUnavailable
	}
	keys, err := parseJWKS(body)
	if err != nil {
		return ErrJWKSUnavailable
	}
	verifier.stateMu.Lock()
	verifier.keys = keys
	verifier.refreshedAt = verifier.now().UTC()
	verifier.stateMu.Unlock()
	return nil
}

func parseJWKS(body []byte) (map[string]*rsa.PublicKey, error) {
	var document jwksDocument
	if err := json.Unmarshal(body, &document); err != nil || len(document.Keys) == 0 || len(document.Keys) > maxJWKSKeys {
		return nil, ErrJWKSUnavailable
	}
	keys := make(map[string]*rsa.PublicKey, len(document.Keys))
	for _, item := range document.Keys {
		if item.KeyType != "RSA" || (item.Use != "" && item.Use != "sig") || (item.Algorithm != "" && item.Algorithm != jwt.SigningMethodRS256.Alg()) {
			continue
		}
		if !boundedNonEmpty(item.KeyID) {
			return nil, ErrJWKSUnavailable
		}
		if _, exists := keys[item.KeyID]; exists {
			return nil, ErrJWKSUnavailable
		}
		key, err := parseRSAKey(item.Modulus, item.Exponent)
		if err != nil {
			return nil, ErrJWKSUnavailable
		}
		keys[item.KeyID] = key
	}
	if len(keys) == 0 {
		return nil, ErrJWKSUnavailable
	}
	return keys, nil
}

func parseRSAKey(encodedModulus, encodedExponent string) (*rsa.PublicKey, error) {
	modulusBytes, err := base64.RawURLEncoding.DecodeString(encodedModulus)
	if err != nil || len(modulusBytes) == 0 {
		return nil, ErrJWKSUnavailable
	}
	modulus := new(big.Int).SetBytes(modulusBytes)
	if modulus.BitLen() < minRSAKeyBits || modulus.BitLen() > maxRSAKeyBits {
		return nil, ErrJWKSUnavailable
	}
	exponentBytes, err := base64.RawURLEncoding.DecodeString(encodedExponent)
	if err != nil || len(exponentBytes) == 0 || len(exponentBytes) > 4 {
		return nil, ErrJWKSUnavailable
	}
	exponent := uint64(0)
	for _, value := range exponentBytes {
		exponent = exponent<<8 | uint64(value)
	}
	if exponent < 3 || exponent > uint64(^uint(0)>>1) || exponent%2 == 0 {
		return nil, ErrJWKSUnavailable
	}
	return &rsa.PublicKey{N: modulus, E: int(exponent)}, nil
}

func withJWKSDefaults(config JWKSConfig) JWKSConfig {
	if config.HTTPTimeout == 0 {
		config.HTTPTimeout = defaultJWKSHTTPTimeout
	}
	if config.RefreshInterval == 0 {
		config.RefreshInterval = defaultJWKSRefreshInterval
	}
	if config.MaxTokenAge == 0 {
		config.MaxTokenAge = defaultOIDCMaxTokenAge
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	return config
}

func validateJWKSConfig(config JWKSConfig) error {
	if !boundedNonEmpty(config.Issuer) || !boundedNonEmpty(config.Audience) {
		return errors.New("OIDC issuer and audience must be non-empty and bounded")
	}
	endpoint, err := url.Parse(strings.TrimSpace(config.JWKSURL))
	if err != nil || (endpoint.Scheme != "http" && endpoint.Scheme != "https") || endpoint.Host == "" || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return errors.New("OIDC JWKS URL must be an absolute HTTP(S) URL without credentials, query, or fragment")
	}
	if config.HTTPTimeout <= 0 || config.HTTPTimeout > 10*time.Second {
		return errors.New("OIDC JWKS HTTP timeout must be greater than zero and at most 10 seconds")
	}
	if config.RefreshInterval < 30*time.Second || config.RefreshInterval > 24*time.Hour {
		return errors.New("OIDC JWKS refresh interval must be between 30 seconds and 24 hours")
	}
	if config.MaxTokenAge <= 0 || config.MaxTokenAge > 24*time.Hour {
		return errors.New("OIDC access token maximum age must be greater than zero and at most 24 hours")
	}
	if config.RequiredACR != "" && !validOIDCAssuranceValue(config.RequiredACR) {
		return errors.New("OIDC required ACR must be non-empty, trimmed, and at most 256 bytes")
	}
	if len(config.RequiredAMR) > maxOIDCAssuranceValues {
		return errors.New("OIDC required AMR count must be at most 16")
	}
	seenAMR := make(map[string]struct{}, len(config.RequiredAMR))
	for _, method := range config.RequiredAMR {
		if !validOIDCAssuranceValue(method) {
			return errors.New("OIDC required AMR values must be non-empty, trimmed, and at most 256 bytes")
		}
		if _, exists := seenAMR[method]; exists {
			return errors.New("OIDC required AMR values must be unique")
		}
		seenAMR[method] = struct{}{}
	}
	if config.MaxAuthAge < 0 || config.MaxAuthAge > 24*time.Hour {
		return errors.New("OIDC maximum authentication age must be between zero and 24 hours")
	}
	if (config.RequiredACR != "" || len(config.RequiredAMR) > 0) && config.MaxAuthAge <= 0 {
		return errors.New("OIDC assurance requirements need a positive maximum authentication age")
	}
	return nil
}
