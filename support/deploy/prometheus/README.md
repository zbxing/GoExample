# Prometheus configuration

`prometheus.yml` is the repository baseline for scraping the production GoExample API and loading `rules/goexample-slo.yml`.

The configuration expects:

- the GoExample Kubernetes Service to resolve as `goexample-api:80`;
- `/metrics` to require the application's independent production Bearer token;
- the token to be mounted beside the configuration at `secrets/goexample_metrics_token`;
- a 30-second scrape and rule evaluation interval with a 10-second scrape timeout.

Mount the configuration, `rules/` directory, and secret file under the same Prometheus configuration directory. Do not put the real token in this repository. `secrets/` is ignored, and `yarn prometheus:rules` creates a non-secret validation fixture only for the duration of `promtool check config`.

The validation command uses the pinned, source-built `promtool` to run full config and referenced-file validation with fatal linting, standalone rule linting, and deterministic rule behavior tests. The evidence bundle records the configuration, rules, tests, commands, outputs, timestamps, tool identity, and exit codes.

This baseline does not prove that Prometheus or Alertmanager is deployed, that target telemetry is being scraped, or that notifications, paging, ownership, and controlled alert drills work. Those remain target-environment evidence requirements.
