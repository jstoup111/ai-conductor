**Status:** Accepted

# Stories: Engine-appended remediation tasks carry a valid Done-when block (#1802)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the two engine writers that append `rem-*` plan tasks, the checks they emit, and the land-time refusal message. The 2-5 criterion bound, remediation routing, plan-growth budgets, and the per-task evidence rule at task close remain outside this slice.

## Story 1: Every engine-appended remediation task carries a well-formed completion block

### Acceptance Criteria

#### Happy Path

- Given a remediation gap carrying a criterion and a parent task, when the engine appends its task block to a plan, then the land-time shape rule reports no violation for the appended task id.
- Given a remediation gap carrying only an id and a title, with no criterion and no governing clause, when the engine appends its task block to a plan, then the land-time shape rule reports no violation for the appended task id.
- Given a remediation gap carrying both a criterion with a parent task and a governing clause, when the engine renders its task block, then the block carries exactly one completion block and exactly one parent-task line, and both the criterion and the clause are restated as checks.

#### Negative Paths

- Given a gap whose criterion, clause, or rationale text spans several lines or carries surrounding blank space, when the engine renders its task block, then every emitted check is a single physical line and the land-time shape rule still reports no violation for that task.
- Given a gap whose optional criterion, parent task, clause, and rationale are all absent or blank, when the engine renders its task block, then it still emits at least two nonblank checks derived from the task id and title, and no check is blank.

### Done When

- [ ] Unit fixtures over both writers show each appended block carrying between two and five nonblank checks for criterion-bound, clause-bound, and bare id-and-title gaps.
- [ ] A combined criterion-and-clause fixture yields one completion block and one parent-task line.
- [ ] A multi-line and a fully blank optional-field fixture each yield only single-line nonblank checks.
- [ ] Re-appending an identical gap leaves the plan text byte-for-byte unchanged.

## Story 2: Hand-authored tasks that genuinely lack criteria are still refused by id

### Acceptance Criteria

#### Happy Path

- Given a plan whose hand-authored tasks each carry between two and five nonblank checks, when the spec is landed, then it lands with no shape refusal.

#### Negative Paths

- Given a hand-authored task with no completion block, when the spec is landed, then landing is refused, the refusal names that task id, and no commit is created.
- Given hand-authored tasks with one check, with a blank check, and with six checks, when the spec is landed, then landing is refused and each offending task id is named with its own reason.

### Done When

- [ ] The existing land refusal fixtures for a missing block and a too-few block continue to pass unchanged.
- [ ] A land fixture proves the worktree head is unmoved after a shape refusal.
- [ ] Blank-check and too-many-check fixtures each name their own task id and reason.

## Story 3: A shape violation on engine-written content reads as an engine defect

### Acceptance Criteria

#### Happy Path

- Given a plan whose only shape violation is on an engine-appended remediation task id, when landing is refused, then the refusal marks that task as engine-appended and tells the reader the engine wrote the block rather than the plan author.

#### Negative Paths

- Given a plan whose only shape violations are on hand-authored task ids, when landing is refused, then the refusal carries no engine-appended attribution for any named task.
- Given a plan carrying one engine-appended and one hand-authored violation, when landing is refused, then each named task carries its own attribution and neither attribution is applied to the other.

### Done When

- [ ] A land refusal fixture over an engine-appended task id contains the engine-appended attribution and the task id.
- [ ] A land refusal fixture over hand-authored ids only contains no engine-appended attribution.
- [ ] A mixed fixture shows both task ids with their respective attributions in one refusal message.

## Negative-category review

Malformed and degenerate gap input is covered by the multi-line and fully blank optional-field cases; the id grammar already rejects unaddressable ids and keeps that existing refusal. Idempotency is covered by the unchanged-on-re-append criterion, which also covers the repeated-remediation-round case. Attribution ambiguity is covered by the mixed engine and hand-authored refusal case. No new deletion, queue, datastore, network call, upload, credential, permission, or transaction is introduced, so those categories are inapplicable. Concurrency is unchanged: both writers keep their existing temp-file-and-rename replacement, which this slice does not touch. Existing coverage for the plan-growth allowance, remediation routing, and the per-task evidence rule at task close remains authoritative for those behaviors.
