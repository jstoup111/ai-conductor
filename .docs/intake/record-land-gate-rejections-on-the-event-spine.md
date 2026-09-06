# Intake origin: record-land-gate-rejections-on-the-event-spine

Source-Ref: jstoup111/ai-conductor#1628
Owner: jstoup111

## Desired outcome
- Every land-time gate rejection is recorded on the existing event spine (`ConductorEventEmitter` -> `.pipeline/events.jsonl`) with the gate name and rejection reason, observable by replaying the ledger.
- Per-gate rejection counts and reasons for a period are derivable from spine data alone, with no log-grepping.
- Design passes the event-spine skill's decision procedure (no parallel channel, no sidecar file).
