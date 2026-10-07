# ADR: Failed provider attempts feed the existing cost telemetry

**Date:** 2026-10-07
**Status:** APPROVED
**Deciders:** James Stoup (operator)
**Amends:** the "failed runs record no usage" decision of #2979
(`.docs/plans/pi-runs-report-token-usage-and-cost-into-harness-t.md` Task 4,
`architecture-review-2026-10-02-pi-runs-report-token-usage-and-cost-into-harness-t.md` C3) and the
equivalent Claude/Codex rule from #1871 (`.docs/stories/streaming-provider-dispatches-record-no-token-usag.md`)
**Conforms to:** adr-2026-07-27-cost-unmetered-is-a-first-class-state

## Context

#2979 made Pi record token usage only from successful streams. A non-zero exit or a terminal
`stopReason: "error"` recorded no `tokenUsage`. #1871 already did the same for Claude and Codex,
which kept usage only when `exitCode === 0`. Both rules exist to keep fabricated or partial figures
out of the cost record.

The rules also threw away real spend. On 2026-10-06, between 19:05 and 20:02 UTC, a DeepSeek build
on Pi via OpenRouter ran in `.worktrees/engine-cannot-represent-more-than-one-branch-step-` for
about an hour. It billed turn after turn and then failed on a run of `402` credit errors. Every turn
before the failure had a complete, provider-reported `message_end` usage record. None of it reached
the event log because the attempt failed. Roughly $50 of spend was recorded as about $0.

The same loss happened elsewhere:
- A Claude `error_max_turns` record carries `total_cost_usd` but no `result` text, and was ignored.
- When the model-fallback ladder moved to its next rung, it discarded the previous rung's usage.
- A cancelled run dropped the turns it had already completed.
- An invocation whose candidate teardown threw emitted no attempt event at all.
- `--report` summed only `step_completed`, which never describes a failure.

Operator requirement: cost for every provider is success + failure, and it must be accurate. The
existing cost telemetry must carry it, with no new telemetry.

## Options Considered

1. **Keep success-only metering.** Rejected. It systematically under-reports cost, and it does so
   most in the expensive failures.
2. **Sum every usage figure in the stream, including mid-stream updates.** Rejected. Pi
   `message_update` records and Claude per-assistant `usage` records are partial or cumulative
   snapshots of a message still in flight, so summing them fabricates and double counts.
3. **Add new telemetry to flag partial and failed spend.** Rejected by the operator. The
   implementation would have added:
   - a `TokenUsage.incomplete` "floor" marker
   - a `failed` breakdown in the rollup
   - new `feature_usage_total` fields
   - shipped-record `cost_incomplete:` and `failed:` lines
   - a KPI `COST-FLOOR` tag
   - an OTel `cost_complete` change

   Each is a new surface every consumer would need to learn, while the existing states already say
   what is needed.
4. **Count only complete, well-formed records on every outcome, and feed them through the existing
   telemetry (chosen).**

## Decision

1. **Failed attempts feed the existing cost telemetry; no new telemetry fields.** A failed
   attempt's usage goes on the existing `TokenUsage` of the existing `provider_attempt` event, and
   that event already carries `outcome`. From there it flows unchanged into `computeCostRollup`,
   `feature_cost_snapshot`, `feature_usage_total`, the shipped-record `## Cost` block, `--report`,
   and the OTel `conductor.feature.cost`, `conductor.feature.step.cost` and
   `conductor.step.dispatches` instruments. Every total is success + failure.
2. **What each adapter records for a failed attempt:**
   - **Claude:** the terminal `result` record's `usage` and `total_cost_usd`, on any exit code. This
     includes `error_*` records without `result` text, a missing native-schema result, and a
     cancelled run that had already written the record.
   - **Codex:** every `turn.completed` record's usage. This includes a non-zero exit, a missing
     structured result, and a cancelled run (read from the live stream).
   - **Pi:** every completed assistant and tool-result `message_end`. This includes turns billed
     before a terminal error stop, a kill, or an abort.
3. **Partial and missing usage use the existing states.**
   - Usage that may not cover the whole attempt keeps its tokens, but no price is applied, so it
     reads as *cost-unmetered*. This covers a Pi agent loop that never settled, a Codex turn that
     never completed, a cancelled Codex run, and a fallback sum where only one rung was priced. It
     follows #3026's precedent for an unreported Pi background run.
   - A failed attempt with no complete record keeps no `tokenUsage` and reads as *unmetered*.
   - In both cases the existing `cost_complete=false` / partial rendering applies. A failed attempt
     is never shown as a complete $0.
4. **No fabrication, no malformed or partial records, no double counting.**
   - Each attempt's usage comes only from its own subprocess output.
   - Model-fallback rungs are separate subprocesses, so summing them counts each once.
   - A success's `provider_attempt` and its compatibility `step_completed` stay deduplicated by
     `DispatchMeteringTracker`, which `--report` now also uses.
   - Retries and recoveries are separate attempts with fresh sessions, so no figure accumulates
     across them.
5. **Persisted schemas are unchanged.** No event, usage, rollup, shipped-record or OTel field is
   added.

## Consequences

- Feature cost totals rise to reflect real failed-attempt spend. Historical event logs are not
  re-priced; their failed attempts stay unmetered.
- No reader can split failed spend from successful spend in a total. The breakdown is still
  available from `provider_attempt.outcome` in `events.jsonl`.
- When a Pi run is killed after real work, its completed messages' dollars are withheld
  (cost-unmetered) rather than reported as a partial figure. The tokens are still counted, and the
  total is marked partial.
- Model-fallback spend is attributed to the attempt's final model. When a later rung succeeds, the
  first rung's spend counts as part of a successful attempt.
- Remaining gaps, where no complete record exists:
  - a message or turn in flight at a kill
  - a Claude run killed before its terminal record
  - a Pi background run that is never waited on
  - pre-spawn adapter failures, which read as unmetered although no model call happened
  - an adapter that throws instead of returning a result, which emits no attempt event
