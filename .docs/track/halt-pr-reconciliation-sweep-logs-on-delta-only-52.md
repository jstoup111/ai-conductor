# Track: Halt-PR reconciliation sweep logs on delta only

Track: technical

Engine-internal logging change to the daemon's halt-PR reconciliation sweep
(`src/conductor/src/engine/halt-pr-reconciliation.ts` + its single caller in
`daemon-cli.ts`). No user-facing product behavior, no CLI/hook/schema surface,
no change to the sweep's healing actions — only which log lines the sweep emits.
Acceptance criteria live in stories. Source: jstoup111/ai-conductor#521
(quantified: 42% of a day's daemon.log was no-op sweep spam). Operator-confirmed
2026-07-11.
