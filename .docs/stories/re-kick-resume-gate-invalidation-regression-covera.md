**Status:** Accepted

# Stories: Re-kick resume gate invalidation regression coverage

Source: jstoup111/ai-conductor#2046. Technical coverage of already-delivered telemetry, authorized by the operator's 2026-09-05 batch-spec request.

## Story 1: Resume gate telemetry cannot disappear without a regression failure

**Requirement:** #2046 desired outcomes 1–4.

As an operator, I want regression coverage of gate decisions on a real daemon resume rebase so that losing those events is detected before release.

### Acceptance Criteria

#### Happy Path

- H1: Given a feature with its own committed runtime file and a foreign runtime change on the local base, with manual testing applicable, when the daemon resume path rebases the feature, then the observed invalidation events include exactly the delta-invalidated gates and their justifying changed paths.
- H2: Given the same resume, when feature-scoped judged gates are preserved, then each preserved gate has one event carrying its declared surface and considered delta; existing drift-budget preservation coverage continues to prove its explicit preservation basis.
- H3: Given a gate that resume successfully re-verifies mechanically, when the same file-changing rebase completes, then its `rebase_gate_reverified` record remains observable alongside the invalidation and preservation records.

#### Negative Paths

- N1: Given the regression tests and a temporary omission of only the resume path's gate-invalidation emission, when the scoped tests run, then the new event assertions fail for missing events; restoring that emission restores the passing result.
- N2: Given that `build` succeeds through mechanical re-verification, when events are collected, then it appears as reverified rather than as a fabricated judged-gate invalidation or preservation. No duplicate or contradictory gate classifications are accepted by the event assertions.

### Done When

- [ ] A direct `resumeRebaseFirst` test using a real local file-changing Git rebase asserts the named invalidated and preserved gate sets, payloads, and a mechanical re-verification record.
- [ ] Existing budget-preserved and fingerprint-reverified `test_suite` tests continue passing without weakening their assertions.
- [ ] A recorded mutation check proves that omitting the resume emission fails the new event assertions and restoring it passes; no production mutation remains in the deliverable.

### Coverage disposition and scope

All H1–H3 and N1–N2 map to plan Task 1. The lowest sufficient layer is integration coverage inside the existing daemon-rekick test module: real local Git, real resume orchestration/classification/emission, controlled verifier boundary, no full Conductor run and no third-party services. Existing budget-specific tests are reused, not duplicated. Every criterion is diff-local to the added regression proof; no assertion requires unrelated work to complete.

Negative categories reviewed: event loss, duplicate/contradictory classifications, and bypass of an existing re-verification side effect apply. New auth, network, concurrency, input-validation, resource-exhaustion, deletion, and exception-hierarchy behavior are absent from this test-only scope. Tests retain the fixture's awaited cleanup and isolated temporary repositories.

Status: Accepted
