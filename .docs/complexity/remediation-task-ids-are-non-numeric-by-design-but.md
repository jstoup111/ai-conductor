# Complexity: remediation-task-ids-are-non-numeric-by-design-but

Tier: M

Rationale: New shared reference-resolver seam plus refactor of prd_audit's Verdict Table
consumer (`planTask` moves from integer to H9 id, touching downstream consumers of the parsed
row), with a contract shaped for later adoption by #2054's ADR-decision consumer. More than a
local parser widening (S), but a single seam with bounded consumers — not L.
