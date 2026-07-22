**Status:** Accepted

# Stories: Demote task-stamping from gate to telemetry (#773)

Technical track. Acceptance criteria are stated as observable engine behavior (Given/When/Then).
Source of truth: `adr-2026-07-21-demote-task-stamping-to-telemetry` (demotion) and
`adr-2026-07-21-completeness-as-build-review-rubric` (replacement — folds a default-on completeness
rubric item into the existing `build_review` judgement gate; supersedes the new-step ADR).

---

## Story: build_review gains a default-on completeness rubric item

**Requirement:** ADR-completeness-as-build-review-rubric (rubric extension + default-on)

As the conductor build loop, I want the existing `build_review` judgement gate to also judge whether
all planned work was implemented, so completion is judged holistically without a per-task stamp gate.

### Acceptance Criteria

#### Happy Path
- Given `build_review` runs at the build → manual_test seam, when it grades a diff, then its rubric
  includes a 4th item — **Completeness: every planned task's work is present in the diff** — under
  the existing all-items-or-FAIL rule, and the verdict schema's `rubric` object carries a
  `completeness` field.
- Given a fresh project with no build_review opt-in, when a build runs, then the completeness rubric
  item is active by DEFAULT (it does not require enabling `build_review` per-project) — it is the
  replacement completion authority for the deleted evidence gate.

#### Negative Paths
- Given a plan with a task whose work is absent from the diff, when build_review grades, then the
  completeness item FAILs and the overall verdict is FAIL (all-or-FAIL).
- Given build_review's diff-honesty items (tautology/scope/rootCause) are configured off/tunable,
  when a build runs, then the completeness item STILL runs (completeness is unconditional even if the
  diff-honesty dial is off) — the step no longer silently `skipped`-defaults out of existence.

### Done When
- [ ] `build-review-prompt.ts` rubric includes a `completeness` item; verdict `rubric.completeness`
      field validated.
- [ ] build_review's completeness dimension is default-on (resolver default / skip idiom adjusted);
      model/effort/retry maps + HARNESS.md model table updated if activation changed.
- [ ] A test asserts completeness runs on a fresh project with no explicit build_review opt-in.

---

## Story: build_review verdict stays fail-closed with the completeness item

**Requirement:** ADR-completeness-as-build-review-rubric (fail-closed predicate reused)

