**Status:** Accepted

# Stories: Unhalt after main advance resumes against stale feature base

Technical track (no PRD). Requirements are the desired outcomes stated in
`jstoup111/ai-conductor#1245`, referenced below as `Outcome-1` … `Outcome-5`:

- **Outcome-1** — resuming a halted feature after its base advances evaluates the advanced base
  before dispatching BUILD or any downstream judged gate.
- **Outcome-2** — a patch already equivalent to current main is not reported as feature-owned
  out-of-plan scope.
- **Outcome-3** — recovery never asks a build agent to reverse or re-plan a valid main-owned change.
- **Outcome-4** — when rebase-first recovery changes protected artifacts only because main advanced,
  seal handling follows the audited protected-artifact rebaseline behavior without an unnecessary
  manual reseal.
- **Outcome-5** — when the base has not advanced, halt recovery does not force an unnecessary rebase
  or invalidate still-current evidence.

Design authority: `adr-2026-08-11-resume-time-base-advance-evaluation` and
`adr-2026-08-11-play-forward-entry-trigger` (both APPROVED), plus the six Conditions in
`architecture-review-2026-08-11-unhalt-after-main-advance-resumes-against-stale-fe.md`.

**Out of scope by operator decision:** the park/HALT race observability outcome (the issue's sixth
bullet) is split to its own intake issue. No story here addresses it.

**Accepted limitation (not a gap to close here):** a HALT cleared by hand while the daemon is
stopped leaves neither halt-resume signal, so that resume is not evaluated and behaves exactly as it
does today. This is recorded in `adr-2026-08-11-play-forward-entry-trigger` and is deliberately not
specified away by any story below.

---

## Story 1: The base-advance evaluator returns a three-valued verdict

**Requirement:** Outcome-1, Outcome-5 · **Condition:** 2

As the daemon preparing to resume a previously-halted feature, I want a single evaluator that
reports whether the feature's base is current, has advanced, or could not be verified, so that the
decision to rebase is never taken against a base the engine could not resolve.

### Acceptance Criteria

#### Happy Path
- Given a feature worktree whose base ref resolves to a remote ref and where
  `rev-list --count HEAD..<baseRef>` is `0`, when the evaluator runs, then it returns the verdict
  `current` and performs no rebase, no seal rotation, and no gate invalidation.
- Given a feature worktree whose base ref resolves to a remote ref and where
  `rev-list --count HEAD..<baseRef>` is greater than `0`, when the evaluator runs, then it returns
  the verdict `advanced` and reports the resolved base ref and its sha.
- Given the base tracking ref already matches the true remote head, when the evaluator runs, then no
  fetch is performed and the verdict is still computed.

#### Negative Paths
- Given a repository with no `origin` remote, when the evaluator runs, then base resolution degrades
  to its local fail-soft shape, the verdict is `undeterminable`, and **no rebase is attempted**.
- Given `ls-remote` exits non-zero (network failure or unreachable remote), when the evaluator runs,
  then the verdict is `undeterminable` and no rebase is attempted.
- Given origin default-branch discovery fails so no base branch can be named, when the evaluator
  runs, then the verdict is `undeterminable` and no rebase is attempted.
- Given `rev-list` exits non-zero against an otherwise-resolved remote base ref, when the evaluator
  runs, then the verdict is `undeterminable` rather than `advanced` — an unreadable count is never
  treated as proof the base moved.
- Given the evaluator throws for any unanticipated reason, when a halt-resume dispatch runs, then
  the error is logged, the dispatch proceeds exactly as it does today, and the daemon does not crash.

### Done When
- [ ] The evaluator is an exported function returning a discriminated three-valued verdict —
      `current`, `advanced`, `undeterminable` — with no boolean anywhere in its public shape.
- [ ] The verdict carries the base ref and base sha that were compared, so a reader can tell which
      base produced the answer.
