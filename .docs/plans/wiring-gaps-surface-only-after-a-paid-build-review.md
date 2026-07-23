# Implementation Plan: cheap-gate-first — wiring_check before build_review (#879)

**Date:** 2026-07-23
**Design:** technical track — no PRD. ADR
`.docs/decisions/adr-2026-07-23-cheap-gate-first-wiring-before-build-review.md` (APPROVED);
review `.docs/decisions/architecture-review-2026-07-23-cheap-gate-first-build-tail.md` (APPROVED)
**Stories:** `.docs/stories/wiring-gaps-surface-only-after-a-paid-build-review.md`
**Conflict check:** `.docs/conflicts/2026-07-23-cheap-gate-first-wiring-before-build-review.md` (CLEAN)
**Complexity:** `.docs/complexity/wiring-gaps-surface-only-after-a-paid-build-review.md` (Tier M)

## Summary

Two coupled engine changes. **D1:** add `wiring_check` to the conductor's engine-native
dispatch bypass so the gate stops spawning an LLM session and is computed solely by its
existing completion predicate + live probe. **D2:** swap the tail order to
`build → wiring_check → build_review → manual_test` so the now-free deterministic gate runs
before the paid grader. Plus the order-derived call sites, in-flight-state safety, the two
superseded-story annotations, and docs/ADR/CHANGELOG upkeep. 11 tasks.

## Technical Approach

- **Engine-native bypass (D1).** `conductor.ts:3247-3271` guards the attempt stamp with a
  `step.name !== 'complexity' && !== 'worktree' && !== 'rebase'` chain and then selects a
  handler through a ternary chain ending in `this.stepRunner.run(...)`. Add `wiring_check` to
  both: it neither needs an attempt stamp (its freshness is HEAD-stamped in the evidence
  file, not mtime-based — see `artifacts.ts:1873-1951`, which never reads
  `ctx.attemptStartedAt`) nor a dispatch. The step then reaches its completion predicate
  directly, which computes evidence via `ctx.wiringProbe` when the file is absent. No new
  handler method is needed — unlike `complexity`/`worktree`/`rebase`, `wiring_check` has no
  engine-side *action*, only a predicate; the branch must therefore produce the same
  `StepRunResult` shape a no-op dispatch would (`{ success: true }`), letting the existing
  completion check decide. Implement as a small private `runEngineNativeNoop()` rather than
  inlining a literal so the intent is greppable.
- **Order swap (D2).** In `steps.ts`, swap the `wiring_check` and `build_review` entries'
  positions in `ALL_STEPS` and set `wiring_check.prerequisites = ['build']`,
  `build_review.prerequisites = ['wiring_check']`, `manual_test.prerequisites =
  ['build_review']`. Update both steps' leading block comments (they narrate the old
  positions). Nothing else in either `StepDefinition` changes.
- **Order-derived literals (D3).** Reorder `conductor.ts:5505-5512`'s target array and
  `rebase.ts:927,935`'s lists (+ the `:897` comment). Leave `GATE_SURFACE` alone (keyed
  record, order-free).
- **Kickback restage set.** `conductor.ts:4505-4509` explicitly sets
  `wiring_check`/`manual_test` to `'stale'` because `markDownstreamStale` only restages
  `done` steps and `wiring_check` is `failed`. Under the new order `build_review` is
  downstream, so `markDownstreamStale` covers it when `done`. Task 6 proves this by test
  rather than assuming it; if the test shows a `done` `build_review` surviving, add it to the
  explicit set.
- **In-flight state (D4).** No migration file. Verify by fixture that an old-topology state
  (`build_review: 'done'`, `wiring_check: 'pending'`) resumes through `wiring_check` and then
  re-evaluates `build_review` under its existing freshness/code-stamp rules, and that no
  gating step is ever marked `skipped` as a side effect.
- **Model table.** Keep the `wiring_check` row (integrity check 5 requires one per step;
  `rebase`/`complexity` are the engine-native precedent) and rewrite its rationale to state
  engine-native. Regenerate `HARNESS.md` with `bin/generate-model-table` so check 5a passes.
