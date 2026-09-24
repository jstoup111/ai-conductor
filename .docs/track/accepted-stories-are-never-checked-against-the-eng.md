# Track: Accepted stories are never checked against the engine's own criterion extractor

Track: technical

Scope boundary: Reconcile the two story-criterion parsers onto one shared structural predicate and
enforce it at `engineer land` and at the daemon `stories` gate. Excludes: any migration, report, or
rewrite of the 93 zero-extraction / 101 drifting stories files already landed on main; excludes
widening the parser to accept bold pseudo-headings or multi-line Given/When/Then blocks beyond the
wrapped-continuation tolerance `listItems` already provides.

Internal engine validation and gate reconciliation — no user-facing product capability and no
product requirements, so acceptance criteria live directly in stories with no PRD.
