# Conflict check for #3685

**Verdict:** CLEAN after operator-approved handoff.

## Fallback edit when BUILD is owned by another child

**Type:** Sequencing conflict  
**Severity:** Resolved  
**Root:** The amended architecture separates the validation checkout from the repair destination.

Story 2 of #3685 requires automatic BUILD routing while preserving an uncommitted product edit. Story 1 of #3683 requires a tracked edit to stay in place and the next routed host entry to refuse it. The per-child build-region ADR requires the switch to refuse a dirty tree. If routing needs a different child, leaving the edit in place prevents the required switch. Conversely, treating all new files as residue before classifying them can send newly created source into quarantine alongside HTML reports.

**Confidence:** 99%, verified against the accepted criteria in manual-test-report-left-in-product-worktree-blocks.md and the dirty-tree switching rule in adr-2026-10-07-per-child-build-region.md. This is a conflict between story outcomes in the routed case. The dirty-switch guard itself can be preserved.

**Resolution and recheck:** Dispatch-owned fallback changes are captured and verified before cleanup, then delivered to the owning BUILD task. Repeated delivery is idempotent. The #3683 criteria now distinguish feature-worktree residue from fallback changes. Running the handoff leaves operator files in place. Applying the dirty-switch guard leaves the captured repair input intact. Neither order loses the edits or requires switching a dirty checkout.

## Other interactions

Story 1's warning permits dispatch while Story 2 still requires verification of the resulting code. Story 3 discards stale findings before repair routing and preserves sibling evidence only where it still applies after BUILD. Neither warning nor evidence-only writes justify a rebuild.
