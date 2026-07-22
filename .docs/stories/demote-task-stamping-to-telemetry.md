**Status:** Accepted

# Stories: Demote task-stamping from gate to telemetry (#773)

Technical track. Acceptance criteria are stated as observable engine behavior (Given/When/Then).
Source of truth: `adr-2026-07-21-demote-task-stamping-to-telemetry` (demotion) and
`adr-2026-07-21-build-end-plan-completeness-gate` (replacement gate).

---

## Story: New `build_completeness` gating step runs after build

**Requirement:** ADR-build-end-plan-completeness-gate (new step)

As the conductor build loop, I want a `build_completeness` gating step immediately after `build`
and before `build_review`, so that build completion is judged holistically instead of by per-task
stamps.

### Acceptance Criteria

#### Happy Path
- Given a feature whose `build` step has run, when the pipeline advances, then `build_completeness`
  is the next step, with `enforcement: 'gating'`, `loopGate: true`, `prerequisites: ['build']`, and
  `kickbackTarget: 'build'`, and it is dispatched by the same engine step runner that dispatches
  `build_review`.
- Given `build_completeness` is registered, when the ordered step list is resolved, then it sits
  strictly between `build` and `build_review` in `ALL_STEPS`.

#### Negative Paths
- Given a Small-tier feature that skips other gating steps, when the pipeline resolves steps, then
  `build_completeness` still follows the tier's skip rules consistently (it does not silently
  vanish for a tier where `build` runs) — its `skippable*` config is explicit, not implicit.
- Given the step is misordered (e.g. registered after `build_review`), when integrity/step tests
  run, then the ordering assertion fails loudly rather than passing.

### Done When
- [ ] `build_completeness` `StepDefinition` exists in `steps.ts` with the flags above and a
      `StepName` union member added in `types/index.ts`.
- [ ] Resolving the BUILD phase yields order `... build → build_completeness → build_review ...`.
- [ ] It is dispatched through the existing engine grader-dispatch path (no bespoke runner).

---

## Story: Completeness predicate is fail-closed on its verdict artifact

**Requirement:** ADR-build-end-plan-completeness-gate (predicate)

