# GoExample Go SDK

This module is the generated Go client for `docs/openapi/openapi.json`. Its `VERSION` matches OpenAPI `info.version`; generated source has no third-party runtime dependency.

Current SDK version: `1.4.0`.

Regenerate and verify from the repository root:

```powershell
yarn sdk:generate
yarn sdk:check
```

The client validates its server URL, applies a 1 MiB response limit by default, preserves caller contexts, and exposes every published `operationId`, including browser-session inventory, bounded device-name update, and subject-bound revocation operations. Deprecated health aliases remain generated during their compatibility window but carry Go `Deprecated` documentation. New consumers should call `GetLiveness`, `GetReadiness`, and `GetStartup`.

This repository-local generation and contract testing does not prove that an external consumer has deployed a migration.

## Release readiness

Prepare and verify the deterministic release manifest from the repository root:

```powershell
yarn sdk:release:prepare --project Example
yarn sdk:release:verify --project Example
```

The manifest records the expected module-scoped tag `SDK/GoExample/v1.4.0`, source and generated-artifact SHA-256 values, module path, source commit, and published operation metadata. It does not create, inspect, or prove publication of a Git tag, package, external consumer, or deployment migration.
