# Implementation Plan: Demote task-stamping from gate to telemetry (#773)

**Date:** 2026-07-21
**Design:** .docs/decisions/adr-2026-07-21-demote-task-stamping-to-telemetry.md, adr-2026-07-21-build-end-plan-completeness-gate.md
**Stories:** .docs/stories/demote-task-stamping-to-telemetry.md
**Conflict check:** Clean as of 2026-07-21

## Summary
Replace the per-task evidence-ledger build gate with a single build-end `build_completeness`
judgement gate, then delete the per-task mechanical stamp gating apparatus — keeping stamps as
telemetry. 24 tasks across 6 phases, ordered so the new gate is enforcing before the old one is
removed (no completion hole).

## Technical Approach
- **Additive-first, delete-last.** Phases 1–2 preserve shared utilities and build+wire the new
  `build_completeness` gating step (new `StepName`, step def after `build`, fail-closed predicate
  reading `.pipeline/build-completeness.json`, a grader module mirroring `build-review-inputs/-prompt`,
  dispatch + kickback routing reusing `build_review`/`manual_test` machinery). Only in Phase 3, once
  the new gate is enforcing, is the `evidenceStamps.has(id)` check removed from the `build` predicate.
- **Then demolish.** Phase 4 deletes the derivation engine (autoheal completion paths), the
  attribution citation judge lane, the no-evidence park counter + evidence-coupled `no_task_progress`,
  the evidence-based reseed, the commit-msg evidence rejection, and demotes attribution-enforcement to
  advisory. Shared utilities `parsePlanTaskPaths`/`TASK_ID_PATTERN` are relocated first (Phase 1) so
  autoheal cleanup can't break `wiring_check`.
- **Preserve telemetry.** Phase 5 sources the #757 resolved-count from `Task:`-trailered commits, and
  confirms attribution spot-audit + retro Part C still function.
- **Prove + document.** Phase 6 rewrites/removes gating tests, adds `build_completeness` acceptance
  coverage, and updates docs + CHANGELOG.
- The grader reasons **holistically (plan-vs-diff)** and is explicitly forbidden from per-task
  SHA/reachability/corroboration reasoning — the guardrail that keeps the wedge classes deleted.

## Prerequisites
- Work happens in `src/conductor/` (the conductor TS package). Run its test suite (`npm test` in
  `src/conductor/`) per task. Harness integrity (`test/test_harness_integrity.sh`) for doc/config tasks.

## Tasks

