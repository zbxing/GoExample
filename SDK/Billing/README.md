# Billing Go SDK

This module is the generated Go client for `docs/openapi/billing.json`. It has no third-party runtime dependency and is exercised against the independent Billing Framework service.

Current SDK version: `1.0.0`.

Regenerate and verify from the repository root:

```powershell
yarn sdk:generate --project Billing
yarn sdk:check --project Billing
```

## Release readiness

Prepare and verify the deterministic release manifest from the repository root:

```powershell
yarn sdk:release:prepare --project Billing
yarn sdk:release:verify --project Billing
```

The manifest records the expected module-scoped tag `SDK/Billing/v1.0.0`, source and generated-artifact SHA-256 values, module path, source commit, and published operation metadata. It does not create, inspect, or prove publication of a Git tag, package, external consumer, or deployment migration.
