**Status:** Accepted

# Stories: Accurate paths in the land cleanliness refusal (#1300)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the refusal diagnostic raised by the spec-landing primitive's worktree-cleanliness guard, and the guide entry that documents the same refusal. The guard's accept/reject decision is unchanged. The issue's request for a supported route to revise an already-landed spec is an undecided design question and is out of scope; #1300 stays open for it.

## Story 1: Name each blocking path under the condition that actually blocked it

### Acceptance Criteria

#### Happy Path

- Given a per-idea worktree whose only uncommitted entry is a modified tracked artifact under the spec-artifact directory, when landing is refused for worktree cleanliness, then the refusal lists that path under uncommitted changes to tracked files and no sentence of the refusal describes it as a change outside the spec-artifact directory.
- Given a per-idea worktree whose only uncommitted entry is an untracked file outside the spec-artifact directory, when landing is refused for worktree cleanliness, then the refusal lists that path under untracked files outside the spec-artifact directory and names no tracked-change condition.
- Given a per-idea worktree carrying both a modified tracked file and an untracked file outside the spec-artifact directory, when landing is refused for worktree cleanliness, then each path appears under its own condition and the remedy names both committing-or-discarding the tracked changes and removing-or-relocating the untracked files.

#### Negative Paths

- Given a per-idea worktree whose only uncommitted entry is a modified tracked artifact under the spec-artifact directory, when landing is refused for worktree cleanliness, then the branch head is unchanged and no landing commit was created.
- Given a per-idea worktree whose only uncommitted entries are untracked files under the spec-artifact directory, when landing runs, then the cleanliness guard admits the worktree and landing proceeds past that guard.

### Done When

- [ ] Unit fixtures cover a tracked-only refusal, an untracked-outside-only refusal, a mixed refusal, and the admitted untracked-artifact worktree.
- [ ] No refusal string produced by the guard describes a tracked modification under the spec-artifact directory as a change outside that directory.
- [ ] The refusal's remedy sentence names only the actions that apply to the conditions it actually reported.

## Story 2: Document the refusal as the guard enforces it

### Acceptance Criteria

#### Happy Path

- Given the engineer-loop guide's list of reasons landing is refused, when a reader consults the worktree-cleanliness entry, then it names uncommitted changes to tracked files at any path and untracked files outside the spec-artifact directory as two distinct conditions.

#### Negative Paths

- Given the same list, when a reader looks for the worktree-cleanliness entry, then no bullet states that the refusal covers only changes outside the spec-artifact directory.

### Done When

- [ ] The engineer-loop guide's refusal list carries the two-condition wording and keeps every other refusal entry it already lists.

## Negative-category review

Input integrity is covered by the one-condition and mixed-condition refusals, which are the input shapes the guard can be handed. Fail-closed behavior is covered by the unchanged branch head after a refusal and by the still-admitted untracked-artifact worktree, together proving the stale-leftover protection is not weakened while the diagnostic changes. Permission, network, dependency, concurrency, deletion, queue, datastore, upload, and transaction categories are inapplicable: the guard reads process output and raises an error, performs no write of any kind before the refusal, and this change introduces no new caller, service, or persisted state. Identity, artifact-content, and tier-completeness refusals are owned by later guards and keep their existing coverage unchanged.
