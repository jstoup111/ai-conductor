# Complexity: prd-audit-halts-on-a-stale-report-when-the-audit-d

Tier: M

Rationale: Engine-internal machinery change across three SHIP-tail gates (prd_audit,
architecture_review_as_built, manual_test) plus one skill contract and a post-dispatch
write handshake. No new external integrations, auth, or state machines; moderate story
count; matches the issue's `size: M` label.
