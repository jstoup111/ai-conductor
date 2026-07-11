# Implementation Plan: Verdict-Aware Resume Entry (#532)

**Date:** 2026-07-11
**Design:** .docs/decisions/adr-2026-07-11-verdict-aware-resume-entry.md (APPROVED)
**Stories:** .docs/stories/rekick-resume-runs-finish-while-the-build-gate-ver.md (Accepted)
**Conflict check:** Clean as of 2026-07-11 (.docs/conflicts/2026-07-11-verdict-aware-resume-entry.md)

## Summary

Make `conductor.run({resume: true})` honor on-disk gate verdicts when deriving its start index —
a backward-only clamp to the earliest verdict-unsatisfied loop-region gate — so a rekick resume
can never fast-forward past a failed build to `finish` (#532 false-ship path). 11 tasks.

## Technical Approach

- **One authority for gate satisfaction.** A new pure helper `earliestUnsatisfiedGateIndex` is
  added to `src/conductor/src/engine/selector.ts`, sharing `selectNextGate`'s exact scan
  (gateSatisfied + isSkipped + regionStart scoping) — refactor the scan into a shared internal
  so the two can never disagree. This matters because `gateSatisfied` alone is NOT enough: a
  tier-skippable step whose state is still `pending` at resume would read unsatisfied and wrongly
  attract the clamp; `isSkipped` (private to selector.ts) handles it, which is why the helper
  lives in that module.
- **Wire at the resume branch only.** In `conductor.run()`, the start-index derivation currently
  reads: `if (this.fromStep) … else if (this.resume) startIndex = this.findResumeIndex(state,
  steps)`. In the `this.resume` branch (and ONLY there — `fromStep` is an exempt operator
  override, ADR §Decision.3), after the state-derived candidate is computed:
  `readAllVerdicts(this.projectRoot)` + `deriveGateTopology(steps)` (module-private, same file)
  → `startIndex = min(candidate, earliestUnsatisfiedGateIndex(...))` when the helper finds an
  unsatisfied gate, else the candidate stands. Backward-only by construction (min), covering both
  `findResumeIndex` branches since the clamp applies to the function's OUTPUT.
- **Nothing else changes.** `findResumeIndex` internals, `checkGate`, `stepSatisfied`, the loop
  tail, and `recordRebaseStepCompletion` are untouched.
- **Anchors, not line numbers** (binding conflict-report constraint): all insertion points above
  are named structurally because #520/#529 build first and will shift `conductor.ts` line numbers.
- **Sequencing:** pure helper first (unit-testable in isolation), then wiring, then per-story
  scenario tests, then parity/regression tests, CHANGELOG last.

## Prerequisites

None — all reused primitives (`readAllVerdicts`, `gateSatisfied`, `selectNextGate`,
`deriveGateTopology`) exist on main at f31bcee3. Tests run from `src/conductor` (vitest config
lives there).

## Tasks

### Task 1: Pure selector helper — earliestUnsatisfiedGateIndex
**Story:** Story 3 (stale overrides satisfied verdict; regionStart scoping), Story 4 (skipped
gates don't attract the clamp) — unit level
**Type:** infrastructure

**Steps:**
1. Write failing unit tests in `test/engine/selector.test.ts`: given steps/state/verdicts/
   regionStart, `earliestUnsatisfiedGateIndex` returns (a) the index of the earliest gate whose
   verdict is `satisfied:false`; (b) the index of a `stale`-status step even when its verdict
   says `satisfied:true`; (c) -1 (or equivalent "none" sentinel) when every region gate is
   satisfied; (d) skips steps that are `skipped` by state or tier (`skippableForTiers`) even
   with no verdict file; (e) ignores steps before `regionStart`.
2. Verify RED.
3. Implement: extract `selectNextGate`'s scan loop into a shared internal; expose
   `earliestUnsatisfiedGateIndex(input: SelectorInput): number` returning the steps-array index
   of the first unsatisfied, non-skipped gate at/after `regionStart`, -1 when none.
   `selectNextGate` delegates to the same internal (behavior byte-identical — existing selector
   tests stay green).
4. Verify GREEN (new + existing selector tests).
5. Commit: "feat(selector): earliestUnsatisfiedGateIndex shares selectNextGate's scan"

**Files:**
- src/conductor/src/engine/selector.ts
- src/conductor/test/engine/selector.test.ts

**Dependencies:** none

### Task 2: Wire the backward-only clamp into the resume branch (#532 fixture)
**Story:** Story 1 happy path (fixture resumes at build)
**Type:** happy-path (integration point)

**Steps:**
1. Write failing test in `test/engine/conductor.test.ts`: construct the verbatim #532 fixture —
   `.pipeline/gates/build.json` `{satisfied:false, kickback:{from:'rebase'}}`,
   `build_review.json` and `manual_test.json` same-shaped unsatisfied, `rebase.json`
   `{satisfied:true}`, state `{…DECIDE done, acceptance_specs:'done', build:'failed',
   rebase:'done', last_step:'finish'}` — run with `resume: true`, assert the first dispatched
   step is `build`, not `finish`.
2. Verify RED (current state-only derivation dispatches `finish`).
3. Implement: in `conductor.run()`'s start-index derivation, `this.resume` branch only: after
   `findResumeIndex`, read `readAllVerdicts(this.projectRoot)`, compute
   `deriveGateTopology(steps).regionStart`, call `earliestUnsatisfiedGateIndex`; if it returns
   ≥ 0 and is LESS than the candidate, clamp `startIndex` down to it. Emit nothing new; the
   `fromStep` branch is untouched.
4. Verify GREEN.
5. Commit: "fix(engine): resume entry clamps to earliest unsatisfied gate verdict (#532)"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 1

### Task 3: Daemon-path fixture test (rekick flow end-to-end)
**Story:** Story 1 happy path (daemon rekick variant — step_started names build)
**Type:** happy-path

**Steps:**
1. Write failing test (extend the existing daemon-resume describe block in
   `test/engine/conductor.test.ts`, or `test/integration/gate-loop.test.ts` if the fixture needs
   the loop tail): daemon-shaped run (`daemon: true, resume: true`) over the #532 fixture asserts
   the `step_started` event sequence begins with `build` and contains no `finish` before the
   build gate verdict flips satisfied.
2. Verify RED/GREEN accordingly (may already pass from Task 2 — if so, keep as regression pin
   and note it in the test comment).
3. Commit: "test(engine): daemon rekick resume dispatches build under unsatisfied gate (#532)"

**Files:**
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 2

### Task 4: Corrupt and missing verdict negatives
**Story:** Story 1 negative paths (unparseable build.json; deleted gates dir)
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) #532 fixture with `build.json` containing `{oops` — resume does not
   throw and still starts at `build` (corrupt verdict → absent → state fallback, `failed` is
   unsatisfied); (b) fixture with `.pipeline/gates/` removed entirely — no throw, starts at
   `build`.
2. Verify RED or pin-GREEN (readVerdict/readAllVerdicts already null-tolerate; the assertion
   pins the fallback path).
3. Commit: "test(engine): resume clamp tolerates corrupt/missing verdicts fail-safe (#532)"

**Files:**
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 2

### Task 5: fromStep exemption
**Story:** Story 1 negative path (--from-step targets finish explicitly)
**Type:** negative-path

**Steps:**
1. Write failing test: #532 fixture, run with `fromStep: 'finish'` (no resume) — the clamp does
   not apply; the targeted step is dispatched (subject to its existing state-only gate, which
   passes since rebase is done).
2. Verify RED/pin-GREEN. 3. Ensure implementation touches only the `this.resume` branch.
4. Commit: "test(engine): explicit fromStep bypasses the resume verdict clamp (#532)"

**Files:**
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 2

### Task 6: in_progress branch coverage (Story 2 trio)
**Story:** Story 2 (all paths)
**Type:** happy-path + negative-path

**Steps:**
1. Write failing tests: (a) #532 fixture + `finish:'in_progress'` → starts at `build`;
   (b) `build:'in_progress'`, later gates unsatisfied or not — entry stays `build` (min() never
   moves the entry later); (c) `finish:'in_progress'` + ALL verdicts satisfied → starts at
   `finish` (clamp no-op).
2. Verify (a) RED, (b)/(c) pin current behavior post-Task-2.
3. Commit: "test(engine): resume clamp covers the in_progress branch (#532)"

**Files:**
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 2

### Task 7: Post-rebase kickback honored on resume
**Story:** Story 3 happy paths (three kickbacks → build; manual_test-only → manual_test)
**Type:** happy-path

**Steps:**
1. Write failing tests: (a) state with build/build_review/manual_test all `'done'`, kickback
   verdicts `{satisfied:false, kickback:{from:'rebase'}}` for all three, `rebase:'done'` — resume
   starts at `build`; (b) only `manual_test.json` unsatisfied (others satisfied) — resume starts
   at `manual_test`.
2. Verify RED (pre-fix both resume at `finish`). 3. GREEN via Task 2 wiring (no new impl
   expected; if impl gaps surface, fix within the clamp helper).
4. Commit: "test(engine): rebase kickback verdicts steer the resume entry (#532)"

**Files:**
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 2

### Task 8: Stale-overrides-verdict and regionStart scoping at the conductor level
**Story:** Story 3 negative paths
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) a loop-region step with state `'stale'` whose verdict file says
   `satisfied:true` — resume selects it (stale wins, same rule as the tail); (b) a verdict file
   for a step BEFORE the derived `regionStart` written `satisfied:false` — resume entry ignores
   it (clamp scans the loop region only).
