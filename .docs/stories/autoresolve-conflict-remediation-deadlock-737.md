**Status:** Accepted

# Restore conflict remediation for shipped pull requests

**Related prior story:** `auto-resolve-open-pr-conflicts.md` (amended by this specification)

## Story 1: Eligible shipped conflicts enter remediation

**Requirement:** FR-1, FR-2, FR-3

As a repository operator, I want a shipped pull request that becomes conflicting to enter
automatic remediation even while its completed-feature evidence remains available, so that
post-ship recoverability does not create a permanent merge blocker.

### Acceptance Criteria

#### Happy Path

- **AC-1:** Given a non-draft pull request enrolled in the shipped watch after a verified ship,
  when it becomes conflicting and no transient safety condition applies, then a remediation
  attempt starts during the next normal watch cycle.
- **AC-2:** Given that eligible pull request still has its completed-feature evidence workspace,
  when eligibility is evaluated, then retention alone does not prevent the attempt.

#### Negative Paths

- **AC-1 negative:** Given a pull request that is draft, closed, merged, missing, or absent from
  the shipped watch, when a watch cycle observes repository state, then no conflict-remediation
  attempt starts for it.
- **AC-2 negative:** Given a conflicting branch and a retained workspace but no verified shipped-
  watch enrollment, when the sweep runs, then workspace presence is not accepted as substitute
  ownership evidence and no attempt starts.

### Done When

- [ ] A watched, shipped, non-draft conflicting pull request starts remediation on the next
      unblocked watch cycle.
- [ ] The same result is proven while its completed-feature evidence workspace exists.
- [ ] Draft, closed, merged, missing, and unwatched cases each produce zero attempts.

## Story 2: Every conflicting candidate gets one safe cycle disposition

**Requirement:** FR-4, FR-5, FR-6

As a repository operator, I want every conflicting watched pull request to have one truthful
outcome per watch cycle, so that temporary contention is distinguishable from an abandoned lane.

### Acceptance Criteria

#### Happy Path

- **AC-1:** Given multiple conflicting watched pull requests in one repository, when a watch
  cycle evaluates them, then each receives exactly one of these observable outcomes: remediation
  started, temporarily deferred with a concrete reason, already under sticky escalation, or newly
  escalated.
- **AC-2:** Given one remediation attempt is already active, when another eligible conflict is
  evaluated, then the second pull request is temporarily deferred and no second branch mutation
  begins concurrently.
- **AC-3:** Given a pull request is deferred by active ownership or cooldown, when that transient
  condition clears, then the pull request remains eligible on a later cycle without having spent
  an attempt or created a human escalation.

#### Negative Paths

- **AC-1 negative:** Given a conflicting watched pull request, when the cycle completes without
  starting remediation, then a missing or ambiguous disposition fails the cycle contract rather
  than being reported as normal conflict precedence.
- **AC-2 negative:** Given two daemon activities target the same pull-request branch, when one
  already owns branch mutation, then the other performs no mutation and records a concrete
  temporary-deferral reason.
- **AC-3 negative:** Given ten watch cycles occur while the same transient condition remains,
  when attempt state and operator signals are inspected, then the attempt count is unchanged and
  no sticky escalation has been created solely by those deferrals.

### Done When

- [ ] Every conflicting watched candidate has exactly one enumerated disposition per cycle.
- [ ] Repository-wide and same-branch concurrency cases start at most one mutation.
- [ ] Transient deferral leaves attempt count and sticky-escalation state unchanged.

## Story 3: Terminal inability escalates once and remains actionable

**Requirement:** FR-7, FR-8

As a repository operator, I want terminal remediation failures to produce one durable,
actionable escalation, so that I can recover the pull request without repeated notification
noise.

### Acceptance Criteria

#### Happy Path

- **AC-1:** Given automatic remediation is active and an attempt is terminally unavailable,
  permanently ineligible, or exhausted, when the conflict is evaluated, then one marked comment
  first identifies the pull request, failed stage, concrete reason, and required recovery action;
  only after that content is confirmed does the escalation become sticky.
- **AC-2:** Given the sticky escalation already represents the unchanged conflict, when ten more
  watch cycles run, then no duplicate escalation, comment, or operator notification is created.
- **AC-3:** Given the actionable comment succeeds but the sticky-label write temporarily fails,
  when a later cycle retries the same escalation, then it updates the same marked comment and
  retries the label without consuming a remediation attempt or creating a duplicate signal.

#### Negative Paths

- **AC-1 negative:** Given remediation is intentionally inactive, when a conflict is observed,
  then inactivity alone does not mutate the pull request with an automated sticky escalation.
- **AC-2 negative:** Given the failure reason or required recovery action has materially changed,
  when the conflict is evaluated again, then the existing operator signal is updated to the
  current actionable state rather than suppressing the change as a duplicate.
- **AC-3 negative:** Given comment lookup or comment write is unavailable in one cycle, when that
  cycle ends, then no new sticky label is applied, no successful notification is falsely reported,
  and a later cycle can retry without consuming a remediation attempt. An indeterminate lookup
  never triggers an unproven fallback comment creation.

### Done When

- [ ] Each terminal enabled-mode condition yields one escalation containing pull request, stage,
      reason, and recovery action.
- [ ] Ten unchanged cycles leave exactly one current escalation signal.
- [ ] Comment success plus label failure and comment lookup/write failure are retryable, create no
      duplicate signal, and consume no remediation attempt.

## Story 4: Conflict ownership remains truthful across remediation lanes

**Requirement:** FR-9, FR-16

As a repository operator, I want conflict remediation and continuous-integration repair to agree
on who owns a conflicting pull request, so that neither lane silently waits for work nobody will
perform.

### Acceptance Criteria

#### Happy Path

