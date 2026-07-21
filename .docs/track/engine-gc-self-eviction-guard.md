# Track: engine-gc-self-eviction-guard

Track: technical

Internal correctness fix to the engine-version GC (`engine-store.ts` `gcVersions`) and the
daemon startup ordering (`daemon-cli.ts`). No user-facing capability and no product requirements,
so no PRD; acceptance criteria live directly in the stories. Scoped down from intake
`jstoup111/ai-conductor#673` — the auto-restart supervisor and durable crash-capture outcomes in
that issue were deliberately excluded (host-crash-moot / separately scoped); only the confirmed,
host-crash-independent GC self-eviction bug is in scope.
