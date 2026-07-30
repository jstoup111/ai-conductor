**Status:** Accepted

# Stories: Single reusable full-suite verification gate (#940)

These stories supersede the finish-owned full-suite behavior in Story 4 and the
“deferred to finish” wording in Story 3 of
`.docs/stories/reduce-redundant-full-test-suite-runs-in-build-shi.md`. They also
supersede the unconditional batch-boundary full-suite criterion in
`.docs/stories/pipeline-scope-per-task-verify-to-affected-tests-f.md`. Scoped
verification remains; ownership of the one reusable aggregate run moves to the
explicit pre-SHIP gate.

> **Amended 2026-07-29:**
> `.docs/stories/deterministic-test-suite-step.md` moves `wiring_check` and
> `test_suite` into a joined deterministic group immediately after `build`,
> defers `build_review` until both pass, and replaces the direct skill surface
> with the deterministic `conduct-ts test-suite` adapter. All proof and
> BUILD-to-SHIP safety outcomes below remain authoritative.

## Story 1: Automated delivery gates SHIP on the aggregate suite

**Requirements:** FR-1, FR-7

As an autonomous-build operator, I want the project's aggregate suite verified
before model review and SHIP begin so regressions return to implementation
without paying for downstream validation first.

### Acceptance Criteria

#### Happy Path

- Given BUILD completes, when automated delivery advances, then it evaluates
  wiring and aggregate verification as a joined deterministic group before
  dispatching build review, manual test, PRD audit, or as-built architecture
  review.
- Given wiring and aggregate verification pass, when build review also passes,
  then the feature may advance to the applicable SHIP validators.

#### Negative Paths

- Given `build` is still unsatisfied, when the selector evaluates progression,
  then neither deterministic verifier runs and no later validator dispatches.
- Given the aggregate suite fails, when the gate finishes, then no SHIP
  validator or build-review model dispatches and automated delivery returns to
  BUILD with the actionable failure output.

### Done When

- [ ] Engine flow evidence shows `build → {wiring_check, test_suite} →
      build_review → manual_test` for an applicable Medium feature.
- [ ] An automated failing-suite scenario asserts BUILD is reopened and every
      SHIP validator remains undispatched.

## Story 2: Interactive verification enforces the same pre-SHIP boundary

**Requirements:** FR-2, FR-8

As an interactive operator, I want the deterministic full-suite adapter at the
same BUILD-to-SHIP boundary so guided delivery cannot bypass the automated
flow's safety guarantee or require model judgment to run tests.

### Acceptance Criteria

#### Happy Path

- Given interactive BUILD work is complete, when the operator follows conduct
  guidance, then wiring and `conduct-ts test-suite` verification precede build
  review, manual test, or any other SHIP activity.
- Given `conduct-ts test-suite` observes a current passing aggregate result, when it
  completes, then direct Claude reports whether it executed or reused the proof
  and permits progression to SHIP.

#### Negative Paths

- Given `conduct-ts test-suite` has not produced a current pass, when the operator asks to
  proceed to SHIP, then guidance blocks progression rather than treating the
  step as optional.
- Given `conduct-ts test-suite` observes a failure, when it reports the result, then it
  names the failing evidence and directs work back to `/tdd` or `/pipeline`
  without invoking a skill, model, or legacy Bash flow.

### Done When

- [ ] Interactive conduct guidance visibly orders the deterministic verifier
      after BUILD and before build review and `/manual-test`.
- [ ] Direct failure guidance blocks SHIP and names `/tdd` or `/pipeline` as the
      remediation route.

## Story 3: Projects declare one authoritative aggregate test operation

**Requirements:** FR-9, FR-10

As a project maintainer, I want to declare the operation that already composes
my unit, acceptance, and other tests so the conductor executes the project's
test policy instead of inventing a second suite configuration.

### Acceptance Criteria

#### Happy Path

- Given a project declares a non-empty aggregate command and working directory,
  when full-suite verification runs, then it executes that exact project-owned
  operation under the declared timeout.
- Given this repository declares `npm test` from `src/conductor`, when the
  operation runs, then the checked-in Vitest inclusion rules cover ordinary
  tests and `test/acceptance/**` tests through the same command.

#### Negative Paths