- **AC-1:** Given automatic conflict remediation is active and a conflicting watched pull request
  is evaluated, when continuous-integration repair considers the same cycle, then it sees the
  pull request's explicit conflict disposition and does not begin competing repair work.
- **AC-2:** Given continuous-integration repair is active while automatic conflict remediation is
  intentionally inactive, when the daemon starts, then exactly one loud compatibility diagnostic
  is emitted and each observed conflict is identified as requiring manual resolution.

#### Negative Paths

- **AC-1 negative:** Given conflict evaluation returns no disposition, when continuous-integration
  repair reaches that pull request, then the system does not claim it was deferred to an active
  conflict owner; the missing ownership outcome is surfaced as an error.
- **AC-2 negative:** Given the daemon remains running through repeated watch cycles with conflict
  remediation inactive, when conflicts recur, then startup diagnostics are not repeated and no
  cycle describes the pull requests as owned by active automatic remediation.

### Done When

- [ ] A conflicting candidate never enters ordinary continuous-integration repair after receiving
      its cycle conflict disposition.
- [ ] Active CI repair plus inactive conflict remediation emits one startup diagnostic per daemon
      start and produces truthful manual-resolution outcomes.
- [ ] No normal-cycle log contains a conflict-precedence deferral without a corresponding conflict
      disposition.

## Story 5: Refreshed branches publish only after all safety proofs hold

**Requirement:** FR-10, FR-11

As a pull-request reviewer, I want automatic remediation to preserve all reviewed work and refuse
stale publication, so that an automatic refresh can never overwrite unseen branch changes.

### Acceptance Criteria

#### Happy Path

- **AC-1:** Given remediation produces a candidate refreshed branch, when all pre-attempt feature
  work remains present, the branch is current with the base used for remediation, and required
  repository verification passes, then the existing pull-request branch may be refreshed.
- **AC-2:** Given the remote pull-request branch changes after remediation begins, when publication
  is attempted, then nothing is published, the remote change remains intact, and one sticky
  concurrent-change escalation names the recovery action.

#### Negative Paths

- **AC-1 negative:** Given feature work is missing, base currency cannot be proven, or any required
  verification fails, when the candidate reaches publication, then no branch update occurs and
  one actionable failure outcome identifies the failed proof.
- **AC-2 negative:** Given the remote branch moves repeatedly while the concurrent-change
  escalation is unchanged, when later cycles observe it, then no overwrite or fallback publication
  occurs and the escalation is not duplicated.

### Done When

- [ ] Publication succeeds only when preservation, base-currency, and repository-verification
      results all pass.
- [ ] Each failed safety proof leaves the remote branch unchanged and names its failed stage.
- [ ] A remote update during remediation is preserved byte-for-byte and yields one concurrent-
      change escalation with no fallback overwrite.

## Story 6: Success and failure advance a bounded remediation lifecycle

**Requirement:** FR-12, FR-13

As a repository operator, I want remediation state to reset on success and remain bounded on
failure, so that recovered pull requests progress while unrecoverable ones do not loop forever.

### Acceptance Criteria

#### Happy Path

- **AC-1:** Given an automatic attempt safely refreshes the existing pull request, when the attempt
  completes, then conflict-attempt state is cleared and any remaining non-conflict CI failures are
  eligible for continuous-integration repair on a later watch cycle.
- **AC-2:** Given an attempt fails below the configured retry limit, when the next cycles run, then
  the existing cooldown and retry bounds are honored before another attempt may begin.
- **AC-3:** Given the retry limit is exhausted, when another watch cycle observes the unchanged
  conflict, then one sticky escalation remains visible and no further attempt begins until operator
  intervention changes the state.

#### Negative Paths

- **AC-1 negative:** Given the refreshed pull request still has a non-conflict CI failure, when the
  same watch cycle continues, then CI repair does not race the just-completed refresh; it may
  evaluate the failure only on a later cycle.
- **AC-2 negative:** Given a failed attempt is still inside cooldown, when repeated watch cycles
  occur, then they do not start early retries, increment the attempt count, or create premature
  escalation.
- **AC-3 negative:** Given exhaustion is unchanged across ten cycles, when state is inspected, then
  the attempt count remains bounded, no new attempt runs, and only one escalation signal exists.

### Done When

- [ ] Successful remediation clears conflict-attempt state on the watched pull request.
- [ ] Remaining non-conflict CI failures become eligible only on a later cycle.
- [ ] Cooldown, retry limit, exhaustion, and operator-intervention behavior are verified with
      stable attempt counts and exactly one escalation.

## Story 7: Terminal outcomes are visible without granting merge authority

**Requirement:** FR-14, FR-15

As a repository operator, I want complete remediation outcome logs while retaining exclusive
merge control, so that automation is auditable without changing the review boundary.

### Acceptance Criteria

#### Happy Path

- **AC-1:** Given remediation reaches any terminal success or failure outcome, when the outcome is
  logged, then the operator-visible record identifies the pull request, furthest stage reached,
  and result.
- **AC-2:** Given remediation successfully refreshes a branch and all checks pass, when automation
  completes, then the pull request remains open for an operator-controlled merge.

#### Negative Paths

- **AC-1 negative:** Given a terminal outcome lacks the pull-request identity, reached stage, or
  result, when the daemon reports completion, then the incomplete record fails the observability
  contract rather than being accepted as a valid terminal log.
- **AC-2 negative:** Given the refreshed pull request becomes mergeable, when the automatic
  remediation flow ends, then it performs no merge action and records no claim that it merged the
  pull request.

### Done When

- [ ] Every terminal remediation result has a greppable operator-visible record containing pull
      request, stage, and result.
- [ ] Successful remediation leaves the pull request open and performs zero automatic merge
      operations.
