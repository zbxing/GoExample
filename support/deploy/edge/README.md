# GoExample Nginx Edge Baseline

This directory defines the repository-level V12-01 edge contract. It pins Nginx 1.30.4 Alpine to an immutable multi-platform OCI digest and fixes the TLS, HTTP/2, header/body, timeout, streaming and drain policy used before the Go application. It does not claim that a target ingress, load balancer, certificate or DNS route has been deployed.

## Render

Validate the version-controlled contract and render an environment-specific Nginx configuration:

```powershell
yarn edge:check
yarn edge:render --server-name api.example.com --upstream-host goexample-api --upstream-port 80
```

The output is `.temp/deployment/edge/goexample-nginx.conf`. The renderer accepts plain DNS names only, rejects wildcard/server URL input, requires a finite port and writes only under `.temp/deployment`. Mount the generated file read-only at `/etc/nginx/nginx.conf` in the exact image recorded by `goexample-nginx.contract.json`.

TLS material remains external. Mount a certificate chain and private key read-only at:

```text
/run/secrets/goexample-edge/tls.crt
/run/secrets/goexample-edge/tls.key
```

The target platform must send `SIGQUIT` and allow 30 seconds for container stop. Nginx gives workers 25 seconds to drain. The certificate issuer, renewal, file permissions, SNI/DNS ownership and secret delivery mechanism are target-environment responsibilities.

## Contract

- The client listener is TLS-only on port 8443, allows TLS 1.2/1.3 and negotiates HTTP/1.1 or HTTP/2. HTTP/3 is not enabled or claimed.
- A single header or request line is limited to a 16 KiB large-header buffer; Nginx internal status 494 is mapped to public 431. The aggregate large-header pool is four buffers.
- Request bodies are limited to 4 MiB. Request and response proxy buffering are disabled so streaming and client upload interruption can propagate instead of being hidden behind edge disk buffering.
- Client header/body/send budgets are 10 seconds. Upstream connect is 2 seconds and upstream send/read are 10 seconds, which leaves the application 8-second request deadline inside the edge read budget.
- Upstream retries are disabled. This avoids replaying non-idempotent requests outside the application's idempotency contract.
- Nginx replaces client `X-Request-ID` with its bounded generated ID, preserves W3C `traceparent`/`tracestate`, and supplies explicit forwarded protocol/address headers. `TRUSTED_PROXIES` in the application must contain only the actual edge addresses.
- Access logs omit URI/query, Authorization, Cookie, request/response bodies, client address and arbitrary headers. They retain request ID, method, status and bounded timing/upstream status fields.
- Upstream 503 passes through. Broken upstream responses and read timeouts produce 502 and 504 respectively.

## Real Contract

`yarn edge:contract` requires a Linux Docker host and OpenSSL. It generates a one-day local certificate, renders the config, validates it with `nginx -t`, then runs the exact pinned image. The scenarios cover TLS/HTTP/2 ALPN, trace and request-ID boundaries, 431, 502, 503, 504, upload interruption and an in-flight response completing during SIGQUIT drain.

The runner always writes the exact six-artifact set `environment.txt`, `test-output.json`, `nginx.log`, `test-status.txt`, `report.json` and `SHA256SUMS` to `.temp/workflow-artifacts/nginx-edge-contract`. Run `yarn edge:contract:verify` to independently bind the fixed command, Node/runner identity, source commit, pinned image, contract/renderer/runner/runbook/verifier/workflow hashes, timestamps, exit status, raw output hashes and ordered scenarios. Successful evidence must contain all seven scenarios; failed evidence retains a bounded error and only the completed ordered scenario prefix. CI runs this verifier and uploads the directory even when the contract fails.

These artifacts remain marked `localContractOnly`. They prove the fixed Linux loopback Nginx contract and its evidence integrity, not the selected target edge, real certificate or DNS ownership, HTTP/3, production capacity, disconnect propagation or rollback. `targetEdge=not_recorded` remains unchanged until independently verified target-environment evidence is archived.

## Production Boundary

V12-01 remains incomplete until the selected target edge or ingress produces auditable results for real certificates, DNS, HTTP/2 and HTTP/3 policy, proxy/header normalization, 431/502/503/504 behavior, slow upload/read, streaming/disconnect propagation, capacity, drain and rollback. The evidence manifest therefore keeps `targetEdge=not_recorded` for this repository baseline.