As the completion checker, I want the existing fail-closed `build_review` predicate to gate on the
extended rubric, so judgement remains fail-closed.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/build-review.json` written this session with `verdict: "PASS"` (all four rubric
  items pass), when the `build_review` predicate runs, then it returns `{ done: true }`.

#### Negative Paths
- Given no verdict artifact exists, when the predicate runs, then it returns `done: false`.
- Given a verdict written in a PRIOR session (stale), when the predicate runs, then `done: false`.
- Given a malformed/unparseable verdict, when the predicate runs, then `done: false` (tolerant parse,
  never a crash, never a pass).
- Given `verdict: "FAIL"` because the completeness item failed, when the predicate runs, then
  `done: false` and the build_review kickback path is armed.

### Done When
- [ ] No change to the fail-closed contract: only a fresh exact `PASS` yields `done:true`;
      missing/stale/malformed/`FAIL` all yield `done:false` — existing tests still pass, extended for
      the completeness-driven FAIL.

---

## Story: Grader judges plan-vs-diff completeness holistically (no stamp reasoning)

**Requirement:** ADR-completeness-as-build-review-rubric (grader)

As the build_review grader, I want to judge completeness by comparing the plan's task set against the
diff it already receives, so unimplemented planned work is caught — without per-task stamp reasoning.

### Acceptance Criteria

#### Happy Path
- Given the grader already receives `{ diff, planBody }`, when it evaluates completeness, then it
  judges whether every planned task's work is present in the diff and reports a one-line
  `rubric.completeness` reason.
- Given every planned task's work is present, when the grader runs, then the completeness item passes.

#### Negative Paths
- Given a diff that touches unrelated files while a planned task's work is missing, when the grader
  runs, then completeness still FAILs (file activity does not mask a missing task).
- Given the grader prompt, when it reasons about completeness, then it does NOT pin/cite a SHA, check
  commit reachability, or path-corroborate a stamp — a test proves a `Task:`-trailered-but-
  unimplemented task is still reported as incomplete.
- Given a task marked verify-only / no-code-change in the plan, when the grader runs, then absence of
  a diff for it is NOT a completeness gap (holistic judgement respects intent, no per-task marker).

### Done When
- [ ] `build-review-prompt.ts` completeness rubric text forbids per-task SHA/reachability/
      corroboration reasoning; a test proves a trailered-but-unimplemented task fails completeness.
- [ ] No new grader inputs are required (the diff + plan build_review already receives suffice).

---

## Story: A completeness FAIL kicks back to build via build_review's self-heal

**Requirement:** ADR-completeness-as-build-review-rubric (routing reuses build_review kickback)

As the conductor, I want a completeness FAIL to reuse build_review's existing kickback, so no new
routing is introduced.

### Acceptance Criteria

#### Happy Path
- Given a FAIL driven by the completeness item under the kickback cap, when the conductor handles it,
  then it uses the existing `buildReviewSelfHeals` block: seeds `pendingRetryHints.set('build',
  <grader reasons naming the missing work>)`, `navigateBack('build')`, downstream stale.

#### Negative Paths
- Given repeated completeness FAILs at the kickback cap (`MAX_KICKBACKS_PER_GATE` = 2), when it FAILs
  a third time, then the loop writes `LOOP_HALT_MARKER` and emits `loop_halt` — it does not spin.
- Given build re-entry after kickback, when tasks are re-derived, then completion is re-derived from
  plan + git trailers (non-destructive re-entry), and build_review re-grades.

### Done When
- [ ] Completeness FAIL reuses `buildReviewSelfHeals` (no new kickbackTarget, no new routing).
- [ ] A test drives ≥3 completeness FAILs and asserts HALT on the 3rd, not a 4th attempt.

---

## Story: Fail-closed on LLM unavailability

**Requirement:** ADR-completeness-as-build-review-rubric (unavailability)

As the operator, I want build_review to block rather than pass when the grader cannot reach a model,
so unavailability never green-lights an unverified build.

### Acceptance Criteria

#### Happy Path
- Given the grader dispatches via the availability ladder and succeeds on a fallback model, when it
  completes, then it writes a normal PASS/FAIL verdict (including the completeness item).

#### Negative Paths
- Given the model fallback ladder is exhausted, when the grader dispatch fails, then NO `PASS` verdict
  is written, the predicate stays `done:false`, and the existing `RateLimitEpisode`/HALT-park path
  handles it (independent of the deleted no-evidence counter) — never advances.
- Given a rate-limit / session-expired / auth-failure during dispatch, when the conductor handles it,
  then it uses the existing distinct handling, never the deleted no-evidence counter.

### Done When
- [ ] Grader dispatch uses `invokeWithLadder`; exhaustion writes no passing verdict.
- [ ] A test simulating ladder exhaustion asserts not-done + park/HALT, never `done:true`.

---

## Story: Per-task evidence-ledger GATING is deleted

**Requirement:** ADR-demote-task-stamping-to-telemetry (deletion)

As the maintainer, I want the per-task mechanical stamp gating removed so the six wedge bug-classes
become structurally impossible.

### Acceptance Criteria

#### Happy Path
- Given a build whose tasks lack per-task evidence stamps but whose planned work is present, when the
  pipeline runs, then the `build` step no longer blocks on `evidence.evidenceStamps.has(id)` — build
  completion is decided by build_review (incl. completeness) + the outcome gates, not by stamps.

#### Negative Paths
- Given the codebase after the change, when searched, then `deriveCompletion`/`deriveCompletionInternal`,
  `applyDerivedCompletion`, `reconcileStatusFromStamps`, the corroboration helpers
  (`fileMatchesPlanPath`/`fileDirMatchesPlanPath`/`corroborationMatch`), `stampShaReachable` +
  pinned-preserve/demote, no-diff/verify-only completion handling, the attribution judge citation
  gate, the no-evidence auto-park counter branch, the evidence-based reseed, and the commit-msg
  evidence rejection are ALL absent (no dead-but-reachable copies).
- Given a commit on a build step lacking an `Evidence:`/`Task:` resolution, when it is committed,
  then the commit is NOT rejected by the commit-msg hook (the fail-closed evidence block is gone).
- Given the `build` predicate after the change, when it runs, then it does not dynamically import
  `deriveCompletion`/`createTaskEvidence` or read `evidenceStamps` to gate.

### Done When
- [ ] The named gating symbols/paths are deleted (grep-verified absent from production code).
- [ ] The `build` completion predicate no longer keys on `evidenceStamps.has(id)`.
- [ ] The full suite passes with the gating removed and build_review completeness in place.

---

## Story: Stamps survive as telemetry

**Requirement:** ADR-demote-task-stamping-to-telemetry (telemetry preserved)

As an operator reading progress/attribution, I want stamps to keep working as telemetry even though
they no longer gate, so attribution, progress display, and audit are unaffected.

### Acceptance Criteria

#### Happy Path
- Given a build-step commit, when it is created, then the `Task: <id>` trailer is still auto-stamped
  by prepare-commit-msg / session pre-dispatch (attribution intact).
- Given tasks resolve during a build, when progress is rendered, then the resolved-count that drives
  `build_progress` / display (#757) still advances — sourced from a SURVIVING non-gating mechanism:
  the count of distinct plan task-ids carried by `Task:`-trailered commits (and/or `conduct task
  done`, now permitted since it is no longer gate authority). It MUST NOT depend on the deleted
  `applyDerivedCompletion`/`reconcileStatusFromStamps` derivation, and MUST NOT use
  corroboration/reachability.
- Given a completed build, when the attribution spot-audit runs and retro Part C reads audit-trail
  events, then both function using the surviving telemetry.

#### Negative Paths
- Given the stamp-writing hooks run but a stamp is missing/late, when the build proceeds, then it
  does NOT block, park, or demote on the missing stamp (stamps are advisory telemetry only).
- Given the sidecar `task-evidence.json` still exists as a record, when it is read, then it is used
  only for telemetry/attribution — no code path gates completion on it.

### Done When
- [ ] `Task:` trailer stamping, progress counts (#757), attribution spot-audit, and retro Part C all
      still function (tests for stamp-writing + progress kept/passing).
- [ ] The resolved-count feeding `build_progress` is sourced from `Task:`-trailered commits (and/or
      `conduct task done`), independent of the deleted derivation — a test asserts progress advances
      after trailered commits with the derivation code absent.
- [ ] No production code path gates/parks/demotes on the sidecar or its counters.

---

## Story: Shared plan-parsing utilities are preserved, not deleted with autoheal

**Requirement:** ADR-demote-task-stamping-to-telemetry (utility-preservation constraint)

As a maintainer, I want `parsePlanTaskPaths` and `TASK_ID_PATTERN` to survive the evidence deletion,
so `wiring_check` and other consumers keep working.

### Acceptance Criteria

#### Happy Path
- Given the evidence-derivation code is removed, when `wiring-probe.ts` and `wired-into.ts` import
  `parsePlanTaskPaths` / `TASK_ID_PATTERN`, then those symbols still resolve (preserved in place or
  relocated with imports updated).

#### Negative Paths
- Given the whole `autoheal.ts` file were deleted naively, when the build compiles, then it must NOT
  break `wiring-probe.ts`/`wired-into.ts` — the change either keeps those utilities in a surviving
  module or moves them and updates every import.
- Given a search for other importers of these utilities, when performed, then every caller is
  accounted for (no dangling import after the move).

### Done When
- [ ] `parsePlanTaskPaths` + `TASK_ID_PATTERN` resolve after the change; `wiring_check` tests pass.
- [ ] TypeScript build is clean (no unresolved imports).

---

## Story: Separate same-named gates remain functional and untouched

**Requirement:** ADR-demote-task-stamping-to-telemetry (scope boundary)

As a maintainer, I want the gates that merely share vocabulary with the demoted one to keep working
unchanged, so I don't accidentally rip out a legitimate outcome gate.

### Acceptance Criteria

#### Happy Path
- Given the change is applied, when the suite runs, then `wiring_check` (export reachability),
  `acceptance_specs` RED-evidence, shipped-record dedup, owner-gate provenance, and the push-evidence
  finish guard all still gate/behave exactly as before (their tests pass unmodified).

#### Negative Paths
- Given the deletion diff, when reviewed, then none of these five systems' files are modified in a
  way that changes behavior (only unrelated utility relocation, if any, with identical semantics).
- Given the acceptance-specs RED-evidence and wiring reachability gates, when exercised, then they
  are demonstrably independent of the deleted evidence graph (no regression from the removal).

### Done When
- [ ] The five separate gates' existing tests pass unchanged.
- [ ] The deletion diff touches none of their behavior.

---

## Story: attribution-enforcement commit gate demoted to advisory

**Requirement:** ADR-demote-task-stamping-to-telemetry (enforcement → advisory)

As a committer, I want the opt-in attribution-enforcement commit gate to stop blocking commits while
keeping trailer grammar validation, so stamps never block per #773.

### Acceptance Criteria

#### Happy Path
- Given attribution-enforcement is configured, when a build-step commit lacks a `Task:` trailer, then
  the commit is NOT rejected (advisory) — but trailer grammar, when a trailer IS present, is still
  validated.

#### Negative Paths
- Given a malformed `Task:` trailer, when committing, then grammar validation still flags it (the
  grammar check survives) — only the fail-closed *absence* block is removed.
- Given enforcement previously parked/blocked on unattributed dispatch, when the same situation
  occurs now, then no block/park results from the enforcement gate.

### Done When
- [ ] The fail-closed commit rejection tied to evidence/attribution is removed; grammar validation
      retained.
- [ ] Enforcement no longer blocks or parks; its tests updated to assert advisory behavior.

---

## Story: Migration sequencing leaves no completion hole

**Requirement:** ADR (sequencing condition)

As the operator, I want build_review's completeness dimension to be in force before the old stamp
predicate is removed, so no build can complete unjudged during the change.

### Acceptance Criteria

#### Happy Path
- Given the plan's task order, when tasks are executed, then build_review's completeness rubric is
  wired and enforcing (default-on) BEFORE the task that removes the `evidenceStamps.has(id)` build
  check runs.

#### Negative Paths
- Given a hypothetical intermediate state where the stamp check is removed but completeness is not yet
  enforcing, when the plan is inspected, then no such ordering exists (the dependency is explicit in
  the plan's task dependency graph).

### Done When
- [ ] The plan's task dependency graph orders "add build_review completeness (default-on)" strictly
      before "remove build stamp predicate."
- [ ] At no committed intermediate state can `build` reach done with neither the stamp gate nor the
      completeness rubric enforcing.

---

## Story: Documentation and changelog updated

**Requirement:** Docs-track-features convention + Release gates

As a reader of the harness docs, I want the evidence-gate documentation to describe telemetry-only
stamps + build_review completeness completion, so docs match behavior.

### Acceptance Criteria

#### Happy Path
- Given the change ships, when README.md, src/conductor/README.md, CLAUDE.md, and HARNESS.md are
  read, then passages describing the evidence gate as blocking/parking/deriving-completion are
  updated to telemetry + build_review's completeness rubric (and its default-on activation), and
  `CHANGELOG.md` `[Unreleased]` carries a Changed/Removed entry describing the demotion.

#### Negative Paths
- Given the PR diff, when checked, then no doc still asserts "task completion is derived from the
  evidence gate" as current behavior; historical CHANGELOG release entries are left intact (not
  rewritten); `VERSION` is NOT bumped (locked until the v1 cut).
- Given the harness integrity suite, when run, then it passes (VERSION semver unchanged,
  `[Unreleased]` present, model table regenerated for the build_review activation change, skill
  frontmatter) with the doc updates.

### Done When
- [ ] README / src/conductor/README / CLAUDE.md / HARNESS.md updated for telemetry + build_review
      completeness (default-on).
- [ ] `CHANGELOG.md` `[Unreleased]` has a Changed/Removed entry; history untouched; VERSION unchanged.
- [ ] `test/test_harness_integrity.sh` passes (model table regenerated if activation changed).
