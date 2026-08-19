**Status:** Accepted

# Stories: Recoverable build review when the blocker is mechanical, not judgement

Source: intake jstoup111/ai-conductor#1629. PRD
`.docs/specs/2026-08-18-review-infrastructure-failures-are-operator-unreco.md` (FR-1..FR-15).
Design: `.docs/decisions/adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane.md`.

Terms used below are the PRD's: a **mechanical fault** is a rubric outcome where the rubric could
not be evaluated at all; the **semantic allowance** is the cumulative budget that bounds rework
churn; the **mechanical allowance** is this feature's separate bound; a **reduced-coverage decision**
is the operator's recorded acceptance that a named rubric did not run.

## Story 1: A mechanical fault is routed on what it is, not on how it was worded

**Requirement:** FR-1

As the build loop, I want a rubric outcome that could not be evaluated to be recognised as mechanical
wherever routing is decided, so that a reworded fault is never mistaken for a review judgement.

### Acceptance Criteria

#### Happy Path
- Given a lap in which one rubric could not be evaluated and three were judged clean, when the lap is
  routed, then the lap is treated as mechanical regardless of the wording of the fault's diagnostic text.
- Given two laps whose mechanical faults carry different diagnostic text but the same fault class,
  when each is routed, then both take the identical routing branch.

#### Negative Paths
- Given a lap in which a rubric was judged and produced a finding whose text happens to describe an
  environment problem, when the lap is routed, then it is routed as a judged finding and blocks —
  diagnostic prose never promotes a finding into the mechanical lane.
- Given a lap in which a rubric was skipped, when the lap is routed, then it is not treated as
  mechanical and no mechanical allowance is consumed.
- Given a lap whose recorded outcome cannot be parsed at all, when the lap is routed, then it is
  rejected as malformed and blocks, rather than being classified mechanical by default.

### Done When
- [ ] Routing decisions for the mechanical lane are taken from the outcome's structured kind, and no
      routing decision reads the fault's free-text diagnostic
- [ ] A test proves two faults with different diagnostic text and the same class route identically
- [ ] A test proves a judged finding containing environment-sounding prose still blocks

## Story 2: The cause of a mechanical fault survives into the recorded outcome

**Requirement:** FR-1, FR-4

As an operator, I want a mechanical fault to record which class of fault occurred, so that the report
tells me what broke and a later decision can be scoped to that class.

### Acceptance Criteria

#### Happy Path
- Given a rubric whose pre-check could not read a file it needs, when the outcome is recorded, then
  the recorded cause names the pre-check class of fault, not a generic provider fault.
- Given a rubric whose evidence could not be written, when the outcome is recorded, then the recorded
  cause names the artifact class of fault.
- Given any mechanical fault, when the outcome is recorded, then the specific sub-reason and any
  bounded excerpt remain available for the human report.

#### Negative Paths
- Given a fault whose originating reason has no mapping to a recorded cause class, when the outcome
  would be recorded, then this is surfaced as a contract defect rather than silently recorded as a
  generic provider fault.
- Given a mechanical fault, when its recorded cause is derived, then no free-text diagnostic
  contributes to the recorded cause.

### Done When
- [ ] Every originating fault reason maps to a declared cause class; the mapping is exhaustive with
      no catch-all fallback
- [ ] A pre-check fault is observable in the recorded outcome as a pre-check class fault
- [ ] The specific sub-reason is still present in the human-facing report

## Story 3: A mechanical lap costs nothing from the semantic allowance

**Requirement:** FR-2

As the build loop, I want a lap that ended in a mechanical fault to leave the semantic allowance
exactly as it was, so that a broken environment cannot exhaust the budget that bounds argument.

### Acceptance Criteria

#### Happy Path
- Given a semantic allowance with a recorded state, when a lap ends in a mechanical fault, then the
  semantic allowance state after the lap is identical to its state before, in every field.
- Given repeated laps that all end in mechanical faults, when the semantic allowance is inspected,
  then it has not advanced at all.

#### Negative Paths
- Given a lap in which one rubric faulted mechanically and another produced an unresolved finding,
  when the lap is routed, then the lap is treated as a judged failure and the semantic allowance IS
  charged — a mechanical fault alongside a real finding does not buy a free lap.
- Given a per-rubric repetition tally exists on the durable allowance state, when a lap ends in a
  mechanical fault, then that tally does not advance either. This is a preserved invariant, not new
  work: it holds whether it is delivered here by the lap never reaching the tally, or already
  delivered by the separate repetition-tally feature.

### Done When
- [ ] A test asserts the durable semantic-allowance state is byte-identical across a mechanical lap
- [ ] A test asserts a mixed lap (mechanical fault plus unresolved finding) does charge the allowance
- [ ] No per-rubric repetition tally advances on a purely mechanical lap

