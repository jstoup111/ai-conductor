# Conflict Check: Interrupted intake claim still strands high-priority issues (#2733)

**Date:** 2026-10-02
**ADR corpus:** repo_wide
**Result:** PASSED — 2 blocking conflicts found and resolved; 0 degrading accepted.

**ADRs examined (subject overlaps intake claim):** adr-011-async-intake-queue-and-github-source, adr-012-durable-intake-ledger-sole-dedup-authority, adr-2026-07-04-claim-time-delivery-evidence-guard, adr-2026-07-10-intake-claim-priority-banding, adr-2026-07-21-intake-only-enforcement, adr-2026-07-22-heartbeat-lease-deferred, adr-2026-07-22-requeue-claimed-distinct-from-reopen, adr-2026-07-22-attempts-counter-on-crash-recovery, adr-2026-07-22-stale-claim-staleness-window-default, adr-2026-07-22-intake-closed-issue-reconciliation, adr-2026-07-22-canonical-tagged-source-ref, adr-2026-08-12-fail-closed-intake-ledger-durability, adr-2026-09-06-inbound-intake-trust-boundary.
**Narrowed out (keyword hit, no claim-walk subject):** adr-2026-08-21-review-bound-by-plan-done-when-criteria, adr-2026-07-23-commit-movement-liveness-floor.

**Stories examined:** 2026-07-10-priority-banded-intake-claim, engineer-claim-delivery-guard, engineer-unclaim-requeue-verb-stale-claimed-ledger, intake-claim-closed-issue-guard-and-brain-sweep, harden-intake-ledger-durability, intake-only-enforcement, phase-9.3b-github-intake-writeback, engineer-cli-subcommand-help-executes-the-command, github-issue-text-reaches-an-autonomous-build-with, spec-authoring-is-blind-to-unmerged-dependent-work.

## Conflict: Concurrent claim reports empty vs waits for the claim lease

**Stories involved:** Priority-banded intake claim Story 4 vs Story 2 (Overlapping claims never walk the same envelopes)
**Files:** [.docs/stories/2026-07-10-priority-banded-intake-claim.md] vs [.docs/stories/interrupted-intake-claim-still-strands-high-priori.md]
**Type:** contradiction
**Severity:** blocking

**Description:** The banded story asserts a concurrent second claim reports `empty` during the first claim's hold; the new design makes the second claim wait for the claim lease (bounded) or fail "claim in progress". Both cannot hold.

**Resolution Options:**
1. Replace the banded story's criterion in place to state the second claim waits for the claim lease and never reports `empty` because of the first claim's hold.
2. Keep the hold-window `empty` behavior by making the second claim skip the lease — reintroduces unguarded walks and the double-handout risk.

**Recommendation / Resolution (operator-approved):** Option 1. The in-place story replacement ships as a companion main-based PR because the land stem gate rejects foreign-stem story edits on this spec branch.

## Conflict: Never-handed-out-twice wording vs accepted duplicate-processing window

**Stories involved:** Story 2 title and Story 3 negative path 1 vs ADR: heartbeat lease deferred
**Files:** [.docs/stories/interrupted-intake-claim-still-strands-high-priori.md] vs [.docs/decisions/adr-2026-07-22-heartbeat-lease-deferred.md]
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-07-22-heartbeat-lease-deferred
**Story ID:** Story 3
**ADR opposing sentence (verbatim):** "Record the duplicate-processing window as a **known, bounded, accepted** residual risk."
**Story opposing sentence (verbatim):** "Given a claimed envelope whose ledger entry is `claimed` (a session already holds it), when the operator runs `compose claim`, then that envelope is not recovered and the entry is not handed out again"

**Description:** The existing stale-claim reap legitimately requeues a `claimed` entry past its window (the accepted #243 residual risk). The story's absolute "not handed out again" (and Story 2's "never handed out twice" title) would require closing that window, which the claim-walk lease does not do.

**Resolution Options:**
1. Narrow the story wording to strand reconciliation only and state stale-claim reaping is unchanged; retitle Story 2; add a scope sentence to ADR-011 decision 6 that this is not the #243 session lease.
2. Expand scope to a session heartbeat lease — outside the operator-confirmed minimal scope.

**Recommendation / Resolution (operator-approved):** Option 1, applied in place.

## Re-check

Re-run after resolutions: zero blocking, zero degrading. Pairs checked in both directions for the lease (vs ledger lease Story 6, delivery-guard ENOENT race, phase-9.3b single-winner claim, stale-claim reap Story 8, requeue verbs) — each holds when the other is fully satisfied.
