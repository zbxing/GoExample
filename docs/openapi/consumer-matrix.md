# API consumer and SDK matrix

Updated: 2026-08-24

| Consumer | Owner | SDK | API contract | Deprecated health aliases | Migration evidence | Deployment evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `support/consumer/HealthProbe` | GoExample maintainers | Go `1.4.0` | OpenAPI `1.4.0` | Migrated to `GET /readyz` | Automated real Framework adapter test verifies old headers, successor link, then canonical-only traffic | Not available; repository-local consumer only |
| `Services/Billing` | GoExample maintainers | Go `1.0.0` | OpenAPI `1.0.0` | Uses canonical `GET /readyz` | Independent Framework `net/http` service exposes `GET /api/v1/billing/summary`; Go and Node contract checks run in the workspace | Not available; repository-local service only |

The generated SDK covers all 26 published operation IDs for Example and the smaller Billing contract is generated independently. `contracts/projects.json` selects the source document for each managed service; `yarn sdk:check --project <project>` regenerates that service's SDK from its workspace or pinned Git contract, rejects unsupported contract shapes, compares the exact formatted source, and requires the matching SDK `VERSION` to match OpenAPI `info.version`.

The compatibility routes remain supported until no earlier than 2027-02-20. This matrix must be updated before an SDK or API release, when a consumer is added, or when a deprecated operation is removed. A local executable and test establish repeatable compatibility evidence, but do not count as a second external production consumer or a completed target deployment migration.
