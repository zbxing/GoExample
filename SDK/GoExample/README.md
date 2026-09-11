# GoExample Go SDK

This module is the generated Go client for `docs/openapi/openapi.json`. Its `VERSION` matches OpenAPI `info.version`; generated source has no third-party runtime dependency.

Current SDK version: `1.4.0`.

Regenerate and verify from the repository root:

```powershell
yarn sdk:generate
yarn sdk:check
```

The client validates its server URL, applies a 1 MiB response limit by default, and exposes every published `operationId`, including browser-session inventory, bounded device-name update, and subject-bound revocation operations. Its built-in HTTP client applies a 30-second total request timeout and returns the first redirect response without following it, preserving the declared status, `Location`, `Set-Cookie`, and bounded body for explicit caller handling; a client supplied through `WithHTTPClient` retains its own timeout and redirect policy. Shorter caller cancellation and elapsed deadlines are authoritative before request editors, after each editor, after the injected HTTP client, after the bounded body read, and before the final response is returned. Rejected request/response bodies are closed by the layer that owns them; a nil response or nil body fails with a fixed error instead of panicking. Cancellation cannot retract a request already accepted by a remote server. Deprecated health aliases remain generated during their compatibility window but carry Go `Deprecated` documentation. New consumers should call `GetLiveness`, `GetReadiness`, and `GetStartup`.

This repository-local generation and contract testing does not prove that an external consumer has deployed a migration.

## Release readiness

Prepare and verify the deterministic release manifest from the repository root:

```powershell
yarn sdk:release:prepare --project Example
yarn sdk:release:verify --project Example
```

The manifest records the expected module-scoped tag `SDK/GoExample/v1.4.0`, source and generated-artifact SHA-256 values, module path, source commit, and published operation metadata. It does not create, inspect, or prove publication of a Git tag, package, external consumer, or deployment migration.
