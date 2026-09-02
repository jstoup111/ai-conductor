# Track: reaped-stale-claim-jstoup111-ai-conductor-2054

Track: technical

Scope boundary: Approach A — shared ADR-decision parser as the single authority, land-time citability gate for new/edited APPROVED ADRs, template updated to name accepted forms. No corpus migration of existing sealed ADRs; the two headingless-Decision ADR cases are handled by explicit recognition or targeted fix, not a sweep.

Internal parser/gate machinery (issue #2054); no user-facing product behavior, so no PRD.

Operator constraint (2026-09-02): backwards compatible — the shared parser accepts every shape the current resolver accepts (strict superset, no narrowing); the land-time citability gate applies only to ADRs added or edited in the spec's own diff, never the existing corpus.