- [ ] Unit tests cover each of the three verdicts, including a separate test per `undeterminable`
      trigger (no origin, `ls-remote` failure, unresolvable default branch, `rev-list` failure).
- [ ] A test asserts that a `current` verdict produces zero git write operations.
- [ ] The evaluator adds no new git plumbing: it composes the existing fresh-base resolver and the
      existing branch-currency predicate.

---

## Story 2: A halt-resume with an advanced base plays forward before any judged gate

**Requirement:** Outcome-1, Outcome-3

As a daemon operator who has cleared a feature's HALT after main moved on, I want the feature's base
integrated before the conductor dispatches anything, so that no judged gate ever grades the feature
against a base that no longer exists.

### Acceptance Criteria

#### Happy Path
- Given a halt-resume dispatch for a feature whose base has advanced, when the dispatch runs, then
  the rebase-first play-forward executes and completes **before** the conductor's resume entry is
  reached, and the step the conductor then dispatches is selected from the post-rebase gate verdicts.
- Given the same dispatch, when the play-forward completes, then downstream gate invalidation and
  kickbacks are applied by the existing verdict-application path — this feature adds no second
  invalidation mechanism.
- Given a halt-resume dispatch for a feature whose base has advanced and whose HALT was cleared by
  the re-kick sweep (so a sentinel is also present), when the dispatch runs, then exactly one
  play-forward runs, not two.

#### Negative Paths
- Given a halt-resume dispatch whose play-forward halts (rebase conflict or seal rejection), when
  the dispatch runs, then the conductor's step loop is **not** entered and the HALT stands.
- Given a halt-resume dispatch for a feature whose recorded PR is already merged, when the dispatch
  runs, then the existing merged-shipment path decides the outcome and no rebase is forced by the
  base-advance trigger.
- Given a fresh dispatch that is not a halt-resume (no prior HALT observed for the slug and no
  durable cleared-halt marker), when the dispatch runs, then no base evaluation occurs and behavior
  is byte-identical to today.

### Done When
- [ ] A test asserts ordering: for an advanced base, the play-forward runs strictly before the
      conductor's resume entry.
- [ ] A test asserts a halted play-forward prevents the conductor step loop from running at all.
- [ ] A test asserts a non-halt-resume dispatch performs no base evaluation (no `ls-remote`, no
      `rev-list` against a base ref).

---

## Story 3: A current or unverifiable base resumes with its evidence intact

**Requirement:** Outcome-5

As a daemon operator clearing a HALT on a feature whose base has not moved, I want the resume to
proceed exactly as it does today, so that a recovery never spends a rebase or discards still-valid
gate evidence for no reason.

### Acceptance Criteria

#### Happy Path
- Given a halt-resume dispatch whose base evaluation returns `current`, when the dispatch runs, then
  no rebase is performed, the protected-artifact seal is not rotated, no gate verdict is
  invalidated, and every pre-existing gate verdict file is unchanged byte-for-byte.
- Given a halt-resume dispatch whose base evaluation returns `current`, when the dispatch runs, then
  the conductor resumes at exactly the step it would have resumed at before this change.
- Given a halt-resume dispatch whose base evaluation returns `undeterminable`, when the dispatch
  runs, then no rebase is performed and the conductor resumes exactly as it does today.

#### Negative Paths
- Given a halt-resume dispatch whose base evaluation returns `undeterminable` **and** whose worktree
  carries an unconsumed re-kick sentinel, when the dispatch runs, then the sentinel path still runs
  its play-forward — an unverifiable base suppresses only the new trigger, never the pre-existing
  sentinel behavior.
- Given a halt-resume dispatch whose base evaluation returns `current` on a worktree holding a
  paused rebase from an earlier attempt, when the dispatch runs, then the pre-existing paused-rebase
  handling is unchanged and the base-advance trigger contributes nothing.