- Given the declaration is absent, malformed, or empty, when verification is
  requested, then it fails closed with an actionable configuration error and
  does not advance SHIP.
- Given the command cannot be resolved or launched, the working directory is
  invalid, the timeout expires, or the process exits non-zero, when
  verification completes, then it records the specific blocking reason and
  does not create passing evidence.

### Done When

- [ ] Project configuration accepts and documents the aggregate command,
      working directory, timeout, additional inputs, and relevant environment
      names.
- [ ] Tests cover every fail-closed preflight/execution outcome: missing,
      malformed, unresolved, unlaunchable, invalid directory, timeout, and
      non-zero exit.
- [ ] This repository's configuration points to its existing Vitest aggregate;
      harness integrity remains outside the declaration per issue scope.

## Story 4: Current passing evidence is reused exactly while inputs match

**Requirements:** FR-3, FR-4, FR-6

As a feature operator, I want a successful aggregate run recognized everywhere
in the flow so an unchanged verification state executes locally no more than
once after its final relevant mutation.

### Acceptance Criteria

#### Happy Path

- Given a successful aggregate run recorded the current verification inputs,
  when the explicit gate or finish checks the same inputs, then it reports
  `REUSED` and does not launch the project command again.
- Given an earlier BUILD fallback ran the aggregate operation successfully,
  when the later explicit gate sees identical verification inputs, then it
  accepts that proof rather than executing a second run.
- Given a rebase changes commit identity but leaves every verification input
  byte-identical, when the gate is reevaluated, then the prior result remains
  current.

#### Negative Paths

- Given passing evidence exists for a different verification identity, when the
  gate checks it, then it reports `STALE` rather than reusing it.
- Given an earlier fallback called the project command directly without
  recording shared evidence, when the gate evaluates, then the unproven run
  does not satisfy the gate and the aggregate operation executes through the
  supported verifier.
- Given the stored provenance commit no longer matches after a byte-identical
  rebase, when content identity still matches, then SHA mismatch alone does not
  incorrectly force a rerun.

### Done When

- [ ] A run counter proves one local aggregate execution across earlier
      fallback, explicit gate, finish, and PR preparation on unchanged inputs.
- [ ] Tests distinguish content identity from provenance SHA and cover
      byte-identical rebase reuse.

## Story 5: Every relevant mutation invalidates; documentation does not

**Requirements:** FR-11, FR-12, FR-16

As a maintainer, I want freshness tied to the inputs that can change test
results so stale proofs rerun while harmless documentation edits preserve them.

### Acceptance Criteria

#### Happy Path

- Given passing evidence, when source, tests, project configuration,
  dependencies, migrations, test infrastructure, an explicitly declared
  additional input, or a declared environment value changes, then the workflow
  reports which category became stale and executes a new aggregate run before
  SHIP.
- Given passing evidence, when only documentation changes, then verification
  reports `REUSED` and does not launch the aggregate command.
- Given relevant tracked, untracked, or dirty content differs, when freshness
  is calculated, then each form participates in the verification identity.

#### Negative Paths

- Given a relevant input cannot be enumerated or read, when freshness is
  calculated, then the result is indeterminate and fails closed instead of
  reusing the prior pass.
- Given a change contains documentation plus any relevant non-documentation
  input, when freshness is calculated, then the mixed change is stale rather
  than being classified as documentation-only.
- Given only commit metadata or SHA changes while relevant content does not,
  when freshness is calculated, then it does not falsely report a relevant
  mutation.

### Done When

- [ ] Parameterized tests cover every required invalidation category, dirty and
      untracked content, mixed docs/code changes, indeterminate reads, and
      documentation-only preservation.
- [ ] Status output distinguishes `EXECUTED`, `REUSED`, `STALE`, and `FAILED`
      and includes a concrete reason without exposing declared environment
      values.

## Story 6: Intermediate verification remains scoped

**Requirement:** FR-5

As a build operator, I want ordinary feedback loops to use impacted tests so the
new final gate is the only owner of unchanged aggregate verification.

### Acceptance Criteria

#### Happy Path

- Given an ordinary TDD cycle, batch boundary, parallel-work join, final
  evaluator, or conduct progression check, when it verifies work, then it uses
  the affected/union-of-affected test scope and does not independently require
  the aggregate suite.
