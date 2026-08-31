**Status:** Accepted

# Stories: Setup fix-session repairs must converge (#1346)

Technical track. These stories cover the #1346 amendment to APPROVED
`adr-2026-07-09-setup-failure-triage`, within the confirmed daemon-only scope.

## Compatibility amendment for inherited #446 and #582 criteria

Effective 2026-08-29, the approved #1346 ADR amendment and the criteria below supersede the
earlier #446/#582 terminal rule wherever it classified every setup-success dirty tree as a
quarantine-and-park result. A dirty tree is accepted only when HEAD remains original, its complete
Git tree is captured before forced setup, forced setup leaves that tree unchanged, and the engine
commits and verifies exactly that tree. Setup drift, rewritten history, commits plus residue, and
any preservation or commit failure still preserve-before-reset and park. The inherited story files
remain unchanged as historical records; BUILD and review for #1346 use this later exact-state
partition.

## Story 1: A verified uncommitted repair becomes durable branch history

**Requirement:** #1346 desired outcome; amended setup-triage Decision 4

As the daemon operator, I want a fix-session repair that passes setup to be committed to the
feature branch, so the next dispatch starts from the repaired code instead of reproducing the same
compile failure.

### Acceptance Criteria

#### Happy Path

- Given setup triage starts the one fix-session from a clean feature HEAD, the session leaves an uncommitted Git-visible repair without moving HEAD, and the forced setup verification succeeds without changing that repair, when triage completes, then the feature branch advances by exactly one repair commit whose parent is the original HEAD and whose complete tree equals the captured repair, the worktree is clean, the outcome is `fixed-pass`, and normal build dispatch proceeds.

#### Negative Paths

- Given the same uncommitted repair, when forced setup adds, removes, or changes any Git-visible content relative to the captured repair, then no repair commit is accepted and triage preserves the full attempt before parking with a setup-drift outcome.
- Given setup leaves the captured repair unchanged but the repair commit fails or its parent, tree, HEAD, or final clean-tree verification does not match the contract, when triage completes, then it does not return `fixed-pass`; it preserves the complete attempt and parks with the exact failed postcondition named.

### Done When

- [ ] A real temporary-git-repository test proves an uncommitted tracked modification plus an
      untracked addition becomes one branch commit with the original parent and exact captured tree.
- [ ] The same test proves forced setup ran, the final worktree is clean, and the normal conductor
      callback is reached without a second fix-session.
- [ ] Tests alter the candidate during setup and inject commit/postcondition failures, proving each
      produces preserve-and-park rather than an accepted or partial repair commit.

## Story 2: Existing safe fix-session outcomes remain accepted

**Requirement:** amended setup-triage Decision 4 compatibility paths

As the daemon operator, I want already-committed repairs and environment-only repairs to keep
working, so adding mechanical commit ownership does not regress successful recovery paths.

### Acceptance Criteria

#### Happy Path

- Given the fix-session creates one or more commits that are clean forward descendants of the original HEAD, when forced setup succeeds without moving HEAD or changing the Git tree, then triage accepts those commits, creates no extra engine repair commit, returns `fixed-pass`, and proceeds to normal build dispatch.
- Given the fix-session changes no Git-visible content but repairs an external worktree dependency or transient environment condition, when forced setup succeeds and HEAD plus the worktree remain unchanged, then triage returns `fixed-pass` without creating an empty commit.

#### Negative Paths

- Given provider-created commits are not forward descendants of the original HEAD, or the provider leaves commits plus uncommitted residue, when triage evaluates the attempt, then the existing commits are not accepted as a successful repair; the complete attempt is preserved and the feature parks with `history-rewritten` or `mixed-commit-and-residue` evidence.
- Given a no-tree-change attempt still fails forced setup, when triage completes, then it parks with `setup-still-failing`, creates no empty commit, and does not report a successful repair.

### Done When

- [ ] Tests prove clean forward provider commits pass without an additional commit and without
      weakening the one-fix-session bound.
- [ ] A test proves a no-tree-change environment repair passes without creating a commit.
- [ ] Tests prove rewritten history, mixed commits plus residue, and a still-failing no-change
      attempt cannot return `fixed-pass`.

