**Status:** Accepted

# Stories: Mergeability-first daemon finish

## Story 1: Assess mergeability before automatic history rewriting

**Requirement:** FR-1

As a daemon operator, I want advanced-base integration assessed without changing the feature so
that history is rewritten only when integration actually requires recovery.

### Acceptance Criteria

#### Happy Path

- Given a completed feature whose resolved target contains commits absent from the feature, when
  automatic integration begins, then the daemon determines whether the committed feature and target
  can merge cleanly before starting a rebase.

#### Negative Paths

- Given a feature whose target cannot be resolved or assessed, when automatic integration begins,
  then the daemon does not claim a clean merge and does not silently satisfy the gate.
- Given the assessment runs, when it completes, then the feature ref, HEAD, index, worktree, and
  commit history remain unchanged.

### Done When

- [ ] A real-Git test proves assessment occurs before any rebase invocation for an advanced target.
- [ ] A state snapshot proves the assessment itself changes no feature ref, HEAD, index, worktree,
      or commit history.

## Story 2: Preserve a feature that can merge cleanly

**Requirement:** FR-2

As a feature reviewer, I want a mergeable branch left unchanged so that review history stays stable
even when the target branch advanced.

### Acceptance Criteria

#### Happy Path

- Given a feature is behind its resolved target but the prospective merge is clean, when automatic
  integration runs, then the integration gate is satisfied without rebasing the feature.

#### Negative Paths

- Given the feature is behind and the prospective merge is not clean, when integration runs, then
  the daemon does not use the mergeable-skip result.
- Given a clean prospective merge, when the gate is satisfied, then no feature commit SHA or commit
  count changes.

### Done When

- [ ] The clean-behind scenario returns a distinct mergeable-skip outcome.
- [ ] Real-Git assertions prove every feature commit SHA is preserved.

## Story 3: Preserve downstream verification after a mergeable skip

**Requirement:** FR-3

As a daemon operator, I want verified work to stay verified after a no-rewrite integration decision
so that base drift alone does not repeat paid or time-consuming gates.

### Acceptance Criteria

#### Happy Path

- Given applicable downstream gates are satisfied and the feature is prospectively mergeable, when
  automatic integration skips the rebase, then those gate verdicts and step states remain satisfied.

#### Negative Paths

- Given automatic integration performs a file-changing rebase instead of a skip, when its changed
  paths require re-verification, then the existing invalidation behavior still applies.
- Given a mergeable skip, when verdict application completes, then it writes no kickback provenance
  and schedules no downstream dispatch.

### Done When

- [ ] Integration coverage proves a mergeable skip preserves every applicable downstream gate.
- [ ] Existing changed-rebase invalidation coverage remains passing.

## Story 4: Recover automatically from a reported conflict

**Requirement:** FR-4

As a daemon operator, I want a real prospective conflict to enter automatic recovery so that avoiding
routine rebases does not create new manual work.

### Acceptance Criteria

#### Happy Path

- Given the prospective merge reports conflicts, when automatic integration runs, then the daemon
  starts the existing rebase and bounded conflict-resolution flow.

#### Negative Paths

- Given conflict recovery exhausts its bounded attempts or judges a conflict unsafe, when the flow
  settles, then the existing conflict HALT is written and the incomplete rebase is not reported as
  finished.
- Given the prospective merge is clean, when automatic integration runs, then the conflict resolver
  is not dispatched.

### Done When

- [ ] A real-Git conflict test proves the existing rebase driver is entered.
- [ ] Resolver success and exhaustion tests retain their existing terminal outcomes.

## Story 5: Fail closed when mergeability is indeterminate

**Requirement:** FR-5

As a daemon operator, I want an inconclusive assessment treated as needing integration so that an
unknown result cannot publish a falsely mergeable feature.

### Acceptance Criteria

#### Happy Path

- Given the prospective merge cannot start or returns an unrecognized result, when automatic
  integration runs, then the daemon enters the existing rebase flow.

#### Negative Paths

- Given the assessment process throws or its target disappears, when the failure is classified,
  then the daemon does not return mergeable-skip and does not bypass protected integration checks.
- Given the fallback rebase also fails unexpectedly, when the flow settles, then the existing
  fail-closed HALT behavior applies.

