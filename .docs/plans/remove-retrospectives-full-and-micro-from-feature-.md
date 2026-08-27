# Implementation Plan: Remove retrospectives (full and micro) from feature delivery

**Date:** 2026-08-26
**Stories:** .docs/stories/remove-retrospectives-full-and-micro-from-feature-.md
**Conflict check:** Clean as of 2026-08-26

## Summary

One-shot removal of the `retro` SHIP step, the daemon-completion retro narrative provider call,
the `micro-retro` closeout obligation, and the retro skill/config/template surface, per APPROVED
adr-2026-08-26-remove-retrospectives-one-shot. 15 tasks.

## Technical Approach

Removal-shaped per `/code-removal`: survivors are characterized first, then deletion proceeds
compiler-outward. Deleting `'retro'` from the `StepName` union (src/conductor/src/types/steps.ts)
makes every exhaustive `Record<StepName, …>` a compile error, so the union deletion, the step
registry deletion, and the `rebase` prerequisite rewire land together (Task 2) and `tsc`
enumerates the record fallout (Task 3). Hand-written string lists and name-matched branches
escape the compiler and get their own tasks (4-6). The `micro-retro` obligation is an
independent lockstep pair (`satisfies` ties the events union to the CLI allowlist) — Task 9.
The harness surface (skill deletion, cross-skill refs, model-table regeneration, harness-test
edits) must be internally atomic for integrity checks 4 and 5a — Task 11 is one commit.
Ordinary docs pages under docs/ are NOT plan tasks (documentation boundary); they ride the
standard documentation-upkeep machinery in the same PR, and Task 14's sweep enumerates the hits
for it. Test triage discipline: DIRECT retro tests are deleted with their subject; INCIDENTAL
tests (shared fixtures, integration flows) are mutated to the surviving flow, never deleted.
Recovery anchor `retro-last` already exists on origin; no task re-creates it.

## Prerequisites

- APPROVED adr-2026-08-26-remove-retrospectives-one-shot (operator waiver of the two-phase
  step-retirement contract, scoped to this change) — present on this branch.

## Tasks

### Task 1: Characterize the halt-narrative survivor
**Story:** Story 2
**Type:** infrastructure
**Verify-only:** yes

**Steps:**
1. Locate existing engineer-store tests covering the halted path (`renderHaltNarrative` output, `narrativeRef` populated, zero provider calls) and the resilient-read path (malformed line skipped; best-effort store-write failure does not fail the run).
2. If any of those survivor behaviors lacks a test, add and commit a characterization test BEFORE any deletion task runs; otherwise record the covering test names in the task's evidence trailer.

**Done when:**
- Named tests exist and pass asserting: halted outcome writes a halt narrative with zero provider invocations; malformed signal lines are skipped on read; store-write failure is reported without failing the run.
- The evidence trailer (or characterization-test commit) names the covering test for each of the three survivor behaviors.

**Files likely touched:**
- src/conductor/test/engineer-store.test.ts — characterization additions only if coverage gaps found

**Dependencies:** none

### Task 2: Delete the retro step and rewire rebase (atomic core)
**Story:** Story 1
**Type:** refactor

**Steps:**
1. Write failing test: SHIP-tail registry test asserting `rebase.prerequisites` equals `['architecture_review_as_built']` and the step registry has exactly the surviving step set.
2. Verify RED.
3. In src/conductor/src/engine/steps.ts delete the `retro` StepDefinition and change `rebase.prerequisites` from `['retro']` to `['architecture_review_as_built']` in the same edit; delete `'retro'` from the `StepName` union in src/conductor/src/types/steps.ts and update its loopGate doc comment.
4. Verify GREEN on the registry test (full compile lands in Task 3; commit Tasks 2-3 together if `tsc` gates the commit).
5. Commit: "remove retro step; rewire rebase to architecture_review_as_built".

**Done when:**
- Registry test passes pinning the new `rebase` prerequisites and surviving step set.
- The diff contains both the union-member deletion and the prerequisite rewire (the silent no-ship hazard class — a prerequisite naming a nonexistent step — is prevented by making the rewire and deletion one change, plus the Task 7 gate test).

**Files likely touched:**
- src/conductor/src/engine/steps.ts — step def deleted, rebase rewired
- src/conductor/src/types/steps.ts — union member removed

