# Complexity: Parked-feature reconciliation sweep (#1060)

Tier: M

Rationale: New daemon sweep module wired as an injected dep (startup + idle tick), a guarded single-slug cleanup helper shared with a new operator CLI verb, GitHub issue-state lookups via the tracker client, shipped-record auto-write, and a new dashboard category. Multiple integration seams (daemon loop, park-marker, shipped-record, dashboard, CLI dispatch) but no new models, auth, or external services beyond the existing `gh` capability. Matches the intake label `size: M`. Not Small (destructive git operations demand architecture review); not Large (no schema/provider surface, single repo, bounded story count).
