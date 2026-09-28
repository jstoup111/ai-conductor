# Track: Grade diffs for event-spine bypasses in build_review

Track: technical

Scope boundary: Balanced — every self-host build_review lap in this repository grades the frozen feature diff for new observation/coordination channels that bypass the event spine; findings block through the existing adjudicator. New `ConductorEvent` variants, same-schema sibling ledgers, the three documented exceptions, and channels backed by an approved ADR pass. Excluded: consumer projects (no spine exists there), a new built-in registry rubric, any mechanical pre-scan, and design-time checks at architecture-review.

Internal review tooling for this repository only; no user-facing behavior, so no PRD.
