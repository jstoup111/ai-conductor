# Track: Halt records committed on stacked child branches make every restack conflict

Track: technical

Scope boundary: restack-only. Every stacked restack replay path (plumbing replay and the provider-resolver fallback) treats halt-record bookkeeping mechanically, and the newest record wins. Halt records stay committed on the active child branch (build-region decision 11 is unchanged). Excluded: moving halt records off child branches, changing flat-feature halt-record behavior, and consolidating the existing halt-record-only tolerances in child-cursor, operator-round, restack-plan, restack-recovery and stack-commit-guard.

Internal restack-engine behavior with no user-facing product requirements; acceptance criteria live in stories. Operator confirmed 2026-10-28. Chosen approach: replay leaves halt-record-only commits out of its candidates, pins the halt-record path in mixed commits, and writes one bookkeeping commit carrying the newest record at the replayed tip when the tip's record differs. FR-9 treats the omitted commits as bookkeeping. "Newest" is decided by the record's own engine-written timestamps (`Resolved at:` when present, else `Halted at:`). Outcome 1 is read as: halt commits may still exist on the active child, but no restack conflicts on them or calls the resolver for them. Source: jstoup111/ai-conductor#3451.
