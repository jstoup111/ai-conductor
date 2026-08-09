# BUILD post-task tail telemetry baseline

Generated on 2026-08-09 with the Task 16 `build-tail` command over the retained
worktree corpus. Each ledger was rendered twice without changes; every pair of
outputs was byte-identical.

```text
Corpus result: 6 measured, 2 partial, 1 unavailable
Measured windows: 23 (first-pass=5, re-entry=18)
Task execution: 8973613ms across 5 windows
Post-resolution ticks: remediation=0, closeout=40
Closeout: 0ms recorded across 0 windows
Obligations: unrecorded
```

## Coverage

- Corpus inspected: 9 retained worktree `.pipeline/events.jsonl` ledgers.
- Measured coverage: 6 ledgers yielded 23 windows. Two ledgers are `partial`
  (and therefore excluded from the measured totals); one contains no completed
  build window and is `unavailable`.
- Unrecorded closeout coverage: every measured window (23 of 23) reports
  `unrecorded`. No `pipeline-events.jsonl` sibling ledger or `pipeline_closeout`
  event exists in the corpus, so no obligation duration is recorded. The reader
  does not invent an obligation name for an absent event.

The historical corpus predates closeout events. Its ISO timestamps are normalized
by the rollup reader before this baseline is computed.
