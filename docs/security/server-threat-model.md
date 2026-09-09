# GoExample Server Threat Model

Review date: 2026-09-09
Scope: Go `Framework`, `Solutions/Example`, `Services/Billing`, server protocols, telemetry, build and deployment boundaries
Out of scope: `MSFront` and its browser, BFF, session, database and UI flows
Method: OWASP threat-modeling workflow with STRIDE categories

## 1. Purpose And Evidence Boundary

This document identifies server assets, trust boundaries, abuse cases, implemented controls, automated evidence and residual risk. A control is marked as implemented only when corresponding code or tests exist. A workflow, example configuration, local fake service or this document does not prove a production control.

The repository now fixes a versioned Nginx edge baseline, but the deployment target, identity provider, shared-state service, target edge instance, collector backend, secret manager and incident owner are not yet fixed. Threats that depend on those systems remain open even when a local or CI contract fails safely without them.

## 2. Assets And Data Classification

| Class | Server assets | Required handling |
| --- | --- | --- |
| Restricted | JWT signing secret, demo password, metrics/pprof bearer tokens, TLS private keys, future client keys | Never log, trace, cache or return; use separate trust-domain secrets; production delivery requires KMS/Vault or equivalent rotation evidence |
| Confidential | Authorization header, JWT claims, authenticated profile, request body, idempotency response, future downstream/database records | Authenticate and authorize before use; apply request limits and deadlines; private responses use `no-store, no-transform`; do not place raw values in metric labels or span attributes |
| Internal | Trace/span/request IDs, route templates, build version/commit, runtime and capacity metrics, health dependency names | Keep bounded and validated; expose diagnostics only through independent bearer credentials; avoid raw URL, error text and dynamic labels |
| Public | OpenAPI document, canonical health status, service name/version intended for the root inventory | Maintain compatibility and deprecation contracts; do not include secrets, detailed system data or dependency credentials |

Data retention, audit-event retention and deletion schedules are not defined in this repository and remain an organizational prerequisite.

## 3. Trust Boundaries And Data Flow

```text
Untrusted client
    -> [B1 Nginx baseline / target TLS termination: target not recorded]
    -> [B2 Fiber listener and HTTP limits]
    -> [B3 middleware: request ID, trace, auth, rate, deadline, admission]
    -> [B4 transport-neutral project use case]
       -> [B5 shared state / identity / database / downstream: mostly not deployed]
       -> [B6 telemetry exporter and collector: local contract only]
```

