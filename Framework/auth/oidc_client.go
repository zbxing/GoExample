package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	defaultOIDCHTTPTimeout    = 3 * time.Second
	maxOIDCMetadataBytes      = 64 << 10
	maxOIDCTokenResponseBytes = 64 << 10
	maxOIDCClientSecretBytes  = 256
	maxOIDCTokenLifetime      = 24 * time.Hour
	maxOIDCRefreshTokenBytes  = 8 << 10
	maxOIDCScopeBytes         = 4 << 10
	maxOIDCAuthMethods        = 16
	maxOIDCAuthMethodBytes    = 128

	oidcTokenAuthNone              = "none"
	oidcTokenAuthClientSecretBasic = "client_secret_basic"
)

var (
	// ErrOIDCProviderUnavailable is returned when discovery is missing or unsafe.
	ErrOIDCProviderUnavailable = errors.New("OIDC provider metadata unavailable")
	// ErrOIDCTokenExchange is returned for bounded token endpoint failures.
	ErrOIDCTokenExchange = errors.New("OIDC token exchange failed")
)

// OIDCClientConfig defines a bounded discovery and authorization-code exchange
// client. Production callers must use HTTPS and an explicitly trusted transport.
// HTTP is accepted only for loopback contract tests.
type OIDCClientConfig struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	RedirectURL  string
	HTTPTimeout  time.Duration
	HTTPClient   *http.Client
}

// OIDCProviderMetadata is the subset of discovery metadata required by the
// Authorization Code + PKCE flow.
type OIDCProviderMetadata struct {
	Issuer                        string   `json:"issuer"`
	AuthorizationEndpoint         string   `json:"authorization_endpoint"`
	TokenEndpoint                 string   `json:"token_endpoint"`
	JWKSURI                       string   `json:"jwks_uri"`
	ResponseTypesSupported        []string `json:"response_types_supported"`
	CodeChallengeMethodsSupported []string `json:"code_challenge_methods_supported"`
}

// oidcProviderMetadataDocument keeps optional discovery capabilities out of
// the public metadata struct so adding protocol fields does not break callers
// that use an unkeyed OIDCProviderMetadata literal.
type oidcProviderMetadataDocument struct {
	Issuer                            string          `json:"issuer"`
	AuthorizationEndpoint             string          `json:"authorization_endpoint"`
	TokenEndpoint                     string          `json:"token_endpoint"`
	JWKSURI                           string          `json:"jwks_uri"`
	ResponseTypesSupported            []string        `json:"response_types_supported"`
	CodeChallengeMethodsSupported     []string        `json:"code_challenge_methods_supported"`
	TokenEndpointAuthMethodsSupported json.RawMessage `json:"token_endpoint_auth_methods_supported"`
}

func (document oidcProviderMetadataDocument) metadata() OIDCProviderMetadata {
	return OIDCProviderMetadata{
		Issuer:                        document.Issuer,
		AuthorizationEndpoint:         document.AuthorizationEndpoint,
		TokenEndpoint:                 document.TokenEndpoint,
		JWKSURI:                       document.JWKSURI,
		ResponseTypesSupported:        document.ResponseTypesSupported,
		CodeChallengeMethodsSupported: document.CodeChallengeMethodsSupported,
	}
}

// OIDCTokenResponse contains bounded token endpoint output. IDToken must be
// passed to JWKSVerifier.VerifyIDToken with AuthorizationCode.Nonce by callers.
type OIDCTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
	RefreshToken string `json:"refresh_token,omitempty"`
	IDToken      string `json:"id_token"`
	Scope        string `json:"scope,omitempty"`
}

// OIDCClient performs discovery once during construction and exchanges codes
// without following redirects or exposing provider response details.
type OIDCClient struct {
	issuer       string
	clientID     string
	clientSecret string
	redirectURL  string
	httpTimeout  time.Duration
	httpClient   *http.Client
	metadata     OIDCProviderMetadata
	tokenAuth    string
}

