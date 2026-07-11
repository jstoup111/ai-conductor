# Implementation Plan: Finish-step completion becomes engine machinery

**Date:** 2026-07-11
**Design:** `.docs/decisions/adr-2026-07-11-finish-step-engine-completion-machinery.md` (APPROVED)
**Stories:** `.docs/stories/finish-step-completion-becomes-engine-machinery-re.md` (Status: Accepted)
**Conflict check:** Clean as of 2026-07-11 (`.docs/conflicts/finish-step-completion-becomes-engine-machinery-re.md`)

## Summary

Makes the finish step's mechanically-fixable completion gaps engine-repaired: the finish
predicate becomes two-phase with an order-gated presentation repair between the phases, the
gate gains an injectable gh seam + isDraft check, recording-only misses get a surgical
retry, the daemon-tail rehab call is removed, and the finish/pr SKILLs become documentation
of engine behavior. 16 tasks.

## Technical Approach

- **Two-phase finish predicate** (`artifacts.ts` `CUSTOM_COMPLETION_PREDICATES.finish`,
  currently :1105-1202): phase 1 = fresh valid `finish-choice`, daemon convergence,
  `pr_url`, push evidence (all existing conditions, unchanged semantics); phase 2 =
  presentation (stale halt title + NEW isDraft), both fail-open on gh errors. Between the
  phases — only when phase 1 fully passes — the predicate invokes an injected repair
  callback (order-gate, conflict-check F1 resolution).
- **New `CompletionContext` injectables** (same pattern as `isHeadPushed`,
  `artifacts.ts:346`): `gh?: GhRunner` (replaces the hardcoded `makeProductionGh()` at
  :1161) and `repairFinishPr?: (prUrl: string) => Promise<void>`. Production values are
  composed in `conductor.ts` where the ctx is built for `checkStepCompletion`
  (:1805-1811); absent injectables fail open / skip (legacy contexts unchanged).
- **Repair composition** lives in `halt-pr-rehabilitation.ts`: the existing
  `rehabilitateHaltPr` (halt-signal-gated facets: unlabel, body marker, `Closes`) gains a
  sibling `ensureShipReady` (unconditional draft→ready flip for the recorded PR — the
  #199-safe ship-readiness facet) and a prefix-gated `retitleFloor` (from
  `state.feature_desc`, fallback `worktree_branch` — `types/state.ts:28,49`). The
  conductor's repair callback composes all three; sourceRef for `Closes` resolves
  engine-side from the committed `.docs/intake/<stem>.md` marker via the existing
  `issue-ref.ts` single source.
- **Facet code**: `CompletionResult` (:304) gains `missing?: 'recording' | 'other'`.
  The conductor's completion-fail retry path (:1853-1855, :2209-2219) selects a narrow
  finish-record prompt (absolute `--pipeline-dir` already computed by `step-runners.ts`
  auto-mode block :840-867) when `missing === 'recording'`; anything else — including an
  absent field — takes the standard full retry.
- **Removal**: the `daemon-cli.ts:784-800` tail call to `rehabilitateHaltPr` is deleted
  (single invocation site).
- **Sequencing**: predicate types → seam → checks → repair primitives → order-gated wiring
  → composition → tail removal → surgical retry → smoke → SKILL/doc sweep. All gh access
  through the injectable seam; every new branch unit-tested with the `fakeGh` pattern
  (`src/conductor/test/engine/pr-labels.test.ts:37-50`). Tests run from `src/conductor`
  (`rtk proxy npx vitest run <file>`).

## Prerequisites

- None beyond the repo as-is: all named seams verified present on main
  (`artifacts.ts:1105-1202`, `halt-pr-rehabilitation.ts:74-128`, `daemon-cli.ts:771-800`,
  `conductor.ts:1560-1571/:1805-1811/:1853-1855/:2209-2219`, `step-runners.ts:840-867`).

## Tasks

### Task 1: Add `missing` facet code to `CompletionResult` and classify recording-only misses
**Story:** Story 4 ("machine-readable facet code"; Done When 1)
**Type:** infrastructure