As the completion checker, I want a deterministic predicate that reads a `.pipeline` verdict
artifact and passes ONLY on a fresh explicit PASS, so that judgement is fail-closed like
`build_review`/`prd_audit`.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/build-completeness.json` written this session with `verdict: "PASS"`, when the
  `build_completeness` predicate runs, then it returns `{ done: true }`.

#### Negative Paths
- Given no verdict artifact exists, when the predicate runs, then it returns `done: false` (not-done),
  never `done: true`.
- Given a verdict artifact written in a PRIOR session (stale per the session freshness floor), when
  the predicate runs, then it returns `done: false`.
- Given a malformed/unparseable verdict artifact, when the predicate runs, then it returns
  `done: false` (tolerant parse → not-done, never a crash and never a pass).
- Given a verdict artifact with `verdict: "FAIL"`, when the predicate runs, then it returns
  `done: false` with a `routeClass` set so gaps can be routed.

### Done When
- [ ] Predicate registered in `CUSTOM_COMPLETION_PREDICATES` and invoked by `checkStepCompletion`.
- [ ] Only a fresh exact `PASS` yields `done:true`; missing/stale/malformed/`FAIL` all yield
      `done:false` — covered by unit tests.
- [ ] Freshness is enforced against `sessionStartedAt`/`attemptStartedAt` like the other verdict gates.

---

## Story: Grader judges plan-vs-diff holistically and emits named gaps

**Requirement:** ADR-build-end-plan-completeness-gate (grader)

As the completeness grader, I want to compare the plan's task set against the actual build diff and
judge whether all planned work is present, so that unimplemented planned work is caught — without
per-task SHA/reachability/corroboration reasoning.

### Acceptance Criteria

#### Happy Path
- Given a plan whose every task's intended work is present in the build diff, when the grader runs,
  then it writes `verdict: "PASS"` to `.pipeline/build-completeness.json`.
- Given a plan with a task whose work is absent from the diff, when the grader runs, then it writes
  `verdict: "FAIL"` with a `RemediationGap` (`disposition: "build"`, non-empty `tasks[]` naming the
  missing work, and a `rationale`).

#### Negative Paths
- Given a build diff that touches files unrelated to a planned task while the task's own work is
  missing, when the grader runs, then it still reports that task as a gap (presence of *some* diff
  does not mask a missing task) — i.e. it does NOT infer completion from mere file activity.
- Given the grader prompt, when it reasons about completion, then it does NOT cite/pin a specific
  SHA, check commit reachability, or path-corroborate a stamp (the wedge-class reasoning is
  explicitly excluded) — verified by the prompt contract and a test asserting a gap is reported on
  missing work even when a `Task:`-trailered commit exists for that id.
- Given a task marked verify-only / no-code-change in the plan, when the grader runs, then absence of
  a diff for it is NOT reported as a gap (holistic judgement respects intent without a per-task
  evidence stamp).

### Done When
- [ ] A grader inputs/prompt module (or skill) exists, dispatched like the `build_review` grader,
      writing `.pipeline/build-completeness.json`.
- [ ] FAIL verdicts carry `RemediationGap` objects shaped exactly for `readRemediationPlan`
      (`disposition: 'build'`, `tasks: {id,title}[]`, `rationale`).
- [ ] The prompt forbids per-task SHA/reachability/corroboration reasoning; a test proves a
      trailered-but-unimplemented task is still flagged as a gap.

---

## Story: FAIL gaps route through existing remediation and re-dispatch build

**Requirement:** ADR-build-end-plan-completeness-gate (routing)

As the conductor, I want completeness gaps to flow through the existing remediation machinery, so no
new routing code is introduced.

### Acceptance Criteria

#### Happy Path
- Given a FAIL verdict with named gaps, when the conductor handles the gate miss, then it invokes the
  existing `planRemediation`/`appendRemediationTasks` path, appends `rem-*` tasks to the plan,
  re-seeds task-status, and navigates back to `build`.

#### Negative Paths
- Given a FAIL verdict whose gaps carry a non-`build` disposition (e.g. `plan`) in daemon mode, when
  routing runs, then a DECIDE-phase target HALTs for the operator (does not silently self-route),
  matching existing remediation behavior.
- Given a FAIL verdict with an empty `tasks[]`, when routing runs, then it does not append zero tasks
  and silently pass — it is treated as a malformed gap (not-done / surfaced), never a spurious PASS.

### Done When
- [ ] Completeness FAIL reuses `planRemediation` → `appendRemediationTasks` (no bespoke routing).
- [ ] Appended tasks use the deterministic `rem-<source>-<gapId>` id scheme and re-seed the plan.
- [ ] After remediation, the loop re-dispatches `build`, then re-runs `build_completeness`.

---

## Story: The completeness gate cannot wedge

**Requirement:** ADR-build-end-plan-completeness-gate (wedge-proof bounding)

As the operator, I want the new gate bounded so a false-negative loop HALTs for a human instead of
spinning forever, so it never becomes a new wedge source.

### Acceptance Criteria

#### Happy Path
- Given the gate has been re-opened by kickback fewer than `MAX_KICKBACKS_PER_GATE` (2) times, when
  it FAILs again, then remediation runs and the loop re-attempts build.

#### Negative Paths
- Given the gate has already been re-opened `MAX_KICKBACKS_PER_GATE` (2) times, when it FAILs a third
  time, then the loop writes the loop-halt marker and emits `loop_halt` (operator-surfaced) — it does
  NOT loop again.
- Given repeated FAILs, when the kickback counter is inspected, then it is per-gate and increments
  monotonically (no reset that would allow unbounded spinning).

### Done When
- [ ] `build_completeness` participates in the existing `kickbackCounts` / `MAX_KICKBACKS_PER_GATE`
      accounting exactly like `manual_test`.
- [ ] A test drives ≥3 consecutive FAILs and asserts a HALT (loop-halt marker) on the 3rd, not a 4th
      attempt.

---

## Story: Fail-closed on LLM unavailability

**Requirement:** ADR-build-end-plan-completeness-gate (unavailability)

As the operator, I want the gate to block rather than pass when the grader cannot reach a model, so
unavailability never green-lights an unverified build.

### Acceptance Criteria

#### Happy Path
- Given the grader dispatches via the availability ladder and succeeds on a fallback model, when it
  completes, then it writes a normal PASS/FAIL verdict.

#### Negative Paths
- Given the model fallback ladder is exhausted (all unavailable), when the grader dispatch fails,
  then NO `PASS` verdict is written, the predicate stays `done:false`, and the existing
  `RateLimitEpisode`/HALT-park path handles it (daemon parks / interactive HALTs) — never advances.
- Given a rate-limit / session-expired / auth-failure during dispatch, when the conductor handles it,
  then it uses the existing distinct rate-limit/session/auth handling (not the deleted no-evidence
  counter) and never advances the gate.

### Done When
- [ ] Grader dispatch uses `invokeWithLadder`; exhaustion writes no passing verdict.
- [ ] Unavailability routes to the existing `RateLimitEpisode`/park/HALT path, independent of any
      evidence counter (which no longer exists).
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
  completion is decided by `build_completeness` + the outcome gates, not by stamps.

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
- [ ] The full suite passes with the gating removed and the new gate in place.

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

As the operator, I want the new completeness gate to be in force before the old stamp predicate is
removed, so no build can complete unjudged during the change.

### Acceptance Criteria

#### Happy Path
- Given the plan's task order, when tasks are executed, then the `build_completeness` gate is wired
  and enforcing BEFORE the task that removes the `evidenceStamps.has(id)` build check runs.

#### Negative Paths
- Given a hypothetical intermediate state where the stamp check is removed but the new gate is not yet
  enforcing, when the plan is inspected, then no such ordering exists (the dependency is explicit in
  the plan's task dependency graph).

### Done When
- [ ] The plan's task dependency graph orders "add build_completeness gate" strictly before "remove
      build stamp predicate."
- [ ] At no committed intermediate state can `build` reach done with neither the stamp gate nor the
      completeness gate enforcing.

---

## Story: Documentation and changelog updated

**Requirement:** Docs-track-features convention + Release gates

As a reader of the harness docs, I want the evidence-gate documentation to describe telemetry-only
stamps + outcome-gate completion, so docs match behavior.

### Acceptance Criteria

#### Happy Path
- Given the change ships, when README.md, src/conductor/README.md, CLAUDE.md, and HARNESS.md are
  read, then passages describing the evidence gate as blocking/parking/deriving-completion are
  updated to telemetry + the new `build_completeness` gate, and `CHANGELOG.md` `[Unreleased]` carries
  a Changed/Removed entry describing the demotion.

#### Negative Paths
- Given the PR diff, when checked, then no doc still asserts "task completion is derived from the
  evidence gate" as current behavior; historical CHANGELOG release entries are left intact (not
  rewritten).
- Given the harness integrity suite, when run, then it passes (VERSION semver, `[Unreleased]` present,
  model table, skill frontmatter) with the doc updates.

### Done When
- [ ] README / src/conductor/README / CLAUDE.md / HARNESS.md updated for telemetry + completeness gate.
- [ ] `CHANGELOG.md` `[Unreleased]` has a Changed/Removed entry; history untouched.
- [ ] `test/test_harness_integrity.sh` passes.
