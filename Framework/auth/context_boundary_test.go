package auth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestOIDCClientRejectsLateSuccessfulHTTPResults(t *testing.T) {
	const issuer = "https://issuer.example"
	metadataBody, err := json.Marshal(validOIDCMetadata(issuer))
	if err != nil {
		t.Fatalf("marshal metadata: %v", err)
	}
	tokenBody, err := json.Marshal(OIDCTokenResponse{
		AccessToken: "access-token",
		TokenType:   "Bearer",
		ExpiresIn:   60,
		IDToken:     "id-token",
	})
	if err != nil {
		t.Fatalf("marshal token response: %v", err)
	}

	for _, boundary := range []string{"transport", "body"} {
		t.Run("discovery "+boundary, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			body := &trackedAuthBody{reader: strings.NewReader(string(metadataBody))}
			if boundary == "body" {
				body.cancelOnRead = cancel
			}
			var calls atomic.Int32
			transport := authRoundTripper(func(*http.Request) (*http.Response, error) {
				calls.Add(1)
				if boundary == "transport" {
					cancel()
				}
				return authJSONResponse(body), nil
			})

			client, err := NewOIDCClient(ctx, OIDCClientConfig{
				Issuer: issuer, ClientID: "client", RedirectURL: "https://app.example/callback",
				HTTPTimeout: time.Second, HTTPClient: &http.Client{Transport: transport},
			})
			if client != nil || !errors.Is(err, ErrOIDCProviderUnavailable) {
				t.Fatalf("NewOIDCClient() = %#v, %v", client, err)
			}
			if calls.Load() != 1 || body.closes.Load() != 1 {
				t.Fatalf("transport calls/body closes = %d/%d, want 1/1", calls.Load(), body.closes.Load())
			}
			if boundary == "transport" && body.reads.Load() != 0 {
				t.Fatalf("body reads after transport cancellation = %d, want 0", body.reads.Load())
			}
		})

		t.Run("token "+boundary, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			body := &trackedAuthBody{reader: strings.NewReader(string(tokenBody))}
			if boundary == "body" {
				body.cancelOnRead = cancel
			}
			var calls atomic.Int32
			transport := authRoundTripper(func(*http.Request) (*http.Response, error) {
				calls.Add(1)
				if boundary == "transport" {
					cancel()
				}
				return authJSONResponse(body), nil
			})
			client := &OIDCClient{
				clientID: "client", redirectURL: "https://app.example/callback", httpTimeout: time.Second,
				httpClient: &http.Client{Transport: transport},
				metadata:   OIDCProviderMetadata{TokenEndpoint: issuer + "/token"},
				tokenAuth:  oidcTokenAuthNone,
			}

			tokens, err := client.ExchangeCode(ctx, AuthorizationCode{
				Code: "code", CodeVerifier: strings.Repeat("a", 43), Nonce: "nonce",
			})
			if tokens != (OIDCTokenResponse{}) || !errors.Is(err, ErrOIDCTokenExchange) {
				t.Fatalf("ExchangeCode() = %#v, %v", tokens, err)
			}
			if calls.Load() != 1 || body.closes.Load() != 1 {
				t.Fatalf("transport calls/body closes = %d/%d, want 1/1", calls.Load(), body.closes.Load())
			}
			if boundary == "transport" && body.reads.Load() != 0 {
				t.Fatalf("body reads after transport cancellation = %d, want 0", body.reads.Load())
			}
		})
	}
}

