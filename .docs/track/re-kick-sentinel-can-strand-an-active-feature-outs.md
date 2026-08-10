# Track: Re-kick sentinel can strand an active feature outside recovery

Track: technical

Internal daemon observability change: a worktree carrying `.pipeline/REKICK` with no live HALT is
reported with its named blocking discovery gate instead of appearing as IN-PROGRESS. No
user-facing product capability, so acceptance criteria live directly in the stories.
