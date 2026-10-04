**Status:** Accepted

# Stories: Over-scope accept stranded behind the resume-time rebase fence

Source: jstoup111/ai-conductor#2983. Technical track, Tier M. Governing decision:
`adr-2026-10-04-resume-completes-interrupted-rebase-operation` (D1–D6). Scope boundary: the
resume-time rebase fence lets ordinary post-rebase unsatisfied re-judgements through to the resume
clamp; resume completes an interrupted rebase operation; fence halts name pending operator
decisions; the prd_audit verdict reason reports the reconciled classification. Finish-fence behavior
is unchanged. Excluded: non-fast-forward push of the halt record.

Terms: the *applied rebase record* is the persisted `rebase` gate verdict whose
`rebaseOperation.status` is `applied`; an *interrupted operation* is one whose status is `applying`;
a *preserved gate* is any gate named in the operation's `transition.preserved`; the *applied-at
time* is the operation's `appliedAt` stamp, otherwise the rebase verdict's own `checkedAt`; a
*post-rebase failing re-judgement* is a preserved gate's persisted verdict that is unsatisfied and
whose `checkedAt` is strictly newer than the applied-at time; a *recorded over-scope decision* is an
`over-scope-decisions` entry in `.pipeline/HALT.cleared` or an effective decision in
`.pipeline/accepted-widenings.json`.

## Story 1: Resume routes a post-rebase failing re-judgement to its gate

**Requirement:** ADR D4

As the daemon resuming a halted feature, I want a preserved gate that was re-judged and failed after
the rebase to be treated as an ordinary unsatisfied gate so that its next lap runs and can consume
the operator's recorded decision.

### Acceptance Criteria

#### Happy Path
- Given an applied rebase record preserving `build_review` (stamped for that operation) and `prd_audit`, a `prd_audit` verdict that is a post-rebase failing re-judgement for an NC.1 OVER_SCOPE offer, and `.pipeline/HALT.cleared` recording `decision: accept` with a rationale for NC.1, when the conductor resumes, then it writes no HALT before dispatch, dispatches `prd_audit`, and the decision is captured into `.pipeline/accepted-widenings.json`
- Given the resume above and a prd_audit report that again grades NC.1 OVER_SCOPE for the same source, when the prd_audit completion predicate runs, then the gate verdict is satisfied and the feature advances past `prd_audit` without any operator deletion of `.pipeline/HALT`
- Given an applied rebase record preserving `build_review` whose verdict is a post-rebase failing re-judgement, when the conductor resumes, then it dispatches `build_review` (the earliest unsatisfied gate) and writes no rebase-fence HALT

#### Negative Paths
- Given the first happy-path setup but `HALT.cleared` records `decision: refuse` for NC.1, when the resumed `prd_audit` lap completes, then the feature halts through prd_audit exactly as it does today for a refused widening, and no rebase-fence HALT is written
- Given the first happy-path setup but no recorded over-scope decision exists, when the resumed `prd_audit` lap completes, then the feature halts with the existing prd_audit over-scope decision block naming NC.1 as awaiting a decision
- Given an applied rebase record preserving `prd_audit` and a `prd_audit` verdict that is unsatisfied with `checkedAt` equal to or older than the applied-at time, when the conductor resumes, then it writes a `needs-human` HALT naming the outstanding `prd_audit` repair and dispatches no step
- Given an applied rebase record preserving `prd_audit` and no `.pipeline/gates/prd_audit.json`, when the conductor resumes, then it writes a `needs-human` HALT and dispatches no step
- Given an applied rebase record preserving `build_review` whose verdict is satisfied but carries no preservation stamp for that operation and is not newer than the applied-at time, when the conductor resumes, then it writes a `needs-human` HALT stating the gate was preserved without its replay-bound authority and dispatches no step
- Given a rebase record whose operation fails structural validation (for example a gate named in both `preserved` and `invalidated`), when the conductor resumes, then it writes a `needs-human` HALT stating the transition record is malformed and dispatches no step

### Done When
- [ ] A resume test reproducing the #2983 state (preserved `prd_audit`, post-rebase failing re-judgement, `HALT.cleared` accept) observes `step_started` for `prd_audit` and no `loop_halt` before it
- [ ] `.pipeline/accepted-widenings.json` contains an `accept` decision for the NC.1 case after that resume
- [ ] Each integrity-fault fixture (stale-before-`appliedAt`, absent verdict, unstamped PASS, malformed record) yields `.pipeline/HALT` with class `needs-human` and no `step_started` event

## Story 2: Finish fence is unchanged

**Requirement:** ADR D5

As the operator, I want finish to keep refusing publication while any rebase effect is unresolved so
that narrowing the resume check never lets unverified work publish.