### Task 1: Relocate shared plan-parsing utilities out of the evidence surface
**Story:** Shared plan-parsing utilities are preserved
**Type:** refactor
**Steps:**
1. Write failing test: importing `parsePlanTaskPaths` + `TASK_ID_PATTERN` from a new stable module resolves; `wiring-probe.ts`/`wired-into.ts` still compile.
2. RED.
3. Move `parsePlanTaskPaths` + `TASK_ID_PATTERN` into a util module (e.g. `plan-task-parse.ts`); re-export from autoheal for now; update `wiring-probe.ts:36`, `wired-into.ts:11` imports.
4. GREEN.
5. Commit: "refactor: extract plan-task-parse utils from autoheal (preserve for wiring)"
**Files:** src/conductor/src/engine/plan-task-parse.ts, src/conductor/src/engine/autoheal.ts, src/conductor/src/engine/wiring-probe.ts, src/conductor/src/engine/wired-into.ts
**Wired-into:** same as existing (utilities already called from wiring-probe.ts#computeWiringEvidence, wired-into.ts)
**Dependencies:** none

### Task 2: Add `build_completeness` to the StepName union
**Story:** New build_completeness gating step runs after build
**Type:** infrastructure
**Steps:**
1. Write failing test: `StepName` accepts `'build_completeness'`; type-level/enumeration test.
2. RED.
3. Add `build_completeness` to the `StepName` union.
4. GREEN.
5. Commit: "feat: add build_completeness StepName"
**Files:** src/conductor/src/types/index.ts
**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 3: Register the `build_completeness` step after build
**Story:** New build_completeness gating step runs after build
**Type:** happy-path
**Steps:**
1. Write failing test: resolved BUILD order is `... build → build_completeness → build_review ...`; flags `gating`, `loopGate:true`, `prerequisites:['build']`, `kickbackTarget:'build'`.
2. RED.
3. Add the `StepDefinition` to `ALL_STEPS` and honor it in `buildStepRegistry` insertion.
4. GREEN.
5. Commit: "feat: register build_completeness gating step after build"
**Files:** src/conductor/src/engine/steps.ts
**Wired-into:** src/conductor/src/engine/steps.ts#ALL_STEPS, src/conductor/src/engine/steps.ts#buildStepRegistry
**Dependencies:** 2

### Task 4: Define the verdict artifact shape + glob
**Story:** Completeness predicate is fail-closed on its verdict artifact
**Type:** infrastructure
**Steps:**
1. Write failing test: a `BUILD_COMPLETENESS_VERDICT` constant/glob resolves `.pipeline/build-completeness.json`.
2. RED.
3. Add the artifact path constant + `STEP_ARTIFACT_GLOBS`/`findArtifactFiles` entry, mirroring `BUILD_REVIEW_VERDICT`.
4. GREEN.
5. Commit: "feat: define build-completeness verdict artifact path"
**Files:** src/conductor/src/engine/artifacts.ts
**Wired-into:** same as Task 5 (consumed by the predicate)
**Dependencies:** none

### Task 5: Implement the fail-closed `build_completeness` predicate (PASS only)
**Story:** Completeness predicate is fail-closed on its verdict artifact
**Type:** happy-path
**Steps:**
1. Write failing test: fresh `verdict:"PASS"` → `{done:true}`.
2. RED.
3. Add `CUSTOM_COMPLETION_PREDICATES.build_completeness`: read verdict artifact, freshness-gate, `validateBuildCompletenessVerdict` (exact PASS), return done only on fresh PASS.
4. GREEN.
5. Commit: "feat: build_completeness completion predicate (PASS-only)"
**Files:** src/conductor/src/engine/artifacts.ts
**Wired-into:** src/conductor/src/engine/artifacts.ts#checkStepCompletion (CUSTOM_COMPLETION_PREDICATES registry)
**Dependencies:** 4

### Task 6: Predicate not-done on missing verdict
**Story:** Completeness predicate is fail-closed (negative)
**Type:** negative-path
**Steps:**
1. Write failing test: no artifact → `{done:false}`.
2. RED. 3. Ensure missing-file path returns not-done (no throw). 4. GREEN.
5. Commit: "test: build_completeness not-done on missing verdict"
**Files:** src/conductor/src/engine/artifacts.ts, src/conductor/test/engine/build-completeness-predicate.test.ts
**Wired-into:** none (no new production surface)
**Dependencies:** 5

### Task 7: Predicate not-done on stale/malformed/FAIL verdict
**Story:** Completeness predicate is fail-closed (negative)
**Type:** negative-path
**Steps:**
1. Write failing tests: prior-session (stale) → not-done; malformed JSON → not-done (tolerant); `verdict:"FAIL"` → not-done with `routeClass` set.
2. RED. 3. Confirm freshness floor + tolerant parse + FAIL routeClass. 4. GREEN.
5. Commit: "test: build_completeness fail-closed on stale/malformed/FAIL"
**Files:** src/conductor/src/engine/artifacts.ts, src/conductor/test/engine/build-completeness-predicate.test.ts
**Wired-into:** none (no new production surface)
**Dependencies:** 5

### Task 8: Grader inputs module (plan task set + build diff)
**Story:** Grader judges plan-vs-diff holistically and emits named gaps
**Type:** happy-path
**Steps:**
1. Write failing test: inputs builder collects plan tasks (via `parsePlanTaskPaths`) + `git diff` over the build's commits from `projectRoot`/`getHeadSha`.
2. RED. 3. Implement `build-completeness-inputs.ts` mirroring `build-review-inputs.ts`. 4. GREEN.
5. Commit: "feat: build-completeness grader inputs (plan vs diff)"
**Files:** src/conductor/src/engine/build-completeness-inputs.ts
**Wired-into:** same as Task 10 (consumed by the grader dispatch)
**Dependencies:** 1

### Task 9: Grader prompt (holistic; forbids SHA/reachability/corroboration)
**Story:** Grader judges plan-vs-diff holistically and emits named gaps
**Type:** happy-path
**Steps:**
1. Write failing test: prompt instructs a holistic implemented?/gap verdict, emits `RemediationGap` (disposition `build`), and explicitly forbids per-task SHA pinning/reachability/path-corroboration.
2. RED. 3. Implement `build-completeness-prompt.ts` mirroring `build-review-prompt.ts`. 4. GREEN.
5. Commit: "feat: build-completeness grader prompt (holistic, no stamp reasoning)"
**Files:** src/conductor/src/engine/build-completeness-prompt.ts
**Wired-into:** same as Task 10
**Dependencies:** 8

### Task 10: Dispatch the grader; write verdict via availability ladder
**Story:** Grader emits verdict / Fail-closed on unavailability
**Type:** happy-path
**Steps:**
1. Write failing test: dispatch via `invokeWithLadder` writes `.pipeline/build-completeness.json` PASS/FAIL; ladder exhaustion writes NO passing verdict.
2. RED. 3. Add engine dispatch (mirror build_review grader dispatch) writing the verdict file. 4. GREEN.
5. Commit: "feat: dispatch build-completeness grader (ladder, fail-closed)"
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/src/engine/build-completeness-inputs.ts
**Wired-into:** src/conductor/src/engine/conductor.ts (build loop step dispatch, build_review grader path)
**Dependencies:** 3, 9

### Task 11: FAIL gaps route through existing remediation → build
**Story:** FAIL gaps route through existing remediation and re-dispatch build
**Type:** happy-path
**Steps:**
1. Write failing test: a FAIL verdict with `RemediationGap[]` drives `planRemediation`/`appendRemediationTasks` (`rem-*` tasks appended, re-seed) and navigates back to `build`.
2. RED. 3. Wire the `build_completeness` gate-miss branch into the existing remediation routing. 4. GREEN.
5. Commit: "feat: route build_completeness gaps through remediation to build"
**Files:** src/conductor/src/engine/conductor.ts
**Wired-into:** src/conductor/src/engine/conductor.ts#planRemediation (existing remediation path)
**Dependencies:** 10

### Task 12: Empty/malformed gap set is not a silent pass
**Story:** FAIL gaps route (negative)
**Type:** negative-path
**Steps:**
1. Write failing test: FAIL with empty `tasks[]` → treated as malformed (not-done/surfaced), never PASS; daemon non-`build` disposition (e.g. `plan`) → HALT for operator.
2. RED. 3. Enforce these in routing. 4. GREEN.
5. Commit: "test: build_completeness malformed-gap + DECIDE-target handling"
**Files:** src/conductor/src/engine/conductor.ts
**Wired-into:** none (no new production surface)
**Dependencies:** 11

### Task 13: Wedge-proof — kickback cap HALTs on 3rd FAIL
**Story:** The completeness gate cannot wedge
**Type:** negative-path
**Steps:**
1. Write failing test: 3 consecutive FAILs → loop-halt marker + `loop_halt` on the 3rd (not a 4th attempt), using `kickbackCounts`/`MAX_KICKBACKS_PER_GATE`.
2. RED. 3. Ensure `build_completeness` participates in the shared kickback accounting like `manual_test`. 4. GREEN.
5. Commit: "feat: bound build_completeness by MAX_KICKBACKS_PER_GATE"
**Files:** src/conductor/src/engine/conductor.ts
**Wired-into:** same as Task 11 (existing kickback accounting)
**Dependencies:** 11

### Task 14: Unavailability parks/HALTs, never passes
**Story:** Fail-closed on LLM unavailability
**Type:** negative-path
**Steps:**
1. Write failing test: ladder-exhaustion + rate-limit/session/auth during dispatch → not-done + existing `RateLimitEpisode`/park-HALT path; never `done:true`.
2. RED. 3. Confirm dispatch failures route to the existing rate-limit/session/auth handling (independent of any evidence counter). 4. GREEN.
5. Commit: "test: build_completeness fail-closed on model unavailability"
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/build-completeness-predicate.test.ts
**Wired-into:** none (no new production surface)
**Dependencies:** 10

### Task 15: Acceptance test — build_completeness end-to-end enforcing
**Story:** New gate + predicate + routing (integration)
**Type:** happy-path
**Steps:**
1. Write failing acceptance test: with a plan task's work missing, the build does NOT reach done until the gap is remediated; a trailered-but-unimplemented task is still flagged (no stamp inference).
2. RED. 3. Confirm end-to-end wiring. 4. GREEN.
5. Commit: "test(acceptance): build_completeness gates a missing planned task"
**Files:** src/conductor/test/acceptance/build-completeness-gate.acceptance.test.ts
**Wired-into:** none (no new production surface)
**Dependencies:** 11, 13, 14

### Task 16: Remove `evidenceStamps.has(id)` from the build predicate  ⟵ SEQUENCING GATE
**Story:** Per-task evidence-ledger GATING is deleted (build predicate)
**Type:** refactor
**Steps:**
1. Write failing test: build predicate no longer imports `deriveCompletion`/`createTaskEvidence` and does not gate on `evidenceStamps`; a build with unstamped-but-implemented tasks + PASS completeness verdict reaches done.
2. RED. 3. Strip the stamp-gate block (artifacts.ts ~981-1052); keep only structural checks; completion authority is now `build_completeness` + outcome gates. 4. GREEN.
5. Commit: "refactor: remove per-task evidence gate from build predicate"
**Files:** src/conductor/src/engine/artifacts.ts
**Wired-into:** none (removes a surface)
**Dependencies:** 15

### Task 17: Delete autoheal completion-derivation (keep utilities)
**Story:** Per-task evidence-ledger GATING is deleted (derivation)
**Type:** refactor
**Steps:**
1. Write failing test: `deriveCompletion`/`applyDerivedCompletion`/`reconcileStatusFromStamps`/corroboration/`stampShaReachable`/no-diff/verify-only handling are absent; module still exports the (now-relocated) utilities or nothing dangling.
2. RED. 3. Delete the derivation functions; drop the temporary re-export from Task 1. 4. GREEN.
5. Commit: "refactor: delete autoheal completion derivation (wedge classes)"
**Files:** src/conductor/src/engine/autoheal.ts, src/conductor/src/engine/conductor.ts
**Wired-into:** none (removes a surface)
**Dependencies:** 16

### Task 18: Delete the attribution citation judge gate + evidence CLI judge
**Story:** Per-task evidence-ledger GATING is deleted (judge lane)
**Type:** refactor
**Steps:**
1. Write failing test: `runAttributionLane` citation-gate + `validateCitations` reachability/ancestry/corroboration + `evidence judge` CLI are removed/no longer dispatched from the build gate.
2. RED. 3. Delete the lane's gating role + `attribution-validate.ts` checks + `evidence-cli.ts` judge path; keep attribution spot-audit telemetry. 4. GREEN.
5. Commit: "refactor: delete attribution citation judge gate (keep spot-audit)"
**Files:** src/conductor/src/engine/attribution-lane.ts, src/conductor/src/engine/attribution-validate.ts, src/conductor/src/engine/evidence-cli.ts, src/conductor/src/engine/conductor.ts
**Wired-into:** none (removes a surface)
**Dependencies:** 16

### Task 19: Delete the no-evidence park counter + evidence-coupled no_task_progress
**Story:** Per-task evidence-ledger GATING is deleted (park/stall)
**Type:** refactor
**Steps:**
1. Write failing test: `noEvidenceAttempts` park branch + evidence-coupled `no_task_progress` verdict removed; `halt_marker` + wall-clock/attempt bounds + `#188` ladder + `MAX_KICKBACKS_PER_GATE` remain.
2. RED. 3. Delete the counter branch (conductor.ts 3585-3862 region) + `daemon-auto-park.ts` no-evidence branch; keep independent bounds. 4. GREEN.
5. Commit: "refactor: delete no-evidence park counter (keep wall-clock/attempt bounds)"
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/src/engine/daemon-auto-park.ts
**Wired-into:** none (removes a surface)
**Dependencies:** 16

### Task 20: Delete evidence-based reseed; drop commit-msg evidence rejection; enforcement→advisory
**Story:** Deletion (reseed) + attribution-enforcement demoted to advisory
**Type:** refactor
**Steps:**
1. Write failing test: `task-seed.ts` no longer restores rows from stamps; `git-hook-assets.ts` COMMIT_MSG_HOOK no longer rejects unattributed/empty build commits (grammar validation kept); `attribution-enforcement.ts` no longer blocks/parks (advisory).
2. RED. 3. Delete reseed (270-303); drop the fail-closed evidence rejection; demote enforcement. 4. GREEN.
5. Commit: "refactor: drop evidence reseed + commit evidence rejection; enforcement advisory"
**Files:** src/conductor/src/engine/task-seed.ts, src/conductor/src/engine/git-hook-assets.ts, src/conductor/src/engine/attribution-enforcement.ts
**Wired-into:** none (removes surfaces / demotes to advisory)
**Dependencies:** 16

### Task 21: Source the #757 resolved-count from Task:-trailered commits
**Story:** Stamps survive as telemetry
**Type:** happy-path
**Steps:**
1. Write failing test: after the derivation deletion, `countResolvedTasks`/`build_progress` advances from distinct plan task-ids carried by `Task:`-trailered commits (and/or `conduct task done`) — not from the deleted derivation.
2. RED. 3. Point the resolved-count at the trailer-derived source; keep `task-evidence.json` as a telemetry record. 4. GREEN.
5. Commit: "feat: progress resolved-count from Task: trailers (telemetry, non-gating)"
**Files:** src/conductor/src/engine/task-progress.ts, src/conductor/src/engine/task-cli.ts
**Wired-into:** src/conductor/src/engine/build-progress-watcher.ts#tick (existing progress consumer)
**Dependencies:** 17

### Task 22: Verify telemetry + separate gates survive (regression)
**Story:** Stamps survive as telemetry / Separate same-named gates untouched
**Type:** negative-path
**Steps:**
1. Write failing test (or run existing): `Task:` trailer stamping + attribution spot-audit + retro Part C still function; `wiring_check`, `acceptance_specs` RED-evidence, shipped-record dedup, owner-gate provenance, push-evidence finish guard tests pass UNCHANGED.
2. RED (where new assertions needed). 3. Confirm no behavior change to the five separate gates. 4. GREEN.
5. Commit: "test: telemetry + separate same-named gates survive the demotion"
**Files:** src/conductor/test/engine/task-progress.test.ts, src/conductor/test/integration/git-hooks-attribution.test.ts
**Wired-into:** none (no new production surface)
**Verify-only:** yes
**Dependencies:** 21

### Task 23: Remove/rewrite the gating test suite
**Story:** Per-task evidence-ledger GATING is deleted (test cleanup)
**Type:** refactor
**Steps:**
1. Delete/rewrite tests asserting the deleted gating: autoheal reachability/corroboration/abstain, path-corroboration acceptance, judged-lane/gate-residue, no-diff, verify-only, evidence-cli judge, no_task_progress halt, seed reset-on-missing-stamp, attribution-enforcement block.
2. Keep: `task-evidence` store round-trip, `task-progress` count, attribution spot-audit, stamp-writing hooks.
3. Run the full conductor suite GREEN.
4. Commit: "test: remove per-task evidence gating suite; keep telemetry tests"
**Files:** src/conductor/test/engine/autoheal-stamp-reachability.test.ts, src/conductor/test/engine/autoheal-dirname-corroboration.test.ts, src/conductor/test/engine/autoheal-path-corroboration-abstain.test.ts, src/conductor/test/acceptance/autoheal-path-corroboration-rejects-valid-build-co.acceptance.test.ts, src/conductor/test/acceptance/evidence-gate-validates-provenance-proxies-not-whe.acceptance.test.ts, src/conductor/test/acceptance/no-diff-task-evidence-stamp.acceptance.test.ts, src/conductor/test/acceptance/verify-only-prove-closed-task-evidence.acceptance.test.ts, src/conductor/test/engine/evidence-cli.test.ts, src/conductor/test/engine/attribution-enforcement.test.ts
**Wired-into:** none (no new production surface)
**Dependencies:** 17, 18, 19, 20
### Task 24: Update docs + CHANGELOG
**Story:** Documentation and changelog updated
**Type:** infrastructure
**Steps:**
1. Update README.md, src/conductor/README.md, CLAUDE.md, HARNESS.md passages describing the evidence gate as blocking/parking/deriving-completion → telemetry + the `build_completeness` gate; leave historical CHANGELOG release entries intact.
2. Add a `CHANGELOG.md` `[Unreleased]` Changed/Removed entry for the demotion; bump VERSION per operator's semver decision.
3. Run `test/test_harness_integrity.sh` GREEN.
4. Commit: "docs: describe build_completeness gate + telemetry-only stamps (#773)"
**Files:** README.md, src/conductor/README.md, CLAUDE.md, HARNESS.md, CHANGELOG.md, VERSION
**Wired-into:** none (no new production surface)
**Dependencies:** 22, 23

## Task Dependency Graph
```
Phase 1 (preserve + scaffold):   1 ─┐        2 ──► 3
                                    │         4 ──► 5 ──► 6
                                    │                └──► 7
Phase 2 (build + wire gate):     1 ─┴► 8 ──► 9 ──► 10 ──► 11 ──► 12
                                              3 ──►  10        11 ──► 13
                                                     10 ──► 14
                                    11,13,14 ─────────────► 15
────────────────────────── SEQUENCING GATE ──────────────────────────
Phase 3 (remove old predicate):  15 ──► 16          (gate enforcing BEFORE removal)
Phase 4 (demolish):              16 ──► 17
                                 16 ──► 18
                                 16 ──► 19
                                 16 ──► 20
Phase 5 (telemetry):             17 ──► 21 ──► 22
Phase 6 (tests + docs):          17,18,19,20 ──► 23
                                 22,23 ──► 24
```
**Critical invariant:** Task 16 (remove `evidenceStamps.has(id)`) depends on Task 15 (new gate
proven enforcing end-to-end). No path lets 16+ run before the new gate is in force — no completion
hole exists at any committed state.

## Integration Points
- After Task 15: `build_completeness` gates a real missing-task build end-to-end (new authority live).
- After Task 16: old per-task gate no longer participates; completion = new gate + outcome gates.
- After Task 21: progress telemetry (#757) verified working off trailers with derivation deleted.
- After Task 24: docs + changelog consistent; harness integrity green.

## Verification
- [ ] All happy path criteria covered (Tasks 1,3,5,8,9,10,11,15,16,21)
- [ ] All negative path criteria covered (Tasks 6,7,12,13,14,22 + deletion assertions 17-20,23)
- [ ] No task exceeds ~5 min of focused work (deletion tasks are scoped per-module)
- [ ] Dependencies explicit and acyclic; sequencing gate (15→16) enforced
- [ ] Every new-surface task carries a Wired-into line
- [ ] 24 tasks — large but a single cohesive L feature (delete-after-replace requires the full set)