| Boundary | Trust transition | Current enforcement | Residual boundary |
| --- | --- | --- | --- |
| B1 | Internet to edge | `support/deploy/edge/goexample-nginx.contract.json` pins TLS 1.2/1.3, HTTP/2, headers/body/timeouts, no proxy buffering/retry, trace/request-ID handling and SIGQUIT drain; static tests and `scripts/nginx-edge-contract.mjs` automate the Docker-loopback contract | No target Nginx/Ingress/cloud-LB artifact, real certificate/DNS test or HTTP/3 evidence |
| B2 | Edge or direct client to process | Header/body/connection/read/write/idle limits, trusted-proxy allowlist and TLS/HTTP1.1 behavior are exercised in `Framework/httpapi/lifecycle_contract_test.go` | Transport connection rejection is outside application metrics; client disconnect cancellation is incomplete |
| B3 | Raw HTTP to authenticated bounded request | JWT issuer/audience/claims, Bearer challenge, CORS, rate/admission/deadline, idempotency fingerprint; OIDC discovery fixes token endpoint client authentication to compatible `client_secret_basic` or explicitly declared `none` without body-secret downgrade, and rejects bounded JSON duplicate keys/multiple top-level values before decoding. Optional browser OIDC start/callback uses PKCE, hash-keyed cross-replica one-time state, a Secure/HttpOnly/SameSite binding cookie, nonce, optional `at_hash` binding, matching token subjects and opaque session/CSRF logout. Redis authorization state requires a payload and global-index member with an identical millisecond expiry, rejects more than 10,000 index entries before cleanup, and consumes inconsistent target state without allowing replay. An opt-in assurance policy requests bounded `acr_values`, then independently requires exact `acr`, all configured `amr` methods and fresh `auth_time`. The browser-session manager adds bounded per-subject inventory, caller-supplied device names and subject-scoped single/all-session revocation; Redis authentication requires the payload, global/subject expiry members and both hashed mapping directions to agree in one bounded snapshot before accepting a session | Demo identity and in-memory development state remain; no target IdP client-registration evidence, MFA enrollment/challenge, inferred device fingerprint or management UI, and no production centralized-revocation evidence |
| B4 | Adapter to application use case | `context.Context` and typed result; production project code has no Fiber import | Only bodyless GET query is migrated; advanced Framework APIs still expose Fiber |
| B5 | Process to state and downstream systems | Standard HTTP client has bounded transport, TLS configuration and low-sensitivity tracing; Redis shared state has startup/readiness checks, bounded I/O, atomic limiting, owner-token locking, low-sensitivity client spans, strict Sentinel discovery, separate data/Sentinel ACLs and production TLS enforcement; browser-session create rejects oversized indexes before cleanup, authentication validates the payload/mappings/two expiry indexes in one bounded Lua read, single revoke validates both mapping directions, and whole-subject revoke rejects more than 10,000 indexed members before traversal; refresh-session user-wide operations likewise reject more than 10,000 families and validate canonical IDs, ownership, fields, and active user/global index scores before cleanup or revoke, while single-family rotation/revoke validate complete family state, both active index scores, and at most 1,024 current/used token reverse mappings before mutation; SQL ordinary-operation boundaries reject nil success observed after their finite context, close late query rows before caller code, and retain transaction commit ownership; queue publish/process, ack/DLQ settlement, and lease-extension boundaries reject success observed after their finite operation deadline, with timed-out handlers following bounded retry/exhausted-attempt DLQ and failed lease extension canceling handling before settlement; JetStream startup preflight reads server configuration and rejects explicit-ack leases below the static or extension-aware worker budget, while runtime `InProgress` failures cancel handling before settlement; pinned local contracts exercise dynamic long-handler lease extension, Redis ACL failover/reconnection, single-node restart, checked stream snapshot/restore with consumer state, sequential leader loss, overlapping two-node outage, barrier-synchronized concurrent two-process loss, and a three-process-live route proxy partition that reject writes without quorum, prevent delayed commit, preserve delivery, and restore all replicas | No successful remote Sentinel/NATS artifact, target Redis TLS/HA/eviction/partition/upgrade/RPO/RTO evidence, project downstream consumer, target database recovery, disk-corruption or cross-host backup recovery, target-latency lease margin calibration, cross-host/zone or network-device partition, infrastructure-level simultaneous failure, or authenticated target broker partition drill |
| B6 | Process to telemetry backend | Bounded nonblocking processor and retry window, W3C propagation, per-attempt/final outcome/drop/saturation metrics | No real collector/backend, dashboard or paging exercise |

Refresh-session rotation and family revoke now read the hash-only token mapping and mutate family state in one bounded Redis Lua command each. The script validates the internal family-ID shape, retains old mappings until TTL for replay detection, and returns only fixed low-sensitivity sentinels. This closes the repository-level two-command consistency window and removes one round trip; it does not prove production Redis latency, HA, TLS/ACL, capacity or cross-host recovery.

Browser-session token and subject-bound public-ID revocation now validate the hash-only owner/token/session-ID mapping in both directions and delete associated state in one bounded Redis Lua command each. Malformed, mismatched or cross-subject mappings fail closed without deleting a valid session. Local command-count and tamper tests do not prove production Redis latency, throughput, HA, TLS/ACL, capacity, eviction or recovery.

