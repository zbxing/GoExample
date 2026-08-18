# GoExample SLO and Alerts

This is the first executable service-level objective definition for the HTTP server. It is intentionally scoped to the metrics emitted by `Framework/observability.Metrics`; it does not claim that an external Prometheus, Alertmanager, dashboard, or paging route is deployed.

## Objectives

| SLI | Objective | Measurement | Error budget |
| --- | ---: | --- | ---: |
| Availability | 99.9% monthly | Responses whose status is not `5xx` divided by all HTTP responses | 0.1% |
| Latency | 95% under 250ms | `goexample_http_request_duration_seconds` p95, excluding `5xx` | 5% of requests |
| Saturation | No fixed objective yet | `goexample_http_requests_in_flight`, `goexample_http_admission_rejections_total`, `goexample_http_draining_rejections_total`, goroutines and heap gauges | Capacity baseline required |

The availability definition deliberately excludes server failures only. Client errors remain visible in the metrics and logs, but do not consume the server availability budget. A route-specific SLO should be added only after its traffic volume and user impact are known.

## Rules

Load `deploy/prometheus/rules/goexample-slo.yml` into Prometheus with `rule_files`. The file provides five-minute, 30-minute, one-hour, six-hour and three-day windows, availability error ratios, a latency histogram SLI, and multi-window burn-rate alerts:

- critical availability: 5m and 1h burn rate above 14.4x;
- warning availability: 30m and 6h burn rate above 6x;
- warning latency: p95 above 250ms for 10 minutes.

The alert rules aggregate route-template labels before calculating service ratios, so dynamic IDs are not used as metric labels. Admission and draining rejection rates are recorded separately without labels; they are diagnostic signals until a capacity baseline and rollout policy establish alert thresholds. A zero-traffic interval produces `NaN` rather than a false outage; operators must still require a minimum request volume before treating a low-traffic ratio as statistically meaningful.

## Operating procedure

1. Confirm the alert is not caused by a scrape, deployment, or edge outage by checking `goexample_process_uptime_seconds`, `goexample_http_requests_in_flight`, `goexample_http_admission_rejections_total`, `goexample_http_draining_rejections_total`, and the application logs. A rising admission counter means the API limit is being exhausted; a rising draining counter is expected during rollout and should be correlated with readiness and deployment events.
2. Use the `traceparent` response value and the `trace_id`/`span_id` JSON log fields to correlate an affected request. Trace export is not installed yet, so this correlation is local to the process logs.
3. Check the route, status, latency bucket, goroutine, heap, and GC metrics before changing limits or rolling back.
4. Record the time range, affected route, customer impact, and mitigation. Close the incident only after the burn rate returns below the alert threshold and a follow-up action is filed.

## Evidence boundary

The repository tests the metric names, label normalization, trace propagation, and rule presence. It does not yet run `promtool`, provision a Prometheus/Alertmanager pair, export OTLP spans, or perform a controlled paging drill. Those are required before declaring the observability objective production-complete.
