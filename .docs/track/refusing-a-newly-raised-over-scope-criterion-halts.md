# Track: Refusing a newly raised OVER_SCOPE criterion halts as malformed-history

Track: technical

Scope boundary: both defect layers. (1) Over-scope decision capture records an explicit accept/refuse
on a story-numbered criterion even when the same cleared block also carries offer-bearing NC entries;
story-criterion decisions keep criterion-only scope (adr-2026-09-07 D1), and NC entries still require
their persisted offer. Capture scope is decided per entry in every current-format block, so an entry
left `pending` is inert, including in a block of only story criteria (operator-confirmed 2026-10-31).
(2) Every capture defect kind maps to its own recovery reason that names the
affected criterion; `malformed-history` is reported only for a genuinely malformed widening history; the stored-history
migration-failure mapping is made total in the same way (operator-confirmed 2026-10-31).
Excluded: persisting offers for story criteria (rejected Approach B), changes to NC semantic
reconciliation, the case-store schema, or classification projection, and the validation-group retry
count for a deterministic capture defect (operator-confirmed out of scope 2026-10-31).

Engine defect in PRD-widening decision capture and halt recovery messaging; no new product
capability. Source: intake jstoup111/ai-conductor#3548.
