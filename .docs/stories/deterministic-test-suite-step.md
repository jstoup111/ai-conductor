**Status:** Accepted

# Stories: Deterministic test-suite BUILD gate

**Coherence:** `.docs/coherence/2026-07-29-deterministic-test-suite-step.md`

These technical stories amend the ordering and direct-skill portions of the
accepted full-suite verification stories. Existing configuration,
content-addressed proof, execution, redaction, cleanup, and failure contracts
remain authoritative.

## Story 1: Reject mechanically invalid builds before paid review

As an operator, I want wiring and aggregate verification to run immediately
after BUILD so a deterministic failure does not spend build-review tokens.

### Acceptance Criteria

#### Happy Path

- Given `build` completed and both deterministic gates are eligible, when the
  BUILD tail advances with concurrency available, then `wiring_check` and
  `test_suite` may execute concurrently and `build_review` starts only after
  both report passing outcomes.
- Given both deterministic gates pass and `build_review` passes, when the flow
  advances, then the applicable SHIP validators may begin.
- Given `validation_concurrency` is one, when the deterministic group runs,
  then it executes `wiring_check` before `test_suite` and still waits for both
  passing outcomes before starting `build_review`.
  **Refined by `adr-2026-08-03-build-repair-member-reuse-validity.md` (#1249):**
  this pins declared member ORDER and the wait-for-every-dispatched-member rule,
  not a guarantee that both members always execute. A round dispatches every
  member the existing skip rules leave eligible, so a round in which one member
  is skipped legitimately runs a single member — and `build_review` still starts
  only after the join declares every prerequisite satisfied. The ordering and
  wait-for-all intent is unchanged; only the "executes both" reading is narrowed
  (established precedent: this repository's amendment of the #420 pinned
  enumeration).

#### Negative Paths

- Given either deterministic gate fails, when the group joins, then
  `build_review` and every SHIP validator remain undispatched and the flow
  returns to BUILD with the failed gate's evidence.
- Given one deterministic gate passes while the other remains pending, when
  progression is evaluated, then the partial result does not satisfy the group
  and neither model review nor SHIP begins.
- Given the configured concurrency cap is exhausted, when the group becomes
  eligible, then work is queued within the shared cap instead of creating an
  uncapped parallel executor or bypassing a gate.

### Done When

- [ ] An orchestration test proves `build → {wiring_check, test_suite} →
      build_review → SHIP` with the deterministic members joined before review.
- [ ] A failing-member test proves zero `build_review` model invocations and
      zero SHIP validator invocations.
- [ ] A cap-one test proves stable `wiring_check`, then `test_suite`, ordering
      across the members that round dispatches (see the #1249 refinement above).

## Story 2: Join deterministic outcomes without corrupting gate state

As an operator, I want concurrent verifier results consolidated once so failure
budgets, evidence, retries, and interruption recovery remain deterministic.

### Acceptance Criteria

#### Happy Path

- Given both branches settle successfully, when the join commits the group
  outcome, then each gate's evidence remains attributable and conductor state
  records one completed deterministic group round.
- Given both branches fail in the same round, when the join commits the result,
  then it emits one BUILD rewind containing both evidence sources and charges
  each failed gate's kickback budget exactly once.
- Given one branch finishes before the other, when the second branch settles,
  then the joined result includes both outcomes regardless of completion order.

#### Negative Paths

- Given both branches fail, when failure routing runs, then it does not issue
  two BUILD rewinds, lose either diagnostic, or charge either gate more than
  once.
- Given execution is interrupted after one branch settles, when the feature is
  resumed, then the settled evidence is preserved, the incomplete branch is
  retryable, and absence is never converted into a passing result.
- Given previously passing suite evidence is stale when the group evaluates it,
  when `test_suite` settles, then the stale proof does not satisfy the join and
  the existing verifier executes or fails closed according to its current
  contract.
- Given a branch throws or returns an indeterminate result, when the group
  joins, then the outcome is blocking and state is not partially marked green.

### Done When

- [ ] Unit tests cover pass/pass, pass/fail, fail/pass, fail/fail, and reversed
      completion order through the single-writer join.
- [ ] Tests prove one rewind with two diagnostics and one budget charge per
      failed gate for the dual-failure case.
- [ ] Interruption and indeterminate-result tests prove no false completion and
      a bounded resume path with every started promise settled or cleaned up.

## Story 3: Expose aggregate verification as machinery, not a skill

As a harness consumer, I want aggregate verification represented by an
engine-native step and deterministic command so no host spends model tokens to
run or classify the suite.

### Acceptance Criteria

#### Happy Path

- Given an automated conductor run reaches `test_suite`, when verification is
  required, then the engine invokes `FullSuiteVerifier` without rendering or
  dispatching a skill for either supported provider.
- Given an interactive operator requests standalone aggregate verification,
  when `conduct-ts test-suite` runs, then it invokes the same verifier and
  reports its deterministic executed, reused, stale, and failed outcomes.
- Given an existing consumer updates the harness, when the release migration
  runs, then it removes only the obsolete Claude and Codex `test-suite` catalog
  links and leaves unrelated installed skills unchanged.

#### Negative Paths

- Given provider or model bookkeeping is evaluated for `test_suite`, when the
  engine selects its execution path, then that metadata cannot produce an LLM
  dispatch or make the native gate provider-specific.
- Given the shipped catalog and generated model table are validated, when the
  obsolete skill is removed, then no catalog, lifecycle guidance, or direct
  host-skill reference still advertises it.
- Given a consumer does not have one of the obsolete links, when migration
  runs, then it completes idempotently without deleting another skill or
  failing the update.
- Given the standalone verifier fails, when the CLI reports the result, then it
  exits non-zero with bounded diagnostics and does not fall back to a skill or
  raw provider prompt.

### Done When

- [ ] The shipped `skills/test-suite` surface and all of its registrations are
      absent while the `test_suite` engine step remains registered.
- [ ] Provider-contract tests prove zero model dispatches and CLI tests prove
      the standalone deterministic adapter remains available.
- [ ] Migration tests cover both host catalogs, missing-link idempotency, and
      preservation of unrelated skills.

## Story 4: Preserve the full-suite proof while changing orchestration

As an operator, I want the orchestration change to preserve the verifier's
existing proof and process guarantees so faster rejection does not weaken the
BUILD-to-SHIP gate.

### Acceptance Criteria

#### Happy Path

- Given current passing content-addressed evidence, when the concurrent
  `test_suite` branch runs, then it reuses the proof without launching the
  aggregate command and contributes a passing outcome to the join.
- Given proof is missing or stale, when the branch runs, then the configured
  aggregate command executes with its existing lock, timeout, redaction,
  process-tree cleanup, and atomic evidence behavior.
- Given the suite writes ignored ephemeral output such as coverage data, when
  the wiring branch runs concurrently, then both gates still evaluate the same
  completed build inputs and their separate evidence remains attributable.
- Given `finish` inspects an unchanged passing proof, when delivery completes,
  then it reuses the same evidence and CI remains independently authoritative.

#### Negative Paths

- Given configuration is invalid, freshness is indeterminate, launch fails,
  the suite times out, or the command exits non-zero, when the branch settles,
  then its existing fail-closed classification and bounded diagnostics reach
  the deterministic join unchanged.
- Given the aggregate command mutates fingerprinted project inputs or files
  consumed by the wiring probe, when the project config is evaluated against
  the concurrency contract, then the setup is not considered safe for parallel
  verification and must be corrected rather than treating divergent inputs as
  a valid pass.
- Given two verifier callers contend for the suite lock, when the group branch
  executes, then the existing lock semantics prevent duplicate aggregate runs
  and neither caller manufactures passing evidence.
- Given execution is cancelled or times out, when cleanup completes, then the
  exact process tree is terminated and no worker continues mutating evidence
  after the joined outcome.

### Done When

- [ ] Existing verifier contract tests remain green without weakening
      fingerprint, evidence, redaction, lock, timeout, or cleanup assertions.
- [ ] Concurrency tests allow ignored coverage output while proving wiring and
      suite evidence remain separate and attributable.
- [ ] Lock-contention and cancellation tests prove no duplicate execution,
      false pass, leaked worker, or post-join evidence write.