// NewOIDCClient discovers and validates a provider before returning a client.
func NewOIDCClient(ctx context.Context, config OIDCClientConfig) (*OIDCClient, error) {
	if ctx == nil {
		return nil, ErrOIDCProviderUnavailable
	}
	config, err := normalizeOIDCClientConfig(config)
	if err != nil {
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
	result := &OIDCClient{
		issuer:       strings.TrimSpace(config.Issuer),
		clientID:     strings.TrimSpace(config.ClientID),
		clientSecret: config.ClientSecret,
		redirectURL:  config.RedirectURL,
		httpTimeout:  config.HTTPTimeout,
		httpClient:   client,
		tokenAuth:    oidcTokenAuthNone,
	}
	if result.clientSecret != "" {
		result.tokenAuth = oidcTokenAuthClientSecretBasic
	}
	metadata, err := result.discover(ctx)
	if err != nil {
		return nil, err
	}
	result.metadata = metadata
	return result, nil
}

// Metadata returns a defensive copy of validated provider metadata.
func (client *OIDCClient) Metadata() OIDCProviderMetadata {
	if client == nil {
		return OIDCProviderMetadata{}
	}
	metadata := client.metadata
	metadata.ResponseTypesSupported = append([]string(nil), metadata.ResponseTypesSupported...)
	metadata.CodeChallengeMethodsSupported = append([]string(nil), metadata.CodeChallengeMethodsSupported...)
	return metadata
}

// ExchangeCode performs a single bounded authorization_code token exchange.
// It does not verify the returned ID token; callers must bind its nonce to the
// AuthorizationCode and call JWKSVerifier.VerifyIDToken explicitly.
func (client *OIDCClient) ExchangeCode(ctx context.Context, authorization AuthorizationCode) (OIDCTokenResponse, error) {
	if client == nil || client.httpClient == nil || ctx == nil ||
		!validAuthorizationCode(authorization) {
		return OIDCTokenResponse{}, ErrOIDCTokenExchange
	}
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {authorization.Code},
		"redirect_uri":  {client.redirectURL},
		"code_verifier": {authorization.CodeVerifier},
	}
	switch client.tokenAuth {
	case oidcTokenAuthNone:
		form.Set("client_id", client.clientID)
	case oidcTokenAuthClientSecretBasic:
	default:
		return OIDCTokenResponse{}, ErrOIDCTokenExchange
	}
	requestContext, cancel := context.WithTimeout(ctx, client.httpTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestContext, http.MethodPost, client.metadata.TokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return OIDCTokenResponse{}, ErrOIDCTokenExchange
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if client.tokenAuth == oidcTokenAuthClientSecretBasic {
		request.SetBasicAuth(url.QueryEscape(client.clientID), url.QueryEscape(client.clientSecret))
	}
	response, err := client.httpClient.Do(request)
	if err != nil {
		return OIDCTokenResponse{}, ErrOIDCTokenExchange
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || !isJSONResponse(response.Header.Get("Content-Type")) {
		return OIDCTokenResponse{}, ErrOIDCTokenExchange
	}
	body, err := readOIDCResponse(response.Body, maxOIDCTokenResponseBytes)
	if err != nil {
		return OIDCTokenResponse{}, ErrOIDCTokenExchange
	}
	var tokens OIDCTokenResponse
	if err := unmarshalOIDCJSON(body, &tokens); err != nil || !validOIDCTokenResponse(tokens) {
		return OIDCTokenResponse{}, ErrOIDCTokenExchange
	}
	return tokens, nil
}

func (client *OIDCClient) discover(ctx context.Context) (OIDCProviderMetadata, error) {
	discoveryURL := strings.TrimRight(client.issuer, "/") + "/.well-known/openid-configuration"
	requestContext, cancel := context.WithTimeout(ctx, client.httpTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestContext, http.MethodGet, discoveryURL, http.NoBody)
	if err != nil {
		return OIDCProviderMetadata{}, ErrOIDCProviderUnavailable
	}
	request.Header.Set("Accept", "application/json")
	response, err := client.httpClient.Do(request)
	if err != nil {
		return OIDCProviderMetadata{}, ErrOIDCProviderUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || !isJSONResponse(response.Header.Get("Content-Type")) {
		return OIDCProviderMetadata{}, ErrOIDCProviderUnavailable
	}
	body, err := readOIDCResponse(response.Body, maxOIDCMetadataBytes)
	if err != nil {
		return OIDCProviderMetadata{}, ErrOIDCProviderUnavailable
	}
	var document oidcProviderMetadataDocument
	if err := unmarshalOIDCJSON(body, &document); err != nil {
		return OIDCProviderMetadata{}, ErrOIDCProviderUnavailable
	}
	metadata := document.metadata()
	if !validOIDCProviderMetadata(metadata, client.issuer) ||
		!validOIDCTokenEndpointAuthMethods(document.TokenEndpointAuthMethodsSupported, client.tokenAuth) {
		return OIDCProviderMetadata{}, ErrOIDCProviderUnavailable
	}
	return metadata, nil
}

func normalizeOIDCClientConfig(config OIDCClientConfig) (OIDCClientConfig, error) {
	if config.HTTPTimeout == 0 {
		config.HTTPTimeout = defaultOIDCHTTPTimeout
	}
	if err := validateOIDCURL(config.Issuer, "issuer"); err != nil {
		return OIDCClientConfig{}, err
	}
	if !boundedNonEmpty(config.ClientID) {
		return OIDCClientConfig{}, errors.New("OIDC client ID must be non-empty and bounded")
	}
	if err := validateAuthorizationEndpoint(config.RedirectURL, "redirect URL"); err != nil {
		return OIDCClientConfig{}, err
	}
	if len(config.ClientSecret) > maxOIDCClientSecretBytes || strings.ContainsAny(config.ClientSecret, "\x00\r\n") {
		return OIDCClientConfig{}, errors.New("OIDC client secret is invalid or too large")
	}
	if config.HTTPTimeout <= 0 || config.HTTPTimeout > 10*time.Second {
		return OIDCClientConfig{}, errors.New("OIDC HTTP timeout must be greater than zero and at most 10 seconds")
	}
	return config, nil
}

func validAuthorizationCode(code AuthorizationCode) bool {
	return code.Code != "" && len(code.Code) <= maxAuthorizationCodeBytes && strings.TrimSpace(code.Code) == code.Code &&
		validPKCEVerifier(code.CodeVerifier) && boundedNonEmpty(code.Nonce)
}

func validPKCEVerifier(verifier string) bool {
	if len(verifier) < 43 || len(verifier) > 128 {
		return false
	}
	for _, character := range verifier {
		if !(character >= 'A' && character <= 'Z') && !(character >= 'a' && character <= 'z') &&
			!(character >= '0' && character <= '9') && !strings.ContainsRune("-._~", character) {
			return false
		}
	}
	return true
}

func validOIDCTokenResponse(tokens OIDCTokenResponse) bool {
	return boundedToken(tokens.AccessToken, maxAccessTokenBytes) && strings.EqualFold(tokens.TokenType, "Bearer") &&
		tokens.ExpiresIn > 0 && tokens.ExpiresIn <= int64(maxOIDCTokenLifetime/time.Second) &&
		boundedToken(tokens.IDToken, maxAccessTokenBytes) &&
		(tokens.RefreshToken == "" || boundedToken(tokens.RefreshToken, maxOIDCRefreshTokenBytes)) &&
		(tokens.Scope == "" || len(tokens.Scope) <= maxOIDCScopeBytes && strings.TrimSpace(tokens.Scope) == tokens.Scope && !strings.ContainsAny(tokens.Scope, "\x00\r\n"))
}

func boundedToken(value string, limit int) bool {
	return value != "" && len(value) <= limit && strings.TrimSpace(value) == value && !strings.ContainsAny(value, "\x00\r\n")
}

func validOIDCProviderMetadata(metadata OIDCProviderMetadata, issuer string) bool {
	if metadata.Issuer != issuer || validateOIDCURL(metadata.AuthorizationEndpoint, "authorization endpoint") != nil ||
		validateOIDCURL(metadata.TokenEndpoint, "token endpoint") != nil || validateOIDCURL(metadata.JWKSURI, "JWKS URI") != nil {
		return false
	}
	if !containsString(metadata.ResponseTypesSupported, "code") || !containsString(metadata.CodeChallengeMethodsSupported, "S256") {
		return false
	}
	return true
}

func validOIDCTokenEndpointAuthMethods(raw json.RawMessage, required string) bool {
	if len(raw) == 0 {
		return required == oidcTokenAuthClientSecretBasic
	}
	var methods []string
	if err := json.Unmarshal(raw, &methods); err != nil || methods == nil || len(methods) == 0 || len(methods) > maxOIDCAuthMethods {
		return false
	}
	found := false
	for _, method := range methods {
		if method == "" || len(method) > maxOIDCAuthMethodBytes || strings.TrimSpace(method) != method || strings.ContainsAny(method, "\x00\r\n") {
			return false
		}
		found = found || method == required
	}
	return found
}

// unmarshalOIDCJSON rejects duplicate object keys before decoding into Go
// structs. encoding/json otherwise lets later keys overwrite earlier values,
// which makes security-sensitive discovery and token fields ambiguous.
func unmarshalOIDCJSON(body []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	if err := scanOIDCJSONValue(decoder); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		if err == nil {
			return errors.New("OIDC JSON contains multiple top-level values")
		}
		return err
	}
	return json.Unmarshal(body, target)
}

func scanOIDCJSONValue(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delimiter {
	case '{':
		seen := make(map[string]struct{})
		for decoder.More() {
			keyToken, err := decoder.Token()
			if err != nil {
				return err
			}
			key, ok := keyToken.(string)
			if !ok {
				return errors.New("OIDC JSON object key is not a string")
			}
			// encoding/json matches struct fields case-insensitively, so reject
			// case-folded duplicates as well as exact duplicates.
			canonicalKey := strings.ToLower(key)
			if _, exists := seen[canonicalKey]; exists {
				return errors.New("OIDC JSON object contains duplicate keys")
			}
			seen[canonicalKey] = struct{}{}
			if err := scanOIDCJSONValue(decoder); err != nil {
				return err
			}
		}
		end, err := decoder.Token()
		if err != nil {
			return err
		}
		if end != json.Delim('}') {
			return errors.New("OIDC JSON object is not terminated")
		}
	case '[':
		for decoder.More() {
			if err := scanOIDCJSONValue(decoder); err != nil {
				return err
			}
		}
		end, err := decoder.Token()
		if err != nil {
			return err
		}
		if end != json.Delim(']') {
			return errors.New("OIDC JSON array is not terminated")
		}
	default:
		return errors.New("OIDC JSON contains an invalid delimiter")
	}
	return nil
}

func validateOIDCURL(raw, name string) error {
	if !boundedNonEmpty(raw) {
		return errors.New("OIDC " + name + " must be non-empty and bounded")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" ||
		(parsed.Scheme != "https" && !isLoopbackHTTP(parsed)) {
		return errors.New("OIDC " + name + " must be HTTPS (or loopback HTTP for tests) without credentials, query, or fragment")
	}
	return nil
}

func isLoopbackHTTP(parsed *url.URL) bool {
	if parsed.Scheme != "http" {
		return false
	}
	host := parsed.Hostname()
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func isJSONResponse(contentType string) bool {
	mediaType, _, err := mime.ParseMediaType(contentType)
	return err == nil && strings.EqualFold(mediaType, "application/json")
}

func readOIDCResponse(reader io.Reader, limit int64) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil || len(body) == 0 || int64(len(body)) > limit {
		return nil, ErrOIDCProviderUnavailable
	}
	return body, nil
}
