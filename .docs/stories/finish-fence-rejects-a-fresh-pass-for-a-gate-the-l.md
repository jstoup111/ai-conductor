**Status:** Accepted

# Stories: Finish fence rejects a fresh PASS for a gate the last rebase preserved

Source: jstoup111/ai-conductor#2680. Technical track, Tier S. Scope boundary: the finish rebase-preservation fence
accepts a fresh re-judgement, plus one additive `appliedAt` stamp on the rebase operation record so
the comparison survives later rebase-verdict rewrites; no recovery CLI and no retirement of gates
from `transition.preserved`.

Terms used below: the *applied rebase record* is the persisted `rebase` gate verdict whose
`rebaseOperation.status` is `applied`; a *preserved gate* is any gate named in that operation's
`transition.preserved`; a *fresh re-judgement* is a preserved gate's persisted verdict that is
satisfied, carries no kickback, carries no preservation stamp, and has a `checkedAt` strictly newer
than the *applied-at time*: the operation's `appliedAt` stamp when present, otherwise the applied
rebase record's own `checkedAt` (legacy records written before the stamp existed).

## Story 1: A fresh satisfied re-judgement of a preserved gate passes the finish fence

As the daemon finishing a rebased feature, I want a preserved gate that was later re-run and passed to satisfy the publication fence so that finish does not halt on a gate whose newest evidence is already green.

### Acceptance Criteria

#### Happy Path
- Given an applied rebase record preserving `prd_audit`, and a `prd_audit` verdict that is satisfied, has no kickback, has no preservation stamp, and has `checkedAt` newer than the applied-at time, when the finish publication fence is evaluated, then it returns no blocker
- Given an applied rebase record preserving `build_review` and `prd_audit`, where `build_review` still carries its replay-bound preservation stamp for that operation and `prd_audit` is a fresh re-judgement, when the finish publication fence is evaluated, then it returns no blocker
- Given an applied rebase record with an `appliedAt` stamp preserving `prd_audit`, and a fresh re-judgement of `prd_audit`, when the rebase gate verdict is later rewritten with a newer `checkedAt` that retains the operation and the finish publication fence is evaluated, then it returns no blocker
- Given a rebase transition being committed by the transition writer, when the operation is marked `applied`, then the persisted `rebaseOperation` carries an `appliedAt` epoch-millisecond stamp and the operation still validates as a well-formed record
- Given an applied rebase record with no `appliedAt` stamp preserving `prd_audit`, and a `prd_audit` verdict that is satisfied, unstamped, has no kickback, and has `checkedAt` newer than the rebase gate verdict's `checkedAt`, when the finish publication fence is evaluated, then it returns no blocker

#### Negative Paths
- Given an applied rebase record preserving `prd_audit`, and a `prd_audit` verdict that is satisfied with no preservation stamp but whose `checkedAt` is older than or equal to the applied-at time, when the finish publication fence is evaluated, then it returns the blocker `rebase transition preserved prd_audit without its replay-bound authority`
- Given an applied rebase record preserving `prd_audit`, and a `prd_audit` verdict that is satisfied, newer than the applied-at time, has no preservation stamp, but carries a `kickback` record, when the finish publication fence is evaluated, then it returns the blocker `rebase transition preserved prd_audit without its replay-bound authority`

### Done When
- [ ] `rebaseOperationPublicationBlocker` returns `null` for a preserved gate whose persisted verdict is a fresh re-judgement, with a unit test in the gate-code-validity test file asserting it
- [ ] The finish completion predicate reports `done: true` (absent other missing evidence) when the only preserved gate is a fresh re-judgement, with a unit test asserting it
- [ ] Unit tests assert the blocker string is still returned for an unstamped satisfied verdict that is not newer than the applied-at time, and for one carrying a kickback

## Story 2: Unsatisfied or authority-less preserved gates still block finish

As the operator relying on the rebase fence, I want a preserved gate whose verdict is unsatisfied, or which lost its replay authority without a fresh re-judgement, to keep blocking finish so that an old PASS can never survive a replay unexamined.

### Acceptance Criteria

#### Happy Path
- Given an applied rebase record preserving `build_review`, and a `build_review` verdict that is unsatisfied, when the finish publication fence is evaluated, then it returns the blocker `rebase transition still has an outstanding build_review repair or re-verification`
- Given an applied rebase record preserving `build_review`, and a `build_review` verdict that is satisfied and stamped with a preservation record bound to a different operation id, when the finish publication fence is evaluated, then it returns the blocker `rebase transition preserved build_review without its replay-bound authority`

#### Negative Paths
- Given an applied rebase record preserving `build_review`, and no persisted `build_review` verdict file at all, when the finish publication fence is evaluated, then it returns the blocker `rebase transition still has an outstanding build_review repair or re-verification`
- Given an applied rebase record preserving `build_review`, and a `build_review` verdict that is satisfied, newer than the applied-at time, and stamped with a preservation record whose `gate` names a different step, when the finish publication fence is evaluated, then it returns the blocker `rebase transition preserved build_review without its replay-bound authority`

### Done When
- [ ] Unit tests assert each of the four scenarios above returns the named blocker string verbatim
- [ ] The `applying` status and malformed-record blockers are unchanged, with the existing tests for them still passing

## Story 3: A preserved gate that is not re-judged keeps its replay-bound authority

As the daemon, I want a preserved gate whose verdict still carries the preservation stamp for the applied operation to pass the fence unchanged so that no preserved review is forced into a re-run by this change.

### Acceptance Criteria

#### Happy Path
- Given an applied rebase record preserving `build_review`, and a `build_review` verdict that is satisfied and stamped with a preservation record whose `gate` is `build_review` and whose `operationId` equals the applied operation's id, when the finish publication fence is evaluated, then it returns no blocker
- Given that same stamped `build_review` verdict, when the finish-time validation-group recheck rewrites the verdict with replay preservation retained, then the rewritten verdict still carries the same preservation stamp and the finish publication fence still returns no blocker

#### Negative Paths
- Given an applied rebase record preserving `build_review`, and a stamped `build_review` verdict whose `checkedAt` is older than the applied-at time, when the finish publication fence is evaluated, then it returns no blocker, because the stamp alone is sufficient authority

### Done When
- [ ] Unit tests assert a correctly stamped preserved verdict returns `null` from `rebaseOperationPublicationBlocker` regardless of its `checkedAt` relative to the applied-at time
- [ ] A unit test asserts `computeAndWriteVerdict` with `retainReplayPreservation: true` on a satisfied stamped prior keeps the stamp and the fence still returns `null`
