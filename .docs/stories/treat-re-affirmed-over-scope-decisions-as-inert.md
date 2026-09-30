**Status:** Accepted

# Stories: Treat re-affirmed over-scope decisions as inert (#2681)

Track: technical

Tier: S

Approved by the operator on 2026-09-28 (delegated). Scope is same-authority reaffirmation, invalid-decision reporting at PRD entry, and the over-scope HALT instruction. Genuine reversal semantics and reconciliation remain unchanged.

## Story 1: Re-affirming a prior over-scope decision keeps it in force

### Acceptance Criteria

#### Happy Path

- Given the latest decision for an over-scope case is refuse, when the operator clears its revise-decision entry naming that decision with decision refuse and a rationale, then the store returns the prior decision unchanged and appends no new revision.
- Given a cleared HALT re-affirms the latest decision's authority, when PRD entry prepares the audit, then it returns no halt and the stored decision history is unchanged.

#### Negative Paths

- Given a revise-decision entry names a decision that is not the latest one for its case, when it is appended with the same authority, then the store still rejects it as invalid-decision and the stored history is unchanged.

### Done When

- [ ] A store unit test proves a same-authority revision of the latest decision returns that decision and leaves the stored decision count unchanged.
- [ ] A conductor PRD entry integration test with the real stores proves a refuse reaffirmation yields no halt text and an unchanged decision inventory.
- [ ] A store unit test proves a same-authority revision naming a superseded decision is still rejected without writing.

## Story 2: An unapplicable operator decision is reported as invalid, not as a persistence failure

### Acceptance Criteria

#### Happy Path

- Given the decision store rejects a cleared entry as invalid-decision, when PRD entry prepares the audit, then the halt reason is invalid-decision, it names the entry's offer id, and its recovery text tells the operator to correct the entry or leave it pending to keep the prior decision.

#### Negative Paths

- Given the decision store fails an append with a lock, lease, or atomic-replace failure, when PRD entry prepares the audit, then the halt reason remains persistence-failed naming the entry.
- Given the decision store rejects a cleared entry as invalid-decision, when capture records the defect, then the rejection event reason is invalid-decision and never write-failed.

### Done When

- [ ] A capture unit test proves a store invalid-decision result becomes an invalid-decision defect with the offer id, and a store atomic-replace-failed result stays write-failed.
- [ ] A recovery unit test proves the invalid-decision recovery text names neither a store nor a lease failure.
- [ ] A conductor PRD entry integration test with the real stores proves a stale revision halts as invalid-decision naming the offer id.

## Story 3: The over-scope HALT explains how to keep a prior decision

### Acceptance Criteria

#### Happy Path

- Given a refused finding renders a revise-decision entry, when the over-scope decision block is rendered, then its instructions say that leaving decision as pending keeps the prior decision unchanged.

#### Negative Paths

- Given only undecided pending entries and no revise-decision entry are rendered, when the over-scope decision block is rendered, then the keep-prior instruction is absent.

### Done When

- [ ] A rendering unit test proves the keep-prior instruction appears with a revise-decision entry and is absent without one.

## Negative-category review

Stale or mismatched revision references cover input integrity and remain rejected. Lock, lease, and atomic-replace failures keep their persistence-failed classification, so genuine dependency failures stay distinguishable. Repeated reaffirmation is idempotent: it never appends a revision. The change deletes nothing, adds no queue, upload, datastore, or transaction, and grants no new authority, so those categories are inapplicable. Existing reversal coverage in the store tests remains authoritative for genuine supersession.
