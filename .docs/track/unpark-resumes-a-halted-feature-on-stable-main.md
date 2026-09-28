# Track: unpark-resumes-a-halted-feature-on-stable-main

Track: technical

Scope boundary: Minimal. Change only the output of `conduct daemon unpark <slug>`. When the
feature's worktree has a live `.pipeline/HALT`, unpark stops claiming "normal dispatch and re-kick
resume". It states that the feature will not resume until the HALT is cleared and prints the
recovery that matches `.pipeline/HALT.class`:
unclassified/legacy/`mechanical` get the clear command, `over-scope` gets the rename to
`HALT.cleared`, `kickback-cap` gets `kickback-budget`, and `needs-human`/`plan-gap` get "resolve
the cause, then clear" with the runbook link. The warning appears in both the unparked branch and
the "was not operator-parked — nothing to do" branch. Unpark stays park-only: it never clears,
renames, or rewrites a HALT, and it never triggers a re-kick or dispatch. Excluded: dashboard
remedy text, the auto-park HALT body, `cli.md`/runbook prose, status bucketing, and every re-kick
or dispatch path (`rekickSweep`, the FR-9 guard, `pickEligible`).

Intake #822's first desired outcome (unpark re-dispatches a halted feature on a stable main) is
deliberately declined. The operator chose to keep `.pipeline/HALT` as the only resume signal. The
stable-main path back to running already exists (clearing HALT wakes the daemon). This change makes
unpark name that path instead of promising a resume it cannot deliver.

## Rationale

Operator-facing CLI output of internal daemon tooling; no product requirement or new functional
surface. Acceptance criteria belong in stories → **technical track** (skip `/prd`).
