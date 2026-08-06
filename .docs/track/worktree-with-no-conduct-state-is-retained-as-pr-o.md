# Track: Worktree with no conduct-state is retained as pr-open-awaiting-main and never dispatched

Track: technical

Daemon operator-surface correctness: the startup/status dashboard misclassifies a
never-started worktree as a retained ship and asserts an unverified `pr-open-awaiting-main`
reason, and an errored dispatch can leave a feature excluded with no operator-clearable
marker. No user-facing product capability is added — acceptance criteria live directly in
the stories.
