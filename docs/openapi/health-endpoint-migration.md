# Health endpoint migration

The `/api/health`, `/api/health/ready`, and `/api/health/startup` compatibility routes are deprecated as of 2026-08-20. They are scheduled to sunset no earlier than 2027-02-20, providing a 184-day migration window.

| Deprecated route | Successor | Meaning |
| --- | --- | --- |
| `GET /api/health` | `GET /livez` | Process liveness |
| `GET /api/health/ready` | `GET /readyz` | Traffic readiness and draining state |
| `GET /api/health/startup` | `GET /startupz` | Startup completion |

The response envelope and status semantics are unchanged during the migration window. Deprecated routes return these headers on successful and error responses:

- `Deprecation: @1787184000`, an RFC 9745 Structured Field Date.
- `Sunset: Sat, 20 Feb 2027 00:00:00 GMT`, an RFC 8594 sunset date.
- `Link: </replacement>; rel="successor-version"`, an RFC 8288 link to the canonical route.

Consumers should update probe definitions, monitors, allowlists, and generated clients to use the successor paths. Verify both 200 and 503 readiness behavior before removing the compatibility paths from consumer configuration.