## Story 3: Every rejected repair is recoverable before the feature is restored

**Requirement:** #1346 non-convergence and evidence outcome; amended Decisions 4–5

As the daemon operator, I want every rejected fix-session attempt preserved before any reset, so no
repair is silently discarded and the daemon cannot spend another session on the same invisible
state.

### Acceptance Criteria

#### Happy Path

- Given a repair is rejected for rewritten history, mixed commits plus residue, setup drift, or a failed repair-commit postcondition, when preservation succeeds, then a slug-scoped quarantine ref reaches the complete attempted state including provider commits and uncommitted content before the feature branch is restored to its original HEAD; triage then parks with the ref, preserved paths, and closed rejection reason.
- Given preservation itself fails before a durable quarantine ref reaches the full attempt, when triage handles the failure, then it performs no reset, leaves the attempted state in the worktree, and parks with the preservation failure named.
- Given either rejected outcome parks the feature, when subsequent daemon scans run without an operator clear/unpark, then they dispatch zero additional setup fix-sessions for that feature.

#### Negative Paths

- Given a quarantine ref already exists, when refreshing it for a rejected repair fails, then the prior ref is not treated as proof that the new attempt was preserved, the current attempt is not reset, and the park evidence names the refresh failure.
- Given the quarantine ref was durably updated but restoration to the original HEAD fails, when triage parks, then the evidence names the restoration failure and the updated ref remains recoverable; the outcome never claims the feature branch is clean or restored.
- Given an operator explicitly clears the park and re-dispatches the feature, when setup still fails, then the existing one-fix-session-per-rotation rule permits at most one new attempt; the automatic scans before that operator action do not count as a new rotation.

### Done When

- [ ] A real Git test preserves a mixed commit-plus-residue attempt, verifies the quarantine ref's
      complete tree/history, and proves restoration occurs only after the ref is reachable.
- [ ] Fault-injection tests at ref refresh and reset prove no unpreserved content is discarded and
      no false restored/clean claim is emitted.
- [ ] A daemon-level test runs repeated scans after the park and observes no repeated fix-session
      until an explicit clear/unpark.

## Story 4: Every repair disposition is visible through the existing event spine

**Requirement:** event-spine rule; amended setup-triage Decisions 4–5

As the daemon operator, I want one structured disposition for each fix-session attempt, so I can
distinguish a retained repair from a rejected one without reconstructing the result from generic
setup logs.

### Acceptance Criteria

#### Happy Path

- Given a fix-session reaches a terminal outcome, when triage completes, then exactly one `setup_repair` event is emitted with one closed disposition — `engine-committed`, `accepted-existing-commit`, `verified-no-tree-change`, or `rejected` — and a rejected event carries one closed rejection reason plus its quarantine ref when preservation succeeded.
- Given that event is emitted on a daemon feature run, when the existing sinks consume it, then the same disposition is persisted in the feature's `events.jsonl` and rendered once in the daemon log; a rejected HALT additionally names the rejection reason, quarantine ref, and preserved paths (or explicitly names the preservation failure).

#### Negative Paths

- Given the provider dispatch throws before changing the tree, when triage parks, then exactly one rejected event names `provider-failure`, no quarantine ref is invented, and the HALT explicitly states that no repair state was preserved because none was produced.
- Given ordinary setup succeeds or setup triage resolves before the fix-session stage, when daemon dispatch proceeds, then no `setup_repair` event is emitted; the new signal does not add noise to unaffected setup paths.
- Given a terminal repair event is declared, when type-check and event-sink contract tests run, then omission from the exhaustive sink registry or from the renderer/persister path fails verification rather than silently dropping the event.

### Done When

- [ ] Unit tests cover every closed disposition and rejection reason and assert exactly one event
      per attempted fix-session.
- [ ] An acceptance test proves the production feature emitter persists and renders the repair
      disposition while the HALT carries actionable durable state.
- [ ] A negative acceptance test proves successful ordinary setup and stage-1-only recovery emit no
      repair event.