- **Sequencing.** D1 first (it is independently correct and shrinks the blast radius of D2),
  then D2 topology, then the derived literals, then in-flight safety, then annotations and
  docs. Every task runs `bash test/test_harness_integrity.sh` before commit per repo rule.

## Prerequisites

- Vitest runs from `src/conductor` (never the worktree root).
- `VERSION` is **not** bumped (frozen pre-v1) — `CHANGELOG.md` `[Unreleased]` only.
- Expect a textual rebase in `conductor.ts` against concurrent intake #878.

## Tasks

### Task 1: wiring_check is never dispatched to the step runner
**Story:** TR-1 happy path + "gap-carrying run dispatches nothing"
**Type:** happy-path

**Steps:**
1. Write failing test: drive a `Conductor` with a stubbed `stepRunner` that records every
   `run()` step name, over a fixture whose `wiring_check` predicate is satisfied by an
   injected `wiringProbe`. Assert `'wiring_check'` never appears in the recorded calls and
   the step still settles `done`. Second case: an injected probe returning gap-carrying
   evidence — assert still zero `'wiring_check'` invocations and that the existing
   kickback-to-`build` fires with the gap messages verbatim.
2. Verify test fails (RED) — today the stub records a `wiring_check` dispatch.
3. Implement: add `wiring_check` to the attempt-stamp exclusion chain and to the handler
   ternary at `conductor.ts:3247-3271`, routing to a new private `runEngineNativeNoop()`
   returning `{ success: true }`.
4. Verify test passes (GREEN); run `src/conductor` vitest and
   `bash test/test_harness_integrity.sh`.
5. Commit with message: "fix(engine): wiring_check is engine-native — never dispatch a session (#879)"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Wired-into:** none (no new production surface) — `runEngineNativeNoop` is a private method
reached only from the existing dispatch ternary at `conductor.ts:3247-3271`, which is already
on the live step-loop path.

**Dependencies:** none

### Task 2: engine-native wiring_check preserves retry, non-git, and escalation behavior
**Story:** TR-1 negative paths (non-git short-circuit; retry cap unchanged)
**Type:** negative-path

**Steps:**
1. Write failing test: (a) `ctx.getHeadSha` resolving `null` ⇒ step settles `done` with zero
   dispatches and no probe invocation; (b) a persistently gap-carrying probe ⇒ retry/kickback
   accounting (`kickbackCounts` increments, `MAX_KICKBACKS_PER_GATE` escalation, terminal
   failure text) is byte-identical to the pre-change baseline captured in the same test file.
2. Verify test fails (RED) where the baseline diverges.
3. Implement: adjust only if Task 1's branch perturbed retry accounting; the intent is that
   no production change is needed here beyond what Task 1 landed.
4. Verify test passes (GREEN).
5. Commit with message: "test(engine): pin wiring_check retry/non-git behavior across the dispatch removal (#879)"

**Files:**
- src/conductor/test/engine/conductor.test.ts
- src/conductor/src/engine/conductor.ts

**Wired-into:** same as Task 1

**Dependencies:** Task 1

### Task 3: model-table rationale + regenerated HARNESS.md for an engine-native gate
**Story:** TR-1 Done-When (row retained, rationale states engine-native, check 5a passes)
**Type:** infrastructure

**Steps:**
1. Write failing test: assert `bin/generate-model-table` output matches the committed
   HARNESS.md section (this is check 5a — run it as the RED signal after editing the
   rationale).
2. Verify test fails (RED).
3. Implement: rewrite `WIRING_CHECK`'s entry in `model-table-metadata.ts` to state that the
   step is engine-native (no dispatch), that its verdict comes from the deterministic probe,
   and that its `model`/`effort` values are inert like `rebase`/`complexity`; regenerate
   HARNESS.md via `bin/generate-model-table`.
4. Verify `bash test/test_harness_integrity.sh` passes (checks 5, 5a, 5b).
5. Commit with message: "docs(harness): wiring_check model-table row reflects engine-native dispatch (#879)"

