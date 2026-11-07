# Track: Operator command to inspect and recover wedged routed rounds

Track: technical

Scope boundary: Outcome 3 of jstoup111/ai-conductor#3459 only. The feature adds a read-only
`ai-conductor stack rounds <slug>` inspection and one guarded write,
`ai-conductor stack rounds close <slug> <rN> --reason <text>`, which closes a superseded open routed
round that has no active host. Excluded: round admission fencing, reconciliation order, and the
stall HALT, which are outcomes 1, 2 and 4 owned by spec #3462 for #3445. Also excluded: abandoning
an active non-operator round and on-demand reconciliation.

Internal operator tooling over existing routing machinery. It carries no product requirements.
