# Billing Go SDK

This module is the generated Go client for `docs/openapi/billing.json`. It has no third-party runtime dependency and is exercised against the independent Billing Framework service.

Current SDK version: `1.0.0`.

Regenerate and verify from the repository root:

```powershell
yarn sdk:generate --project Billing
yarn sdk:check --project Billing
```

The built-in HTTP client applies a 30-second total request timeout and returns the first redirect response without following it, preserving the status, `Location`, `Set-Cookie`, and bounded body for explicit caller handling; a client supplied through `WithHTTPClient` retains its own timeout and redirect policy. Shorter caller cancellation and elapsed deadlines are authoritative before request editors, after each editor, after the injected HTTP client, after the bounded response read, and before the final response is returned. Rejected request/response bodies are closed by the layer that owns them; a nil response or nil body fails with a fixed error instead of panicking. Cancellation cannot retract a request already accepted by a remote server.

## Release readiness

Prepare and verify the deterministic release manifest from the repository root:

```powershell
yarn sdk:release:prepare --project Billing
yarn sdk:release:verify --project Billing
```

The manifest records the expected module-scoped tag `SDK/Billing/v1.0.0`, source and generated-artifact SHA-256 values, module path, source commit, and published operation metadata. It does not create, inspect, or prove publication of a Git tag, package, external consumer, or deployment migration.