**Dependencies:** 1

### Task 3: Resolve compiler-enumerated exhaustive records
**Story:** Story 4
**Type:** refactor

**Steps:**
1. Run `tsc`; remove the `retro` key from every exhaustive record it flags: DEFAULT_STEP_RETRIES and DEFAULT_STEP_REVIEW (src/conductor/src/engine/resolved-config.ts), CLAUDE_STEP_MODELS/CODEX_STEP_MODELS/STEP_EFFORTS (src/conductor/src/engine/provider-model-policy.ts), STEP_RATIONALE (src/conductor/src/engine/model-table-metadata.ts), STEP_SKILL_INVOCATIONS (src/conductor/src/engine/skill-invocation.ts), the artifact contract entry and the completion predicate (src/conductor/src/engine/artifacts.ts), and any others tsc names.
2. Verify `tsc` clean and the existing config/model-policy tests pass with the shrunk records.
3. Commit: "drop retro from exhaustive step records".

**Done when:**
- `tsc` exits 0 with zero remaining `retro`-keyed entries in the named records.
- Config resolution and model-policy test suites pass.

**Files likely touched:**
- src/conductor/src/engine/resolved-config.ts — retries/review entries removed
- src/conductor/src/engine/provider-model-policy.ts — model/effort entries removed
- src/conductor/src/engine/model-table-metadata.ts — rationale entry removed
- src/conductor/src/engine/skill-invocation.ts — dispatch descriptor removed
- src/conductor/src/engine/artifacts.ts — artifact contract + completion predicate removed

**Dependencies:** 2

### Task 4: Edit hand-written runtime step lists
**Story:** Story 4
**Type:** refactor

**Steps:**
1. Write failing test: interactive one-shot dispatch and stale-complete re-verification operate over the surviving steps (SHIP_GATING_STEPS = test_suite, manual_test, finish; oneShotSteps = complexity, conflict_check, architecture_diagram, rebase).
2. Verify RED, then remove `'retro'` from SHIP_GATING_STEPS (src/conductor/src/engine/complete-verifier.ts), oneShotSteps (src/conductor/src/engine/step-runners.ts), and the DOCS_WRITE_ALLOWLIST per-step entry (src/conductor/src/engine/phase-marker.ts).
3. Verify GREEN; commit: "remove retro from runtime step lists".

**Done when:**
- Named tests pin the three surviving lists and pass.
- `resolveDocsAllowlist` tests pass with no per-step prefixes (ALWAYS-ALLOWED prefixes unchanged).

**Files likely touched:**
- src/conductor/src/engine/complete-verifier.ts — SHIP_GATING_STEPS
- src/conductor/src/engine/step-runners.ts — oneShotSteps
- src/conductor/src/engine/phase-marker.ts — DOCS_WRITE_ALLOWLIST

**Dependencies:** 2

### Task 5: Delete the daemon-mode retro skip branch
**Story:** Story 4
**Type:** refactor

**Steps:**
1. Remove the `if (this.daemon && step.name === 'retro')` skip branch (src/conductor/src/engine/conductor.ts:5898-5911 region) and rewrite the `daemon` option doc comments that define the flag in terms of the retro skip (conductor.ts, src/conductor/src/daemon-cli.ts).
2. Verify the skip-chain tests pass: no name-matched step special case remains and `config_skip`/`recordStepSkip` behavior for other causes is unchanged.
3. Commit: "remove daemon-mode retro skip branch".

**Done when:**
- Skip-chain tests pass with the branch gone; `recordStepSkip` generic behavior unchanged (existing tests green).
- The `daemon` flag's doc comments describe its surviving effects only.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — skip branch + comments
- src/conductor/src/daemon-cli.ts — option doc comment

**Dependencies:** 2

### Task 6: Delete the completion narrative provider path
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing test: `emitEngineerSignal` for a `done` outcome (any tier) appends a valid record with `narrativeRef` absent and the injected provider adapter records zero invocations; halted outcome unchanged (Task 1 characterization stays green).
2. Verify RED.
3. In src/conductor/src/engine/engineer-store.ts delete the done-branch of `produceNarrative` (the `executeProviderCandidates` call, `buildRetroPrompt`, the legacy session fallback, the `tierSkippedRetro` arg threading); keep `renderHaltNarrative`. In src/conductor/src/engine/daemon-runner.ts delete `retroTierSkipped` and its call sites.
4. Verify GREEN; commit: "engineer signal emits without provider call on done".

