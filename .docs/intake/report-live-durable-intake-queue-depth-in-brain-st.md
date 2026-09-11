# Intake origin: report-live-durable-intake-queue-depth-in-brain-st

Source-Ref: jstoup111/ai-conductor#1132
Owner: jstoup111

## Desired outcome
- `brain status` reports current durable queue state rather than the size of a prior notification batch.
- Pending, claimed/in-flight, and unhealthy/stranded counts are distinguishable.
- An empty poll does not leave a stale value presented as current queue depth.
