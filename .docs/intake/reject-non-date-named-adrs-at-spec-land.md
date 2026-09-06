# Intake origin: reject-non-date-named-adrs-at-spec-land

Source-Ref: jstoup111/ai-conductor#705
Owner: jstoup111

## Desired outcome
A deterministic gate rejects any `.docs/decisions/adr-*.md` whose name is not `adr-YYYY-MM-DD-<slug>`, so a number-named ADR cannot merge — caught at the moment of the mistake, not in review. (Existing numbered legacy references like `ADR-008` in prose are not filenames and are out of scope; the check is on `.docs/decisions/` filenames only.)
