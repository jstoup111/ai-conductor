# Intake origin: restore-per-member-telemetry-for-validation-groups

Source-Ref: jstoup111/ai-conductor#2414
Owner: jstoup111

## Desired outcome

- A step dispatched through the auto-mode validation fan-out produces the same duration observation as the same step dispatched serially: it appears in `conductor_step_duration_milliseconds_*` with its own step attribute.
- The duration recorded for a fan-out member reflects that member's own wall clock, not the whole group's.
- Each fan-out member produces a step span in the trace, attributable to that member.
- A step that runs serially is unchanged — no double-counted duration observation when a group degrades to width-1 (that path already skips the fan-out ceremony deliberately).
- Adding a step to a built-in group cannot silently drop its telemetry: the omission is caught mechanically rather than discovered from an empty dashboard panel.
