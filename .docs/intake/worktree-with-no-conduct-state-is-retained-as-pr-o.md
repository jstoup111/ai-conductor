# Intake origin: worktree-with-no-conduct-state-is-retained-as-pr-o

Source-Ref: jstoup111/ai-conductor#1329
Owner: jstoup111

## Desired outcome

- A feature with no HALT, no park, an unpushed branch and no commits is dispatchable; it
- A worktree that has never initialised pipeline state is distinguishable, in the dashboard,
- A retained row's stated reason matches reality: a row claiming a PR is awaiting main only
- A genuinely shipped-and-retained worktree whose PR is open is still excluded from dispatch
- When a feature is excluded from dispatch for any reason, an operator can determine which
