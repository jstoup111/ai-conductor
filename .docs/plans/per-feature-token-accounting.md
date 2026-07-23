# Implementation Plan — Per-feature token accounting (#537)

Track: technical. Tier: M. Approach: A. ADRs: 2026-07-22-a (json capture), 2026-07-22-b (rollup in
shipped-record). Stories: `.docs/stories/per-feature-token-accounting.md` (S1–S6).

Each task is 2–5 min granularity, names its Files, its Dependencies, and the story/acceptance it
serves. RED acceptance specs are authored per story before each task's GREEN (standard TDD).

---

## Task 1 — Extend usage type + parse json result
Add `cost_usd`, `numTurns`, `durationMs` to `TokenUsage` (keep the four token classes). Add
`parseJsonResult(stdout)` that parses the `--output-format json` object into
`{ output: string /* .result */, tokenUsage?: TokenUsage }`; returns `tokenUsage` undefined when the
payload is not valid result json.
- **Files:** `src/conductor/src/execution/llm-provider.ts`, `src/conductor/src/execution/claude-provider.ts`
- **Dependencies:** none
- **Serves:** S1 (happy + unparseable negative)

## Task 2 — Switch autonomous dispatch to `--output-format json`
In `invoke()`, replace `--output-format text` with `json` (prompt stays on stdin). Source
`InvokeResult.output` from `parseJsonResult(...).output`; attach `.tokenUsage`. Do **not** touch
`invokeInteractive()`.
- **Files:** `src/conductor/src/execution/claude-provider.ts`
- **Dependencies:** Task 1
- **Serves:** S1 (text-preserved negative — byte-equivalent `.result`; no E2BIG)

## Task 3 — Thread tokenUsage + model through the step runner
Add `tokenUsage?` to `StepRunResult` (`conductor.ts`); `runAutonomous` forwards `result.tokenUsage`
(currently dropped at step-runners.ts:555) and records the resolved `model` string it dispatched with.
- **Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/conductor.ts`
- **Dependencies:** Task 2
- **Serves:** S2 (happy)

## Task 4 — Emit tokenUsage + model on step_completed; unmetered marker
At the `step_completed` emit (conductor.ts:4912) include `tokenUsage` and `model`; when usage is
absent, set an explicit `unmetered: true` (+ `durationMs` if known). Add `model?`, `unmetered?` to the
`step_completed` event type.
- **Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/types/events.ts`
- **Dependencies:** Task 3
- **Serves:** S2 (unmetered negative)

## Task 5 — Cost rollup aggregator
New `computeCostRollup(worktreeDir)` that reads that feature's `.pipeline/events.jsonl` and existing
dispatch/retry/halt signals, returning `{ tokens{input,output,cacheRead,cacheCreation}, costUsd,
dispatches, retries, halts, unmetered{count,durationMs} }`. Pure/tested; tolerates a missing or
partial `events.jsonl` (folds the gap into `unmetered`).
- **Files:** `src/conductor/src/engine/cost-rollup.ts` (new), unit test alongside
- **Dependencies:** Task 4
- **Serves:** S3 (happy + partial-ledger negative)

## Task 6 — Persist the Cost block in the shipped record
Add a `renderShippedRecordWithCost(fields, rollup)` that appends a `## Cost` body block **after** the
closing `---` fence (parser ignores post-fence body — dedup keys byte-stable). Wire the ship call site
to compute the rollup (Task 5) and write it; never fail ship on a rollup error. Add a regression test
that `parseShippedRecord` + daemon dedup still match with the Cost block present.
- **Files:** `src/conductor/src/engine/shipped-record.ts`, ship call site
  (`shipped-record-cli.ts` / `finish` path), dedup regression test
- **Dependencies:** Task 5
- **Serves:** S3 (happy); conflict-check #2

## Task 7 — `conduct kpi` read-only command
Register `conduct kpi` (name verified free in `cli.ts`). New `renderKpi()` reads committed
`.docs/shipped/*.md` Cost blocks, prints tokens-per-shipped-feature per feature + an aggregate/trend,
and marks any feature with `unmetered.count > 0` as partial.
- **Files:** `src/conductor/src/cli.ts`, `src/conductor/src/index.ts`,
  `src/conductor/src/engine/kpi-report.ts` (new)
- **Dependencies:** Task 6
- **Serves:** S4 (happy + incomplete-visible negative)

## Task 8 — Retro reads the real Cost block
Update the retro skill's context-efficiency section to read the shipped record's Cost block; report
`unmetered/absent` when there is none (no fabricated figure).
- **Files:** `skills/retro/SKILL.md` (Part C), retro input assembly if needed
- **Dependencies:** Task 6
- **Serves:** S5 (happy + negative)

## Task 9 — Keep the OTel counter fed
Ensure the `conductor.step.tokens` counter is recorded from the Task-4 event data with the `model`
attribute available; confirm no double-count. No new export path (Approach C consumes this later).
- **Files:** `src/conductor/src/engine/otel/metrics.ts`, `src/conductor/src/engine/conductor.ts`
- **Dependencies:** Task 4
- **Serves:** S6 (happy + otel-disabled negative)

## Task 10 — Docs + CHANGELOG
Document `conduct kpi` and the shipped-record Cost block in `README.md` and
`src/conductor/README.md`; add a `## [Unreleased]` CHANGELOG entry (Added). No VERSION bump
(pre-v1). Assess migration-gate: additive command + additive shipped-record body — internal/no
consumer CLI/hook/schema break; add a `.docs/release-waivers/` waiver only if the self-host gate flags
a surface.
- **Files:** `README.md`, `src/conductor/README.md`, `CHANGELOG.md`, (waiver iff gate flags)
- **Dependencies:** Task 7, Task 8
- **Serves:** Docs-track-features + release gate

---

## Task Dependency Graph

```
T1 ─▶ T2 ─▶ T3 ─▶ T4 ─┬─▶ T5 ─▶ T6 ─┬─▶ T7 ─┐
                       │             └─▶ T8 ─┼─▶ T10
                       └─▶ T9               (T9 parallel; not a T10 blocker)
```

- Critical path: T1→T2→T3→T4→T5→T6→T7→T10.
- T9 branches off T4 and runs in parallel with T5–T8.
- T7 and T8 both depend only on T6 and can run in parallel.

## Out of scope (deferred, documented)
- Human operator/babysit session metering (Approach B).
- OTel-first KPI + dashboard cleanup post-OTel integration (Approach C — operator-requested later
  fast-follow). This plan only keeps the OTel path fed (T9).

Status: Accepted
