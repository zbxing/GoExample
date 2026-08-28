# GoExample Server Security Audit Events

Review date: 2026-08-24
Scope: Go `Framework`, `Solutions/Example`, and `Services/Billing` server authentication, application role/resource authorization and privileged diagnostic access
Out of scope: `MSFront`, production sink deployment, retention, immutability, SIEM routing and incident ownership

## 1. Contract

Security audit records use the structured log message `security_audit`. They are emitted at `INFO` for successful authentication or diagnostic access and `WARN` for failure or rate limiting. The general request log remains separate and can be joined through `request_id`, `trace_id` and `span_id`.

An optional `httpapi.SecurityAuditSink` receives the same decision as a transport-neutral `SecurityAuditRecord`. The sink record adds a UTC `timestamp`; it does not include the log-only `msg` field. The allowed privacy boundary is identical for both representations.

| Field | Required | Allowed content |
| --- | --- | --- |
| `msg` | yes | fixed value `security_audit` |
| `event` | yes | `login`, `bearer`, `session`, `authorization`, or `diagnostics` |
| `outcome` | yes | `success`, `failure`, or `limited` |
| `reason` | yes | fixed reason from the event catalog below |
| `target` | yes | fixed logical target: `demo_auth`, `oidc_browser`, `api`, `application_query`, `application_command`, `metrics`, or `pprof` |
| `request_id` | yes | server-validated or server-generated correlation ID |
| `trace_id` / `span_id` | yes for HTTP requests | local or propagated trace correlation IDs |
| `actor_id` | successful login only | authenticated stable subject ID; never a submitted username |
| `timestamp` | sink record only | UTC time from the application clock |

The event record must not contain a submitted username, password, authorization header, token, request body, raw URL/path, client IP, arbitrary error text, JWT claims, role names, email or display name. The existing request log already records normalized request information and client IP under its separate access policy.

## 2. Event Catalog

| Event | Outcome | Reason | Trigger |
| --- | --- | --- | --- |
| `login` | `success` | `credentials_valid` | demo credentials were verified and a token was issued |
| `login` | `failure` | `invalid_credentials` | submitted credentials did not match; username existence is not disclosed |
| `login` | `failure` | `token_issue_failed` | credentials matched but token issuance failed; raw error is omitted |
| `login` | `limited` | `rate_limited` | the authentication limiter rejected the request |
| `login` | `success` | `oidc_started` | a bounded PKCE authorization request and state-binding cookie were created |
| `login` | `failure` | `oidc_start_failed` | bounded authorization state could not be created; raw errors are omitted |
| `login` | `success` | `oidc_callback_valid` | state/cookie, exchange, nonce and matching token subjects were verified; tokens are omitted |
| `login` | `failure` | `oidc_callback_invalid` | state/cookie/provider callback, nonce, claims or subject binding failed; callback values are omitted |
| `login` | `failure` | `oidc_exchange_failed` | the bounded token exchange failed; provider status, body and errors are omitted |
| `login` | `success` | `oidc_session_started` | verified callback claims established an opaque application session; raw session/CSRF values are omitted |
| `login` | `failure` | `oidc_session_failed` | application session creation failed; store errors and credentials are omitted |
| `bearer` | `failure` | `token_missing` | protected API request lacked a usable Bearer credential |
| `bearer` | `failure` | `token_invalid` | Bearer verification failed; token and parser error are omitted |
| `session` | `failure` | `session_missing` | protected API request lacked both Bearer and opaque session credentials |
| `session` | `failure` | `session_invalid` | session lookup, expiry, CSRF cookie/header binding, or stored CSRF verification failed |
| `session` | `success` | `session_revoked` | logout immediately deleted the opaque session and expired both cookies |
| `session` | `failure` | `session_revoke_failed` | logout could not resolve or delete the session; backend details are omitted |
| `authorization` | `failure` | `role_required` | an authenticated principal lacked every role declared by an application query or command; subject, roles and route are omitted |
| `authorization` | `failure` | `resource_invalid` | a typed request resolved to a malformed or excessive resource descriptor; input and validation details are omitted |
| `authorization` | `failure` | `resource_denied` | the resource policy denied, failed, timed out, panicked, or returned an invalid decision; subject, tenant, resource, attributes and backend details are omitted |
| `diagnostics` | `success` | `token_valid` | configured metrics or pprof credential passed constant-time comparison |
| `diagnostics` | `failure` | `token_invalid` | configured metrics or pprof credential was absent or incorrect |

Successful Bearer authentication and successful role/resource checks are not logged for every business request because they would duplicate the request log and create unnecessary volume. The authenticated application can add a domain audit event when a real privileged state change is introduced.

## 3. Sink Delivery Contract

Set `httpapi.Options.SecurityAuditSink` to inject storage or a durable queue adapter. Writes receive a context with `SecurityAuditTimeout`, which defaults to 100ms. Implementations must honor cancellation and should durably enqueue the record before returning; the Framework cannot make an implementation durable merely by calling it.

The structured `security_audit` log is emitted before the optional sink call. A sink return error, deadline, or panic is folded into a fixed failure outcome and never changes the HTTP response. Raw sink errors and panic values are discarded rather than logged or exposed as metric labels. Delivery is synchronous within the configured budget, so deployments must size that budget and use a bounded adapter instead of performing unbounded remote work.

### 3.1 Local Hash-Chain Adapter

`httpapi.NewHashChainAuditSink` provides a repository-local tamper-evident adapter for newline-delimited JSON. Each record has a monotonic sequence, the previous SHA-256 digest and a digest over the previous link plus the canonical low-sensitivity payload. `VerifyHashChain` replays the chain and rejects changed fields, missing links, duplicate sequences, unknown fields and trailing JSON. Writes are serialized, record lines are bounded to 16 KiB by default (configurable up to 1 MiB), and callers waiting behind another write can be canceled through the supplied context.

