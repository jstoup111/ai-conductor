---
title: Log export
parent: Guides
nav_order: 9
---

# Export operational logs

Enable `otel.logs` to export structured harness lifecycle and diagnostic records. Local terminal
output and `daemon.log` remain the primary operator view. Every URL below is normalized to exactly
one `/v1/logs`; omit that suffix in examples unless your collector requires showing it.

```yaml
otel:
  exporter: otlp
  endpoint: https://collector.example
  logs:
    enabled: true
    headers:
      Authorization:
        env: LOG_EXPORT_TOKEN
```

Credentials are references, not literals. Set `LOG_EXPORT_TOKEN` in the daemon or interactive
process environment; its value is never retained in the spool.

## Destination recipes

| Destination | `otel.logs.endpoint` | Header references |
| --- | --- | --- |
| Loki OTLP | `https://loki.example/otlp` | `Authorization: { env: LOKI_TOKEN }` |
| OpenTelemetry Collector / Elasticsearch pipeline | `https://collector.example` | collector-specific headers, if any, as `{ env: NAME }` |
| Sumo Logic OTLP | `https://otlp.sumologic.com` | `Authorization: { env: SUMO_TOKEN }` |
| Datadog OTLP intake | `https://otlp-http-intake.logs.datadoghq.com` | `DD-API-KEY: { env: DD_API_KEY }` |

Example with a dedicated endpoint:

```yaml
otel:
  exporter: otlp
  endpoint: https://traces.example
  logs:
    enabled: true
    endpoint: https://loki.example/otlp
    headers:
      Authorization:
        env: LOKI_TOKEN
```

With `otel.logs.spool.enabled: true` (the default), logs are committed locally before successful
acknowledgement and are retried only to their original authorized destination. Setting it to `false`
sends new records directly and leaves any older retained batches untouched.
