# Complexity: PRD audit no-owner OVER_SCOPE findings

Tier: M

Rationale: single-repo engine change across a bounded set of collaborating modules —
`parsePrdAuditReport` (artifacts.ts), `accepted-widenings.ts` (decision identity/matching),
the prd_audit gate route, and a skill-shape parity fixture. No new models, integrations,
auth, or state machines; but the parser/acceptance/gate contract spans multiple consumers
and needs conflict- and coherence-checking. Issue labeled size: M. Not S (multi-module
contract change with routing implications); not L (no new subsystem, ~1 day).