- Given a halt-resume dispatch whose base evaluation returns `current`, when the dispatch runs, then
  no `rebase` step completion is stamped into pipeline state — a no-op evaluation records no rebase.

### Done When
- [ ] A test captures every `.pipeline/gates/*.json` verdict before and after a `current`-verdict
      resume and asserts they are identical.
- [ ] A test asserts an `undeterminable` verdict performs no rebase while a co-present sentinel
      still does.
- [ ] A test asserts no rebase-completion state is stamped on a `current` verdict.

---

## Story 4: The play-forward accepts an explicit trigger without changing sentinel semantics

**Requirement:** Outcome-1 · **Condition:** 3

As the engine, I want one play-forward implementation entered by either a re-kick sentinel or an
explicit base-advance trigger, so that recovery logic never forks and the sentinel keeps its exact
present meaning.

### Acceptance Criteria

#### Happy Path
- Given a sentinel is present and no trigger is passed, when the play-forward is invoked, then it
  runs and the sentinel is consumed exactly once — unchanged from today.
- Given no sentinel is present and the base-advance trigger is passed, when the play-forward is
  invoked, then it runs and no sentinel file is created at any point.
- Given both a sentinel and the trigger are present, when the play-forward is invoked, then it runs
  once and the sentinel is consumed exactly once.
- Given neither a sentinel nor the trigger is present, when the play-forward is invoked, then it
  returns its existing skip result and performs no git operation.
- Given any of the three entering combinations, when the play-forward runs, then the sequence after
  the guard is identical: merged-PR guard, rebase, seal-rejection handling, bounded conflict
  resolution, build pre-verify, verdict application, state stamp, event emission.

#### Negative Paths
- Given a sentinel is present and the play-forward throws after consuming it, when the dispatch
  runs, then the sentinel is not recreated — the one-shot contract holds on the failure path, and a
  crash cannot loop on it.
- Given the trigger is passed for a worktree whose sentinel is unreadable (permission error), when
  the play-forward is invoked, then it still runs via the trigger and the unreadable sentinel does
  not abort the resume.
- Given the trigger is passed but the base ref is deleted from the remote between evaluation and
  rebase, when the play-forward runs, then the rebase failure is handled by the existing halt path
  with a reason naming the unresolvable base.

### Done When
- [ ] Tests cover all four guard combinations: sentinel only, trigger only, both, neither.
- [ ] A test asserts the "both" case consumes the sentinel exactly once and runs one play-forward.
- [ ] A test asserts the "neither" case is a pure no-op returning the existing skip result.
- [ ] The post-guard sequence has no branch on entry reason — asserted by a test that both entry
      reasons produce the same call sequence.

---

## Story 5: Operator park still outranks base-advance recovery

**Requirement:** Outcome-1 · **Condition:** 4

As a daemon operator who has parked a feature, I want park to remain strictly dominant over the new
base evaluation, so that parking still means "no machinery touches this worktree" even when main has
moved far ahead.

### Acceptance Criteria

#### Happy Path
- Given an operator-parked worktree whose base has advanced, when a dispatch is attempted, then the
  base evaluation does **not** run, no rebase occurs, and the existing operator-parked termination
  is returned.
- Given an operator-parked worktree holding an unconsumed re-kick sentinel and an advanced base,
  when a dispatch is attempted, then the sentinel is still present and unmodified afterwards.
- Given a worktree parked between base evaluation and the play-forward call, when the dispatch
  continues, then the pre-existing park re-check prevents the play-forward from running.

#### Negative Paths
- Given the park check itself throws, when a dispatch is attempted, then the feature is treated as
  parked (fail-toward-parked, unchanged from today) and no base evaluation or rebase occurs.
- Given an operator-parked worktree whose base is `undeterminable`, when a dispatch is attempted,
  then no evaluation-related git command is issued at all.
- Given a worktree that is unparked and then dispatched, when the dispatch runs, then base
  evaluation proceeds normally — park suppression is not sticky.

