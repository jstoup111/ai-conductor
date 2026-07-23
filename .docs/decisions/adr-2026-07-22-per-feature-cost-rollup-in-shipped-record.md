# ADR 2026-07-22-b — Per-feature cost rollup lives in the committed shipped-record

Status: APPROVED
Date: 2026-07-22
Feature: per-feature-token-accounting (#537)

## Context

The KPI (tokens-per-shipped-feature) must be "readable from a single command or file after ship" and
"computable across features and over time" — without manual log archaeology. We need a per-feature
cost record that is durable, attributable, and trend-friendly. Candidate homes: the per-worktree
`.pipeline/events.jsonl` (ephemeral, discarded with the worktree), a new `.daemon/` ledger (per-repo,
not committed, lost on machine change), or the existing committed `.docs/shipped/<slug>.md`.

## Decision

Persist the rollup as a `Cost:` block in the existing committed `.docs/shipped/<slug>.md` record,
written at ship by aggregating the feature's own per-worktree `events.jsonl` plus the existing
dispatch/retry/halt signals. The block records, per feature:

- `tokens`: summed input / output / cache_read / cache_creation across all metered `step_completed`
  events,
- `cost_usd`: summed `total_cost_usd`,
- `dispatches`, `retries`, `halts`: counts,
- `unmetered`: `{count, duration_ms}` — sessions the engine could not meter (parse failure, or
  non-daemon sessions), so a partial total is visibly partial.

Attribution requires no change to the shared event bus: `.pipeline/` is per-worktree and each feature
builds in its own worktree, so `events.jsonl` is already per-feature.

The `step_completed` emit carries `model` alongside `tokenUsage`, keeping the existing OTel
`conductor.step.tokens` counter fed so the deferred OTel-first work (Approach C) is a consumer swap,
not a re-wire.

The KPI/trend surface (`conduct kpi`) reads committed `.docs/shipped/*.md` Cost blocks — no new
database, no daemon-shared store; trend survives machine changes because the data is in git.

## Consequences

- Ship becomes the aggregation point; `writeShippedRecord` gains the Cost block. If the worktree's
  `events.jsonl` is absent/partial, the rollup still writes with everything it has, marking the gap in
  `unmetered` (never fails ship).
- Retro reads the real Cost block instead of estimating (skills/retro Part C).
- Human operator sessions are out of scope for metering but appear in `unmetered` when known; full
  operator metering is deferred Approach B.
- Cost definition is intentionally not lossy: all four token classes + cost are retained; the KPI
  headline chooses input+output, leaving cache-aware cost modeling to later work.
