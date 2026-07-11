# Complexity: Issues close on first production observation of the fixed behavior — not on merge

Tier: M

## Rationale

- **State machine:** each watch entry has a lifecycle (enrolled/awaiting-merge → watching →
  closed-on-observation | no-show-flagged | pruned-on-PR-close) persisted across daemon restarts
  in `.daemon/observation-watch.jsonl` — more than a one-shot fix, less than a cross-service flow.
- **Integration points (4):** spec-time committed artifact (`.docs/observation/<plan-stem>.md`) +
  its land-gate enforcement; the ship-time trailer-injection site (`daemon-cli.ts` — `Closes` vs
  `Refs` becomes conditional); a new sweep wired into `sweepBestEffort`; GitHub via `gh`
  (issue close/comment/label).
- **Not L:** single subsystem (daemon post-ship lifecycle), direct in-repo precedent
  (mergeable-watch registry + sweep), no new models, auth, external services, or schema
  migrations; story count expected ~5–7.
- **Not S:** touches the close semantics of every future fix, needs negative-path coverage
  (no-show window, PR closed unmerged, malformed signature, log rotation) and a
  conflict-check against the intake/write-back and evidence machinery.