2. Verify RED/pin-GREEN. 3. Commit: "test(engine): resume clamp respects stale and regionStart
   scoping (#532)"

**Files:**
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 1, 2

### Task 9: All-satisfied fast-forward parity (regression pins)
**Story:** Story 4 happy paths
**Type:** negative-path (regression guard)

**Steps:**
1. Extend the existing daemon-resume tests: (a) full BUILD/SHIP progress with SATISFIED verdict
   files on disk → resume starts at `finish`, and equals `findResumeIndex`'s raw output (parity
   assertion); (b) fresh dispatch (DECIDE preseeded done, no verdict files) → starts at
   `acceptance_specs` — the existing test must remain green unmodified.
2. These pin behavior — expected GREEN immediately post-Task-2; a RED here is an implementation
   bug in the clamp.
3. Commit: "test(engine): all-satisfied resumes fast-forward unchanged (#532)"

**Files:**
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 2

### Task 10: Front-half guard and skipped-tier no-attract
**Story:** Story 4 negative paths
**Type:** negative-path

**Steps:**
1. Write tests: (a) state resuming in the linear front half (e.g. `stories` done,
   `conflict_check` pending, loop gates all pending, no verdicts) — entry is the front-half step;
   pending loop gates ahead do NOT drag it forward (backward-only); (b) tier-S-shaped state where
   loop-region steps are tier-skippable and still `pending` with no verdicts — the clamp does not
   pull the entry back to them (isSkipped parity with selectNextGate).
