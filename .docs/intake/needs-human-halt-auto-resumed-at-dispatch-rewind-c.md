# Intake origin: needs-human-halt-auto-resumed-at-dispatch-rewind-c

Source-Ref: jstoup111/ai-conductor#2132
Owner: jstoup111

## Desired outcome

- A `needs-human` HALT is never cleared or re-dispatched by any daemon sweep or resume path without an explicit, auditable operator action — confirmable by grepping `.pipeline/events.jsonl`/`.daemon/daemon.log` for an operator-attributed event immediately preceding any resume of a `needs-human`-halted feature.
- When a `remediate`-originated needs-human halt has been resolved by an operator (plan amended, committed, resealed), there is a documented command that clears the halt and resumes `build`, even in the state where `last_step` has already reverted to `build` itself (i.e., regardless of whether the auto-resume bug above has also been fixed — this should hold defensively either way).
- (negative path) `rewind`'s existing guard against targeting a *later*-than-appropriate step, or a step with real downstream gate verdicts to invalidate, is unchanged — this should not loosen protection for the ordinary case, only cover the build-halted-in-place case.
