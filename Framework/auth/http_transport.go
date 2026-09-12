package auth

import (
	"crypto/tls"
	"net"
	"net/http"
	"time"
)

const (
	defaultAuthConnectTimeout      = 5 * time.Second
	defaultAuthResponseHeaderLimit = 10 * time.Second
	defaultAuthIdleTimeout         = 90 * time.Second
	defaultAuthMaxConnections      = 50
	defaultAuthMaxIdleConnections  = 50
	defaultAuthMaxIdlePerHost      = 10
	defaultAuthMaxResponseHeaders  = 1 << 20
)

// defaultAuthHTTPTransport is shared only by Framework authentication clients.
// Its explicit budgets keep OIDC/JWKS requests independent of a mutable
// process-wide http.DefaultTransport while retaining environment proxy support.
var defaultAuthHTTPTransport = &http.Transport{
	Proxy: http.ProxyFromEnvironment,
	DialContext: (&net.Dialer{
		Timeout:   defaultAuthConnectTimeout,
		KeepAlive: 30 * time.Second,
	}).DialContext,
	ForceAttemptHTTP2:      true,
	MaxConnsPerHost:        defaultAuthMaxConnections,
	MaxIdleConns:           defaultAuthMaxIdleConnections,
	MaxIdleConnsPerHost:    defaultAuthMaxIdlePerHost,
	IdleConnTimeout:        defaultAuthIdleTimeout,
	TLSHandshakeTimeout:    defaultAuthConnectTimeout,
	ExpectContinueTimeout:  time.Second,
	ResponseHeaderTimeout:  defaultAuthResponseHeaderLimit,
	MaxResponseHeaderBytes: defaultAuthMaxResponseHeaders,
	TLSClientConfig:        &tls.Config{MinVersion: tls.VersionTLS12},
}