## Story 4: A mechanical lap re-runs the review instead of sending the build back for rework

**Requirement:** FR-2, FR-3

As the build loop, I want a mechanical fault to cause the review to run again rather than dispatch
rework, so that no work is asked of the builder for a fault the builder did not cause.

### Acceptance Criteria

#### Happy Path
- Given a lap that ends in a mechanical fault with mechanical allowance remaining, when the lap
  completes, then no review outcome is published for that lap and the review runs again.
- Given a mechanical fault that clears on the next attempt, when the review runs again, then it
  proceeds to a normal judged outcome with no residue from the faulted lap.

#### Negative Paths
- Given a lap that ends in a mechanical fault, when the lap completes, then no rework is dispatched
  to the builder and no rework hint is produced.
- Given a lap that ends in a mechanical fault, when a later reader inspects the review outcome, then
  they do not find a failing outcome recorded for that lap.
- Given a mechanical fault occurring on a lap where a previous lap's outcome is still present, when
  the review runs again, then the stale outcome is not treated as this lap's result.

### Done When
- [ ] A mechanical lap with allowance remaining publishes no review outcome
- [ ] The review re-runs without dispatching rework
- [ ] No stale prior outcome is read as authority for the re-run

## Story 5: Mechanical re-attempts are bounded and terminate for a human

**Requirement:** FR-3, FR-4

As an operator, I want mechanical re-attempts to stop after a fixed number, so that a permanently
broken environment terminates instead of retrying forever or spending unbounded cost.

### Acceptance Criteria

#### Happy Path
- Given a mechanical fault that recurs, when the mechanical allowance is exhausted, then the feature
  stops and requires a human decision.
- Given the mechanical allowance is exhausted, when the terminating state is presented, then it names
  the rubric, the fault class, the bounded diagnostic, how much allowance was consumed, and both
  resumption steps in order: record a reduced-coverage decision, then clear the terminal state by the
  documented recovery. Recording the decision does not itself clear the terminal state.
- Given a review that passes, when the mechanical allowance is later inspected, then it has been reset.

#### Negative Paths
- Given a mechanical fault that recurs, when the run terminates on the exhausted allowance, then the
  terminating state is one the autonomous loop will not clear and re-dispatch by itself.
- Given the mechanical allowance is exhausted, when the run terminates, then no review outcome is
  fabricated as passing and no coverage is silently reduced.
- Given mechanical faults on different rubrics across successive laps, when the allowance is counted,
  then all of them count toward the same bound — a rotating fault cannot evade termination.
- Given a mechanical fault, when the run terminates, then the terminating state does not assert that
  the run "cannot converge" — it states only what was observed.

### Done When
- [ ] The mechanical allowance has a declared fixed ceiling and terminates on exhaustion
- [ ] The terminating state is of a class the autonomous loop does not auto-clear
- [ ] The terminating text names rubric, fault class, diagnostic, allowance consumed, and both
      resumption steps in order
- [ ] The allowance resets on a passing review

## Story 6: The operator can see exactly which rubric could not run, and why

**Requirement:** FR-4

As an operator, I want the exhausted mechanical fault to appear in the same report I already use for
findings, so that I do not have to reconstruct it from durable state files.

### Acceptance Criteria

#### Happy Path
- Given a review with an exhausted mechanical fault, when the operator inspects the review report,
  then the report names the rubric, the fault class, and the bounded diagnostic.
- Given a review whose only blocker is an exhausted mechanical fault, when the operator inspects the
  report, then the report distinguishes "blocked by a fault that could not be evaluated" from
  "blocked by unresolved findings" rather than showing a failing verdict with nothing unresolved.

#### Negative Paths
- Given a review with no mechanical faults, when the operator inspects the report, then no
  mechanical-fault section is shown and the report is unchanged from today.
- Given durable state that cannot be read, when the operator inspects the report, then the report
  reports the state as unavailable rather than presenting an empty or partial view as complete.

### Done When
- [ ] The findings report shows exhausted mechanical faults with rubric, class, and diagnostic
- [ ] A review blocked only by a mechanical fault no longer presents as "FAIL with nothing unresolved"
- [ ] A review with full coverage produces byte-identical report output to today

## Story 7: An operator records a reduced-coverage decision, and it is durable

**Requirement:** FR-5, FR-7

As an operator, I want to record that I accept a named rubric not having run, with my reasoning, so
that the review can proceed on a decision that is attributable and auditable.

### Acceptance Criteria

#### Happy Path
- Given a review with an exhausted mechanical fault on one rubric, when the operator records a
  reduced-coverage decision for that rubric with a rationale, then the decision is stored durably with
  the rubric, the fault class, the rationale, the operator's identity, and the time.
- Given a recorded reduced-coverage decision, when the feature is dispatched again in a new process,
  then the decision is still in force.
