# Intake origin: render-every-declared-render-event-in-inline-runs

Source-Ref: jstoup111/ai-conductor#2167
Owner: jstoup111

## Desired outcome
- Inline runs render the same `render: true` events the daemon path renders.
- The subscription list cannot silently drift from the event-sink declarations (a drift is caught mechanically).
