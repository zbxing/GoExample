# Billing service

`Services/Billing` is an independently deployable, reusable Framework service
in the workspace. It
keeps its application use case in `internal/billingapp`, exposes the service
through `httpapi.NewHTTPHandler` and `server.RunHTTP`, and publishes a small
OpenAPI contract at `docs/openapi/billing.json`.

Run its standard workspace tasks with:

```powershell
$env:GO_PROJECT = 'Billing'
yarn test:server
yarn build:server
yarn sdk:check --project Billing
```

This is repository-local multi-project evidence. It does not claim an
external consumer, SDK release tag, target deployment, or production
migration.
