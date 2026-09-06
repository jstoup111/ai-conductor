# Intake origin: render-build-review-rubric-events-in-the-daemon-lo

Source-Ref: jstoup111/ai-conductor#1592
Owner: jstoup111

## Desired outcome
- A running lap shows per-branch labeled progress (rubric name, provider/model, started/settled/cached/skipped) rather than undifferentiated provider lines.
- A settled lap renders per-rubric outcomes and findings as a readable list; judged-FAIL, neutral skip, and infrastructure-failure are distinguishable at a glance in the log.
- No raw JSON blobs in the human log stream; full structured data remains on the spine.
- Negative path: machine consumers (events.jsonl, dashboard) see no schema change from a rendering fix.