### Done When

- [ ] Injected error and unrecognized-result tests both prove fallback to rebase.
- [ ] No indeterminate test case can produce a satisfied mergeable-skip verdict.

## Story 6: Preserve re-kick play-forward

**Requirement:** FR-6

As a daemon operator, I want re-kick to keep incorporating advanced-base commits before retrying a
halted gate so that mergeability-first finish behavior does not defeat re-kick recovery.

### Acceptance Criteria

#### Happy Path

- Given a clean-behind completed feature at normal finish, when integration runs, then it may return
  mergeable-skip and preserve history.
- Given a re-kicked feature after the base advanced, when play-forward runs, then it performs the
  existing rebase before retrying the pending gate even if a prospective merge would be clean.

#### Negative Paths

- Given the advanced base contains a commit that resolves the pending gate, when re-kick completes,
  then that commit is present in the feature worktree before the gate retries.
- Given re-kick re-conflicts, when recovery settles, then the existing bounded resolver and HALT
  behavior applies; re-kick never returns mergeable-skip.

### Done When

- [ ] Finish coverage proves clean-behind mergeability skip.
- [ ] Re-kick coverage proves mandatory rebase precedes the pending-gate retry.
- [ ] Re-kick has no mergeable-skip outcome.

## Story 7: Leave protected artifacts and evidence untouched on skip

**Requirement:** FR-7

As a daemon operator, I want no-rewrite integration to leave protected decisions and evidence intact
so that a clean skip never manufactures rebase lineage.

### Acceptance Criteria

#### Happy Path

- Given a valid protected-artifact seal and evidence citations, when integration returns
  mergeable-skip, then neither the seal nor citations are translated, rotated, or rebaselined.

#### Negative Paths

- Given integration performs an actual clean rebase, when history moves, then the existing
  verification, translation, and permitted rebaseline behavior still runs.
- Given a mergeable skip, when injected translation or rebaseline callbacks are observed, then each
  has zero invocations.

### Done When

- [ ] Tests pin byte-identical seal and evidence files across mergeable skip.
- [ ] Existing actual-rebase seal/evidence tests remain passing.

## Story 8: Explain the integration outcome to operators

**Requirement:** FR-8

As a daemon operator, I want a distinct mergeable-skip signal so that I can tell preserved history
from an already-current branch, an actual rebase, or unresolved conflict recovery.

### Acceptance Criteria

#### Happy Path

- Given a mergeable skip occurs, when events and daemon output are recorded, then they identify that
  history rewriting was skipped because the feature can merge cleanly.

#### Negative Paths

- Given the branch is already current, when integration completes, then output retains the
  already-current outcome rather than reporting mergeable-skip.
- Given an actual rebase or conflict HALT occurs, when output is rendered, then neither is mislabeled
  as mergeable-skip.

### Done When

- [ ] The structured event contract has a dedicated mergeable-skip case.
- [ ] Formatter tests distinguish all four outcomes.

## Story 9: Never skip an incomplete rebase

**Requirement:** FR-9

As a daemon operator, I want paused rebase state to outrank mergeability so that an incomplete
history rewrite can never be published.

### Acceptance Criteria

#### Happy Path

- Given a rebase state directory exists or unresolved paths remain, when automatic integration
  starts, then the existing fail-closed recovery outcome is returned before mergeability assessment.

#### Negative Paths

- Given conflicts were staged but rebase continuation was not completed, when no unresolved paths
  remain, then the rebase state directory still prevents mergeable-skip.
- Given no active rebase state or unresolved path exists, when integration starts, then normal
  mergeability assessment may proceed.

### Done When

- [ ] Existing paused and staged-without-continue regression tests remain passing.
- [ ] A call-order assertion proves mergeability assessment cannot run before the active-rebase
      guard.

## Verify-Claims Ledger

### Claims

- [verified] Every story maps to one approved PRD requirement.
- [verified] Conflict/unknown fallback, finish-only policy, protected-artifact behavior, re-kick
  play-forward, and active-rebase precedence are established by approved operator decisions.

### Assumptions

- No unconfirmed load-bearing assumptions remain; the operator approved the PRD and ADR decisions.

### Verdict

CLEAR
