**Status:** Accepted

# Stories: A root node_modules symlink cannot break the testQuality preflight (#3317)

Track: technical

Tier: S

Approved by the operator on 2026-10-21 as a composer hotfix. Scope is the repository's ignore pattern for dependency trees and the order in which the testQuality preflight exposes the source worktree's dependency installation inside its counterfactual checkout. Wording of the preflight's materialization-failure halt is out of scope.

## Story 1: Keep a root dependency link out of the feature branch and the preflight's way

### Acceptance Criteria

#### Happy Path

- Given a feature worktree whose root holds an untracked `node_modules` symlink, when its status is checked or `git add -A` runs, then the symlink is ignored and is neither reported as uncommitted nor staged.
- Given a feature branch whose HEAD adds a tracked root `node_modules` symlink, when the testQuality preflight materializes its counterfactual checkout, then it restores the merge-base tree first, then links the source worktree's dependency installation at the checkout root and at `src/conductor/node_modules`, and the scoped selectors run.
- Given a feature branch that tracks no root dependency entry, when the testQuality preflight materializes its counterfactual checkout, then both dependency links resolve to the source worktree's installation as before.

#### Negative Paths

- Given a source worktree with no `src/conductor/node_modules` installation, when the preflight links dependencies, then it skips the links and leaves dependency resolution to the scoped command.