**Steps:**
1. Write failing test: finish predicate with missing `.pipeline/finish-choice` (all else
   satisfiable) returns `done:false` with `missing:'recording'`; missing `pr_url` (choice
   `pr`) likewise `missing:'recording'`.
2. Verify RED.
3. Implement: extend `CompletionResult` with optional `missing?: 'recording' | 'other'`;
   set `'recording'` on the finish-choice-absent/stale/invalid and pr_url-absent returns,
   `'other'` on every other finish `done:false` return.
4. Verify GREEN.
5. Commit: "feat(finish-gate): machine-readable missing-facet code on CompletionResult"

**Files:**
- src/conductor/src/engine/artifacts.ts
- src/conductor/test/engine/artifacts.test.ts

**Dependencies:** none

### Task 2: Restructure the finish predicate into explicit phase 1 / phase 2
**Story:** Story 1 (order-gate precondition); Story 3 (no-pr_url short-circuit)
**Type:** refactor

**Steps:**
1. Write failing test: with a recorded `pr_url` but push evidence `false`, the predicate
   returns before any presentation read (fakeGh call count stays 0 once Task 3 lands —
   here assert via ordering seam: presentation helper not invoked; use a spy wrapper).
2. Verify RED.
3. Implement: reorder the finish predicate so ALL non-presentation conditions
   (finish-choice fresh+valid, daemon convergence, pr_url, push evidence) are evaluated
   first and return on miss; presentation logic moves into a distinct second block.
   Existing semantics of every condition unchanged (existing describe
   `checkStepCompletion: finish predicate` stays green).
4. Verify GREEN (including the existing finish predicate tests).
5. Commit: "refactor(finish-gate): two-phase predicate — evidence before presentation"

**Files:**
- src/conductor/src/engine/artifacts.ts
- src/conductor/test/engine/artifacts.test.ts

**Dependencies:** 1

### Task 3: Inject `gh` into `CompletionContext`; route the stale-title read through it
**Story:** Story 3 ("injectable fake GhRunner … zero real gh spawns"; Done When 1–2)
**Type:** happy-path

**Steps:**
1. Write failing test (first ever through-the-gate `readStaleHaltTitle` coverage): fakeGh
   returning a `needs-remediation:`-titled PR → predicate fails naming the stale title;
   fakeGh returning a clean ready PR → presentation passes.
2. Verify RED.
3. Implement: add `gh?: GhRunner` to `CompletionContext`; presentation block uses
   `ctx.gh`, falling back to `makeProductionGh()` only when absent (composition-root
   default preserved); delete the hardcoded call at the stale-title read.
4. Verify GREEN under `AI_CONDUCTOR_NO_REAL_EXEC`.
5. Commit: "feat(finish-gate): injectable GhRunner seam for the presentation branch (#368)"

**Files:**
- src/conductor/src/engine/artifacts.ts
- src/conductor/test/engine/artifacts.test.ts

**Dependencies:** 2

### Task 4: isDraft ship-readiness check in phase 2
**Story:** Story 3 ("recorded PR is still a draft … not complete, reason names the draft state")
**Type:** happy-path

**Steps:**
1. Write failing test: fakeGh reports `isDraft: true` with a clean title → predicate
   `done:false`, reason names draft/ship-readiness, `missing:'other'`.
2. Verify RED.
3. Implement: extend the phase-2 `gh pr view` JSON fields with `isDraft`; fail while
   draft. No halt-classification interaction (reason text says ship-readiness).
4. Verify GREEN.
5. Commit: "feat(finish-gate): fail while the recorded PR is a draft (#439)"

**Files:**
- src/conductor/src/engine/artifacts.ts
- src/conductor/test/engine/artifacts.test.ts

**Dependencies:** 3

### Task 5: Phase-2 fail-open and short-circuit negative paths
**Story:** Story 3 negative paths (gh error → fail-open pass; no pr_url → zero gh calls)
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) fakeGh throws → presentation passes with logged warning while
   phase-1 conditions still enforced; (b) fakeGh returns malformed JSON → same fail-open;
   (c) state without `pr_url` under choice `pr` → `done:false` at phase 1 and fakeGh
   recorded zero calls.
