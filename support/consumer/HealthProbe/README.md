# HealthProbe consumer

`HealthProbe` is an independent executable consumer of the versioned GoExample Go SDK. It calls canonical `GET /readyz`, requires a successful HTTP status and envelope, and never uses the deprecated `/api/health/ready` alias in production code.

```powershell
$env:GOEXAMPLE_BASE_URL = "http://localhost:3001"
go run ./cmd/healthprobe
```

The command has a five-second total request budget. Its migration contract test runs against the real Framework HTTP adapter: it verifies the legacy endpoint's `Deprecation`, `Sunset`, and successor `Link`, then proves the migrated consumer calls only `/readyz`. This is a repository-local migration rehearsal, not evidence that an external deployment has migrated.