### Acceptance Criteria

#### Happy Path
- Given an applied rebase record whose preserved gates are each stamped for that operation or freshly re-judged satisfied after the applied-at time, when the finish publication fence is evaluated, then it returns no blocker
- Given an applied rebase record preserving `prd_audit` whose verdict is a post-rebase failing re-judgement, when the finish publication fence is evaluated, then it returns `rebase transition still has an outstanding prd_audit repair or re-verification`

#### Negative Paths
- Given a rebase record with `status: applying`, when the finish publication fence is evaluated, then it returns `rebase transition is still applying; reconcile the persisted rebase operation before publication`
- Given an applied rebase record preserving `build_review` and no `build_review` verdict file, when the finish publication fence is evaluated, then it returns `rebase transition still has an outstanding build_review repair or re-verification`
- Given an applied rebase record preserving `build_review` whose satisfied verdict lacks its replay-bound stamp and is not newer than the applied-at time, when the finish publication fence is evaluated, then it returns `rebase transition preserved build_review without its replay-bound authority`

### Done When
- [ ] Existing finish-fence tests pass unmodified
- [ ] A finish-fence test with a post-rebase failing re-judgement asserts the exact outstanding-repair blocker string

## Story 3: The rebase operation record carries its preservation evidence

**Requirement:** ADR D1

As the engine, I want the rebase operation record to persist the evidence that justifies each
preservation so that an interrupted operation can be completed without losing earned preservation.

### Acceptance Criteria

#### Happy Path
- Given a file-changing rebase that preserves `build_review` and `prd_audit`, when the transition writer persists the `applying` descriptor, then that same write carries, for each preserved gate, its gate name, original judge identity, original verdict digest, and relevant input identities
- Given the descriptor above, when it is marked `applied`, then the persisted preservation evidence is retained and the record still validates as well formed

#### Negative Paths
- Given a rebase record written before this change (no persisted preservation evidence), when it is validated, then it is accepted as well formed
- Given a rebase record whose persisted preservation evidence names a gate set different from `transition.preserved`, when it is validated, then it is rejected as malformed
- Given a rebase record whose persisted preservation evidence is not a list or has an entry missing its verdict digest, when it is validated, then it is rejected as malformed
- Given a rebase that preserves no gates, when the `applying` descriptor is persisted, then its preservation evidence is empty and the record validates

### Done When
- [ ] `.pipeline/gates/rebase.json` from a preserving rebase contains one evidence entry per preserved gate with a `sha256` verdict digest
- [ ] Validator tests cover legacy (absent), matching, mismatched, and malformed evidence

## Story 4: Resume completes an interrupted rebase operation

**Requirement:** ADR D2

As the daemon resuming a feature whose rebase transition was interrupted, I want the recorded
transition re-applied so that the feature continues without operator intervention and keeps every
preservation still backed by unchanged evidence.

### Acceptance Criteria

#### Happy Path
- Given an `applying` rebase record with a full transition and persisted preservation evidence, where each preserved gate's current verdict matches its recorded digest, when the conductor resumes, then each preserved gate is stamped for that operation, each invalidated gate is `pending` with an unsatisfied verdict, the record becomes `applied` with an `appliedAt` stamp, and resume continues at the earliest unsatisfied gate
- Given the completion above has already happened, when the conductor resumes again, then the operation is not re-applied, no gate verdict changes, and no HALT is written

#### Negative Paths
- Given an `applying` record with persisted evidence where `prd_audit`'s current verdict no longer matches its recorded digest, when the conductor resumes, then `prd_audit` is not stamped as preserved, is absent from the completed operation's `transition.preserved`, is classified by the existing post-rebase rerun-or-reuse rules (re-verified when its completion check mechanically attests the current tree, otherwise `pending` with an unsatisfied verdict), and resume writes no rebase-fence HALT for it
- Given an `applying` record with persisted evidence where `test_suite` is preserved, its current verdict no longer matches its recorded digest, and its completion check mechanically re-verifies the current tree, when the conductor resumes, then `test_suite` is recorded in the completed operation's `transition.reverified` and is not re-dispatched
- Given an `applying` record whose completion is refused because conduct state for an invalidated gate changed concurrently, when the conductor resumes, then it writes a `needs-human` HALT stating the rebase transition was refused and dispatches no step
- Given an `applying` record with persisted evidence, when the conductor resumes, then no step is dispatched until the record is `applied`

### Done When
- [ ] A resume test from an interrupted full descriptor ends with `rebaseOperation.status = applied`, `appliedAt` set, and preserved gates carrying `preservation.operationId` equal to the operation id
- [ ] A changed-verdict fixture shows the gate absent from `transition.preserved` after completion and either in `transition.reverified` or `pending`, and resume writes no rebase-fence HALT
- [ ] A refused-completion fixture yields `.pipeline/HALT` class `needs-human` and no `step_started`