### Done When
- [ ] A test asserts a parked worktree with an advanced base issues zero base-evaluation git
      commands and performs zero rebases.
- [ ] A test asserts a parked worktree's unconsumed sentinel is byte-identical before and after an
      attempted dispatch.
- [ ] A test asserts the throwing-park-check path suppresses evaluation.

---

## Story 6: A patch already equivalent to main is not attributed as feature scope

**Requirement:** Outcome-2, Outcome-3 · **Condition:** 1

As a daemon operator, I want a commit that main already carries to disappear from the graded diff
once the base is integrated, so that the build reviewer stops reporting main-owned work as
unauthorized feature scope and stops demanding a plan decision no human should make.

This story is the operator-directed proof of the design's one inferred assumption — that a clean
rebase drops the upstream-equivalent commit unaided, so no patch-equivalence filter is needed. Both
halves are required: the positive proof and the without-rebase control.

### Acceptance Criteria

#### Happy Path
- Given a feature branch carrying a commit whose patch is already present on `origin/<default>`
  under a different sha, when a resume-triggered rebase integrates the advanced base, then that
  commit's paths are absent from `git diff merge-base(origin/<default>, HEAD)..HEAD` — the exact
  range the build reviewer grades.
- Given the same feature after the resume-triggered rebase, when build review inputs are assembled,
  then the graded diff contains only the feature's own remaining work.
- **Control:** given the identical starting state with the resume-triggered rebase suppressed, when
  build review inputs are assembled, then the upstream-equivalent commit's paths **are** present in
  the graded diff and Scope fails — proving the test detects the defect it claims to fix.

#### Negative Paths
- Given a feature commit that merely *touches the same files* as an upstream commit but is not
  patch-equivalent, when the resume-triggered rebase runs, then that commit survives the rebase and
  remains in the graded diff — genuine feature work is never silently dropped.
- Given a feature commit that is patch-equivalent to an upstream commit but conflicts during the
  rebase, when the rebase runs, then the conflict is surfaced through the existing bounded
  resolution and halt path rather than being resolved by dropping feature work.
- Given a rebase that drops an upstream-equivalent commit, when the post-rebase state is inspected,
  then no acceptance guard reports the feature's commits as lost — the drop is recognized as
  correct, not as a failed rebase.

### Done When
- [ ] An acceptance test constructs a real repository where a feature commit is patch-equivalent to
      a commit merged into the base after the feature diverged, drives the resume path, and asserts
      the commit's paths are absent from the graded merge-base range.
- [ ] The same test asserts the without-rebase control still yields those paths in the graded range
      and a Scope failure.
- [ ] A test asserts a same-files-but-different-patch commit survives the rebase.
- [ ] If the assumption proves false — the commit survives a clean rebase — this story fails RED and
      the gap is reported rather than worked around; no story here silently substitutes a
      patch-equivalence filter.

---

## Story 7: A resume-triggered rebase rebaselines the seal without a manual reseal

**Requirement:** Outcome-4 · **Condition:** 5

As a daemon operator, I want a rebase that main's advance caused to rotate the protected-artifact
seal through the existing audited path, so that recovering a halted feature never requires me to run
a manual reseal for changes I did not author.

> **Amended 2026-08-11 by #1245 (conflict-check):** this story verifies **inherited** behavior
> rather than specifying new implementation. `resumeRebaseFirst` already calls
> `performRebase(..., { translateAfterRebase })`, and `translateAfterRebase` already rotates the
> seal with the proactive-rebase trigger, so routing the base-advance entry through the existing
> play-forward inherits the rotation with no new seal code. The story is retained — and its
> criteria are unchanged — because the inheritance is exactly what could silently regress if a
> future implementation bypassed `resumeRebaseFirst`. Additionally, rotation fires **only after a
> clean rebase**: a `noop` or `conflict_halt` outcome must leave the seal untouched
> (`adr-2026-07-26-protected-artifact-seal-rebaseline`).