Whole-subject browser-session revocation now checks the subject index against the absolute 10,000-session manager bound before expiry cleanup or traversal, validates lowercase SHA-256 metadata and the reverse public-ID mapping for every active member, and only enters the deletion pass after the full set succeeds. Missing, malformed, inconsistent or cross-subject mappings return the existing fixed invalid sentinel without partially deleting active sessions. This is a repository integrity and bounded-work guarantee, not production Redis capacity or latency evidence.

Refresh-session user-wide revoke and active-family count now check the per-user index against the absolute 10,000-family bound before traversal, validate canonical family IDs, owner and stored state, and require active user/global index scores to match the absolute expiry. Cleanup and revocation start only after every member passes validation; malformed or cross-user state returns the existing fixed invalid-session sentinel without partial mutation. This is a repository integrity and bounded-work guarantee, not production Redis capacity or latency evidence.

Refresh-session single-family rotation and revoke now treat the token mapping as an index that must be verified rather than an authorization fact. Before mutation, each script validates the complete family state, active global/user index scores, current-token reverse mapping, incoming current/used membership, and every used-token reverse mapping under the absolute 1,024-history bound. A forged mapping or corrupt family therefore returns the fixed invalid-session sentinel without revoking a legitimate family. This is a repository integrity and bounded-work guarantee, not production Redis latency, HA, TLS/ACL, capacity, eviction, or recovery evidence.

Redis authorization-request create now checks the global pending index against the absolute 10,000-entry bound before expiry cleanup and refuses to adopt an existing target member without a payload. Consume reads the target payload and index score together, removes that target once, and accepts it only when strict payload decoding yields the same integral expiry. Missing, malformed or mismatched target state cannot reach token exchange or replay, and tests retain an unrelated valid request. This is a repository identity-state integrity and bounded-work guarantee, not production Redis latency, HA, TLS/ACL, capacity, eviction, or recovery evidence.

Redis browser-session create now rejects either expiry index above 10,000 before cleanup and refuses to adopt a target token already present as an orphan member. Authentication reads a bounded payload, positive-TTL token/public-ID mappings and both expiry scores in one Lua snapshot; Go rejects unknown/trailing payload JSON and independently recomputes subject/session-ID hashes before accepting claims. Missing, malformed, fractional, persistent or mismatched state fails closed without changing another session. This is a repository identity-state integrity and bounded-work guarantee, not production Redis latency, HA, TLS/ACL, capacity, eviction, or recovery evidence.

Redis browser-session inventory now applies the same five-object rule as authentication: before cleanup it rejects a subject index above 10,000, and each selected member must have a bounded strict payload, positive-TTL token metadata and public-ID mapping, closed subject/token/session-ID ownership, and matching integral global/subject expiry scores. Device-name updates use one complete read-only Lua snapshot followed by a full-state compare-and-swap Lua write, so a concurrent payload, mapping, index, score, or TTL loss cannot be overwritten. Invalid direct-store inputs issue no Redis command, and an abnormal target does not modify another subject/session. These are repository integrity, bounded-work, and command-boundary guarantees; they do not prove production Redis latency, throughput, HA, TLS/ACL, capacity, eviction, or recovery.

## 4. STRIDE Threat Register

Status values are `Mitigated locally`, `Partially mitigated`, or `Open`. Local mitigation never implies target-environment validation.