## Story 5: Interrupted operations without evidence complete by re-checking

**Requirement:** ADR D3

As the operator, I want interrupted operations that lack preservation evidence to complete by
re-checking gates so that recovery never keeps a pass it cannot prove.

### Acceptance Criteria

#### Happy Path
- Given an `applying` record with a full transition but no persisted preservation evidence, when the conductor resumes, then every gate in `invalidated` and `preserved` is `pending` with an unsatisfied verdict, none carries a preservation stamp, and the record becomes `applied` with an empty preserved set
- Given a provisional `applying` record (id beginning `preparing-`, empty transition), when the conductor resumes, then every gate downstream of `rebase` is `pending` with an unsatisfied verdict, none is preserved, and the record becomes `applied`

#### Negative Paths
- Given a provisional `applying` record, when completion runs, then no satisfied verdict written before the rebase survives as satisfied on any downstream gate
- Given an `applying` record without evidence whose completion is refused, when the conductor resumes, then it writes a `needs-human` HALT stating the rebase transition was refused and dispatches no step
- Given an `applying` record that fails structural validation for a reason other than missing evidence, when the conductor resumes, then it is not completed and resume writes a `needs-human` HALT stating the record is malformed

### Done When
- [ ] Fallback fixtures for no-evidence and provisional records end `applied` with an empty preserved set and every affected gate `pending`
- [ ] After completion the finish fence reports no applying blocker, and the verdict-aware resume clamp selects a re-checked gate before finish until those gates pass

## Story 6: Rebase-fence halts name the operator's pending decision

**Requirement:** ADR D6

As the operator reading a rebase-fence halt, I want it to name any pending or recorded over-scope
decision and the next action so that I am not left with a halt that points nowhere.

### Acceptance Criteria

#### Happy Path
- Given a resume that halts on a rebase integrity fault and `.pipeline/HALT.cleared` records `decision: accept` for NC.1, when the HALT is written, then its body includes the fault text, names NC.1 with recorded state `accept`, and names the next action for the fault
- Given a resume that halts on a rebase integrity fault and an over-scope offer for NC.1 with no recorded decision, when the HALT is written, then its body names NC.1 as awaiting a decision and names `ai-conductor halt clear` as the way to record it

#### Negative Paths
- Given a resume that halts on a rebase integrity fault and no over-scope offer or decision exists, when the HALT is written, then its body is the fault text alone, unchanged from today
- Given a resume that halts on a rebase integrity fault and `.pipeline/accepted-widenings.json` is unparseable, when the HALT is written, then the HALT is still written with the fault text and states that the recorded decision state could not be read
- Given a resume that halts on a rebase integrity fault while `.pipeline/HALT.cleared` exists, when the HALT is written, then `.pipeline/HALT.cleared` is byte-identical afterwards

### Done When
- [ ] Halt-text tests cover recorded-accept, recorded-refuse, pending, none, and unreadable decision state
- [ ] A test asserts `HALT.cleared` content is unchanged across a rebase-fence halt

## Story 7: The prd_audit verdict reason reports the reconciled classification

**Requirement:** Track scope item 3

As the operator reading `.pipeline/gates/prd_audit.json`, I want the blocking reason to reflect the
over-scope finding's reconciled state so that I am not told to repair something that is waiting on
my decision.

### Acceptance Criteria

#### Happy Path
- Given a prd_audit lap whose report grades NC.1 OVER_SCOPE for a new source that the lap's reconciliation offers as a decision case, when the gate verdict is persisted, then its reason contains `NC.1 (OVER_SCOPE)` with the awaiting-decision classification and directs the operator to record a decision, not `[missing-relation]`
- Given the same lap after an `accept` decision is recorded for that case, when the gate verdict is persisted on the next lap, then NC.1 is not listed as blocking

#### Negative Paths
- Given a prd_audit lap where reconciliation judges NC.1's relation `uncertain` or `different`, when the gate verdict is persisted, then its reason carries the `[uncertain-relation]` classification as today
- Given a prd_audit lap where the decision store is corrupt, when the gate verdict is persisted, then its reason carries `[corrupt-decision-store]` and the gate is unsatisfied
- Given a prd_audit lap with a FIXABLE criterion and no OVER_SCOPE finding, when the gate verdict is persisted, then its reason is the existing `close the gap (BUILD) or amend the PRD (DECIDE)` text

### Done When
- [ ] A test reproducing the #2983 ordering (offer reconciled in the same lap) asserts the persisted reason has no `[missing-relation]` and names the awaiting-decision state
- [ ] `gate_verdict` event reason matches the persisted gate file reason
