# Complexity: Durable OTel export queue

Tier: M

Operator scope: Balanced, confirmed 2026-09-29 during explore.

The change adds one new engine component — a write-first, disk-backed OTLP spool with a drain loop — wrapped around the existing span and metric exporters in `src/conductor/src/engine/otel/`. It introduces new storage (a bounded spool directory under `.daemon/`), a new `otel:` config surface for the spool, a new drop/backlog event on the existing event spine, and amends ADR-014 Decisions 4 and 5 (in-memory, failure-isolated export). It must be verified against two backend families (Datadog Agent/DDOT and Grafana LGTM) and ship reference collector configuration for both. No new service or process, no hook wiring, settings schema, or skill symlink change. Logs export (#1935) and events.jsonl replay are excluded. Medium: new storage, config and cross-backend contract warrant a lightweight architecture review, conflict check, and coherence check, but the change is contained to one subsystem.