- Given scoped selection is genuinely unsafe and a BUILD fallback broadens to
  the aggregate operation, when it runs, then the resulting pass is recorded
  as reusable full-suite evidence.

#### Negative Paths

- Given a scoped test fails, when the responsible BUILD activity evaluates it,
  then it blocks or remediates that activity rather than deferring a known
  failure to the aggregate gate.
- Given a fallback broadens to the aggregate operation, when later workflow
  steps run on unchanged inputs, then none calls the project command directly
  and creates a duplicate unrecorded execution.

### Done When

- [ ] Guidance for TDD, pipeline batches, parallel joins, build review, and
      conduct progression consistently says scoped/impacted tests.
- [ ] Any permitted full fallback invokes the shared verifier and records why
      broadening occurred.

## Story 7: Finish is a reuse-aware safety fallback

**Requirement:** FR-13

As a completion operator, I want finish to trust current gate evidence and
repair missing verification itself so normal and standalone use are both safe
without duplicate work.

### Acceptance Criteria

#### Happy Path

- Given the explicit gate recorded a current pass, when finish verifies
  completion, then it reports reuse and does not launch the aggregate command.
- Given finish is invoked standalone with missing or stale evidence, when all
  other preconditions permit verification, then it runs the aggregate operation
  through the shared verifier and accepts a new pass.

#### Negative Paths

- Given finish's fallback run fails or cannot start, when finish evaluates the
  result, then completion remains blocked, no finish choice is recorded, and
  actionable failure evidence is retained.
- Given current passing evidence exists, when finish runs, then “fresh
  verification” wording does not force a redundant execution merely because a
  new session began.

### Done When

- [ ] Finish tests cover current-proof reuse, standalone missing/stale fallback,
      and blocking fallback failure.
- [ ] The normal gate-to-finish path proves zero additional aggregate process
      launches.

## Story 8: PR and CI keep separate responsibilities

**Requirements:** FR-14, FR-15

As a release operator, I want PR preparation to reuse local completion evidence
while CI independently verifies the pushed revision so local speed never
weakens the remote merge gate.

### Acceptance Criteria

#### Happy Path

- Given completion verification passed, when `/pr` prepares, pushes, or updates
  the pull request, then it performs no independent local aggregate-suite run.
- Given an applicable pull-request revision reaches CI, when CI evaluates it,
  then the repository's authoritative CI tests execute independently without
  trusting `.pipeline/test-suite-evidence.json`.

#### Negative Paths

- Given `/pr` has no current local evidence because it was invoked outside the
  supported completion flow, when PR preparation runs, then it does not silently
  invent a local pass or rerun the suite; completion verification remains the
  owner of that safety check.
- Given local evidence says `PASS` but CI fails on the pushed revision, when the
  merge gate evaluates, then CI remains blocking and local evidence cannot
  override it.

### Done When

- [ ] `/pr` guidance and tests contain no local aggregate-suite execution.
- [ ] CI workflow behavior remains independent and its applicable test jobs are
      not skipped because local evidence exists.

## Story 9: Mutation-specific repair checks remain unchanged

**Requirement:** FR-17

As an autonomous-delivery operator, I want conflict autoresolution and CI repair
to retain their immediate post-mutation checks so reuse optimization does not
weaken mutation-specific safety.

### Acceptance Criteria

#### Happy Path

- Given automated conflict resolution mutates the tree, when its established
  post-mutation verification runs, then that check still executes according to
  its existing contract.
- Given CI repair mutates the tree, when its established post-mutation
  verification runs, then that check still executes according to its existing
  contract.

#### Negative Paths

- Given current reusable gate evidence predates an autoresolve mutation, when
  autoresolve verifies its result, then the evidence does not suppress the
  established post-mutation check.
- Given current reusable gate evidence predates a CI-repair mutation, when the
  repair path verifies its result, then the evidence does not suppress the
  established post-mutation check.

### Done When

- [ ] Regression tests prove autoresolve and CI-repair post-mutation suite
      behavior is byte-for-byte unchanged in outcome and remains executable.
- [ ] Scope review confirms no implementation change routes those repair checks
      through reusable gate evidence.