2. Verify RED.
3. Implement any gap the tests expose (expected: try/catch envelope already fail-open;
   assert-only otherwise).
4. Verify GREEN.
5. Commit: "test(finish-gate): fail-open presentation + no-pr_url short-circuit"

**Files:**
- src/conductor/test/engine/artifacts.test.ts

**Dependencies:** 4

### Task 6: Prefix-gated retitle-floor primitive
**Story:** Story 2 (all criteria)
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `halt-pr-rehabilitation.test.ts`: title
   `needs-remediation: x` + `featureDesc` → `gh pr edit` to `feat: <featureDesc>`; no
   `featureDesc` → floor from branch name; prose title → zero edit calls; gh edit failure
   → warn-only resolved outcome; body never edited by the floor; no result title contains
   `needs-remediation:`.
2. Verify RED.
3. Implement: export `retitleFloor(gh, cwd, prUrl, {featureDesc, branch})` in
   `halt-pr-rehabilitation.ts` — reads the title, prefix-gates, edits title only.
4. Verify GREEN.
5. Commit: "feat(rehab): deterministic retitle-floor for stale needs-remediation titles"

**Files:**
- src/conductor/src/engine/halt-pr-rehabilitation.ts
- src/conductor/test/engine/halt-pr-rehabilitation.test.ts

**Dependencies:** none

