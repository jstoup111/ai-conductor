# Complexity: one line-shape rule for daemon log indentation (#2367)

Tier: S

Rationale: the signal table puts every signal in Small. There are no data models or tables, no
external integration, no auth, and no state machine, and the work has three stories. No schema,
CLI flag, hook, settings key, event type, or persisted record changes. Only the rendered text of
`.daemon/daemon.log` and the live console changes. Nothing in the repository parses a daemon.log
line body: `conduct daemon logs` and the `daemon status` last-activity column print lines verbatim
(`daemon-observe-cli.ts` `tailDaemonLog` callers).

The diff is broad but mechanical. One new engine module declares the depth of each rendered event
type in a typed table checked against the sink registry, and owns the single line composer. The two
existing loggers in `engine/daemon-log.ts` and the console tee call that composer. The renderer arms
in `daemon-cli.ts` stop writing their own `·` marker and leading spaces. The plan states the rule as
one invariant enforced by one test over every type in `renderedEventTypes()`, not as a list of
renderer sites, so it cannot grow lap by lap the way #3078 did (#3230).

Per the tier rules, architecture-diagram, architecture-review, conflict-check, coherence-check, and
plan-review are skipped. Assessed under operator-delegated DECIDE acceptance, 2026-10-28.
