# Track: PRD audit no-owner OVER_SCOPE findings

Track: technical

Scope boundary: Full issue #1848 — (a) parse and route no-owner scope findings end-to-end
including operator accept/refuse, (b) reject duplicate criterion keys at parse, (c) per-row
rejection diagnostics instead of whole-report discard. Identity: report-scoped ordinal keys
with decisions bound to key + summary; a mismatch re-asks the operator rather than applying.

Engine/parser/acceptance-record contract change with a skill-shape parity fixture; no
product-facing capability, so acceptance criteria live in stories (no PRD).
