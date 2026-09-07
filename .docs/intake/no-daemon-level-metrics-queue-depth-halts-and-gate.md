# Intake origin: no-daemon-level-metrics-queue-depth-halts-and-gate

Source-Ref: jstoup111/ai-conductor#1937
Owner: jstoup111

## Desired outcome

- Backlog state over time is observable as telemetry — how many features are eligible, blocked,
  gated and parked — without reading local files or running a CLI.
- Feature-level outcomes are observable as counts over time: features started, shipped, halted,
  and halted-by-class, so halt rate is chartable and alertable.
- Gate outcomes are observable per gate — pass, kickback, and their rates — so a gate's behavior
  can be compared across weeks and #1835's retirement decisions can rest on reported numbers.
- End-to-end feature duration is observable, not only per-step duration.
- A consumer can attribute all of the above to a project when several projects report to one
  backend.
- These signals appear for a daemon that is running normally, without a feature dispatch being
  required to produce them.