func TestAuthHTTPEntryPointsRejectPreCompletedContextWithoutTransport(t *testing.T) {
	t.Run("OIDC discovery", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		var calls atomic.Int32
		client, err := NewOIDCClient(ctx, OIDCClientConfig{
			Issuer: "https://issuer.example", ClientID: "client", RedirectURL: "https://app.example/callback",
			HTTPClient: &http.Client{Transport: authRoundTripper(func(*http.Request) (*http.Response, error) {
				calls.Add(1)
				return nil, errors.New("private transport error")
			})},
		})
		if client != nil || !errors.Is(err, ErrOIDCProviderUnavailable) || calls.Load() != 0 {
			t.Fatalf("NewOIDCClient() = %#v, %v, calls=%d", client, err, calls.Load())
		}
	})

	t.Run("OIDC token", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		var calls atomic.Int32
		client := &OIDCClient{
			clientID: "client", redirectURL: "https://app.example/callback", httpTimeout: time.Second,
			httpClient: &http.Client{Transport: authRoundTripper(func(*http.Request) (*http.Response, error) {
				calls.Add(1)
				return nil, errors.New("private transport error")
			})},
			metadata:  OIDCProviderMetadata{TokenEndpoint: "https://issuer.example/token"},
			tokenAuth: oidcTokenAuthNone,
		}
		tokens, err := client.ExchangeCode(ctx, AuthorizationCode{
			Code: "code", CodeVerifier: strings.Repeat("a", 43), Nonce: "nonce",
		})
		if tokens != (OIDCTokenResponse{}) || !errors.Is(err, ErrOIDCTokenExchange) || calls.Load() != 0 {
			t.Fatalf("ExchangeCode() = %#v, %v, calls=%d", tokens, err, calls.Load())
		}
	})

	t.Run("JWKS initialization", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		var calls atomic.Int32
		verifier, err := NewJWKSVerifier(ctx, JWKSConfig{
			Issuer: "https://issuer.example", Audience: "goexample-api", JWKSURL: "https://issuer.example/jwks",
			HTTPClient: &http.Client{Transport: authRoundTripper(func(*http.Request) (*http.Response, error) {
				calls.Add(1)
				return nil, errors.New("private transport error")
			})},
		})
		if verifier != nil || !errors.Is(err, ErrJWKSUnavailable) || calls.Load() != 0 {
			t.Fatalf("NewJWKSVerifier() = %#v, %v, calls=%d", verifier, err, calls.Load())
		}
	})
}

func TestJWKSVerifierRejectsCompletedContextWithCachedKey(t *testing.T) {
	now := time.Date(2026, time.September, 9, 12, 0, 0, 0, time.UTC)
	key := generateRSAKey(t, 2048)
	server := newJWKSServer(t, jwksJSON(t, "cached", &key.PublicKey))
	verifier := newTestJWKSVerifier(t, server.URL, func() time.Time { return now })
	verifier.httpClient.Transport = authRoundTripper(func(*http.Request) (*http.Response, error) {
		t.Fatal("cached verification unexpectedly accessed JWKS transport")
		return nil, nil
	})
	accessToken := signOIDCTestToken(t, key, "cached", now)
	idToken := signIDToken(t, key, "cached", IDTokenClaims{
		Nonce: "nonce",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "https://issuer.example", Subject: "subject", Audience: jwt.ClaimStrings{"goexample-api"},
			ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute)), IssuedAt: jwt.NewNumericDate(now.Add(-time.Minute)),
		},
	})

	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	contexts := []struct {
		name string
		ctx  context.Context
	}{
		{name: "canceled", ctx: canceled},
		{name: "elapsed deadline", ctx: authDeadlineOnlyContext{Context: context.Background(), deadline: time.Now().Add(-time.Millisecond)}},
	}
	for _, candidate := range contexts {
		t.Run(candidate.name, func(t *testing.T) {
			if _, err := verifier.VerifyToken(candidate.ctx, accessToken); !errors.Is(err, ErrInvalidToken) {
				t.Fatalf("VerifyToken() error = %v", err)
			}
			if _, err := verifier.VerifyIDToken(candidate.ctx, idToken, "nonce"); !errors.Is(err, ErrInvalidToken) {
				t.Fatalf("VerifyIDToken() error = %v", err)
			}
			if _, err := verifier.VerifyIDTokenWithAccessToken(candidate.ctx, idToken, "nonce", "opaque-access-token"); !errors.Is(err, ErrInvalidToken) {
				t.Fatalf("VerifyIDTokenWithAccessToken() error = %v", err)
			}
		})
	}
}

func TestJWKSRefreshRejectsLateResponseWithoutPublishingCache(t *testing.T) {
	for _, boundary := range []string{"transport", "body"} {
		t.Run(boundary, func(t *testing.T) {
			now := time.Date(2026, time.September, 9, 12, 0, 0, 0, time.UTC)
			firstKey := generateRSAKey(t, 2048)
			secondKey := generateRSAKey(t, 2048)
			server := newJWKSServer(t, jwksJSON(t, "first", &firstKey.PublicKey))
			verifier := newTestJWKSVerifier(t, server.URL, func() time.Time { return now })
			_, initialRefresh := verifier.cachedKey("first")
			now = now.Add(defaultJWKSRefreshInterval + time.Second)

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			body := &trackedAuthBody{reader: strings.NewReader(string(jwksJSON(t, "second", &secondKey.PublicKey)))}
			if boundary == "body" {
				body.cancelOnRead = cancel
			}
			verifier.httpClient.Transport = authRoundTripper(func(*http.Request) (*http.Response, error) {
				if boundary == "transport" {
					cancel()
				}
				return authJSONResponse(body), nil
			})
			if err := verifier.refresh(ctx, refreshExpired); !errors.Is(err, ErrJWKSUnavailable) {
				t.Fatalf("refresh() error = %v", err)
			}
			if body.closes.Load() != 1 {
				t.Fatalf("late JWKS body closes = %d, want 1", body.closes.Load())
			}
			if boundary == "transport" && body.reads.Load() != 0 {
				t.Fatalf("body reads after transport cancellation = %d, want 0", body.reads.Load())
			}
			if key, refreshedAt := verifier.cachedKey("second"); key != nil || !refreshedAt.Equal(initialRefresh) {
				t.Fatalf("late JWKS was published: key=%v refreshedAt=%s want=%s", key != nil, refreshedAt, initialRefresh)
			}
			if key, _ := verifier.cachedKey("first"); key == nil {
				t.Fatal("late JWKS refresh removed the last valid cache")
			}
		})
	}
}

