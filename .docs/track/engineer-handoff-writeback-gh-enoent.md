# Track: engineer handoff write-back gh ENOENT fix

Track: technical

Internal conductor CLI/adapter bug fix (issue jstoup111/ai-conductor#290): write-back gh
spawn dies on a deleted-worktree cwd and the failure is advisory-and-forgotten. No
user-facing product behavior — acceptance criteria live in stories; no PRD.
