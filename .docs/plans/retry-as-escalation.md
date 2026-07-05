# Implementation Plan: retry-as-escalation

Derived from `adr-2026-07-05-retry-as-escalation-ladder.md`, the architecture doc,
and the stories. Tier **M**. All paths under `src/conductor/`. Test-first: each task
names the acceptance behavior it turns green. Stories referenced as S1–S11.

## Task 0 — Acceptance specs (RED)

Generate failing acceptance specs from `.docs/stories/retry-as-escalation.md` (S1–S11)
in the project's vitest layout. These are the RED gate for every task below.

## Task 1 — Ordering constants + bump helpers (pure)

- New module `src/conductor/src/engine/escalation.ts`.
- `export const EFFORT_ORDER = ['low','medium','high','xhigh','max'] as const;`
- `export const MODEL_TIER_ORDER = ['haiku','sonnet','opus','fable'] as const;`
- `bumpEffort(effort, steps)` → clamp to last index (S6 top-of-ladder no-op).
- `bumpModel(model, steps)` → clamp to last index (S7 top-of-tier no-op). A base model
  not present in `MODEL_TIER_ORDER` returns unchanged (defensive).
- Unit tests: each ordering, clamping at both ends, unknown-model passthrough.

## Task 2 — `escalateAttempt` pure function (S1, S2, S6, S7)

- In `escalation.ts`: `escalateAttempt(baseModel, baseEffort, attempt, escalate) → {model, effort}`.
  - `escalate === false` → return base unchanged (S5).
  - `attempt <= 1` → base.
  - `attempt === 2` → `{ model: baseModel, effort: bumpEffort(baseEffort, 1) }` (S1).
  - `attempt >= 3` → `{ model: bumpModel(baseModel, attempt - 2), effort: bumpEffort(baseEffort, 1) }` (S2).
- Unit tests cover S1, S2, S6 (base `max`), S7 (base `fable`), and the opt-out branch.
  Pure function — no I/O, fully table-testable.

## Task 3 — `escalate` config field: type + validation (S11)

- `types/config.ts`: add `escalate?: boolean` to `StepConfig` (doc: "default true;
  false pins base model/effort across retries").
- `engine/config.ts`: add `escalate` to the `knownStepKeys` allow-list; add a boolean
  check mirroring the `disable` validation (reject non-boolean with a
  `steps.<name>.escalate` message).
- Tests: valid `true`/`false` accepted; `"no"`/number rejected; unknown sibling key
  still rejected (S11).

## Task 4 — Thread `escalate` through resolution

- `engine/resolved-config.ts`: add `escalate: boolean` to `ResolvedStepConfig`; resolve
  via the existing precedence chain (`stepCfg?.escalate ?? phase ?? default true`).
  Keep the default centralized (e.g. `DEFAULT_STEP_ESCALATE = true` or inline default).
- Tests: default true when unset; step-level false wins; precedence parity with the
  other knobs.

## Task 5 — Wire escalation into the retry loop (S1, S2, S5, S10)

- `engine/conductor.ts`, inside the `while (attempt < stepMaxRetries)` loop, after
  `attempt++` and before dispatch: compute
  `const esc = escalateAttempt(resolved.model, resolved.effort, attempt, resolved.escalate);`
- Pass `esc.model` and `esc.effort` as per-attempt overrides into the dispatch
  (`stepRunner.run(..., { retryReason, modelOverride: esc.model, effortOverride: esc.effort })`
  — use the existing effort-override seam at step-runners.ts:254/273 and add the model
  override symmetrically).
- **Do not** move or duplicate the non-consuming `attempt--; continue` paths — escalation
  reads `attempt` so those are automatically correct (S10).
- `step-runners.ts`: honor the per-call `modelOverride` where `resolved.model` is read,
  then pass it through the existing `modelAvailability.effectiveModel(...)` call so the
  bumped target still composes with #186 (S8, no new wiring).
- Tests: S1/S2 assert the dispatched `(model, effort)` per attempt via an injected
  runner/provider spy; S5 asserts base is pinned when `escalate:false`; S10 asserts a
  rate-limit path re-runs at the same rung.

## Task 6 — Availability composition test (S8)

- With `opus` marked dead in `ModelAvailability`, assert an attempt-3 step whose base is
  `sonnet` dispatches on a live model (substituted by `effectiveModel`), not the dead
  tier. No production change expected here if Task 5 routes through the existing call —
  this task is the guard test that proves it.

## Task 7 — Budget reduction (S3)

- `engine/resolved-config.ts` `DEFAULT_STEP_RETRIES`: `explore`, `prd`, `plan`, `build`
  from `5` → `3`. Leave other steps unchanged (architecture_review stays 5 — out of the
  issue's scope).
- Tests: resolved `max_retries` for those four is 3 with no override; a per-step override
  still wins (S3).

## Task 8 — Escalation logging (S4)

- `types/events.ts`: add optional `escalatedModel?: string`, `escalatedEffort?: string`
  to the `step_retry` event.
- `engine/conductor.ts`: when emitting `step_retry` (both emit sites ~1280 and ~1399),
  include the `(model, effort)` the **next** attempt will use
  (`escalateAttempt(base, attempt + 1, escalate)`).
- `engine/report-renderer.ts` `aggregateRetryHotspots`: extend the hotspot shape to
  surface the terminal escalation rung (max model/effort observed per step) so retro
  Part C can report it. Keep existing fields intact.
- Tests: S4 asserts the emitted event carries the next attempt's model/effort and that
  the aggregator reports the escalation; assert old event lines without the fields still
  aggregate (backward-compat).

## Task 9 — Exhausted-retries HALT invariant (S9)

- No production change intended — this is the regression guard. Assert that with all
  rungs failing at `max_retries` 3 in auto mode, the loop writes `LOOP_HALT_MARKER` and
  emits `loop_halt`, and that exactly `max_retries` attempts ran (ladder added none).

## Task 10 — Docs + CHANGELOG + migration

- **HARNESS.md**: document the escalation ladder (effort-then-model, budget floor 3,
  `escalate` opt-out) in the Model Selection **prose** region, **outside** the
  generated-table markers, so `bin/generate-model-table` drift check (test 5a) still
  passes. If any of it must live in the generated table, edit `model-table-metadata.ts`
  and regenerate via `bin/generate-model-table` instead of hand-editing.
- **README / src/conductor/README**: note that retries now escalate and how to opt out.
- **CHANGELOG.md**: `## [Unreleased]` → Added (escalation ladder) + Changed (deep
  budgets 5→3). Add a `## Migration` note: escalation is on by default; set
  `escalate: false` per step to preserve identical retries. (HarnessConfig field, not
  `settings.json` — the migration note is documentation; no `bin/migrate` block needed
  since the field is optional and back-compatible.)

## Task 11 — Full validation

- Run `test/test_harness_integrity.sh` (SKILL/HARNESS/table drift, section numbering,
  changelog gate).
- Run `rtk proxy npx vitest run` in `src/conductor` (its own npm install per worktree).
- Confirm all S1–S11 specs are green and the HARNESS.md table drift check passes.

## Sequencing / dependencies

Task 0 → 1 → 2 (pure core) → 3 → 4 (config) → 5 (wire) → 6, 8, 9 (guards, parallelizable
after 5) → 7 (budgets, independent, any time) → 10 (docs) → 11 (validation). Tasks 1, 2,
3, 7 are independent and can start in parallel; Task 5 is the integration join.
