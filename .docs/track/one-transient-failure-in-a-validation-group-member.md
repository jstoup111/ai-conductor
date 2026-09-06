# Track: One transient failure in a validation-group member discards its siblings

Track: technical

Scope boundary: Restore the ADR-conformant per-branch retry budget for validation-group
members AND retain completed sibling verdicts across a no-verdict group halt. Excluded:
any new observability event or halt-reason surface beyond what already exists, and any
change to the join policy itself (a no-verdict branch still halts the group, per
adr-2026-07-10-validation-group-join.md).

> **Amended 2026-09-06 by #1425:** the retry-budget half is delivered by #2190 (its accepted
> Story 1; PR #2206 already carries `resolved.max_retries`), found at conflict-check. This spec
> now delivers sibling retention only and is blocked by #2190; the budget is assumed present.

Internal engine retry/state semantics restoring an already-approved ADR contract
(adr-2026-07-10-concurrent-group-core.md D5); no user-facing product capability, so
acceptance criteria live directly in stories.
