# Implementation Plan: Demote task-stamping from gate to telemetry (#773)

**Date:** 2026-07-21
**Design:** .docs/decisions/adr-2026-07-21-demote-task-stamping-to-telemetry.md, adr-2026-07-21-completeness-as-build-review-rubric.md (supersedes adr-2026-07-21-build-end-plan-completeness-gate.md)
**Stories:** .docs/stories/demote-task-stamping-to-telemetry.md
**Conflict check:** Clean as of 2026-07-21

## Summary
Fold a default-on **completeness** rubric item into the existing `build_review` judgement gate, then
delete the per-task evidence-ledger gating apparatus — keeping stamps as telemetry. 21 tasks across 6
phases, ordered so completeness is enforcing before the old stamp gate is removed (no completion hole).

## Technical Approach
- **Reuse, don't rebuild.** `build_review` (adr-2026-07-07, #324, merged) is already the input-starved
  judgement gate at the build → manual_test seam: grader fed `{ diff, planBody }` → `.pipeline/build-
  review.json` → fail-closed predicate → `buildReviewSelfHeals` kickback bounded by
  `MAX_KICKBACKS_PER_GATE`. #773 adds a 4th rubric item (**completeness: every planned task's work is
  present in the diff**) to that gate and makes the completeness dimension **default-on** so it is the
  replacement completion authority once the evidence gate is deleted. No new step / StepName /
  predicate / grader module.
- **Additive-first, delete-last.** Phase 1–2 extend build_review (rubric + default-on) and prove it
  enforcing. Only in Phase 3, once completeness is enforcing, is the `evidenceStamps.has(id)` check
  removed from the `build` predicate.
- **Then demolish.** Phase 4 deletes the derivation engine, the attribution citation judge lane, the
  no-evidence park counter + evidence-coupled `no_task_progress`, the evidence-based reseed, the
  commit-msg evidence rejection, and demotes attribution-enforcement to advisory. `parsePlanTaskPaths`/
  `TASK_ID_PATTERN` are relocated first (Phase 1) so autoheal cleanup can't break `wiring_check`.
- **Preserve telemetry.** Phase 5 sources the #757 resolved-count from `Task:`-trailered commits and
  confirms spot-audit + retro Part C still function.
- **Prove + document.** Phase 6 removes/rewrites gating tests and updates docs + CHANGELOG (VERSION
  stays locked until the v1 cut).
- The completeness rubric reasons **holistically (plan-vs-diff)** and is explicitly forbidden from
  per-task SHA/reachability/corroboration reasoning — the guardrail that keeps the wedge classes deleted.

## Prerequisites
- Work happens in `src/conductor/` (the conductor TS package). Run its test suite per task. Harness
  integrity (`test/test_harness_integrity.sh`) for doc/config/model-table tasks.

## Tasks

