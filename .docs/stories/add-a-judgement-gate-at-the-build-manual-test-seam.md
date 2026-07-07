**Status:** Accepted

# Stories: build_review judgement gate at the build → manual_test seam

**Source:** intake jstoup111/ai-conductor#324 · ADR `adr-2026-07-07-build-review-judgement-gate.md` (APPROVED) · technical track, tier M.
All stories testable with an **injected fake grader / fake StepRunner** (gate-loop test pattern) — no live model calls. All tests use an isolated tmpdir `projectRoot` (never cwd `.pipeline/` writes, per #252 convention).

## Story: build_review is a first-class loop member gating manual_test

**Requirement:** TS-1 (ADR decisions 1)

As the conductor engine, I want `build_review` registered as a first-class loopGate step between `build` and `manual_test` so that the gate-driven tail treats it as a loop region member.

### Acceptance Criteria

#### Happy Path
- Given the static registry, when `ALL_STEPS` is loaded, then `build_review` exists with `phase: 'BUILD'`, `enforcement: 'gating'`, `prerequisites: ['build']`, `loopGate: true`, and `manual_test.prerequisites` equals `['build_review']`.
- Given a conduct run with `verifyArtifacts: true` and `build_review` enabled, when `build` completes and its gate satisfies, then the selector's next unsatisfied gate is `build_review` (never `manual_test` directly).
- Given `deriveGateTopology`, when topology is derived, then `build_review` appears in `verdictSteps` and `firstLoopIndex` is unchanged for existing projects.

#### Negative Paths
- Given `build`'s gate is unsatisfied (kickback pending), when the selector runs, then `build_review` is NOT selected (earliest-unsatisfied ordering holds: `build` re-runs first).
- Given `build_review` completed but was later marked `stale` by a downstream kickback cascade, when `gateSatisfied` is evaluated, then it returns false and `build_review` re-runs (stale beats old satisfied verdict).
- Given a per-step config attempts `steps.build_review.disable: true`, when config is validated, then validation rejects it (built-in gating steps cannot be disabled) — the opt-in flag is the only off-switch.
- Given the exhaustive per-step maps (`DEFAULT_STEP_MODELS/EFFORT/RETRIES/REVIEW`, `STEP_PROMPTS`, `model-table-metadata.ts`), when the integrity/model-table tests run, then a missing `build_review` row fails the suite (compile-time or test-time, never silent).

### Done When
- [ ] `build_review` entry present in `ALL_STEPS` with the exact fields above; `StepName` union extended.
- [ ] `manual_test.prerequisites === ['build_review']` asserted by a registry test.
- [ ] Rows exist in every exhaustive per-step map + regenerated model table; `test/generate-model-table.test.ts` and `test_harness_integrity.sh` pass.
- [ ] Selector/topology tests cover ordering and loop-membership above.

## Story: opt-in flag, default off, with exact legacy topology when off

**Requirement:** TS-2 (ADR decision 2)

As a project operator, I want `build_review` off unless I opt in via config so that existing projects pay zero cost and see zero behavior change.

### Acceptance Criteria

#### Happy Path
- Given no `build_review` key in `.ai-conductor/config.yml`, when the conductor starts, then the resolved flag is off and the step is marked `skipped` (with a skip event emitted).
- Given the step is `skipped`, when `manual_test`'s gate is checked, then the `build_review` prerequisite counts as satisfied and the run proceeds `build → manual_test` exactly as today.
- Given `build_review.enabled: true`, when the conductor starts, then the step is active and dispatched after `build`.

#### Negative Paths
- Given `build_review.enabled: false` explicitly, when resolved, then behavior is identical to the absent-key case (no distinction between absent and false).
- Given a malformed value (`build_review.enabled: "yes-please"` / non-boolean), when config is validated, then resolution fails safe to OFF and a validation warning is surfaced — never fail-open into a half-configured gate.
- Given the flag is off, when a stale `.pipeline/build-review.json` from a previous enabled run exists, then it is ignored (skipped step's gate never reads it) and cannot block or satisfy anything.
- Given the flag is toggled on mid-feature (state already past build_review), when the tail re-evaluates, then the skipped status is not retroactively re-opened within the same run (flag is read at startup, consistent with `owner_gate_cutover` read-once semantics).

### Done When
- [ ] Top-level `build_review` config type + safe-by-default resolver (absent/false/malformed → off) with unit tests for all three.
- [ ] Gate-loop integration test: flag off ⇒ step skipped, `manual_test` selected directly after `build`, zero grader dispatches.
- [ ] Gate-loop integration test: flag on ⇒ `build_review` dispatched between `build` and `manual_test`.

## Story: grader runs input-starved in a fresh one-shot session

**Requirement:** TS-3 (ADR decision 3)

As the trust boundary, I want the grader fed only structurally-assembled inputs (feature diff, approved plan, self-run test output) in a fresh one-shot session so that it cannot inherit the maker's confidence.

### Acceptance Criteria

#### Happy Path
- Given an enabled `build_review` dispatch, when the runner builds the grader invocation, then the session is brand-new (`resume: false`, fresh uuid — the `resolveRebaseConflict` pattern), never the maker's session.
- Given the dispatch, when inputs are assembled, then the prompt contains exactly: the `git diff <merge-base(default-branch, HEAD)>..HEAD` output, the plan document body, and the instruction to run the project test suite itself — assembled by engine code from git/fs, not by any agent.
- Given the grader session, when it executes, then it runs the test suite and writes `.pipeline/build-review.json` with `{verdict, reasons[], rubric:{tautology, scope, rootCause}}`.

#### Negative Paths
- Given the maker's summary/transcript and `.pipeline/task-status.json` exist on disk, when the grader prompt is assembled, then a **structural test** asserts none of their content appears in the prompt (assert by construction — the assembly function's inputs are only git diff + plan path — and by prompt-content test, not convention).
- Given `git merge-base` fails (detached/unborn edge), when input assembly errors, then the step fails with a diagnostic and the gate stays unsatisfied — never dispatch a grader with a partial/empty diff presented as complete.
- Given the grader session dies on a terminal API error (ladder exhausted), when the step returns, then the step is `failed`/unsatisfied — dependency unavailability must not read as PASS.
- Given an empty diff (build produced no commits), when assembly runs, then the grader is not dispatched and the verdict is FAIL with reason "no diff to grade" (fail-closed, surfaced as kickback evidence).

### Done When
- [ ] Grader dispatch uses a fresh one-shot session; unit test asserts `resume: false` + new session id.
- [ ] Input-assembly function has a structural isolation test (prompt built from git diff + plan only; task-status/summary content absent).
- [ ] Error paths (merge-base failure, runner death, empty diff) covered by tests, each ending unsatisfied.

## Story: fail-closed verdict predicate

**Requirement:** TS-4 (ADR decision 4)

As the objective gate layer, I want `CUSTOM_COMPLETION_PREDICATES.build_review` to pass only on a valid, fresh PASS verdict so that every malformed or absent grader output blocks rather than ships.

### Acceptance Criteria

#### Happy Path
- Given a valid `.pipeline/build-review.json` with `verdict: 'PASS'` written this session, when the predicate runs, then the gate is satisfied and `computeAndWriteVerdict` records `{satisfied: true}`.

#### Negative Paths
- Given the file is missing, then unsatisfied with reason "no build-review verdict".
- Given malformed JSON or a schema-invalid object (missing `verdict`/`rubric`), then unsatisfied (validator mirrors `validateAcceptanceRedEvidence` strictness).
- Given `verdict: 'FAIL'`, then unsatisfied and the FAIL reasons are preserved for kickback evidence.
- Given a verdict file whose mtime predates the current session (`fileIsFreshSinceSession` false — stale artifact from a prior run), then unsatisfied — a prior session's PASS never carries forward.
- Given any unrecognized verdict string (`'pass'`, `'APPROVED'`, `''`), then unsatisfied — exact-match fail-closed, no case-folding leniency.

### Done When
- [ ] Predicate + validator implemented with unit tests for all six paths above.
- [ ] Predicate registered in `CUSTOM_COMPLETION_PREDICATES` and artifact glob added for `build_review`.

## Story: FAIL kicks back to build with evidence

**Requirement:** TS-5 (ADR decision 6; #384 interaction)

As the loop, I want a FAIL verdict to re-open `build` with the grader's reasons as retry hints so that the rebuild targets the defect instead of guessing.

### Acceptance Criteria

#### Happy Path
- Given a FAIL verdict under the cap, when the tail advances, then a gate verdict `{satisfied: false, kickback: {from: 'build_review', evidence: <grader reasons>}}` is written against `build`, `pendingRetryHints` for `build` carries the reasons, `navigateBack(build)` runs, and downstream steps (`build_review`, `manual_test`) are marked stale.
- Given the kickback re-entered `build`, when the build gate re-evaluates, then task completion is re-derived from plan + git trailers (engine-owned task-status) — previously completed tasks remain completed.
- Given the rebuild completes, when the tail advances, then `build_review` re-runs with a freshly assembled diff (including the fix commits).

#### Negative Paths
- Given a FAIL verdict with empty `reasons[]`, when the kickback is written, then a placeholder evidence line ("grader returned FAIL without reasons") is used — the write-boundary rule (kickback must carry evidence) is never violated.
- Given the build agent wipes `.pipeline/task-status.json` during kickback re-entry, when the build gate re-evaluates, then completion is still re-derived (structurally harmless per ADR 2026-07-05) — asserted by an integration test.
- Given a FAIL verdict, when kickback is processed, then `manual_test` is NOT selectable until `build_review` passes again (stale cascade holds; no skipping past the gate).
- Given a finish-time rebase resolution changed code and re-opened `build` (rebase-resolution re-verify path), when downstream steps are staled, then `build_review` is in the staled set and must re-pass before `manual_test` — the re-verify target set is `{build, build_review, manual_test}`, not the pre-build_review `{build, manual_test}` enumeration.

### Done When
- [ ] Integration test (fake grader FAIL-tautological): kickback verdict written, retry hints seeded, `build` re-selected, stale cascade asserted.
- [ ] Integration test (fake grader FAIL-scope): same path, distinct evidence string asserted end-to-end.
- [ ] Task-completion-survives-kickback test present.

## Story: retry cap HALTs instead of looping unbounded

**Requirement:** TS-6 (ADR decision 6; #324 acceptance criteria)

As the operator, I want the build → build_review → build cycle capped so that a persistently failing grader burns bounded tokens and surfaces to a human.

### Acceptance Criteria

#### Happy Path
- Given `buildReviewSelfHeals` below `MAX_KICKBACKS_PER_GATE` (2), when FAIL arrives, then the counter increments and the kickback proceeds (TS-5). The counter is implemented as the existing **gate-keyed per-gate kickback counter** (the mechanism the daemon `↩ KICKBACK` visibility feature defines) — keyed by `build_review`, not a second parallel counter registry; independence from `manualTestSelfHeals` comes from the key.
- Given the counter at the cap, when a further FAIL arrives, then `LOOP_HALT_MARKER` (`.pipeline/halt-user-input-required`) is written with the grader's evidence, a `loop_halt` event is emitted, and the run stops — no further dispatches.

#### Negative Paths
- Given a HALT was written, when the daemon rekick sweep runs, then the feature is not silently re-dispatched into the same failing cycle (HALT is the terminal state until a human clears it).
- Given a PASS after one FAIL (counter = 1), when the feature later hits an unrelated `manual_test → build` kickback, then the `build_review` counter is NOT consumed by it — counters are per-gate, `manualTestSelfHeals` and `buildReviewSelfHeals` independent.
- Given the counter state, when the conductor restarts mid-feature (daemon crash), then the cap cannot be evaded by restart — the count survives restart or the generic `scanKickbackVerdicts` / `MAX_GATE_SELECTIONS` bounds still backstop unbounded looping (either mechanism acceptable; test pins whichever is implemented).

### Done When
- [ ] Integration test (fake grader always-FAIL): exactly 2 kickbacks then HALT marker + `loop_halt` event; total `build` dispatches = initial + 2.
- [ ] Counter-independence test vs `manualTestSelfHeals`.
- [ ] Restart/backstop bound test present.

## Story: docs and generated tables track the new step

**Requirement:** TS-7 (repo "docs track features" convention)

As a harness consumer, I want the new step and flag documented so that opting in doesn't require reading engine source.

### Acceptance Criteria

#### Happy Path
- Given the feature lands, when docs are checked, then `README.md` + `src/conductor/README.md` describe `build_review` (what it grades, the flag, the cap/HALT behavior), the model table is regenerated, and `CHANGELOG.md` `[Unreleased]` carries an Added entry.

#### Negative Paths
- Given the model-table section drifts from `bin/generate-model-table` output, when `test_harness_integrity.sh` runs, then it fails (existing check 5a/5b covers the new row — verified red before regen, green after).

### Done When
- [ ] README(s), CHANGELOG `[Unreleased]`, and regenerated model table committed with the feature.
- [ ] Full `test/test_harness_integrity.sh` green.