func TestJWKSRefreshWaitHonorsCallerCancellation(t *testing.T) {
	now := time.Date(2026, time.September, 9, 12, 0, 0, 0, time.UTC)
	key := generateRSAKey(t, 2048)
	server := newJWKSServer(t, jwksJSON(t, "current", &key.PublicKey))
	verifier := newTestJWKSVerifier(t, server.URL, func() time.Time { return now })
	now = now.Add(defaultJWKSRefreshInterval + time.Second)

	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	verifier.httpClient.Transport = authRoundTripper(func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		close(started)
		<-release
		return authJSONResponse(&trackedAuthBody{reader: strings.NewReader(string(jwksJSON(t, "current", &key.PublicKey)))}), nil
	})
	ownerDone := make(chan error, 1)
	go func() {
		ownerDone <- verifier.refresh(context.Background(), refreshExpired)
	}()
	<-started

	waiterContext, cancelWaiter := context.WithCancel(context.Background())
	cancelWaiter()
	waiterDone := make(chan error, 1)
	go func() {
		waiterDone <- verifier.refresh(waiterContext, refreshExpired)
	}()

	var waiterErr error
	timely := false
	select {
	case waiterErr = <-waiterDone:
		timely = true
	case <-time.After(100 * time.Millisecond):
	}
	close(release)
	if err := <-ownerDone; err != nil {
		t.Fatalf("owner refresh error = %v", err)
	}
	if !timely {
		waiterErr = <-waiterDone
		t.Fatalf("canceled refresh waiter remained blocked until owner completion: %v", waiterErr)
	}
	if !errors.Is(waiterErr, ErrJWKSUnavailable) {
		t.Fatalf("waiter refresh error = %v", waiterErr)
	}
	if calls.Load() != 1 {
		t.Fatalf("refresh transport calls = %d, want 1", calls.Load())
	}
}

func TestCompletedAuthContextErrorObservesCancellationAndElapsedDeadline(t *testing.T) {
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if err := completedAuthContextError(canceled); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled context error = %v", err)
	}
	elapsed := authDeadlineOnlyContext{Context: context.Background(), deadline: time.Now().Add(-time.Millisecond)}
	if err := completedAuthContextError(elapsed); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("elapsed deadline error = %v", err)
	}
	if err := completedAuthContextError(context.Background()); err != nil {
		t.Fatalf("live context error = %v", err)
	}
	if allocations := testing.AllocsPerRun(1000, func() {
		if completedAuthContextError(context.Background()) != nil {
			panic("live context unexpectedly completed")
		}
	}); allocations != 0 {
		t.Fatalf("live completedAuthContextError allocations = %f, want 0", allocations)
	}
}

type authRoundTripper func(*http.Request) (*http.Response, error)

func (transport authRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

type trackedAuthBody struct {
	reader       io.Reader
	cancelOnRead context.CancelFunc
	reads        atomic.Int32
	closes       atomic.Int32
}

func (body *trackedAuthBody) Read(buffer []byte) (int, error) {
	body.reads.Add(1)
	if body.cancelOnRead != nil {
		cancel := body.cancelOnRead
		body.cancelOnRead = nil
		cancel()
	}
	return body.reader.Read(buffer)
}

func (body *trackedAuthBody) Close() error {
	body.closes.Add(1)
	return nil
}

func authJSONResponse(body io.ReadCloser) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       body,
	}
}

type authDeadlineOnlyContext struct {
	context.Context
	deadline time.Time
}

func (ctx authDeadlineOnlyContext) Deadline() (time.Time, bool) { return ctx.deadline, true }
func (authDeadlineOnlyContext) Done() <-chan struct{}           { return nil }
func (authDeadlineOnlyContext) Err() error                      { return nil }
