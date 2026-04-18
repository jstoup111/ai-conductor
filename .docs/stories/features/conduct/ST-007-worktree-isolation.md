# Story: Worktree Isolation Per Feature

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** conduct/SKILL.md

As a developer, I want each feature to get its own git worktree and branch so that feature
work is isolated from main and from other in-progress features.

## Acceptance Criteria

### Happy Path
- Given a new feature starts, when the worktree step runs, then a worktree is created in
  `.worktrees/<slug>` with a branch named `feature/<slugified-description>`
- Given the worktree exists, when subsequent steps run, then all commits happen in the
  worktree — the main repo working directory is not modified
- Given a feature's PR is merged, when `--resume` or `--cleanup` runs, then the conductor
  offers to remove the worktree, delete the local branch, and mark the feature complete
- Given multiple features are in progress, when `--resume` runs, then it shows a menu of
  active worktrees to choose from

### Negative Paths
- Given a worktree already exists for this branch, when the conductor tries to create it,
  then it detects the existing worktree and reuses it instead of failing
- Given the `.worktrees/` directory doesn't exist, when a worktree is created, then the
  directory is created automatically
- Given a worktree's branch has been deleted externally, when `--resume` tries to access it,
  then it reports the error and offers cleanup instead of crashing
- Given the slug generated from the feature description collides with an existing worktree,
  when creation is attempted, then a suffix is appended to make the name unique

### Done When
- [ ] Worktrees are created in `.worktrees/` with slugified branch names
- [ ] All feature commits are isolated in the worktree
- [ ] Merged PRs trigger cleanup offers on --resume
- [ ] --resume shows a menu of active features when multiple exist
- [ ] Worktree creation handles existing worktrees, missing directories, and name collisions