**Files:**
- src/conductor/src/engine/model-table-metadata.ts
- HARNESS.md

**Wired-into:** none (no new production surface) — the rationale string is consumed by the
pre-existing `bin/generate-model-table` → HARNESS.md pipeline.

**Dependencies:** Task 1

### Task 4: swap ALL_STEPS positions and repoint the three prerequisite arrays
**Story:** TR-2 happy path (registry shape)
**Type:** happy-path

**Steps:**
1. Write failing test: in `steps.test.ts`, assert `wiring_check.prerequisites === ['build']`,
   `build_review.prerequisites === ['wiring_check']`,
   `manual_test.prerequisites === ['build_review']`, and that the loop-tail topology array
   reads `build, wiring_check, build_review, manual_test, prd_audit,
   architecture_review_as_built, retro, rebase, finish`. Also assert both gates keep
   `phase: 'BUILD'`, `enforcement: 'gating'`, `loopGate: true`, `skippableForTiers: []`.
2. Verify test fails (RED).
3. Implement: swap the two `StepDefinition` entries' positions in `ALL_STEPS`, set the three
   `prerequisites` arrays, and rewrite both steps' leading block comments to describe the new
   positions and why (cheap-deterministic-gate-first, citing the ADR).
4. Verify test passes (GREEN); run the full `src/conductor` suite and triage every order
   assertion the swap breaks.
5. Commit with message: "feat(engine): run wiring_check before build_review (#879)"

**Files:**
- src/conductor/src/engine/steps.ts
- src/conductor/test/engine/steps.test.ts

**Wired-into:** none (no new production surface) — the edited `ALL_STEPS` entries are data
already consumed by `getStepDefinition`, `tryGetStepIndex`, the selector, `checkGate`,
`navigateBack`, and `markDownstreamStale`.

**Dependencies:** Task 1

### Task 5: per-tier step lists and unskippability across S/M/L in the new order
**Story:** TR-2 negative path (tier invariance)
**Type:** negative-path

**Steps:**
1. Write failing test: for each of S/M/L assert `shouldSkipForTier` is `false` for both gates
   and that the resolved step list names them in the new order (the existing per-tier
   expectation arrays in `steps.test.ts` encode the old order).
2. Verify test fails (RED).
3. Implement: update the per-tier expectation arrays; no production change expected.
4. Verify test passes (GREEN).
5. Commit with message: "test(engine): per-tier step lists reflect the wiring_check→build_review order (#879)"

**Files:**
- src/conductor/test/engine/steps.test.ts

**Wired-into:** none (no new production surface)

**Dependencies:** Task 4

