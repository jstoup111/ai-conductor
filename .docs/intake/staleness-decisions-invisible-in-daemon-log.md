# Intake origin: staleness-decisions-invisible-in-daemon-log

Source-Ref: jstoup111/ai-conductor#982
Owner: jstoup111

## Desired outcome

- Evidence found stale is invalidated on **first** detection rather than re-evaluated
- The behavior holds for every step whose completion check can reject on staleness, not
- Staleness that does not invalidate the verdict does not force a full re-run: a verdict
- Staleness that *does* invalidate the verdict — evidence computed over a materially
- When a step is rejected for staleness, the log distinguishes which of the two classes
- A run in which a step writes evidence and a later commit advances HEAD completes without
