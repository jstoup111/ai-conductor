**Status:** Accepted

# Stories: install paths never wait on npm's automatic audit (#3344)

Track: technical (no PRD — acceptance criteria live here). Tier: S (hotfix).
Source: jstoup111/ai-conductor#3344. Operator decision recorded on the issue: the
vulnerability check is report-only via Dependabot, delivered separately; this
story covers only the install-path stall.

## Story: bin/install and bin/setup install without audit or funding lookups

**Requirement:** #3344 desired outcome 1

As an operator, I want `bin/install` and per-worktree `bin/setup` to depend only on
fetching and building packages so that neither can stall on npm's automatic audit
registry call, whose result never changes the install outcome.

### Acceptance Criteria

#### Happy Path
- Given the npm config resolved in `src/conductor`, when `bin/install` runs `npm ci` or `bin/setup` runs `npm install` there, then `audit` and `fund` both resolve to `false`.

#### Negative Paths
- Given operator user and global npm config that set `audit=true` and `fund=true`, when npm config is resolved in `src/conductor`, then the project-level `src/conductor/.npmrc` still resolves both to `false`.

### Done When
- [ ] `test/test_conductor_npm_no_audit.sh` passes and is registered in `test/shell_tests.manifest`.
