# Conflict Check: Spine-derived cumulative cost gauges (#2095, absorbs #2086)

**Date:** 2026-08-30
**Inventory:** all 344 story files, all 239 prior conflict reports, and the repo-wide ADR corpus (`conflict_check.adr_corpus: repo_wide`): 300 ADR files; a title and body sweep for telemetry, metric, cost, usage, event-ledger, visualizer, and renderer subjects narrowed semantic comparison to 22 ADRs (listed below); the remaining 278 were narrowed out as subject-disjoint (gates, planning, review rubrics, worktree/branch mechanics, provider auth, memory, install/migration). Supersession parsing: 9 ADRs carry a superseded status; none of the examined set is fully superseded, so none was excluded on that ground.
**Result:** **PASS — zero blocking conflicts remain.** Three blocking contradictions were found (one on the first pass, two on the 2026-08-30 tokens scope extension) and resolved by operator decision (deletion of the superseded historical assertions). No degrading conflict is accepted.

## Conflict: A shipped story requires the per-process cost counter this spec removes

**Stories involved:** "Step cost is exported as its own USD counter" (historical, #1936) vs "Per-step, per-model, per-source cost is exact and provider-agnostic" (Story 2)
**Files:** `.docs/stories/exported-telemetry-carries-no-cost-signal-so-spend.md` vs `.docs/stories/exported-step-cost-under-records-spend-20x-so-ever.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 99% — the historical happy path requires a `conductor.step.cost` data point per finite-cost dispatch; the new story requires that no per-process cost counter be exported.

**Historical opposing sentence (verbatim):** "Given a step closes with `tokenUsage.costUsd` a finite number and `costSource: 'provider'`, when `MetricsRecorder.onStepClose` runs, then `conductor.step.cost` records that exact `costUsd` value with attributes `{ step, source: 'provider' }` (plus `model` when a model was provided)"
**New opposing sentence (verbatim):** "Given any dispatch close, when the visualizer's metric instruments are enumerated, then the only cost-carrying instruments are the two feature gauges; no per-process cost counter is exported"

**Description:** #1936 introduced the counter as the way to chart spend per step and per model. #2095/#2086 established (verified against the live backend) that a per-process cumulative counter on the feature-stable identity of ADR-014 cannot be aggregated correctly on any backend; the same outcome is now delivered by the cumulative `conductor.feature.step.cost` gauge. Both stories cannot hold: one requires the counter's data point, the other forbids it.

**Resolution Options:**
1. Delete the historical Story 1 (its outcome is carried by the new Story 2); keep the historical Story 2 (dispatch metering visibility) untouched.
2. Keep the counter alongside the gauges and drop the removal criterion from the new Story 2 — leaves a documented metric that is wrong by construction.
3. Keep the counter but remove it from docs and dashboards only — same defect, less visible.

**Resolution:** Option 1, selected by the operator ("just remove it"). The historical Story 1 is deleted from `exported-telemetry-carries-no-cost-signal-so-spend.md` with no amendment record (story artifacts are replaced in place). Because the engineer land gate rejects a foreign-stem stories file in the spec diff, the deletion ships as a companion pull request based on `main` alongside the spec PR (precedent: PR #1928 beside spec PR #1927), not on the spec branch.

## Conflict: Two shipped stories require the per-process token counter this spec removes (scope extension)

**Stories involved:** "Metrics for duration, retries, and tokens" (historical, id-less heading, ADR-014 phase 1) and "OTel path stays fed for the deferred KPI work" (historical Story 6, #906 lineage) vs "Per-step, per-model token counts are exact and cumulative" (Story 5)
**Files:** `.docs/stories/otel-observability.md` and `.docs/stories/per-feature-token-accounting.md` vs `.docs/stories/exported-step-cost-under-records-spend-20x-so-ever.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 99% — both historical criteria require a `conductor.step.tokens` data point per usage-bearing step; the new story requires that no per-process token counter be exported.

**Historical opposing sentence (verbatim, otel-observability):** "Given a `step_completed` carries `tokenUsage`, when processed, then `conductor.step.tokens` (counter, attributes `step` + `kind` ∈ {input, output, cacheRead, cacheCreation}) records each present token kind."
**Historical opposing sentence (verbatim, per-feature-token-accounting Story 6):** "**Then** `conductor.step.tokens` is recorded with the token counts (and model attribute available), with no new wiring required by the future OTel-first work."
**New opposing sentence (verbatim):** "Given any dispatch close, when the visualizer's metric instruments are enumerated, then the only token-carrying instrument is the feature token gauge; no per-process token counter is exported"

**Description:** the token counter has the identical splice defect as the cost counter (per-process cumulative on the shared feature identity). Story 6's own purpose — "so Approach C is a later consumer swap" — is what this spec delivers, so its assertion is fulfilled and retired rather than contradicted in spirit; the phase-1 tokens bullet is superseded by the cumulative gauge.

**Resolution Options:**
1. Delete the tokens bullet (and its token-only negative paths) from the phase-1 story and delete Story 6 of per-feature-token-accounting; keep every other assertion in both files.
2. Keep the tokens counter alongside the gauge — leaves a wrong-by-construction token metric.
3. Rewrite both historical assertions to name the gauge — same outcome as 1 with more churn in shipped artifacts.

**Resolution:** Option 1, selected by the operator ("fix tokens now if it's a repeat"). Both deletions ship in the same companion pull request as the cost-story deletion (foreign-stem story edits cannot ride the spec branch).

## Explicitly Compatible Overlaps

Each pair below was tested in both directions ("if A is fully satisfied, does B still hold?"); both answers were yes.

- `daemon-dispatched-builds-emit-no-otel-telemetry-th` Story 3 (stop force-flushes traces and metrics before teardown; repeated stop returns the same promise) vs new Story 3 — the new stop flushes first and then shuts the meter provider down; the idempotent-promise clause is preserved verbatim as a negative path.
- `daemon-dispatched-builds-emit-no-otel-telemetry-th` Story 4 (export failures surface as bounded `renderer_error` warnings on the bus; build outcome unaffected) vs new Story 4 — the new story adds rendering of that same bounded event; boundedness and outcome-neutrality are restated as negative paths.
- `every-project-reports-the-same-otel-identity-so-me` Stories 1–2 (data-point `project`/`feature` attributes; feature-stable metric Resource; run id only on the trace side) vs new Stories 1–2 — every new point carries `project`/`feature` and no run identifier; the Resource is untouched.
- `exported-telemetry-carries-no-cost-signal-so-spend` Story 2 (`conductor.step.dispatches` with `metering` from `classifyMetering`) vs new Stories 2 and 5 — the dispatches counter is out of scope and unchanged.
- `otel-observability` "Metrics for duration, retries, and tokens" duration and retry criteria vs new Story 5 — the duration histogram and retry counter are untouched; only the tokens bullet is removed.
- `build-post-task-tail-telemetry` Stories 2–3 (closeout events are non-persisted bus events reaching existing consumers) vs the new `feature_cost_snapshot` — same sink shape (`persist: false, otel: true`); no shared field or file.
- `fix-otel-step-duration-histogram-bucket-saturation` — duration histogram untouched.

## Examined ADRs (repo-wide corpus, narrowed by subject) — all compatible

- `adr-014-otel-observability-exporter adr-2026-07-22-build-dispatch-json-usage-capture adr-2026-07-22-per-feature-cost-rollup-in-shipped-record adr-2026-07-26-event-sink-registry-exhaustiveness adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation adr-2026-07-27-cost-unmetered-is-a-first-class-state adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates adr-2026-07-29-engine-observed-provider-time-partition adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main adr-2026-08-08-pipeline-owned-closeout-timestamps adr-2026-08-09-reseal-audit-rides-the-existing-event-spine adr-2026-08-11-halt-events-ride-the-persisted-spine adr-2026-08-12-execution-lifecycle-completeness-for-timing adr-2026-08-13-durable-base-advance-attribution adr-2026-08-19-live-provider-stream-observation adr-2026-08-24-one-dispatch-member-on-the-provider-contract adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot adr-2026-08-27-daemon-dispatcher-executor-seam adr-2026-07-10-intra-step-build-progress-events adr-2026-07-04-kickback-event-emission-and-log-prominence adr-2026-07-07-audit-trail-event-sink adr-2026-07-27-cold-start-within-step-retries`

Notable checks: `adr-2026-07-22-per-feature-cost-rollup-in-shipped-record` names the OTel consumer swap this spec delivers (amended 2026-08-30); `adr-014` Decision 4 (off the hot path) holds because the ledger read is in Conductor's step-close code, not the bus handler; `adr-2026-07-27-cost-unmetered-is-a-first-class-state` is honoured by `cost_complete=false` and the no-fabricated-cost rule; `adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot` supplies the `source=rate-card` dimension unchanged; `adr-2026-07-26-event-sink-registry-exhaustiveness` requires the new union member to declare all four sinks.

## Oscillation Check

Pairs sharing a gate or field were tested in both directions. No pair yields two "no" answers: the only mutually exclusive pair was the counter contradiction above, which is an ordinary contradiction resolved by deletion, not an oscillation.
