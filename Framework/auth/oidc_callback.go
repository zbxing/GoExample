package auth

import (
	"context"
	"errors"
)

var (
	// ErrOIDCCallbackInvalid indicates a malformed, expired, replayed, or
	// nonce-invalid callback. It never includes provider or token details.
	ErrOIDCCallbackInvalid = errors.New("invalid OIDC callback")
	// ErrOIDCCallbackExchange indicates a bounded token endpoint failure while
	// completing a callback.
	ErrOIDCCallbackExchange = errors.New("OIDC callback token exchange failed")
)

// OIDCCallbackResult contains the verified ID-token claims and bounded token
// response produced by CompleteOIDCCallback. Access-token verification remains
// an application policy because providers may issue opaque access tokens.
type OIDCCallbackResult struct {
	Claims IDTokenClaims
	Tokens OIDCTokenResponse
}

// CompleteOIDCCallback consumes a pending state exactly once, exchanges the
// authorization code, and verifies the returned ID token against that request's
// nonce. Any failure after state consumption remains non-replayable.
func CompleteOIDCCallback(ctx context.Context, manager *AuthorizationRequestManager, client *OIDCClient, verifier *JWKSVerifier, state, code string) (OIDCCallbackResult, error) {
	if ctx == nil || manager == nil || client == nil || verifier == nil {
		return OIDCCallbackResult{}, ErrOIDCCallbackInvalid
	}
	authorization, err := manager.CompleteContext(ctx, state, code)
	if err != nil {
		return OIDCCallbackResult{}, ErrOIDCCallbackInvalid
	}
	tokens, err := client.ExchangeCode(ctx, authorization)
	if err != nil {
		return OIDCCallbackResult{}, ErrOIDCCallbackExchange
	}
	claims, err := verifier.VerifyIDTokenWithAccessToken(ctx, tokens.IDToken, authorization.Nonce, tokens.AccessToken)
	if err != nil {
		return OIDCCallbackResult{}, ErrOIDCCallbackInvalid
	}
	return OIDCCallbackResult{Claims: claims, Tokens: tokens}, nil
}
