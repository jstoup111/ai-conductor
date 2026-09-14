# Intake origin: prime-priority-labels-when-the-resolver-cache-is-c

Source-Ref: jstoup111/ai-conductor#2158
Owner: jstoup111

## Desired outcome
- After a daemon restart with a non-empty backlog, labeled priorities determine dispatch order.
- When label data is unavailable, dashboards/logs say so (fallback mode) instead of presenting banded ordering.
