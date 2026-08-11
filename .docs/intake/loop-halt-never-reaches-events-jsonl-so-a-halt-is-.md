# Intake origin: loop-halt-never-reaches-events-jsonl-so-a-halt-is-

Source-Ref: jstoup111/ai-conductor#1477
Owner: jstoup111

## Desired outcome

- After a build halts, the halt and its cause are recoverable from `.pipeline/events.jsonl` alone, without consulting the audit trail or the daemon log.
- The recorded halt names the step that actually halted; halting in a step other than `build` is attributed to that step.
- `rebase_conflict_halt` is likewise recoverable from the spine.
- A halt-count over persisted events reports a non-zero count when halts have occurred.
- If the on-disk halt marker cannot be written, that failure is itself visible rather than silent.
- Non-halt event volume does not measurably grow — this should not become a firehose.