- Given a recorded reduced-coverage decision, when the review's own outcome file is removed or
  replaced by stale-state recovery, then the decision survives.

#### Negative Paths
- Given a review with an exhausted mechanical fault on one rubric, when a decision is recorded for
  that rubric, then a mechanical fault on a *different* rubric still blocks.
- Given a decision recorded for one fault class, when a mechanical fault of a *different* class occurs
  on the same rubric, then it still blocks.
- Given a reduced-coverage decision recorded on one feature, when a different feature encounters the
  same rubric and fault class, then that other feature still blocks — decisions never travel between
  features.
- Given an empty or whitespace-only rationale, when a decision is attempted, then it is refused and
  nothing is stored.
- Given durable state that cannot be read or written, when a decision is attempted, then it is refused
  and the review remains blocking.

### Done When
- [ ] A recorded decision persists across processes and survives removal of the review outcome file
- [ ] The stored record carries rubric, fault class, rationale, operator identity, and time
- [ ] Cross-rubric, cross-class, and cross-feature isolation each proven by test
- [ ] A blank rationale is refused with nothing stored

## Story 8: Only a verified human at an interactive terminal may reduce coverage

**Requirement:** FR-6

As the operator, I want the reduced-coverage decision to be unavailable to any automated caller, so
that the autonomous loop can never decide on its own to ship with less review. (This story also
carries the PRD's no-unattended-weakening non-functional requirement.)

### Acceptance Criteria

#### Happy Path
- Given an interactive terminal and a resolvable local operator identity, when a reduced-coverage
  decision is recorded, then it succeeds and the operator's identity is stored on the record.

#### Negative Paths
- Given a non-interactive caller, such as a piped or spawned process, when a reduced-coverage decision
  is attempted, then it is refused, nothing is stored, and the refusal is observable.
- Given an interactive terminal but no resolvable operator identity, when a decision is attempted,
  then it is refused and nothing is stored.
- Given the autonomous build loop encountering an exhausted mechanical fault, when it runs to
  termination, then it never records a reduced-coverage decision on its own behalf.
- Given any configuration value, environment variable, or flag, when the autonomous loop runs, then
  none of them grants it the authority to record a reduced-coverage decision.

### Done When
- [ ] A non-interactive attempt is refused, stores nothing, and emits an observable refusal
- [ ] An unresolvable operator identity is refused
- [ ] A test asserts no configuration path grants the loop this authority

## Story 9: Reduced coverage is refused when it would not be an honest decision

**Requirement:** FR-13, FR-14

As the system, I want to refuse a reduced-coverage decision for anything other than a currently
exhausted mechanical fault, so that the decision cannot be used to wave through work it was never
meant to cover.

### Acceptance Criteria

#### Happy Path
- Given a rubric currently in an exhausted mechanical-fault state, when a decision is recorded for it,
  then it is accepted.

#### Negative Paths
- Given a rubric that ran and was judged, when a reduced-coverage decision is attempted for it, then
  it is refused with a reason and nothing is stored.
- Given a rubric that was skipped, when a decision is attempted for it, then it is refused.
- Given a rubric with mechanical allowance still remaining, when a decision is attempted for it, then
  it is refused — the retry lane must be exhausted first.
- Given a rubric for which a decision is already recorded, when the same decision is attempted again,
  then it is refused as already recorded and nothing changes.
- Given a rubric name that does not exist, when a decision is attempted, then it is refused.
- Given a review that has been replaced while the operator was deciding, when the decision lands, then
  it is refused rather than applied to a review the operator did not inspect.

### Done When
- [ ] Judged, skipped, allowance-remaining, duplicate, unknown-rubric, and stale-review attempts are
      each refused, each leaving state unchanged
- [ ] Every refusal is observable and states its reason

## Story 10: With coverage accepted and findings resolved, the review passes

**Requirement:** FR-8

As the build loop, I want a review whose mechanical faults are all covered by decisions and whose
findings are all resolved to pass, so that the feature proceeds without manual intervention in state.

### Acceptance Criteria

#### Happy Path
- Given every mechanical fault is covered by a decision and every finding is resolved or accepted,
  when the effective verdict is derived, then it is PASS and the build proceeds.
- Given a covered mechanical fault, when the effective verdict is derived on a later lap, then the
  decision is applied from current state under the existing state lease, not concluded from a prior
  lap's file.
- Given a feature stopped on an exhausted mechanical fault, when the operator records a
  reduced-coverage decision and then clears the terminal state by the documented recovery, when the
  feature is dispatched again, then the review derives PASS and the feature proceeds — with no edit
  to any durable state file by hand.

#### Negative Paths
- Given one mechanical fault is covered and a second, uncovered mechanical fault is present, when the
  effective verdict is derived, then it is FAIL.
- Given every mechanical fault is covered but one judged finding is unresolved, when the effective
  verdict is derived, then it is FAIL.
- Given no rubric was judged at all — every rubric mechanically faulted and every fault covered — when
  the effective verdict is derived, then it is FAIL: a review that judged nothing cannot pass.
- Given durable decision state that is malformed, when the effective verdict is derived, then it fails
  closed and blocks.

### Done When
- [ ] A covered mechanical fault no longer contributes to the blocking set
- [ ] The end-to-end path — terminal state, recorded decision, documented clear, re-dispatch, PASS —
      is demonstrated without hand-editing durable state
- [ ] Uncovered fault, unresolved finding, and zero-judged-rubrics cases each still FAIL
- [ ] Malformed decision state blocks rather than passing

## Story 11: A real finding still blocks, and the two decisions cannot substitute for each other

**Requirement:** FR-9, FR-12

As a reviewer of shipped work, I want a rubric that ran and found a problem to block exactly as it
does today, so that this feature cannot become a way around review judgement.

### Acceptance Criteria

#### Happy Path
- Given a rubric that ran and produced an unresolved finding, when the effective verdict is derived,
  then it is FAIL, whether or not any reduced-coverage decision exists.
- Given a review with full coverage and no mechanical faults, when it is derived, reported, and
  recorded, then the behavior and output are identical to today.

#### Negative Paths
- Given an unresolved finding, when a reduced-coverage decision naming that finding's rubric exists,
  then the finding remains unresolved and continues to block.
- Given an exhausted mechanical fault, when an operator attempts to clear it using the existing
  finding-acceptance action, then that action refuses it exactly as it does today.
- Given a finding, when an operator attempts to clear it using the reduced-coverage decision, then it
  is refused.

### Done When
- [ ] Unresolved findings block regardless of any reduced-coverage decision
- [ ] The existing finding-acceptance action still refuses mechanical faults
- [ ] The reduced-coverage decision refuses findings
- [ ] A full-coverage review is unchanged from today, proven by test

## Story 12: Reduced coverage is stamped where a reader will meet it

**Requirement:** FR-10, FR-11

As a later reader of the shipped record, I want reduced coverage to be conspicuous, so that I can see
which rubric did not run, why, and on whose authority, without inspecting per-lap state.

### Acceptance Criteria

#### Happy Path
- Given a review that passed with a reduced-coverage decision in force, when the lap's evidence is
  read, then it records the rubric, the fault class, the current diagnostic, the operator, the
  rationale, and the decision time.
- Given the same review, when the record of what shipped is read, then it carries the same
  reduced-coverage entry, rendered from the same data as the retained pull request's entry.
- Given a decision in force across several laps, when each passing lap's evidence is read, then each
  names the fault actually present on that lap.

#### Negative Paths
- Given a known reduced-coverage decision that cannot be rendered into the shipped record, when
  publication runs, then it blocks rather than shipping a record with the reduced coverage missing.
- Given no reduced-coverage decision, when the shipped record is written, then it carries no
  reduced-coverage section at all.
- Given unreadable decision state, when the shipped record is written, then no reduced-coverage entry
  is fabricated.

### Done When
- [ ] Lap evidence and the shipped record both carry the full reduced-coverage entry
- [ ] Both are rendered from one data contract, not two independent renderers
- [ ] An unrenderable known decision blocks publication
- [ ] Absent decisions produce no section, and unreadable state fabricates nothing

## Story 13: State written before this change still reads, and unaffected reviews are untouched

**Requirement:** FR-15

As an operator with features already in flight, I want existing durable state to keep working, so that
shipping this change does not halt or corrupt a running feature.

### Acceptance Criteria

#### Happy Path
- Given durable decision state written before this change, when it is read, then it parses and its
  existing records continue to have their existing effect.
- Given a durable allowance ledger written before this change, when it is read, then the absent
  mechanical counter is treated as a fresh count rather than rejected.
- Given a feature mid-flight when this change ships, when its next lap runs, then it behaves normally
  and does not terminate spuriously.

#### Negative Paths
- Given decision state containing an unrecognised record kind, when it is read, then it fails closed
  and grants no coverage reduction.
- Given a ledger whose mechanical counter is present but not a valid count, when it is read, then it
  is treated as corrupt state consistent with existing handling, and never as unlimited allowance.
- Given a worktree deleted and recreated, when the review runs, then the allowance and decisions are
  absent, the review blocks pending a fresh decision, and nothing is silently passed.

### Done When
- [ ] Pre-change decision state and ledgers both parse and behave unchanged
- [ ] An unrecognised record kind grants no reduction
- [ ] A corrupt counter never reads as unlimited allowance
- [ ] A recreated worktree fails open on allowance but never on coverage
