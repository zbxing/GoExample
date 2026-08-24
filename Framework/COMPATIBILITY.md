# Framework compatibility policy

`Framework` is currently on the `0.1.x` development line. A release tag must use the module-scoped form `Framework/v0.1.0`; the repository currently does not claim that such a release has been published.

## Supported baseline

- Go language: `1.25.x`; CI and local orchestration currently pin `go1.25.13`.
- Fiber: `3.5.x` for the transport-specific APIs that remain public.
- API snapshot: `Framework/api-snapshot.json`, generated from importable production packages only.

Run `yarn api:compat` to require the working snapshot and current exported API to match. Run `yarn api:snapshot` only when intentionally adding API or after an approved compatibility-line change. Once the first snapshot exists on the target branch, the PR workflow additionally compares the current API with that target snapshot: additions are compatible, while removal or signature changes fail. The one-time bootstrap path is explicit in CI and still requires the current source and checked-in snapshot to match exactly.

Before `v1.0.0`, a breaking change requires a minor version increment in `Framework/VERSION`, an updated snapshot, an `Unreleased` changelog entry, and migration guidance. At or after `v1.0.0`, it requires a major version increment. Patch releases never permit source-incompatible API changes.

The optional `httpapi.Options.OIDCBrowser` field and `httpapi.NewOIDCBrowser` constructor are additive. Existing resource-server and demo compositions retain their routes and behavior when the field is nil; the original constructor retains callback-only behavior. `httpapi.NewOIDCBrowserWithSessions`, `auth.BrowserSessionManager`, and `auth.BrowserSessionStore` are additive opt-in APIs. Session-enabled compositions add a conditional logout operation and allow protected routes to use the opaque cookie; unsafe cookie-authenticated requests must supply the bound CSRF cookie/header pair. Bearer behavior is unchanged and an explicit Authorization header always takes precedence over cookies.

Session-enabled compositions now also add conditional list, bounded device-name update, subject-bound single-session revoke, and revoke-all routes. This is an additive OpenAPI `1.4.0` change: existing operations are unchanged, while clients that use the new PATCH or DELETE operations must send the CSRF cookie/header pair when authenticating by browser cookie. Bearer-authenticated calls do not require CSRF. Malformed, unknown, and cross-subject public session IDs intentionally share the same 404 response; legacy stores without inventory or metadata support fail closed with 503. Device names are explicit caller metadata only; the Framework does not infer a device fingerprint or parse User-Agent values.

`auth.BrowserSessionConfig.MaxSessionsPerSubject`, the public session inventory types/methods, and `BrowserSessionInventoryStore` are additive. A zero per-subject limit defaults to the existing global limit. The original `BrowserSessionStore` method set is unchanged, so existing stores continue to support start/verify/end; inventory operations against a legacy external store return `ErrBrowserSessionInventoryUnavailable`. Store implementations that opt into the extension must preserve subject scoping, bounded results, atomic limits/revocation and fail-closed backend errors.

The Redis browser-session payload and indexes now include the public session ID, hashed subject ownership and creation time. A rolling deployment must treat pre-inventory browser sessions as invalid and require reauthentication, or drain/reset only the application's browser-session namespace before enabling the new binary; mixed old/new writers are not supported. Authorization-request and refresh-session namespaces are unaffected.

`auth.AuthorizationRequestStore`, `AuthorizationRequestRecord`, and the `StartContext`/`CompleteContext` methods are additive. Existing `Start`/`Complete` callers retain bounded in-process behavior. Injecting a store changes ownership of pending state to that backend; implementations must preserve hash-only state keys, atomic one-time consumption, finite expiry and fail-closed errors.

The optional `auth.JWKSConfig.RequiredACR`, `RequiredAMR`, and `MaxAuthAge` fields and `auth.AuthorizationRequestConfig.ACRValues` are additive. Their zero values preserve existing ID-token and authorization-request behavior. When enabled, assurance requirements intentionally reject callbacks without a matching `acr`, every required `amr` value, and a fresh `auth_time`; callers must deploy the matching IdP policy before enabling them.

The snapshot gate covers exported declarations and signatures. It does not prove behavioral compatibility, serialized schema compatibility, performance stability, or a successful release. Those require contract tests, benchmarks, deprecation windows, and release artifacts appropriate to the change.

The unreleased `queueclient.Client.MinimumDeliveryLease`, optional delivery lease-extension fields/callback/observer, and `natsjetstream.PreflightConsumer` APIs are additive on the `0.1.x` line; zero values keep the prior static-budget behavior and existing adapter construction remains source-compatible. Deployments that enable JetStream lease extension must run preflight with the exact worker configuration and treat either a failed server-backed lease check or runtime extension failure as fail-closed. The local `InProgress` contract does not provide target-environment latency calibration or exactly-once settlement.