### Acceptance Criteria

#### Happy Path
- Given a halt-resume whose base advanced and whose base carries newer content under a protected
  `.docs/` directory, when the resume-triggered play-forward completes, then the seal's
  `rebaselines[]` gains an entry whose `trigger` is the proactive-rebase trigger and whose `paths`
  name exactly the protected paths the rebase changed.
- Given the same resume, when the next BUILD or SHIP step attempt verifies the seal, then
  verification passes with no protected-artifact halt and no operator action.
- Given the same resume, when the seal is inspected, then its `baselineCommit` advanced to the
  post-rebase commit and the rebaseline entry records the `fromCommit` it advanced from.
- Given the same resume, when the audit trail is inspected, then the rebaseline is recorded through
  the existing seal-rotation telemetry — this feature introduces no new authorization channel.

#### Negative Paths
- Given a halt-resume whose base advanced and whose seal verification legitimately rejects (a
  protected artifact was modified by the feature in a way the rotation predicate refuses), when the
  play-forward runs, then the existing seal halt is written and no rotation is forced — the new
  trigger never widens what a rotation may authorize.
- Given a halt-resume whose worktree carries no seal file at all, when the play-forward runs, then
  the rebase proceeds under the existing legacy behavior and no seal is manufactured.
- Given a resume-triggered rebase that changes only non-protected paths, when it completes, then no
  rebaseline entry is appended — rotation is driven by actual protected-path change, not by the
  rebase having happened.
- Given a resume-triggered play-forward whose rebase outcome is `noop` (the branch was already
  current) or `conflict_halt`, when it completes, then the seal is left untouched and no rebaseline
  entry is appended — rotation is reached only on a clean rebase that moved HEAD.

### Done When
- [ ] An acceptance test asserts the `rebaselines[]` lineage entry (trigger, `fromCommit`,
      `toCommit`, `paths`) after a resume-triggered rebase — asserting absence of a HALT is
      explicitly **not** sufficient.
- [ ] A test asserts the subsequent seal verification passes with no operator command run.
- [ ] A test asserts a legitimately-refused rotation still halts, proving the trigger did not widen
      seal authority.
- [ ] A test asserts a non-protected-path rebase appends no rebaseline entry.

---

## Story 8: A resume-triggered rebase conflict halts with a distinguishable reason

**Requirement:** Outcome-3 · **Condition:** 6

As a daemon operator, I want a HALT caused by a resume-time rebase conflict to say so, so that I can
tell new integration work apart from the original finding I just cleared and do not conclude the
recovery failed to take effect.

### Acceptance Criteria

#### Happy Path
- Given a halt-resume whose base advanced and whose rebase conflicts beyond the bounded resolution
  cap, when the play-forward halts, then the HALT reason names the base-advance trigger and the base
  ref that was being integrated.
- Given the same halt, when its class sidecar is read, then it carries the class the existing
  conflict path assigns — this feature introduces no new halt class.
- Given a conflict halt from the pre-existing sentinel entry, when its reason is read, then it is
  unchanged from today — only the base-advance entry adds trigger attribution.

#### Negative Paths
- Given a halt-resume whose rebase conflict is resolved within the bounded cap, when the resolution
  succeeds, then no HALT is written and the resume continues.
- Given a halt-resume that halts on a rebase conflict, when the operator clears that HALT and the
  base is still advanced and still conflicting, then the next resume attempts the play-forward again
  and halts again with the same distinguishable reason — the loop is bounded per attempt by the
  existing resolution cap and is never silent.
- Given a halt-resume that halts on seal rejection rather than conflict, when the HALT reason is
  read, then it names the seal rejection, not a rebase conflict.

### Done When
- [ ] A test asserts the conflict HALT reason contains the base-advance trigger attribution and the
      base ref.
