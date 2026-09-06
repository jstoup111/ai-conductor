# Intake origin: render-kickback-and-build-re-entry-counts-in-condu

Source-Ref: jstoup111/ai-conductor#2252
Owner: jstoup111

## Desired outcome
- A feature's report states how many times BUILD was re-entered and which gates re-opened
  it, without the reader grepping the ledger.
- Kickback counts are attributed per source gate, so a feature re-opened once by three
  gates is distinguishable from one re-opened three times by one gate.
- A feature that never kicked back reports that explicitly rather than omitting the
  section, so absence of kickbacks is distinguishable from absence of reporting.
- Negative path: the report remains derived solely from `events.jsonl` and adds no new
  telemetry channel, file, or side-writing.
