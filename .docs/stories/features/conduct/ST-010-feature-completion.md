# Story: Feature Completion and Cleanup

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** conduct/SKILL.md

As a developer, I want the conductor to handle feature completion cleanly — committing final
artifacts, marking the feature done, and offering worktree cleanup.

## Acceptance Criteria

### Happy Path
- Given all steps complete successfully, when the conductor finishes, then it commits any
  uncommitted SHIP phase artifacts (.docs/retros/, manual-test results, etc.)
- Given a PR was created (finish chose Option 2), when the feature completes, then the PR
  URL is displayed and stored in state
- Given the feature is complete, when `feature_status` is set to `complete`, then the feature
  is excluded from `--resume` menus
- Given a completed feature's worktree exists, when `--cleanup` or the next `--resume` runs,
  then the conductor offers to remove the worktree and delete the branch

### Negative Paths
- Given the final artifact commit fails (e.g., nothing to commit), when the conductor handles
  it, then it continues without error — an empty commit is not created
- Given the PR creation fails during finish, when the error occurs, then the feature is NOT
  marked complete — the user can retry finish
- Given a worktree cleanup is offered but the user declines, when `--resume` runs again later,
  then the cleanup offer reappears

### Done When
- [ ] SHIP phase artifacts are committed automatically on completion
- [ ] PR URL is stored in state and displayed
- [ ] Complete features are excluded from --resume menus
- [ ] Worktree cleanup is offered on --resume and --cleanup
- [ ] Empty commits are not created
- [ ] Failed PR creation does not mark feature as complete