| ID | STRIDE | Threat and abuse case | Current controls and automated evidence | Residual risk | Status |
| --- | --- | --- | --- | --- | --- |
| TM-01 | Spoofing | Direct clients forge `X-Forwarded-For` or request IDs to evade controls or corrupt correlation | Production rejects IPv4/IPv6 `/0`; trusted/untrusted proxy behavior uses real TCP tests; pinned Nginx replaces request ID and sets the forwarded chain | Target edge addresses, hop normalization and bypass prevention are unverified | Partially mitigated |
| TM-02 | Spoofing | Token signed for another service or with insufficient authentication strength is replayed to this API | Demo and external verifiers fix algorithm, issuer, audience, required claims, maximum age and role bounds in `Framework/auth/service.go` and `Framework/auth/jwks.go`; OIDC/JWKS provider I/O and cached verification reject completed caller contexts, close late responses, prevent late cache publication and allow refresh waiters to cancel while preserving single-flight; browser OIDC first requires discovery-compatible token endpoint client authentication, then binds one-time state/cookie, nonce, optional ID-token `at_hash` to the exchanged access token, and ID/access-token subjects. Its opt-in assurance policy fails closed on missing/stale/malformed `acr`/`amr`/`auth_time`; bounded `SessionManager` stores only SHA-256 refresh hashes, rotates families and revokes on replay; browser sessions have per-subject limits plus authenticated low-sensitivity HTTP inventory and subject-scoped single/all-session revoke, with CSRF, cross-subject and Redis cross-client atomic tests | Local JWKS/discovery/callback/session tests do not prove target IdP client registration or MFA enrollment/challenge, device metadata or management UI, production centralized revocation or production session storage | Partially mitigated |
| TM-03 | Tampering | A reused idempotency key changes method, target, principal, media type or body | SHA-256 fingerprint and 409 conflict behavior in `Framework/httpapi/idempotency_fingerprint.go` and `app_test.go` | In-memory state is not atomic across replicas; external Storage/Locker is absent | Partially mitigated |
| TM-04 | Tampering | API implementation silently diverges from documented request or response contracts | Runtime/OpenAPI inventory tests and `scripts/openapi-compat.mjs` reject incompatible changes | No generated SDK or real consumer-version matrix | Mitigated locally |
| TM-05 | Repudiation | Attacker injects delimiters or credentials into logs, or security decisions cannot be correlated | Request ID boundary runs before logging; `security_audit` uses fixed events/reasons and request/trace correlation; an optional bounded sink receives an exact low-sensitivity schema and exposes only fixed delivery outcomes; local `HashChainAuditSink` links records with strict sequence/hash verification; tests reject submitted credentials, tokens, sink error text and forbidden fields | A local hash chain cannot make the writer durable, encrypted, access-controlled or immutable; retention/deletion, SIEM delivery, named owner and operator attribution are absent | Partially mitigated |
| TM-06 | Information disclosure | Credentials, raw URLs, bodies or arbitrary errors leak through telemetry | Low-sensitivity server/client spans, fixed metric labels and exporter wrappers; tests scan attributes and metrics | Real collector access control, retention and tenant isolation are unverified | Partially mitigated |
| TM-07 | Information disclosure | Authenticated or error responses are cached, transformed or validated with ETag | Private/error paths set `no-store, no-transform`, `Pragma: no-cache`, remove ETag and avoid compression; behavior tests cover failures | Target CDN/edge cache behavior is unverified | Partially mitigated |
| TM-08 | Information disclosure | Panic or validation responses expose stack, token, body or internal error text | Unified error boundary returns bounded messages; panic stack remains server-side with trace correlation | Log sink access control and redaction outside the process are unverified | Mitigated locally |
| TM-09 | Denial of service | Slow headers, partial bodies, oversized payloads or excessive connections exhaust resources | Application limits plus pinned Nginx header/body/client/upstream budgets, unbuffered proxying and local 431/502/503/504/upload-interrupt contract | No target-edge slow-client test, HTTP/3 limit, FD dashboard or capacity breakpoint artifact | Partially mitigated |
| TM-10 | Denial of service | Business concurrency or request rate exhausts CPU and downstream budgets | Nonblocking admission, request deadline, rate limiter, draining and rejection counters | Rate and idempotency state are single-process; no distributed quota | Partially mitigated |
| TM-11 | Denial of service | Slow or failed collector blocks requests or causes unbounded telemetry memory | Official batch processor, exact capacity/drop/pending gauges, timeout, recovery tests and alerts in `Framework/observability` | No real collector outage/soak or Alertmanager drill | Mitigated locally |
| TM-12 | Elevation of privilege | Metrics or pprof credentials reuse the JWT signing domain | Production config requires distinct JWT, metrics and pprof secrets; negative tests cover every reuse pair | Static bearer tokens lack central policy, short-lived identity and rotation platform | Partially mitigated |
| TM-13 | Elevation of privilege | An unauthenticated, wrong-role, or cross-tenant caller reaches a protected application resource | Bearer middleware and exact roles run before typed input; bounded resource authorization then validates tenant/type/ID/action/attributes and fails closed on deny/error/timeout/panic before handler or idempotency state. Example preview/describe enforce subject-owned tenants, with OpenAPI, privacy and no-application-span tests | Example ownership is a local static policy, not a target policy service or production relationship/attribute store; policy distribution, cache invalidation and administrative changes are unverified | Partially mitigated |
| TM-14 | Elevation of privilege | A dependency or build workflow is replaced with untrusted code | Locked Go/Yarn dependencies, action and image digests, CodeQL, dependency review, SBOM and vulnerability workflow | No signed image, SLSA provenance, deployment verification or remote-run artifact | Partially mitigated |
| TM-15 | Denial of service / Tampering | Rollout sends traffic to a draining instance or kills active requests before budgets expire | Readiness, explicit draining, propagation delay, shutdown budget and real connection convergence tests | No Kubernetes/equivalent rolling, eviction, PDB or rollback exercise | Partially mitigated |
| TM-16 | Spoofing / Tampering | A forged, mismatched, insufficient-assurance or replayed browser OIDC callback exchanges an authorization code, an incompatible provider authentication declaration causes credential downgrade, or duplicate JSON fields alter a security decision | `auth.OIDCClient` requires compatible discovery metadata, rejects duplicate/ambiguous bounded JSON before decoding, uses only Basic-header credentials or an explicitly declared public `none` method, and never falls back to body secrets. `httpapi.OIDCBrowser` hashes state into a fixed `__Host-` Secure/HttpOnly/SameSite=Lax cookie, atomically consumes hash-keyed state before exchange, clears the cookie on every callback, compares in constant time and verifies nonce, optional `at_hash` binding and matching token subjects. Redis accepts state only when its strict payload and global expiry index agree, with a pre-cleanup 10,000-entry bound and one-time failure for orphan/mismatched state. Optional assurance requires exact `acr`, every configured `amr` and fresh `auth_time`; tests cover auth-method mismatch, duplicate-key rejection, request shape, cross-client consume, concurrent replay, payload/index tamper, callback mismatch/provider failure, malformed assurance, `at_hash` mismatch and privacy | Local Redis/IdP substitutes do not prove target client registration, browser/IdP MFA enrollment/challenge, production Redis HA or a multi-replica target-environment callback drill | Partially mitigated |

