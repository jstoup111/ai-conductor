# Intake origin: feature-cost-and-shipment-metrics-cannot-be-groupe

Source-Ref: jstoup111/ai-conductor#2528
Owner: jstoup111

## Desired outcome

- Feature cost and shipped-feature metrics for features with a known complexity tier expose the correct S/M/L tier in Grafana's metrics datasource.
- Operators can group feature costs and shipment counts by tier using those metrics directly, without joining step metrics or consulting repository artifacts.
- Grouping by tier preserves the underlying shipment counts and cumulative feature-cost totals: no duplicate shipments or duplicated cost observations are introduced.
- Unknown or unavailable tier is represented honestly; it is never fabricated as S, M, or L, and telemetry export continues.
- Existing feature attribution and custom attributes remain usable alongside tier, including grouping by both tier and an operator-supplied attribute.
