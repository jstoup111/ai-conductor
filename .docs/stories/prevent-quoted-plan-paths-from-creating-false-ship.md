**Status:** Accepted

# Stories: Correct shipment association for PR checks (#1461)

Track: technical

Tier: S

Approved by the operator on 2026-09-06. Scope is the required premerge check, automatic declaration maintenance, diagnostics, and body-edit events. Historical audit and reconciliation policy remain outside this slice.

## Story 1: Bind declared implementations without mistaking discussion for ownership

### Acceptance Criteria

#### Happy Path

- Given an implementation PR declares exactly one existing plan and has valid shipment evidence, when the required check runs, then it succeeds for that plan.
- Given an undeclared PR mentions plan paths in prose, quotations, or code blocks, when the required check runs, then it succeeds as not applicable without requiring a shipment record.

#### Negative Paths

- Given a declared implementation has missing or invalid shipment evidence, when the required check runs, then it fails with the existing evidence refusal.

### Done When

- [ ] CLI fixtures distinguish a valid declaration from prose, blockquotes, fenced code, indented code, and HTML comments.
- [ ] A real-verifier CLI fixture returns nonzero for a declared implementation with no shipped record.

## Story 2: Preserve automatic binding and explain the decision

### Acceptance Criteria

#### Happy Path

- Given an engine publication has one resolved shipment identity, when it maintains the implementation PR for completion, then the PR carries one explicit declaration for that identity and a repeated maintenance pass preserves the body without another edit.
- Given a check binds an implementation to a plan, when it reports success or refusal, then the output names the plan and the declaration basis.

#### Negative Paths

- Given multiple distinct existing plans are declared, when the check classifies the PR, then it reports an ambiguous not-applicable result without selecting a plan.
- Given publication cannot resolve one plan or cannot read or write the PR declaration, when it maintains the implementation PR for completion, then that publication effect fails without recording successful completion.

### Done When

- [ ] A production publication fixture observes one canonical declaration at the GitHub edit boundary and no second edit for identical input.
- [ ] CLI output fixtures contain the selected plan and declaration basis, and ambiguous input never reaches the verifier.
- [ ] Injected identity and GitHub failures prevent successful outcome recording.

## Story 3: Recheck corrected PR bodies

### Acceptance Criteria

#### Happy Path

- Given a PR body is corrected, when GitHub emits the edited event, then the required check runs against that event body and exact commit identity without requiring a push or reopen.

#### Negative Paths

- Given the event lacks its PR URL or base or head commit identity, when the check runs, then it returns an error rather than a successful shipment verdict.

### Done When

- [ ] The parsed workflow configuration includes edited and retains the shipped-record job and immutable event-head checkout.
- [ ] Two event fixtures for the same head show the corrected body changes the association verdict.
- [ ] Missing URL/base/head fixtures return nonzero.

## Negative-category review

Invalid/ambiguous declarations and missing event identity cover input integrity. Publication GitHub read/write failures cover permission, network, and dependency failures. Repeated publication covers idempotency; each event keeps its own immutable identity. The check remains read-only. No new deletion, queue, datastore, upload, or transaction is introduced; those categories are inapplicable. Existing evidence-verifier refusal coverage remains authoritative for record integrity.