## 5. Security Invariants

The following are release-blocking repository invariants:

1. Production startup fails for default/weak or cross-domain secrets, invalid proxy trust, invalid tracing endpoints, inconsistent timeout/lock budgets, missing Redis configuration, or unavailable external shared state.
2. Protected operations retain Bearer challenges and OpenAPI security references; compatibility gates reject silent authentication tightening.
3. Restricted data never appears in response bodies, metric labels, span attributes or request logs.
4. Dynamic route values never become metric labels; trace processor metrics remain label-free or use fixed outcomes.
5. Request body, header, connection, concurrency, rate, downstream and shutdown work all retain finite bounds.
6. A client-controlled idempotency key cannot replay a response across a different request fingerprint or authenticated principal.
7. `Solutions/Example` application and production project API code do not import Fiber types.
8. Resource policy denial, error, timeout, panic or invalid decision cannot execute the application handler, create command idempotency state, or expose subject, tenant, resource, attributes or backend details.
9. When OIDC assurance is configured, a callback without the exact `acr`, every required `amr` method and a fresh `auth_time` cannot establish an application session.
10. An OIDC client cannot exchange a code through an authentication method not selected from compatible discovery metadata, and a client secret cannot enter the token request form or query.
11. OIDC discovery and token response JSON cannot contain duplicate object keys, ambiguous case-folded keys, or multiple top-level values.
12. A browser-session inventory or public-ID revoke operation for one subject cannot enumerate or revoke another subject's session; single-session revocation must validate both hashed mapping directions before deletion.
13. A refresh-session user-wide operation cannot traverse more than the absolute family bound, derive a key from a non-canonical family ID, count or revoke another user's family, or partially mutate state after a later validation failure.
14. A refresh-session single-family operation cannot trust an unverified token mapping, traverse more than 1,024 used tokens, accept inconsistent family fields or active indexes, or mutate a legitimate family when current/used reverse mappings disagree.
15. A Redis-backed OIDC authorization request cannot be accepted unless its hash-keyed payload and global index member both exist with the same integral expiry, and create cannot clean an index above the absolute 10,000-entry bound.
16. A Redis-backed browser session cannot authenticate unless its bounded payload, positive-TTL bidirectional mappings, and global/subject index members all exist with the same integral expiry; create cannot clean either index above the absolute 10,000-entry bound or adopt a target orphan member.
17. Redis browser-session inventory and device metadata updates cannot accept or overwrite a selected session unless the same bounded payload, positive-TTL bidirectional mappings, and matching integral global/subject expiry members still form one subject-owned state; inventory cannot clean an index above the absolute 10,000-entry bound.
18. A queue publish/process, acknowledgement/dead-letter settlement, or lease-extension callback result observed after its finite operation deadline cannot become success or confirmation; parent cancellation and lease failure cannot start settlement.
19. A SQL driver nil result observed after its finite operation context cannot become success, and late query rows cannot enter a caller consumer; a timeout is an unknown write outcome rather than proof that a non-transactional statement was undone.

