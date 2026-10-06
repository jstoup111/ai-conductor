# Track: over-scope-refusal-should-route-to-build-rework-in

Track: technical

Scope boundary: Balanced. A durable operator `refuse` on an outside-visible OVER_SCOPE finding
routes to BUILD through the existing `planRemediation` path. The engine supplies refusal
evidence: criterion/NC key, decision id and rationale, and the original source snapshot. The
lap budget is `prd_audit.max_remediation_laps` and remediation tasks use `rem-prd-audit-*`.
The feature HALTs only once that cap is spent. Includes an additive amendment to
adr-2026-08-24 D6. Accept is unchanged. Pending (undecided) findings still halt and keep the
prior decision; if pending and refused findings both block, the feature halts as it does
today. Excluded: automatic recovery of features already stuck in a refused re-halt (operator
re-clears), new status or CLI surfaces for the refusal lap budget, and any mechanical commit
revert.

Engine-internal SHIP routing change with no new user-facing capability; acceptance criteria
live in stories (intake jstoup111/ai-conductor#2931).