- [ ] A test asserts the sentinel-entry conflict HALT reason is unchanged from current behavior.
- [ ] A test asserts a within-cap resolution writes no HALT.

---

## Story 9: The resume base decision is observable on the event spine

**Requirement:** Outcome-1

As a daemon operator reading the log or the event ledger, I want every resume-time base decision
recorded as an event, so that I can tell a verified-current base from an unverifiable one without
inspecting the worktree filesystem.

### Acceptance Criteria

#### Happy Path
- Given a halt-resume dispatch, when base evaluation completes, then an event is emitted on the
  existing conductor event emitter carrying the verdict, the base ref and sha that were compared,
  and the entry reason when a play-forward follows.
- Given a `current` verdict and an `undeterminable` verdict, when their events are read back, then
  the two are distinguishable from the event payload alone.
- Given a play-forward entered by sentinel versus by base-advance trigger, when the events are read
  back, then the entry reason distinguishes them.
- Given the emitted event, when the daemon renders its feature log, then the decision appears there
  through the existing sink configuration.

#### Negative Paths
- Given event emission fails, when the dispatch runs, then the resume decision is still applied —
  telemetry never gates recovery.
- Given a dispatch that is not a halt-resume, when it runs, then no base-decision event is emitted
  (no misleading "evaluated" record for a path that never evaluated).
- Given the new event variant reaches a consumer that predates it, when the ledger is parsed, then
  parsing does not fail — the variant is additive and read by named fields.

### Done When
- [ ] A new variant is added to the conductor event union with an entry in the event sink
      configuration; no sidecar file, bespoke log, or artifact-stamped timestamp is introduced.
- [ ] A test asserts the event payload distinguishes all three verdicts and both entry reasons.
- [ ] A test asserts a failing emitter does not prevent the rebase or the resume.
- [ ] A test asserts no event is emitted on a non-halt-resume dispatch.

---

## Story 10: The reported feature reaches BUILD instead of halting a fourth time

**Requirement:** Outcome-1, Outcome-2, Outcome-3

As the operator who lost three dispatches to this defect, I want the end-to-end scenario from the
issue to resume into BUILD and attempt its remediation tasks, so that the fix is proven against the
failure as it actually occurred rather than only against its parts.

### Acceptance Criteria

#### Happy Path
- Given a feature halted with a human-required disposition whose worktree carries a protected-artifact
  seal, whose branch holds a commit already patch-equivalent to the advanced base, and whose pending
  remediation tasks have never been attempted, when the operator clears the HALT and the daemon
  re-dispatches, then the base is integrated first, the conductor enters the step loop, and the
  remediation tasks are attempted.
- Given that same scenario, when the build reviewer next grades the feature, then it does not report
  the upstream-equivalent commit's files as out-of-plan feature scope.
- Given that same scenario, when the resume completes, then no operator command was required beyond
  clearing the HALT — no manual sentinel authoring, no manual reseal.

#### Negative Paths
- Given that same scenario but with the base **not** advanced, when the operator clears the HALT,
  then the feature resumes with no rebase and its existing evidence intact.
- Given that same scenario where the rebase conflicts, when the play-forward halts, then the HALT
  names the base-advance trigger and the pending remediation tasks remain unattempted but
  unmodified — recovery never rewrites them.
- Given that same scenario where the feature is operator-parked before the clear, when the daemon
  ticks, then nothing is evaluated, rebased, or dispatched.

### Done When
- [ ] An acceptance test reproduces the reported scenario end to end — human-required halt, sealed
      worktree, upstream-equivalent commit, advanced base — and asserts the conductor reaches its
      step loop rather than re-halting on the same finding.
- [ ] The test asserts the graded diff after resume is free of the upstream-equivalent commit's
      paths.
- [ ] The test asserts no manual reseal and no manual sentinel authoring occurred.
- [ ] A companion assertion covers the unchanged-base variant resuming with evidence intact.

---

**Status:** Accepted
