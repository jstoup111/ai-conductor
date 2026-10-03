# Intake origin: a-feature-s-telemetry-fragments-into-disconnected-

Source-Ref: jstoup111/ai-conductor#2011
Owner: jstoup111

## Desired outcome

- All telemetry for one feature, across every dispatch and re-kick from first dispatch to ship, is capturable and viewable as one connected whole rather than trace by trace.
- Within that whole, individual dispatches remain distinguishable — their ordering, boundaries, and the gaps between them are visible, not merged into one undifferentiated run.
- Distinct features remain fully separate; a fresh feature never inherits or joins another feature's trace identity.
- Existing per-dispatch inspection (open a single run's trace and see its steps) still works.