2. Verify GREEN (pins) or fix within the selector helper if RED.
3. Commit: "test(engine): clamp is backward-only and skip-aware (#532)"

**Files:**
- src/conductor/test/engine/conductor.test.ts
- src/conductor/test/engine/selector.test.ts

**Dependencies:** 1, 2

### Task 11: CHANGELOG entry
**Story:** repo release gate (CHANGELOG on every PR)
**Type:** infrastructure

**Steps:**
1. Add under `## [Unreleased]` → `### Fixed`: "Rekick resume no longer dispatches steps past an
   unsatisfied on-disk gate verdict — the resume entry clamps backward to the earliest
   unsatisfied loop-region gate (#532)." No migration block: internal engine behavior, no
   CLI/hook/schema surface change.
2. Commit: "docs(changelog): #532 verdict-aware resume entry"

**Files:**
- CHANGELOG.md

**Dependencies:** none

## Task Dependency Graph

```
Task 1 (selector helper) ──► Task 2 (wire clamp) ──► Tasks 3,4,5,6,7,9
                                   │
Task 1 ─────────────────────► Tasks 8,10 (also need Task 2)
Task 11 (independent)
```

## Integration Points

- After Task 2: the #532 fixture end-to-end behavior is testable — the false-ship path is closed.
- After Task 9: daemon re-dispatch parity is proven — safe against the known
  re-run-everything regression class.

## Verification

- [ ] All happy path criteria covered: S1→T2/T3, S2→T6, S3→T7, S4→T9
- [ ] All negative path criteria covered: S1→T4/T5, S2→T6, S3→T8, S4→T10
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies explicit and acyclic (graph above)
- [ ] conductor.ts insertion points referenced structurally only (conflict-report constraint)