### Task 1: Relocate shared plan-parsing utilities out of the evidence surface
**Story:** Shared plan-parsing utilities are preserved
**Type:** refactor
**Steps:**
1. Write failing test: `parsePlanTaskPaths` + `TASK_ID_PATTERN` resolve from a stable module; `wiring-probe.ts`/`wired-into.ts` still compile.
2. RED. 3. Move them into `plan-task-parse.ts`; re-export from autoheal for now; update `wiring-probe.ts:36`, `wired-into.ts:11`. 4. GREEN.
5. Commit: "refactor: extract plan-task-parse utils from autoheal (preserve for wiring)"
**Files:** src/conductor/src/engine/plan-task-parse.ts, src/conductor/src/engine/autoheal.ts, src/conductor/src/engine/wiring-probe.ts, src/conductor/src/engine/wired-into.ts
**Wired-into:** same as existing (utilities already called from wiring-probe.ts#computeWiringEvidence, wired-into.ts)
**Dependencies:** none

### Task 2: Add the completeness rubric item to the build_review grader prompt
**Story:** build_review gains a default-on completeness rubric item / Grader judges plan-vs-diff completeness holistically
**Type:** happy-path
**Steps:**
1. Write failing test: `buildGraderPrompt` output includes a 4th rubric item "Completeness: every planned task's work is present in the diff", forbids per-task SHA/reachability/corroboration reasoning, and instructs a `rubric.completeness` reason.
2. RED. 3. Add the completeness rubric text + all-or-FAIL wording to `build-review-prompt.ts`. 4. GREEN.
5. Commit: "feat: add completeness rubric item to build_review grader prompt"
**Files:** src/conductor/src/engine/build-review-prompt.ts
**Wired-into:** same as existing (build_review grader dispatch, conductor.ts build_review step)
**Dependencies:** 1

### Task 3: Extend the build_review verdict schema with `rubric.completeness`
**Story:** build_review verdict stays fail-closed with the completeness item
**Type:** happy-path
**Steps:**
1. Write failing test: verdict validation accepts/round-trips `rubric.completeness`; a FAIL where only completeness fails is a valid FAIL.
2. RED. 3. Add `completeness` to the verdict `rubric` shape + `validateBuildReviewVerdict`. 4. GREEN.
5. Commit: "feat: build_review verdict carries rubric.completeness"
**Files:** src/conductor/src/engine/artifacts.ts, src/conductor/src/engine/build-review-inputs.ts
**Wired-into:** src/conductor/src/engine/artifacts.ts#checkStepCompletion (existing build_review predicate)
**Dependencies:** 2

### Task 4: Make build_review's completeness dimension default-on
**Story:** build_review gains a default-on completeness rubric item
**Type:** happy-path
**Steps:**
1. Write failing test: on a fresh project with no `build_review.enabled` opt-in, build_review runs and the completeness rubric is evaluated (step is not `skipped`-defaulted out).
2. RED. 3. Adjust the resolver default / `when_skip` idiom so build_review (completeness dimension) is active by default; keep diff-honesty items tunable. 4. GREEN.
5. Commit: "feat: build_review completeness default-on (replacement completion authority)"
**Files:** src/conductor/src/engine/config.ts, src/conductor/src/engine/resolved-config.ts, src/conductor/src/engine/steps.ts
**Wired-into:** src/conductor/src/engine/steps.ts (build_review step activation), src/conductor/src/engine/resolved-config.ts#build_review resolution
**Dependencies:** 3

### Task 5: Predicate fail-closed on missing/stale/malformed/FAIL (completeness-driven)
**Story:** build_review verdict stays fail-closed with the completeness item
**Type:** negative-path
**Steps:**
1. Write failing tests: no artifact → not-done; prior-session (stale) → not-done; malformed → not-done (tolerant); completeness-FAIL verdict → not-done + kickback armed.
2. RED. 3. Confirm the existing fail-closed predicate covers the completeness-driven FAIL unchanged. 4. GREEN.
5. Commit: "test: build_review fail-closed incl. completeness-driven FAIL"
**Files:** src/conductor/test/engine/build-review-completeness.test.ts, src/conductor/src/engine/artifacts.ts
**Wired-into:** none (no new production surface)
**Dependencies:** 3

### Task 6: Completeness FAIL reuses build_review self-heal kickback to build
**Story:** A completeness FAIL kicks back to build via build_review's self-heal
**Type:** happy-path
**Steps:**
1. Write failing test: a completeness-FAIL under cap seeds `pendingRetryHints.set('build', <reasons>)` and `navigateBack('build')` via `buildReviewSelfHeals` (no new routing).
2. RED. 3. Confirm the completeness FAIL flows through the existing self-heal block. 4. GREEN.
5. Commit: "test: completeness FAIL kicks back to build via buildReviewSelfHeals"
**Files:** src/conductor/src/engine/conductor.ts
**Wired-into:** src/conductor/src/engine/conductor.ts#buildReviewSelfHeals (existing kickback)
**Dependencies:** 4

### Task 7: Wedge-proof — completeness FAIL loop HALTs at kickback cap
**Story:** A completeness FAIL kicks back (negative)
**Type:** negative-path
**Steps:**
1. Write failing test: 3 consecutive completeness FAILs → `LOOP_HALT_MARKER` + `loop_halt` on the 3rd (not a 4th), via `buildReviewSelfHeals`/`MAX_KICKBACKS_PER_GATE`.
2. RED. 3. Confirm the existing cap covers completeness FAILs. 4. GREEN.
5. Commit: "test: completeness FAIL bounded by MAX_KICKBACKS_PER_GATE (HALT not spin)"
**Files:** src/conductor/src/engine/conductor.ts
**Wired-into:** none (no new production surface)
**Dependencies:** 6

### Task 8: Fail-closed on LLM unavailability
**Story:** Fail-closed on LLM unavailability
**Type:** negative-path
**Steps:**
1. Write failing test: ladder-exhaustion + rate-limit/session/auth during the build_review grader dispatch → no PASS written, not-done, existing `RateLimitEpisode`/park-HALT; never `done:true`.
2. RED. 3. Confirm dispatch failures route to existing handling (independent of any evidence counter). 4. GREEN.
5. Commit: "test: build_review fail-closed on model unavailability"
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/build-review-completeness.test.ts
**Wired-into:** none (no new production surface)
**Dependencies:** 4

### Task 9: Acceptance test — completeness gates a missing planned task end-to-end
**Story:** build_review completeness (integration)
**Type:** happy-path
**Steps:**
1. Write failing acceptance test: with a plan task's work missing, the build does NOT reach done until it's implemented; a `Task:`-trailered-but-unimplemented task is still flagged incomplete (no stamp inference); default-on with no build_review opt-in.
2. RED. 3. Confirm end-to-end wiring. 4. GREEN.
5. Commit: "test(acceptance): build_review completeness gates a missing planned task"
**Files:** src/conductor/test/acceptance/build-review-completeness.acceptance.test.ts
**Wired-into:** none (no new production surface)
**Dependencies:** 6, 7, 8

### Task 10: Remove `evidenceStamps.has(id)` from the build predicate  ⟵ SEQUENCING GATE
**Story:** Per-task evidence-ledger GATING is deleted (build predicate)
**Type:** refactor
**Steps:**
1. Write failing test: build predicate no longer imports `deriveCompletion`/`createTaskEvidence` and does not gate on `evidenceStamps`; a build with unstamped-but-implemented tasks + build_review PASS reaches done.
2. RED. 3. Strip the stamp-gate block (artifacts.ts ~981-1052); keep only structural checks; completion authority is now build_review (completeness) + outcome gates. 4. GREEN.
5. Commit: "refactor: remove per-task evidence gate from build predicate"
**Files:** src/conductor/src/engine/artifacts.ts
**Wired-into:** none (removes a surface)
**Dependencies:** 9

### Task 11: Delete autoheal completion-derivation (keep utilities)
**Story:** Per-task evidence-ledger GATING is deleted (derivation)
**Type:** refactor
**Steps:**
1. Write failing test: `deriveCompletion`/`applyDerivedCompletion`/`reconcileStatusFromStamps`/corroboration/`stampShaReachable`/no-diff/verify-only handling absent; module still exports relocated utilities cleanly.
2. RED. 3. Delete the derivation functions; drop the Task 1 temporary re-export. 4. GREEN.
5. Commit: "refactor: delete autoheal completion derivation (wedge classes)"
**Files:** src/conductor/src/engine/autoheal.ts, src/conductor/src/engine/conductor.ts
**Wired-into:** none (removes a surface)
**Dependencies:** 10

### Task 12: Delete the attribution citation judge gate + evidence CLI judge
**Story:** Per-task evidence-ledger GATING is deleted (judge lane)
**Type:** refactor
**Steps:**
1. Write failing test: `runAttributionLane` citation-gate + `validateCitations` reachability/ancestry/corroboration + `evidence judge` CLI removed/no longer dispatched from the build gate; spot-audit telemetry kept.
2. RED. 3. Delete the lane's gating role + `attribution-validate.ts` checks + `evidence-cli.ts` judge path. 4. GREEN.
5. Commit: "refactor: delete attribution citation judge gate (keep spot-audit)"
**Files:** src/conductor/src/engine/attribution-lane.ts, src/conductor/src/engine/attribution-validate.ts, src/conductor/src/engine/evidence-cli.ts, src/conductor/src/engine/conductor.ts
**Wired-into:** none (removes a surface)
**Dependencies:** 10

### Task 13: Delete the no-evidence park counter + evidence-coupled no_task_progress
**Story:** Per-task evidence-ledger GATING is deleted (park/stall)
**Type:** refactor
**Steps:**
1. Write failing test: `noEvidenceAttempts` park branch + evidence-coupled `no_task_progress` verdict removed; `halt_marker` + wall-clock/attempt bounds + `#188` ladder + `MAX_KICKBACKS_PER_GATE` remain.
2. RED. 3. Delete the counter branch (conductor.ts 3585-3862 region) + `daemon-auto-park.ts` no-evidence branch. 4. GREEN.
5. Commit: "refactor: delete no-evidence park counter (keep wall-clock/attempt bounds)"
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/src/engine/daemon-auto-park.ts
**Wired-into:** none (removes a surface)
**Dependencies:** 10

### Task 14: Delete evidence-based reseed; drop commit-msg evidence rejection; enforcement→advisory
**Story:** Deletion (reseed) + attribution-enforcement demoted to advisory
**Type:** refactor
**Steps:**
1. Write failing test: `task-seed.ts` no longer restores rows from stamps; COMMIT_MSG_HOOK no longer rejects unattributed/empty build commits (grammar kept); `attribution-enforcement.ts` no longer blocks/parks (advisory).
2. RED. 3. Delete reseed (270-303); drop the fail-closed evidence rejection; demote enforcement. 4. GREEN.
5. Commit: "refactor: drop evidence reseed + commit evidence rejection; enforcement advisory"
**Files:** src/conductor/src/engine/task-seed.ts, src/conductor/src/engine/git-hook-assets.ts, src/conductor/src/engine/attribution-enforcement.ts
**Wired-into:** none (removes surfaces / demotes to advisory)
**Dependencies:** 10

### Task 15: Source the #757 resolved-count from Task:-trailered commits
**Story:** Stamps survive as telemetry
**Type:** happy-path
**Steps:**
1. Write failing test: after the derivation deletion, `countResolvedTasks`/`build_progress` advances from distinct plan task-ids carried by `Task:`-trailered commits (and/or `conduct task done`) — not from the deleted derivation.
2. RED. 3. Point the resolved-count at the trailer-derived source; keep `task-evidence.json` as a telemetry record. 4. GREEN.
5. Commit: "feat: progress resolved-count from Task: trailers (telemetry, non-gating)"
**Files:** src/conductor/src/engine/task-progress.ts, src/conductor/src/engine/task-cli.ts
**Wired-into:** src/conductor/src/engine/build-progress-watcher.ts#tick (existing progress consumer)
**Dependencies:** 11

### Task 16: Verify telemetry + separate gates survive (regression)
**Story:** Stamps survive as telemetry / Separate same-named gates untouched
**Type:** negative-path
**Steps:**
1. Run/extend tests: `Task:` trailer stamping + attribution spot-audit + retro Part C still function; `wiring_check`, `acceptance_specs` RED-evidence, shipped-record dedup, owner-gate provenance, push-evidence finish guard tests pass UNCHANGED.
2. RED where new assertions needed. 3. Confirm no behavior change to the five separate gates. 4. GREEN.
5. Commit: "test: telemetry + separate same-named gates survive the demotion"
**Files:** src/conductor/test/engine/task-progress.test.ts, src/conductor/test/integration/git-hooks-attribution.test.ts
**Wired-into:** none (no new production surface)
**Verify-only:** yes
**Dependencies:** 15

### Task 17: Remove/rewrite the gating test suite
**Story:** Per-task evidence-ledger GATING is deleted (test cleanup)
**Type:** refactor
**Steps:**
1. Delete/rewrite tests asserting the deleted gating: autoheal reachability/corroboration/abstain, path-corroboration acceptance, judged-lane/gate-residue, no-diff, verify-only, evidence-cli judge, no_task_progress halt, seed reset-on-missing-stamp, attribution-enforcement block.
2. Keep: `task-evidence` store round-trip, `task-progress` count, attribution spot-audit, stamp-writing hooks, existing build_review tests.
3. Full conductor suite GREEN. 4. Commit: "test: remove per-task evidence gating suite; keep telemetry tests"
**Files:** src/conductor/test/engine/autoheal-stamp-reachability.test.ts, src/conductor/test/engine/autoheal-dirname-corroboration.test.ts, src/conductor/test/engine/autoheal-path-corroboration-abstain.test.ts, src/conductor/test/acceptance/autoheal-path-corroboration-rejects-valid-build-co.acceptance.test.ts, src/conductor/test/acceptance/evidence-gate-validates-provenance-proxies-not-whe.acceptance.test.ts, src/conductor/test/acceptance/no-diff-task-evidence-stamp.acceptance.test.ts, src/conductor/test/acceptance/verify-only-prove-closed-task-evidence.acceptance.test.ts, src/conductor/test/engine/evidence-cli.test.ts, src/conductor/test/engine/attribution-enforcement.test.ts
**Wired-into:** none (no new production surface)
**Dependencies:** 11, 12, 13, 14

### Task 18: Update HARNESS.md model table for build_review activation change
**Story:** Documentation and changelog updated (model table)
**Type:** infrastructure
**Steps:**
1. If build_review's default activation changed its model-table row, regenerate via `bin/generate-model-table` and commit.
2. Run `test/test_harness_integrity.sh` (checks 5/5a/5b) GREEN.
3. Commit: "docs: regenerate model table for build_review default-on"
**Files:** HARNESS.md, src/conductor/src/engine/model-table-metadata.ts
**Wired-into:** none (no new production surface)
**Dependencies:** 4

### Task 19: Update prose docs (README, conductor README, CLAUDE.md, HARNESS.md)
**Story:** Documentation and changelog updated
**Type:** infrastructure
**Steps:**
1. Update passages describing the evidence gate as blocking/parking/deriving-completion → telemetry + build_review completeness (default-on). Leave historical CHANGELOG release entries intact.
2. Commit: "docs: describe build_review completeness + telemetry-only stamps (#773)"
**Files:** README.md, src/conductor/README.md, CLAUDE.md, HARNESS.md
**Wired-into:** none (no new production surface)
**Dependencies:** 16, 17

### Task 20: CHANGELOG [Unreleased] entry (VERSION stays locked)
**Story:** Documentation and changelog updated
**Type:** infrastructure
**Steps:**
1. Add a `CHANGELOG.md` `[Unreleased]` Changed + Removed entry for the demotion + build_review completeness. Do NOT bump `VERSION` (locked until the v1 cut).
2. Run `test/test_harness_integrity.sh` GREEN (VERSION unchanged, `[Unreleased]` present).
3. Commit: "docs(changelog): demote evidence gate to telemetry; build_review completeness (#773)"
**Files:** CHANGELOG.md
**Wired-into:** none (no new production surface)
**Dependencies:** 19

### Task 21: Migration/waiver check for the release gate
**Story:** Release gates
**Type:** infrastructure
**Steps:**
1. Determine whether the change touches a consumer-visible breaking surface (settings.json schema / hook wiring / skill symlink targets / bin/conduct CLI). The commit-msg hook is `hook wiring` — assess whether dropping the evidence rejection is consumer-visible; if internal-only, add a `.docs/release-waivers/demote-task-stamping-to-telemetry.md` waiver (per CLAUDE.md); if consumer-visible, add a `## Migration` bash block to CHANGELOG.
2. Run integrity + release-gate checks GREEN.
3. Commit: "chore(release): migration/waiver for #773 demotion"
**Files:** CHANGELOG.md, .docs/release-waivers/demote-task-stamping-to-telemetry.md
**Wired-into:** none (no new production surface)
**Dependencies:** 20

## Task Dependency Graph
```
Phase 1 (preserve + extend):   1 ──► 2 ──► 3 ──► 4
                                            3 ──► 5
                                            4 ──► 6 ──► 7
                                            4 ──► 8
Phase 2 (prove enforcing):     6,7,8 ─────► 9
──────────────────────── SEQUENCING GATE ────────────────────────
Phase 3 (remove old predicate): 9 ──► 10        (completeness enforcing BEFORE removal)
Phase 4 (demolish):            10 ──► 11
                               10 ──► 12
                               10 ──► 13
                               10 ──► 14
Phase 5 (telemetry):           11 ──► 15 ──► 16
Phase 6 (tests + docs):        11,12,13,14 ──► 17
                               4 ──► 18
                               16,17 ──► 19 ──► 20 ──► 21
```
**Critical invariant:** Task 10 (remove `evidenceStamps.has(id)`) depends on Task 9 (build_review
completeness proven enforcing, default-on, end-to-end). No path lets 10+ run before completeness is in
force — no completion hole exists at any committed state.

## Integration Points
- After Task 9: build_review completeness gates a real missing-task build end-to-end, default-on.
- After Task 10: old per-task gate no longer participates; completion = build_review + outcome gates.
- After Task 15: progress telemetry (#757) verified working off trailers with derivation deleted.
- After Task 21: docs + changelog consistent; VERSION locked; harness integrity + release gate green.

## Verification
- [ ] All happy path criteria covered (Tasks 2,3,4,6,9,10,15)
- [ ] All negative path criteria covered (Tasks 5,7,8,16 + deletion assertions 11-14,17)
- [ ] No task exceeds ~5 min of focused work (deletion tasks scoped per-module)
- [ ] Dependencies explicit and acyclic; sequencing gate (9→10) enforced
- [ ] Every new-surface task carries a Wired-into line
- [ ] VERSION not bumped (locked until v1 cut); CHANGELOG [Unreleased] entry present
- [ ] 21 tasks — single cohesive L feature (delete-after-replace requires the full set)