### Task 7: `ensureShipReady` — unconditional ready-flip for the recorded PR, no halt classification
**Story:** Story 1 negative path (#199 early-draft: readied but never halt-classified)
**Type:** happy-path

**Steps:**
1. Write failing tests: clean-titled unlabeled draft PR → flipped ready with
   verify-after-write re-read, and NO unlabel/retitle/body mutation attempted; already-ready
   PR → no-op; flip verify still draft after bounded retries → non-fatal partial outcome.
2. Verify RED.
3. Implement: export `ensureShipReady(gh, cwd, prUrl)` in `halt-pr-rehabilitation.ts`
   (reuses the existing ready-flip + verify plumbing used by `cleanupHaltPresentation`).
4. Verify GREEN.
5. Commit: "feat(rehab): ensureShipReady — finish-time ready-flip without halt classification"

**Files:**
- src/conductor/src/engine/halt-pr-rehabilitation.ts
- src/conductor/test/engine/halt-pr-rehabilitation.test.ts

**Dependencies:** 6

### Task 8: Order-gated repair invocation between the predicate's phases
**Story:** Story 1 (happy paths + "phase-1 miss → repair does NOT run")
**Type:** happy-path

**Steps:**
1. Write failing tests: with `repairFinishPr` injected as a recording spy — (a) all
   phase-1 conditions pass → repair invoked exactly once, strictly before the phase-2
   fakeGh read (assert relative order via a shared call log); (b) any phase-1 miss
   (missing choice / pr_url / push false) → repair never invoked; (c) repair throwing →
   warning logged, predicate proceeds to phase 2 (warn-only).
2. Verify RED.
3. Implement: add `repairFinishPr?: (prUrl: string) => Promise<void>` to
   `CompletionContext`; invoke between phases under the order-gate; absent → skip
   (legacy behavior).
4. Verify GREEN.
5. Commit: "feat(finish-gate): order-gated in-step presentation repair (ADR D1)"

**Files:**
- src/conductor/src/engine/artifacts.ts
- src/conductor/test/engine/artifacts.test.ts

**Dependencies:** 2, 3

### Task 9: Conductor composition — production repair callback + gh + sourceRef threading
**Story:** Story 1 Done When 1 (wiring); Story 2 (floor inputs)
**Type:** infrastructure

**Steps:**
1. Write failing wiring test: a Conductor-built completion ctx (test seam mirroring how
   `isHeadPushed` is injected today) carries `gh` and a `repairFinishPr` that composes,
   in order: `rehabilitateHaltPr` (with sourceRef resolved from the committed
   `.docs/intake/<stem>.md` via `issue-ref.ts`), `retitleFloor` (featureDesc from
   `state.feature_desc`, branch from `state.worktree_branch`), `ensureShipReady` — all
   against a fake gh, asserting the composed call sequence.
2. Verify RED.
3. Implement in `conductor.ts` where the completion ctx is assembled (:1805-1811 region).
4. Verify GREEN.
5. Commit: "feat(conductor): compose finish-repair callback into completion context"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor-finish-repair.test.ts

**Dependencies:** 7, 8

### Task 10: Remove the daemon-cli post-run tail rehab call
**Story:** Story 1 negative path ("post-run tail … makes NO rehabilitation call"); Done When 2
**Type:** refactor

**Steps:**
1. Write failing test: the daemon post-run tail path (existing test seam around
   `daemon-cli`'s post-run handling, or a source-level assertion test if no seam exists)
   performs no `rehabilitateHaltPr` invocation; `closeIssueOnImplementationMerge` wiring
   is untouched.
2. Verify RED (the call at `daemon-cli.ts:784-800` still exists).
3. Implement: delete the tail invocation + its now-unused imports.
4. Verify GREEN, plus full `halt-pr-rehabilitation.acceptance.test.ts` still green
   (pure-function semantics untouched — Story 1 Done When 4).
5. Commit: "refactor(daemon): remove post-run tail rehab — in-step repair is the single site"

**Files:**
- src/conductor/src/daemon-cli.ts
- src/conductor/test/engine/daemon-cli-tail.test.ts

**Dependencies:** 9

### Task 11: Surgical recording-only retry prompt selection
**Story:** Story 4 happy paths; Done When 2
**Type:** happy-path

**Steps:**
1. Write failing tests: completion result `missing:'recording'` → the retry dispatch
   prompt contains `conduct-ts finish-record` and the absolute `--pipeline-dir`, and does
   NOT contain the full `/finish` walk; `missing:'other'` → standard retry prompt.
2. Verify RED.
3. Implement: in the completion-fail retry path (`conductor.ts` :1853-1855/:2209-2219
   region), branch on `result.missing === 'recording'` to build the narrow prompt
   (reusing the exact command block from the auto-mode section in `step-runners.ts`).
4. Verify GREEN.
5. Commit: "feat(conductor): surgical finish-record retry on recording-only misses (ADR D4)"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/conductor-surgical-retry.test.ts

**Dependencies:** 1

### Task 12: Surgical-retry misclassification guards + budget accounting
**Story:** Story 4 negative paths ("mixed gap → full re-walk"; "absent code → full";
"bounded budget"; "refusal preserved")
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) recording missing AND push evidence false → `missing` is NOT
   `'recording'` → standard prompt; (b) legacy result object without `missing` → standard
   prompt; (c) surgical retries decrement the same per-step retry budget and exhaust into
   the existing recovery path; (d) the surgical prompt's command is the fail-closed CLI
   (no engine-side marker write anywhere in the new code — assert no `finish-choice`
   write from conductor code paths).
2. Verify RED where applicable.
3. Implement any classification gap exposed (expected: phase-1 ordering from Task 2
   already yields `'other'` for mixed gaps; assert-only otherwise).
4. Verify GREEN.
5. Commit: "test(conductor): surgical-retry misclassification + budget guards"

**Files:**
- src/conductor/test/engine/conductor-surgical-retry.test.ts

**Dependencies:** 11

### Task 13: Real-binary smoke — surgical retry path end-to-end
**Story:** Story 4 Done When 3
**Type:** negative-path

**Steps:**
1. Write the smoke (pattern: `test/smoke/finish-record.smoke.test.ts`): isolated repo,
   recording absent with satisfiable evidence → engine emits the surgical prompt; running
   the named `conduct-ts finish-record` command against the real binary completes the
   step on re-evaluation.
2. Verify it fails against a stubbed-out branch (RED sanity), then GREEN against the real
   wiring.
3. Commit: "test(smoke): surgical finish-record retry drives one-command completion"

**Files:**
- src/conductor/test/smoke/surgical-finish-retry.smoke.test.ts

**Dependencies:** 11

### Task 14: End-to-end acceptance — reused halt PR ships first-try
**Story:** Story 1 happy path (gate passes on the same attempt)
**Type:** happy-path

**Steps:**
1. Write failing acceptance test: fake gh seeded with a reused halt PR (draft + label +
   `needs-remediation:` title + body marker); state carries recorded choice/pr_url and
   push evidence true; one completion evaluation → repair ran (ready, unlabeled, floor or
   prose title clean, `Closes` once, body marker gone) and the predicate returns
   `done:true` — first-try ship.
2. Verify RED.
3. Wire whatever the composed path is missing (expected: assert-only after Tasks 8–9).
4. Verify GREEN.
5. Commit: "test(acceptance): reused halt PR ships on the first finish attempt (#499)"

**Files:**
- src/conductor/test/acceptance/finish-step-engine-repair.acceptance.test.ts

**Dependencies:** 9

### Task 15: finish/pr SKILLs become documentation of engine behavior
**Story:** Story 5 (all criteria)
**Type:** infrastructure

**Steps:**
1. Rewrite `skills/finish/SKILL.md`: presentation mechanics (undraft, unlabel, `Closes`,
   draft flip — incl. checklist line ~373) become descriptions of engine behavior; the
   `/pr` prose rewrite and the `finish-record` exit contract remain agent instructions.
   Rewrite `skills/pr/SKILL.md` reused-halt-PR section to match exactly.
2. Grep-verify: no remaining agent instruction to run `gh pr ready` or remove the
   `needs-remediation` label in either SKILL.
3. Run `test/test_harness_integrity.sh` — must pass.
4. Commit: "docs(skills): finish/pr presentation mechanics documented as engine behavior (ADR D5)"

**Files:**
- skills/finish/SKILL.md
- skills/pr/SKILL.md

**Dependencies:** 9

### Task 16: CHANGELOG + README documentation sweep
**Story:** Story 5 Done When 3; repo "Docs track features" rule
**Type:** infrastructure

**Steps:**
1. Add `CHANGELOG.md` `[Unreleased]` entries (Added: in-step order-gated repair, isDraft
   gate check, surgical retry; Changed: SKILL contracts, daemon tail removal; Fixed:
   #368 test gap, #439 draft ships). No migration block: no settings schema / hook wiring
   / CLI-surface change (internal engine behavior + SKILL prose).
2. Update `README.md` + `src/conductor/README.md` finish-step/gate sections.
3. Run the full suite from `src/conductor` (`rtk proxy npx vitest run`) +
   `test/test_harness_integrity.sh`.
4. Commit: "docs: changelog + readme for finish-step engine completion machinery"

**Files:**
- CHANGELOG.md
- README.md
- src/conductor/README.md

**Dependencies:** 10, 13, 14, 15

## Task Dependency Graph

```
T1 ──> T2 ──> T3 ──> T4 ──> T5
        │      │
        │      └────┐
        └─────────> T8 ──> T9 ──> T10 ──────────┐
T6 ──> T7 ─────────/        ├──> T14 ───────────┤
T1 ──> T11 ──> T12          └──> T15 ───────────┼──> T16
        └────> T13 ─────────────────────────────┘
```

## Integration Points

- After Task 5: the hardened gate is fully testable standalone (fakeGh) — behavior
  identical to today plus draft enforcement.
- After Task 9: the complete in-step repair path can be driven end-to-end with a fake gh
  (Task 14 asserts it).
- After Task 10: single-invocation-site invariant holds across the codebase.
- After Task 13: the surgical retry is proven against the real binary.

## Verification

- [ ] All happy path criteria covered: Story 1 → T8/T9/T14; Story 2 → T6; Story 3 →
      T3/T4; Story 4 → T11/T13; Story 5 → T15
- [ ] All negative path criteria covered: Story 1 → T8(b,c)/T7/T10; Story 2 → T6; Story 3
      → T5; Story 4 → T12; Story 5 → T15 (grep + integrity + exit-contract retention)
- [ ] No task exceeds 5 minutes of focused work
- [ ] Dependencies explicit and acyclic (graph above)