**Done when:**
- New test passes: done → zero provider invocations, `narrativeRef` absent; halted → halt narrative referenced.
- Store schema tests pass with `narrativeRef` absent on all non-halted records.
- Task 1's survivor tests still pass.

**Files likely touched:**
- src/conductor/src/engine/engineer-store.ts — narrative provider path deleted
- src/conductor/src/engine/daemon-runner.ts — retroTierSkipped + threading deleted

**Dependencies:** 1, 2

### Task 7: Pin the SHIP tail ordering end-to-end
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing (or newly-passing, if Task 2's registry test already implies it — then fold assertions there and mark this in the evidence) gate-loop test: with `architecture_review_as_built` done+satisfied, `rebase` is runnable, then `finish`; with it unsatisfied, `rebase` stays gate-blocked; a validly SKIPPED prerequisite state satisfies the gate (the #922 skipped-prerequisite acceptance re-pointed at the new edge); a failed validation-group join still blocks `rebase`.
2. Verify GREEN after Tasks 2-4; commit: "pin SHIP tail architecture_review_as_built → rebase → finish".

**Done when:**
- Gate-loop test passes covering: satisfied → runnable, unsatisfied → blocked, skipped-prerequisite acceptance, failed join → blocked.
- An executed-sequence assertion (daemon-runner or conductor integration test) shows the SHIP tail as exactly architecture_review_as_built, rebase, finish.

**Files likely touched:**
- src/conductor/test/gates.test.ts — tail ordering assertions
- src/conductor/test/conductor-ship-tail.test.ts — executed-sequence assertion (or the existing suite file that owns it)

**Dependencies:** 3, 4

### Task 8: Pin fail-by-name on stale retro references
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write tests: (a) config carrying a `steps.retro` key fails resolution naming the unknown step; (b) loading a `conduct-state.json` recording a retro step status fails by name (mechanism: the existing `Unknown step: <name>` throw in the step registry lookup, steps.ts getStep/resolve path — the decided fail-loud mechanism, not a new validator).
2. If (a) or (b) currently passes silently (e.g. unknown step keys ignored), implement the minimal check that routes both through the existing unknown-step throw.
3. Verify GREEN; commit: "stale retro references fail by name".

**Done when:**
- Both tests pass with error messages naming `retro` as the unknown step.
- No permanently-pending gate state is reachable from a stale reference (covered by the two tests plus Task 7's blocked-vs-runnable assertions).

**Files likely touched:**
- src/conductor/src/engine/config.ts — unknown step-key routing if currently silent
- src/conductor/src/engine/state.ts — state-load unknown-step routing if currently silent
- src/conductor/test/config.test.ts — negative tests

**Dependencies:** 3

### Task 9: Remove the micro-retro closeout obligation (lockstep pair)
**Story:** Story 3
**Type:** refactor

**Steps:**
1. Write failing test: `conduct-ts closeout-event micro-retro <start> <end>` exits non-zero naming the unknown obligation; the batch-gate roster test enumerates the surviving obligations; rollup/build-tail rendering aggregates the surviving set.
2. Verify RED.
3. Delete `'micro-retro'` from the `pipeline_closeout.obligation` union (src/conductor/src/types/events.ts) and from CLOSEOUT_OBLIGATIONS (src/conductor/src/engine/closeout-cli.ts) in one edit (`satisfies` enforces lockstep); shrink the enforced batch-gate obligation roster in the same change.
4. Verify GREEN; commit: "remove micro-retro closeout obligation".

**Done when:**
- CLI rejection test passes; `isCloseoutObligation('micro-retro')` is false.
- Batch-gate roster test passes on the surviving set; a missing surviving obligation still fails closed (existing enforcement test green).
- `tsc` clean (lockstep pair consistent).

**Files likely touched:**
- src/conductor/src/types/events.ts — obligation union
- src/conductor/src/engine/closeout-cli.ts — allowlist
- src/conductor/test/closeout-cli.test.ts — rejection + roster tests

**Dependencies:** none

### Task 10: Triage and migrate the conductor test suite
**Story:** Story 4
**Type:** refactor

**Steps:**
1. Enumerate every conductor test file referencing retro (~89 candidates). Classify each per `/code-removal`: DIRECT (sole subject is retro behavior) → delete with justification in the commit body; INCIDENTAL (shared fixtures, step-sequence assertions, integration flows) → mutate to the surviving flow (fixtures lose the retro entry; sequence assertions use the new tail; tier-skip tests use a surviving skippable step).
2. Check the s-tier pipeline-knobs pinning test for step-name enumeration and update its expected set if it enumerates.
3. Run the full conductor suite; fix fallout; commit: "triage retro tests: delete DIRECT, migrate INCIDENTAL".

**Done when:**
- Full conductor suite green.
- The commit body lists each deleted DIRECT file/case; no INCIDENTAL test was deleted.

**Files likely touched:**
- src/conductor/test/ — DIRECT deletions and INCIDENTAL migrations across the enumerated set

**Dependencies:** 3, 4, 5, 6, 9

### Task 11: Delete the retro skill surface atomically (integrity checks 4/5a)
**Story:** Story 5
**Type:** refactor

**Steps:**
1. In ONE commit: delete skills/retro/; remove or rewrite every `/retro` and micro-retro reference in skills/pipeline/SKILL.md (batch checklist bullet, Micro-Retros section, summary.json rationale), skills/simplify/SKILL.md, skills/conduct/SKILL.md (step 17, predicate/progress/tier tables, final report), skills/manual-test/SKILL.md, skills/architecture-review/SKILL.md (flow wording), skills/tdd/SKILL.md, skills/bootstrap/SKILL.md (scaffold list), skills/intake/SKILL.md; update templates/pull_request_template.md and templates/CLAUDE.md.template; run bin/generate-model-table to regenerate the HARNESS.md model table and update HARNESS.md's phase-flow, artifact-table, exemption-list, output-restriction, tech-context, and prose retro lines; delete the three retro assertions and the audit-loop entry in test/test_provider_skill_contracts.sh.
2. Run test/test_harness_integrity.sh and test/test_provider_skill_contracts.sh; fix any dangling-reference or drift failure before committing.
3. Commit: "delete retro skill surface; regenerate model table".

**Done when:**
- test/test_harness_integrity.sh fully green (checks 4 and 5a included) at this commit.
- test/test_provider_skill_contracts.sh green over the surviving skill set.
- HARNESS.md model table byte-identical to bin/generate-model-table output.

**Files likely touched:**
- skills/ — retro directory deleted; eight SKILL.md files edited
- HARNESS.md — regenerated table + prose lines
- templates/pull_request_template.md; templates/CLAUDE.md.template — retro rows removed
- test/test_provider_skill_contracts.sh — retro assertions removed

**Dependencies:** 3

### Task 12: Remove the legacy bin/conduct retro step
**Story:** Story 4
**Type:** refactor

**Steps:**
1. Delete check_retro/run_retro, the status check, step/label/check array entries, recovery prompt, usage text, dispatch case, ALL_STEPS/STEP_FUNCS/STEP_LABELS entries, SHIP-artifact commit-message line, and final summary line from bin/conduct; update the per_feature_steps entry in test/test_conduct_worktree.sh.
2. Run `bash -n bin/conduct`, test/lint_shell.sh, and test/test_conduct_worktree.sh.
3. Commit: "remove retro step from legacy bin/conduct".

**Done when:**
- bin/conduct parses (`bash -n`) and is shellcheck-clean at error severity via test/lint_shell.sh.
- test/test_conduct_worktree.sh passes with the surviving step arrays.

**Files likely touched:**
- bin/conduct — retro step machinery removed
- test/test_conduct_worktree.sh — per_feature_steps updated

**Dependencies:** none

### Task 13: Update generated session-hook and comment surfaces
**Story:** Story 5
**Type:** refactor

**Steps:**
1. Replace the retro-flavored worked examples in the generated hook's prefix-matching comments (src/conductor/src/engine/session-hook-assets.ts) and hooks/claude/docs-guard.sh with a surviving-step example; sweep remaining engine comment-only retro mentions flagged in the review (gate-verdicts.ts rationale block, conductor.ts recordStepSkip comments, index.ts/daemon-cli.ts AuditTrailWriter comments, escalation-ladder comment) and rewrite them against surviving behavior.
2. Run the affected unit tests and shell lint.
3. Commit: "rewrite retro-flavored comments and hook examples".

**Done when:**
- session-hook-assets tests pass; hooks pass shellcheck at error severity.
- No engine comment describes retro as a live step or consumer.

**Files likely touched:**
- src/conductor/src/engine/session-hook-assets.ts — comment example
- hooks/claude/docs-guard.sh — comment example
- src/conductor/src/engine/gate-verdicts.ts; src/conductor/src/engine/conductor.ts; src/conductor/src/index.ts; src/conductor/src/daemon-cli.ts — comment rewrites

**Dependencies:** 5

### Task 14: Completeness sweep
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Sweep literal names (`retro`, `micro-retro`, `mini-retro`, `retrospective`, `.docs/retros`, `buildRetroPrompt`, `retroTierSkipped`, `tierSkippedRetro`, `check_retro`, `run_retro`, `batch-N-retro`) across source, skills, templates, hooks, bin, test, and docs. grep here is ugrep -I (binary/NUL files silently skipped) — additionally run `git grep -I` as a second engine so empty output from one tool is never the sole evidence.
2. Review every hit: remove it, or justify it in the commit body as a historical record (shipped `.docs/` artifacts of past features, `.docs/retros/` reports, CHANGELOG history, the `retro-last` tag reference, this feature's own artifacts) or an incidental match (retroactive/retroactivity identifiers).
3. Enumerate remaining docs/ page hits for the documentation-upkeep pass riding this PR (not plan work).
4. Commit: "retro completeness sweep" with the justified-hit list in the body.

**Done when:**
- The commit body contains the full reviewed hit list from both grep engines; every surviving hit carries a justification from the closed set above.
- Full conductor suite plus test/test_harness_integrity.sh green at this commit.

**Files likely touched:**
- none — sweep resolves stragglers in place; expected result is justifications, not edits

**Dependencies:** 10, 11, 12, 13

### Task 15: Reconcile open retro-dependent work
**Story:** Story 6
**Type:** infrastructure

**Steps:**
1. Add `Closes jstoup111/ai-conductor#717` to this feature's PR body alongside the existing issue linkage (via `gh pr edit` once the implementation PR exists, or the finish step's PR-body mechanism), with one line citing the removal ADR as the obsoleting decision.
2. Post a re-scoping comment on jstoup111/ai-conductor#939 via `gh issue comment`: the retro producer is removed; the surviving general clause (post-BUILD accepted stories need an observable lifecycle disposition) stands or the issue closes at operator discretion; record the disposition of the 927 retro-followups residual story named in Story 6.
3. Commit evidence trailer only if no repo file changes (Evidence: skipped — external issue reconciliation).

**Done when:**
- The PR body carries the `Closes` line for #717 with the obsoleting rationale.
- #939 carries the re-scoping comment including the 927 residual disposition.

**Files likely touched:**
- none — external `gh` operations

**Dependencies:** 14

## Task Dependency Graph

```
T1 ──▶ T2 ──▶ T3 ──▶ T7   T9 (independent)   T12 (independent)
       │      ├────▶ T8
       │      └────▶ T11
       ├────▶ T4 ──▶ T7
       ├────▶ T5 ──▶ T13
       └────▶ T6
T3,T4,T5,T6,T9 ──▶ T10
T10,T11,T12,T13 ──▶ T14 ──▶ T15
```

## Integration Points

- After Task 7: the surviving SHIP tail is provable end-to-end in the engine suite.
- After Task 10: the full conductor suite is green on the retro-free engine.
- After Task 14: the whole repository (engine + harness surface) validates clean.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task (Tasks 7, 8, 9, 14 own them explicitly)
- [ ] No task exceeds granularity materially except the declared-atomic Task 11 (integrity-check atomicity requires one commit)
- [ ] Every task has a falsifiable `Done when:` block; fail-loud/fail-closed properties name their mechanism (unknown-step throw; `satisfies` lockstep; integrity checks 4/5a)
- [ ] Dependencies explicit and acyclic
- [ ] No terminal catch-all validation task (Task 14 is a bounded sweep with a closed justification set, not a re-validation of the feature)
