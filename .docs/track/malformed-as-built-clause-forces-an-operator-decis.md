# Track: malformed-as-built-clause-forces-an-operator-decis

Track: technical

Scope boundary: minimal — the as-built governing-clause resolver collapses a dotted decision cite (`adr-x D5.2`, `adr-x decision 5.2`) to its whole decision, mirroring the ADR parser's existing collapse of dotted headings; the architecture-review skill contract states that whole-decision cites are preferred and that a dotted cite resolves to its whole decision. No new halt class, no mechanical-fault allowance for the as-built step, no change to DESIGN/unknown-ADR needs-human halts.

Engine resolver change plus skill contract text; no user-facing product behavior. Source: jstoup111/ai-conductor#2424.