This adapter does not make an arbitrary `io.Writer` durable, encrypted, access-controlled, immutable or remotely delivered. The writer must provide bounded durable storage, and the deployment must separately define key management, retention/deletion, SIEM/paging, clock policy, operator attribution and incident access. A locally verified chain is evidence of application-side linking only.

`httpapi.NewEncryptedAuditWriter` can be placed below the hash-chain sink when records need confidentiality at rest. It encrypts each complete NDJSON line with AES-256-GCM, binds the bounded `key_id` as additional authenticated data, generates a fresh 96-bit nonce from `crypto/rand`, and returns the plaintext byte count required by `io.Writer`. `RotateKey` changes the key ID without resetting the wrapped hash-chain sequence. `VerifyEncryptedHashChain` accepts an explicit keyring, rejects unknown or malformed keys, duplicate nonces, altered ciphertext, unknown envelope fields and a broken decrypted chain. Key material is caller-owned and must be supplied by a KMS/Vault or equivalent deployment boundary; the repository does not persist, rotate, authorize or recover production keys.

## 4. Metrics And Alert

`goexample_security_events_total{event,outcome}` mirrors audit decisions with a fixed-cardinality matrix. The exporter always emits only these label values:

- `event`: `login`, `bearer`, `session`, `diagnostics`, `authorization`, `_OTHER`;
- `outcome`: `success`, `failure`, `limited`, `_OTHER`.

Any value supplied outside the fixed set collapses to `_OTHER`; raw input can never become a label. Reasons, targets, actor IDs, request IDs and errors are intentionally absent from metrics.

`goexample_security_audit_sink_writes_total{outcome="success|failure"}` counts optional sink calls with exactly two fixed outcomes. A missing sink leaves both series at zero. `failure` includes returned errors, observed deadlines and recovered panics without revealing which error occurred.

`GoExampleAuthenticationRateLimited` warns only when login rate limiting remains active for five minutes. `GoExampleSecurityAuditSinkFailures` warns when configured sink failures remain active for five minutes. A local rule file is not proof that Prometheus, Alertmanager or paging is deployed.

## 5. Operating Procedure

1. Confirm `GoExampleAuthenticationRateLimited` against `goexample_security_events_total{event="login",outcome="limited"}` and the configured authentication rate/window.
2. For `GoExampleSecurityAuditSinkFailures`, compare the fixed success/failure series, verify sink dependency health and confirm the implementation is honoring its context budget. Do not log the returned sink error to investigate it.
3. Query `msg="security_audit"`, group by fixed event/outcome/reason/target, and correlate individual records through request and trace IDs. Treat a local log as a recovery aid, not proof that the external sink accepted the record.
4. Do not copy credentials, raw authorization headers or request bodies into incident notes. Use the actor ID only where a successful authentication already established it.
5. Check target-edge and identity-provider logs before attributing source or identity; this repository has neither a target edge nor a formal identity provider.
6. Record incident owner, time range, action and evidence location in the operational system selected by the deployment.

## 6. Evidence And Residual Boundary

`Framework/httpapi/app_test.go` exercises login success, invalid credentials, rate limiting, missing/invalid Bearer credentials, denied query/command roles, and successful/failed metrics and pprof authentication. `Framework/httpapi/oidc_browser_test.go` covers state/session/CSRF cookie attributes, positive callback and `/me`, CSRF rejection, logout/revocation, missing/mismatched state cookie, consume-before-reject, replay, provider callback/exchange failure, fixed responses and log/span privacy. `Framework/auth/browser_session_test.go` and `Framework/sharedstate/browser_session_store_test.go` cover access-token expiry caps, claim cloning, hash-only storage, cross-manager/client verification and revoke, limits, expiry, and backend outage. `Framework/httpapi/application_resource_authorization_test.go` covers resource allow/deny, malformed resources, policy error/invalid decision/timeout/panic privacy, role-first ordering and idempotency-state non-pollution. Tests require request/trace correlation where recorded and reject credential, subject, role, tenant, resource, claim or backend-error leakage. `Framework/httpapi/security_audit_sink_test.go` verifies the exact low-sensitivity sink schema, correlation, UTC timestamp, success, returned error, context deadline, panic recovery, response isolation and error-text non-disclosure. `Framework/httpapi/security_audit_chain_test.go` verifies the resource/session reason allowlist, linked sequence/hash output, encrypted AES-GCM envelopes, key rotation, keyring failure, nonce reuse rejection, tamper rejection, strict record validation, cancellation, line bounds and concurrent serialization. `Framework/observability/metrics_test.go` proves fixed sink outcomes and unknown event strings collapsing to `_OTHER`.

`yarn audit:chain:evidence` runs the six fixed hash-chain and encrypted-writer tests with the pinned workspace Go toolchain and writes a schema-v1 local-only report. The report binds the exact command/test set, runtime and source commit, fourteen source files, raw stdout/stderr, process status, limitations and a five-file checksum set. `yarn audit:chain:verify` and the aggregate evidence verifier reject source, scope, contract, output-marker, checksum and extra-artifact tampering. This is application-side repository evidence, not proof of a production audit deployment.

The repository defines an injection contract and an optional encrypted hash-chain adapter, but does not provide or deploy an immutable audit sink, KMS/Vault key custody, access controls, retention/deletion schedule, clock synchronization evidence, SIEM ingestion, paging delivery, named security owner or incident record. General `LOG_LEVEL` filtering and destination reliability also remain deployment responsibilities. These gaps block a production-complete audit claim.