These invariants are enforced by `yarn test:node`, `yarn test:server`, `yarn race:server`, `yarn vet:server`, `yarn api:compat` and `yarn openapi:compat`.

## 6. Open Production Risks

The following items block a production-complete security claim:

- deploy and test the pinned policy on a target edge, including real certificates/DNS, HTTP/2/3, proxy headers, buffering, limits, disconnect and drain;
- complete the current JWKS/resource-session foundation with target IdP client-registration/discovery/browser evidence, actual MFA enrollment/challenge and claim mapping, device metadata and user-facing inventory/revocation, short-token policy, production Redis HA/TLS/ACL evidence for the hash-keyed authorization/session indexes and centralized revocation, and a production tenant/resource policy store with change governance;
- deploy KMS/Vault-equivalent secret storage with access policy, rotation, break-glass and audit evidence;
- deploy atomic external rate/idempotency state and test two-instance failure, eviction, failover and reconnect behavior;
- deploy an immutable audit sink or durable hash-chain-backed adapter and define access control, retention, privacy deletion, SIEM delivery, incident ownership and operator attribution;
- validate a real collector/backend, database, outbound dependency and paging route under controlled failure;
- sign release images, produce provenance and enforce deployment-time verification;
- run multi-replica rollout, eviction, rollback, restore and RPO/RTO exercises.

## 7. Review Triggers And Ownership

Repository maintainers own this model until named security and service owners are recorded. Review is required for any of the following:

- new public route, authentication method, role, data class or externally reachable diagnostic endpoint;
- new database, queue, cache, shared-state provider, downstream API, collector or edge product;
- change to token claims, secret storage, proxy trust, CORS, request limits, logging or telemetry attributes;
- Framework major/minor release, transport migration, multi-replica deployment or material incident;
- at least once per release cycle even when no trigger is reported.

Every review must update the threat status, evidence path, residual risk and date. Production exceptions require a named owner, expiry and compensating control outside this repository.

## 8. References

- [OWASP Threat Modeling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html)
- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP API Security Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)
- [RFC 6750 Bearer Token Usage](https://www.rfc-editor.org/rfc/rfc6750)
- [RFC 7519 JSON Web Token](https://www.rfc-editor.org/rfc/rfc7519)
