# Intake origin: let-an-operator-park-settle-without-a-needs-human-

Source-Ref: jstoup111/ai-conductor#1803
Owner: jstoup111

## Desired outcome
- A park that settles cleanly at a step boundary ends the loop with a park verdict; no `needs-human`
  HALT is written for it.
- Unparking such a feature returns it to normal dispatch with no leftover marker for an operator to
  delete by hand.
- A genuinely markerless abnormal exit — one with no operator park boundary behind it — still writes
  the `needs-human` HALT with its current wording, and is still refused for re-kick.
- While a feature is held by a halt after unpark, that state is visible in `conduct-ts daemon status`
  rather than reported as neither gated nor blocked.
