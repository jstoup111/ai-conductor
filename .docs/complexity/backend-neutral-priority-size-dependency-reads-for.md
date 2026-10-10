# Complexity: Backend-neutral priority/size/dependency reads for daemon backlog ordering (#851)

Tier: M

Rationale: Bounded engine refactor plus one new behavior — a new backend-neutral ordering port with
a GitHub implementation and a per-reference dispatch factory, six consumer sites rewired (daemon priority
and blocker resolvers, compose claim, index.ts, coherence-validator, monitor-cli), and Jira refs routed
to the existing `tracker_backend_unavailable` / `no-adapter` event. No new subsystem, no data
migration, no Jira transport; GitHub ordering behavior is preserved exactly.
