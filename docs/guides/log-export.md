---
title: Log export
parent: Guides
nav_order: 9
---

# Export operational logs

Enable `otel.logs` to export structured harness lifecycle and diagnostic records. Local terminal
output and `daemon.log` remain the primary operator view. Log export is off by default and uses
OTLP/HTTP protobuf only.

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

## Endpoint and secret syntax

`otel.logs.endpoint` is an OTLP base URL, not a final log URL. The harness removes trailing slashes
and repeated `/v1/logs` suffixes, then appends exactly one `/v1/logs`. Thus both
`https://collector.example` and `https://collector.example/v1/logs` send to
`https://collector.example/v1/logs`. Keep any required backend prefix in the base URL: an
Elasticsearch OTLP endpoint, for example, uses `https://elasticsearch.example/_otlp` and receives
`https://elasticsearch.example/_otlp/v1/logs`.

Credentials are references, not literals. A header must be written as `{ env: VARIABLE_NAME }` and
the named process-environment variable supplies its value at send time. Where a provider documents a
header prefix, put the complete value—including that prefix—in the variable. Never put a real token,
API key, presigned URL, or query-string credential in this file; query strings are rejected.

The example above references `LOG_EXPORT_TOKEN`; it does not contain the token. The same rule applies
to every recipe below.

## Destination recipes

### Loki

Point at Loki's OTLP base path. Loki must permit structured metadata (`allow_structured_metadata:
true`; it is enabled by default in Loki 3.0+). The harness's complete `feature` identity is record
metadata, so do not promote it to an indexed label unless its cardinality is acceptable.

```yaml
otel:
  logs:
    enabled: true
    endpoint: https://loki.example/otlp
    headers:
      Authorization:
        env: LOKI_AUTHORIZATION
```

This sends to `https://loki.example/otlp/v1/logs`. Configure `LOKI_AUTHORIZATION` in the process
environment with the full value required by the Loki gateway. See Loki's
[OTLP ingestion guide](https://grafana.com/docs/loki/latest/send-data/otel/) for backend setup.

### Elasticsearch or an OpenTelemetry Collector

Use an Elasticsearch deployment that exposes the OTLP endpoint, with its required `/_otlp` base path,
or send to a network collector that has an OTLP receiver and an Elasticsearch exporter. A collector
receives OTLP over the network; it does not need a checkout mount or access to local daemon files.

```yaml
otel:
  logs:
    enabled: true
    endpoint: https://elasticsearch.example/_otlp
    headers:
      Authorization:
        env: ELASTIC_OTLP_AUTHORIZATION
```

This sends to `https://elasticsearch.example/_otlp/v1/logs`. If the deployment uses API-key
authentication, `ELASTIC_OTLP_AUTHORIZATION` contains the complete provider-required authorization
value, including its `ApiKey` prefix. For a collector, replace the endpoint with its OTLP base URL
and use only the header references that collector requires. See Elastic's
[OTLP/HTTP endpoint reference](https://www.elastic.co/docs/manage-data/ingest/otlp-endpoint).

### Sumo Logic

Create an OTLP/HTTP Source and use the source URL it provides, selecting its separate authorization
header rather than a presigned URL with embedded credentials.

```yaml
otel:
  logs:
    enabled: true
    endpoint: https://sumo-source.example
    headers:
      Authorization:
        env: SUMO_OTLP_AUTHORIZATION
```

This sends to `https://sumo-source.example/v1/logs`. `SUMO_OTLP_AUTHORIZATION` holds the complete
header value supplied for that source, including the `x-sumo-token:` prefix when required. See
Sumo Logic's [OTLP/HTTP Source guide](https://www.sumologic.com/help/docs/send-data/hosted-collectors/http-source/otlp/).

### Datadog

Use the OTLP intake hostname for your Datadog site and an API-key header reference. The site is part
of the hostname, so choose the hostname for the account rather than copying a different site's URL.

```yaml
otel:
  logs:
    enabled: true
    endpoint: https://otlp.datadoghq.com
    headers:
      DD-API-KEY:
        env: DD_API_KEY
```

This sends to `https://otlp.datadoghq.com/v1/logs`; replace `datadoghq.com` with the account's
Datadog site where appropriate. `DD_API_KEY` holds only the API-key value. See Datadog's
[OTLP logs intake guide](https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest/logs/) for the
site-specific endpoint.

## Delivery and retention

Use an explicit `logs.endpoint` when logs should have a different destination from the parent
trace/metric OTLP endpoint. If the parent is a valid HTTP/protobuf OTLP exporter, logs can instead
inherit its endpoint and header references:

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
sends new records directly and leaves any older retained batches untouched. See
[configuration](../reference/configuration.md#otellogs) for the independent 64 MiB log spool cap and
the complete setting contract.
