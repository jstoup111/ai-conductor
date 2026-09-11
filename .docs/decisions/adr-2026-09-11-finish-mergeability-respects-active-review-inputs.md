# ADR: Finish mergeability must respect active review inputs

**Date:** 2026-09-11
**Status:** APPROVED
**Deciders:** James Stoup (operator), Codex operator session
**Supersedes:** `adr-2026-07-30-finish-only-mergeability-gate`
**Source-Ref:** jstoup111/ai-conductor#2211

## Context

The preceding decision lets normal finish preserve review verdicts when the feature branch can merge cleanly with the advanced base. A conflict-free text merge does not establish that a verdict still applies when the base changed the active feature's stories, PRD, plan, or coherence inputs.

The operator approved document-aware invalidation on 2026-09-10 and reaffirmed it on 2026-09-11: update the branch and rerun only affected reviews when their active inputs changed. The implementation already contains this exception, but it incorrectly rewrote the approved predecessor's decision 5. This ADR records the approved policy through supersession; the predecessor's decision text is restored for history.

## Decision

1. Preserve the distinction between normal finish and re-kick. At normal finish, preserve the active/incomplete-rebase guard and the already-current no-op. Resolve the current default/base target; if the branch is behind, assess the prospective merge without changing refs, index, worktree, or history.
2. At normal finish, a clean prospective merge may return mergeable-skip and preserve downstream verdicts only when the advanced base has not changed a resolved input document of an active judged review. This retains the avoidance of unnecessary rebase-only evidence translation and protected-seal rebaselining for unaffected branches.
3. When the advanced base changes the active feature's stories, PRD, plan, or coherence inputs used by a judged review, enter the existing rebase flow even if the prospective merge is clean. Use the existing scoped input resolution and gate projection to invalidate and rerun only affected reviews. Unrelated feature documents do not trigger this exception. A document-only change does not itself invalidate BUILD or aggregate test proof.
4. Conflicting or indeterminate prospective merges enter the existing rebase and bounded conflict-resolution flow. Both clean rebases and conflict-resolution recovery use the same relevant-document invalidation policy. Existing code/test invalidation, drift-budget, evidence, protected-seal, and HALT behavior remains in force.
5. Re-kick retains mandatory play-forward rebase onto the advanced base before retrying its gate and cannot take mergeable-skip. It continues to share the existing rebase driver, conflict resolver, verdict, evidence-translation, protected-seal, and HALT machinery with finish.
6. Keep the existing lifecycle step name and placement. Normal finish requires the branch to be current or prospectively mergeable without unresolved changes to active review inputs; publication still requires current passing evidence. Re-kick retains the rebased-onto-advanced-base contract.
7. Coverage binding remains non-tree-attesting under `adr-2026-08-31-coverage-binding-judge-step`. This decision does not introduce a durable coverage resume-validity stamp or authorize a test-only validity branch. The existing post-rebase classification owns invalidation for its active input surface.

## Consequences

- Reviews follow the requirements they actually judged, rather than treating a clean merge as proof that old approvals remain current.
- Relevant document changes can add affected-review work at finish. Unrelated document changes preserve the existing skip, and document-only changes do not cause BUILD or full-suite reruns.
- No new provider dispatch category, retry policy, event channel, store, or configuration is introduced. The existing review and rebase paths implement the policy.
- The predecessor is superseded as a whole; decisions 1, 4, 5, and 6 above carry forward its unaffected finish/re-kick contract.

## Verification

Existing plan Tasks 1–4 own scoped document projection and the real local-Git proofs for relevant, unrelated, and conflict-resolved input changes. The repair task added for AB-2 removes the unreachable coverage resume-validity branch. The engine's configured verification and as-built review must pass before shipment.

## Verify-Claims Ledger

- [verified] The predecessor's original decision 5 unconditionally preserved downstream verdicts after a clean prospective merge; checked against the feature merge base.
- [verified] The current as-built report identifies production callers for active-input resolution and both finish and re-kick invalidation, and separately identifies the uncalled coverage-validity branch.
- Confirmed decision: operator approved this behavior again on 2026-09-11 after reviewing the old/new policy. No pending assumptions; this record does not claim new test execution.