### Task 6: zero grader dispatch on a gap-carrying HEAD; both gates re-evaluate after rebuild
**Story:** TR-2 negative paths (the intake's outcomes 1 and 3)
**Type:** negative-path

**Steps:**
1. Write failing integration test: a gap-carrying probe on the first HEAD ⇒ assert the
   recorded runner calls contain **zero** `'build_review'` entries before the kickback to
   `build`; then a wiring-clean second HEAD ⇒ assert `wiring_check` recomputes evidence
   against the new SHA and `build_review` is dispatched exactly once. Third case: a
   `build_review` FAIL on a clean HEAD ⇒ after the rebuild, `wiring_check` runs again before
   `build_review`.
2. Verify test fails (RED).
3. Implement: adjust the wiring kickback block's explicit restage set at
   `conductor.ts:4505-4509` only if the test shows a `done` `build_review` surviving the
   `navigateBack`/`markDownstreamStale` cascade; also append a line to the build retry hint
   noting that an unfinished wire-in task is a legitimate cause of a wiring gap (ADR's
   rejected sub-decision mitigation).
4. Verify test passes (GREEN).
5. Commit with message: "test(engine): a wiring-broken HEAD costs zero grader dispatches (#879)"

**Files:**
- src/conductor/test/integration/wiring-gate-loop.acceptance.test.ts
- src/conductor/src/engine/conductor.ts

**Wired-into:** same as Task 1

**Dependencies:** Task 4

### Task 7: reorder the rebase-origin re-open and post-rebase invalidation lists
**Story:** TR-3 happy path + `classifyGateInvalidation` negative path
**Type:** happy-path

**Steps:**
1. Write failing test: after a file-changing rebase, assert the emitted `kickback` events for
   the re-opened tail appear in the order `build, wiring_check, build_review, manual_test,
   prd_audit, architecture_review_as_built`. Separately assert
   `classifyGateInvalidation`'s preserved/invalidated sets are unchanged for every delta
   partition (test-only, featureSrc-only, foreignSrc-only, empty, mixed).
2. Verify test fails (RED) on the event-order assertion.
3. Implement: reorder the target array at `conductor.ts:5505-5512` and the lists at
   `rebase.ts:927,935`; update the `rebase.ts:897` comment and the
   `conductor.ts:5465-5473` comment block to describe the new positioning. Do **not** touch
   `GATE_SURFACE`.
4. Verify test passes (GREEN).
5. Commit with message: "fix(engine): tail-order literals follow the new ALL_STEPS order (#879)"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/rebase.ts
- src/conductor/test/engine/rebase.test.ts
- src/conductor/test/engine/gate-invalidation.test.ts

**Wired-into:** none (no new production surface) — literals inside already-wired functions.

**Dependencies:** Task 4

### Task 8: validation group is provably untouched; correct the stale anchor prose
**Story:** TR-3 negative path (group membership) + TR-5 negative path (types/steps.ts prose)
**Type:** negative-path

**Steps:**
1. Write failing test: `getGroupForStep('wiring_check')` and `getGroupForStep('build_review')`
   both return `undefined`; `VALIDATION_GROUP.members` is unchanged; `resolveGroupMembership`
   over a representative state returns the same members/dispatchable/allSkipped triple as
   before the swap.
2. Verify test fails (RED) only if a regression is introduced; otherwise land it as a pinned
   invariant with the prose fix as the behavioral change under test.
3. Implement: correct the doc comment at `types/steps.ts:113-118` so it describes the actual
   behavior (members are read directly from this list; there is no registry-builder
   contiguity/anchor verification), removing the false claim.
4. Verify test passes (GREEN); `bash test/test_harness_integrity.sh` passes.
5. Commit with message: "docs(engine): StepGroup prose no longer claims an unimplemented anchor check (#879)"

**Files:**
- src/conductor/src/types/steps.ts
- src/conductor/test/engine/steps.test.ts

**Wired-into:** none (no new production surface)

**Dependencies:** Task 4

### Task 9: an old-topology persisted state resumes without deadlock or a skipped gate
**Story:** TR-4 (all criteria)
**Type:** negative-path

**Steps:**
1. Write failing test: load a state fixture with `build: 'done'`, `build_review: 'done'`,
   `wiring_check: 'pending'`; assert resume runs `wiring_check` to a verdict for the current
   HEAD, then reaches `build_review` and applies its existing freshness/code-stamp rules
   (a verdict failing them re-runs the grader rather than passing through), and finally
   reaches `manual_test`. Second case: `wiring_check: 'done'`, `build_review: 'pending'`
   resumes with no `wiring_check` re-run. Third case: assert **no** gating step is ever
   marked `'skipped'` across either resume.
2. Verify test fails (RED).
3. Implement: only if the selector/`checkGate` path deadlocks or advances on an unsatisfied
   gating prerequisite. The fail direction must be "re-run the gate", never "advance".
4. Verify test passes (GREEN).
5. Commit with message: "test(engine): old-topology state resumes safely under the new gate order (#879)"

**Files:**
- src/conductor/test/engine/conductor.test.ts
- src/conductor/src/engine/conductor.ts

**Wired-into:** same as Task 1

**Dependencies:** Task 4

### Task 10: ADR amendments and superseded-story annotations
**Story:** TR-5 happy path (ADR pointers) + conflict-check blocking items 1 and 2
**Type:** documentation

**Steps:**
1. Add a supersession pointer to `adr-2026-07-07-build-review-judgement-gate.md` and
   `adr-2026-07-12-wiring-check-gate.md` naming
   `adr-2026-07-23-cheap-gate-first-wiring-before-build-review` and stating that only the
   positioning clause is superseded.
2. Add a supersession note at the top of
   `.docs/stories/2026-07-12-wiring-reachability-gate.md` covering its lines 127–175
   (ordering assertions), leaving the rest of the story authoritative.
3. Correct `.docs/stories/s-tier-pipeline-knobs.md` Story 6's final criterion from
   "dispatches `build_review`, `wiring_check`, …" to wording that asserts each gate
   *resolves to a verdict* and is not tier-skipped — preserving the tier-invariant without
   asserting a dispatch that no longer occurs.
4. Verify no remaining Accepted story asserts the old order:
   `grep -rn "prerequisites === \['build_review'\]\|after build_review" .docs/stories/`
   returns only annotated files.
5. Commit with message: "docs: amend ADRs and annotate superseded ordering assertions (#879)"

**Files:**
- .docs/decisions/adr-2026-07-07-build-review-judgement-gate.md
- .docs/decisions/adr-2026-07-12-wiring-check-gate.md
- .docs/stories/2026-07-12-wiring-reachability-gate.md
- .docs/stories/s-tier-pipeline-knobs.md

**Wired-into:** none (no new production surface)

**Dependencies:** Task 4

### Task 11: user-facing docs, CHANGELOG, and full integrity validation
**Story:** TR-5 happy path (docs) + negative path (integrity + release gate)
**Type:** documentation

**Steps:**
1. Update `docs/daemon-operations.md` and `src/conductor/README.md` everywhere the BUILD tail
   order is stated, to `build → wiring_check → build_review → manual_test`; note that
   `wiring_check` is engine-native (no session, no tokens) alongside `complexity`/`rebase`.
2. Add `CHANGELOG.md` `[Unreleased]` entries — **Changed:** wiring_check now runs before
   build_review so a wiring-broken HEAD costs no grader dispatch; **Fixed:** wiring_check no
   longer spawns an LLM session (it was falling through the engine-native bypass), which also
   removes the stale-evidence retry class caused by that session moving HEAD.
3. Do **not** edit `VERSION`.
4. Run `bash test/test_harness_integrity.sh` and the full `src/conductor` vitest suite; if the
   release gate's path classifier flags a canonical breaking surface, add a waiver under
   `.docs/release-waivers/wiring-gaps-surface-only-after-a-paid-build-review.md` listing every
   flagged surface verbatim with a non-empty rationale (this change alters no CLI, hook,
   skill-symlink, or settings.json behavior).
5. Commit with message: "docs: BUILD tail order + engine-native wiring_check (#879)"

**Files:**
- docs/daemon-operations.md
- src/conductor/README.md
- CHANGELOG.md

**Wired-into:** none (no new production surface)

**Dependencies:** Task 3; Task 7; Task 9; Task 10

## Task Dependency Graph

```
Task 1 (engine-native bypass)
 ├── Task 2 (retry/non-git invariants)
 ├── Task 3 (model table + HARNESS.md) ─────────┐
 └── Task 4 (ALL_STEPS swap + prerequisites)    │
      ├── Task 5 (per-tier lists)               │
      ├── Task 6 (zero grader dispatch) ────────┤
      ├── Task 7 (tail-order literals) ─────────┤
      ├── Task 8 (validation group + prose)     │
      ├── Task 9 (old-topology resume) ─────────┤
      └── Task 10 (ADR + story annotations) ────┤
                                                └── Task 11 (docs + CHANGELOG + validation)
```

## Verification

- Every task's commit is preceded by `bash test/test_harness_integrity.sh` (repo rule).
- Acceptance of outcome 1 is Task 6's assertion of zero `'build_review'` runner invocations
  on a gap-carrying HEAD — measured on the stub, not inferred from logs.
- Acceptance of the un-filed cost is Task 1's assertion of zero `'wiring_check'` runner
  invocations.
- Outcome 4 (measured FAIL frequency) is satisfied at DECIDE time and recorded in
  `.docs/track/wiring-gaps-surface-only-after-a-paid-build-review.md`.
