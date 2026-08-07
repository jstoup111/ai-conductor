# Intake origin: automatic-park-outcome-writes-no-park-marker-so-an

Source-Ref: jstoup111/ai-conductor#1328
Owner: jstoup111

## Desired outcome

- After an error triage resolves to `park`, a park marker for that slug exists on disk, and the
  next backlog scan does not list the slug as dispatchable.
- Whenever a HALT body claims the feature is "parked for human inspection", that claim is true of
  the state on disk at that moment.
- The reconciliation line reports the park that was just performed instead of `parked=0`.
- A feature that errors but is not meant to be parked still dispatches normally on the next scan.
- No feature can consume more than one automatic fix-session for the same unresolved setup failure
  without operator action.
