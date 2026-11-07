Waives: outcome-2, outcome-4

Rationale: jstoup111/ai-conductor#1988 is roadmap slice 2 of
`adr-2026-10-07-conductor-decomposition-target-architecture` (D7). The operator confirmed the scope
on 2026-10-24: build the D5 ratchet only. Neither outcome is dropped, and each has a named home:

- **outcome-2** (the two #1017 violations are gone and cannot be reintroduced): removing them is
  slice 3, the spec `break-the-engine-ui-import-cycle-and-stop-types-im` already on main for
  jstoup111/ai-conductor#1017, which depends on this ratchet. Once slice 3 removes them, this spec's
  ratchet and its stale-entry rule keep them from being reintroduced.
- **outcome-4** (the module-map documentation cannot silently drift): the operator removed the
  `docs/contributing/code-organization.md` edit and the doc-consistency check from this spec. The
  repository's `maintain-documentation` pre-finish gate owns the module-map refresh, and it reviews
  documentation impact on every implementation change.
