**Status:** Accepted
**Source:** `jstoup111/ai-conductor#1077`

# Stories: Total HALT classification with legacy compatibility

These technical stories implement jstoup111/ai-conductor#1077 under the approved architecture and
`adr-2026-07-28-total-halt-classification-legacy-boundary.md`. They supersede the earlier
classless-is-retryable acceptance in
`main-advance-re-kick-sweep-wipes-needs-human-decid.md`; that behavior remains only for markers
explicitly identified as `legacy` at the upgrade boundary.

## Story 1: Every new engine-owned HALT has an explicit retry disposition

As the daemon operator, I want every new conductor HALT to declare whether automation may retry it
so that a missing sidecar cannot silently turn an operator decision into more work.

### Acceptance Criteria

#### Happy Path

- Given any production path that creates a conductor HALT, when that path stops a feature, then the
  resulting marker has a readable class of exactly `needs-human` or `mechanical` and the class
  matches the reviewed disposition for that reason.
- Given a developer adds a new HALT call through the shared contract, when TypeScript and repository
  integrity validation run, then an explicit writable class is required and the call passes only
  with an allowed value.
- Given a condition whose retry safety is ambiguous, when its reviewed disposition is recorded,
  then it is classified `needs-human` rather than made automatically retryable.

#### Negative Paths

- Given a production caller omits the class or supplies `legacy`, when TypeScript validation runs,
  then validation fails before that code can ship.
- Given production code writes the canonical HALT body directly instead of using the shared
  contract, when repository integrity validation runs, then validation fails and identifies the
  bypassing source location.
- Given a newly added HALT reason has no reviewed disposition, when the complete writer inventory is
  checked, then the change is rejected rather than inheriting an automatic-retry default.

### Done When

- [ ] The production build rejects a missing class and rejects `legacy` at a new writer.
- [ ] An integrity fixture proves a direct canonical HALT write is detected with its source path.
- [ ] A checked writer inventory accounts for every production HALT creation site and assigns each
      `needs-human` or `mechanical` with a rationale.
- [ ] A repository scan finds no production bypass of the shared classified-writer contract.

## Story 2: Pre-boundary classless HALTs retain their historical retry behavior

As an operator upgrading a running daemon, I want existing classless HALTs distinguished from new
classification failures so that the upgrade remains backward compatible without making future
corrupt state retryable.

### Acceptance Criteria

#### Happy Path

- Given the daemon owns the project lock and the compatibility boundary has not completed, when it
  starts, then every existing live HALT without a readable class is identified as `legacy` before
  backlog discovery, dispatch, or re-kick can run.
- Given the boundary scan completes, when daemon startup continues, then a durable completion signal
  exists and later startups do not reclassify newly created markers as historical.
- Given an existing HALT already has a readable `needs-human` or `mechanical` class, when the boundary
  scan runs, then its class is unchanged.

#### Negative Paths

- Given the daemon cannot acquire exclusive project ownership, when startup is attempted, then
  neither compatibility migration nor normal daemon work begins.
- Given startup stops after one or more legacy stamps but before recording completion, when the next
  lock-owning daemon starts, then it safely repeats the scan and completes without changing already
  readable classes.
- Given an individual historical marker cannot be stamped, when migration processes it, then the
  slug and failure are reported, the marker remains non-retryable as `unclassified`, and startup
  never guesses a retryable class for it.
- Given the compatibility completion signal already exists, when a later bare or unreadable class
  appears, then startup leaves it `unclassified` instead of treating it as `legacy`.

### Done When

- [ ] A startup-level test proves migration occurs after lock acquisition and before discovery,
      dispatch, and re-kick collaborators are invoked.
- [ ] An interrupted-run test proves a repeat scan is idempotent and the completion signal is
      recorded only after the scan finishes.
- [ ] Tests prove readable classes are preserved, failed stamps fail closed, and post-boundary bare
      markers are never converted to `legacy`.
- [ ] A legacy marker follows the historical canonical retry path after migration.

## Story 3: Re-kick decisions fail closed for unclassified current state

As the daemon operator, I want the sweep to retry only explicitly retryable or migrated legacy
HALTs so that malformed current state cannot trigger an unattended loop.

### Acceptance Criteria

#### Happy Path

- Given an eligible halted worktree with class `mechanical`, when the base-advance sweep runs, then
  the daemon reports the class and uses the existing bounded clear-and-re-kick path.
- Given an eligible halted worktree with class `legacy`, when the sweep runs, then the daemon reports
  that compatibility disposition and uses the same bounded clear-and-re-kick path.
- Given a halted worktree with class `needs-human`, when any eligible sweep runs, then the daemon
  reports the disposition and leaves the HALT, class, branch, and worktree untouched.

#### Negative Paths

- Given a HALT has a missing, unreadable, empty, or unknown class after the compatibility boundary,
  when a sweep evaluates it, then it is reported as `unclassified`, remains halted, and receives no
  rebase abort, marker clear, retry sentinel, or dispatch eligibility change.
- Given a `mechanical` or `legacy` feature was already re-kicked at the current base SHA, when the
  sweep repeats, then the existing once-per-SHA bound still prevents another retry.
- Given an otherwise retryable feature is parked or already processed, when the sweep evaluates it,
  then the existing park and processed guards still win and classification does not bypass them.

### Done When

- [ ] A disposition matrix test covers `needs-human`, `mechanical`, `legacy`, and every
      `unclassified` input form with exact retain-or-retry assertions.
- [ ] Tests assert that an unclassified marker causes none of the canonical retry side effects.
- [ ] Existing once-per-SHA, operator-park, processed-work, abort-rebase, and rebase-first behavior
      remains passing for the classes that are retryable.
- [ ] Sweep diagnostics include the slug and resolved disposition for every classification branch.

## Story 4: HALT body and class changes cannot reuse stale retry authority

As the daemon operator, I want marker updates and clears to keep the HALT body and its class
consistent so that an interrupted write cannot borrow an old classification.

### Acceptance Criteria

#### Happy Path

- Given a worktree contains a prior HALT class, when a new HALT replaces the prior reason, then the
  old class is no longer observable before the new body is associated with its new explicit class.
- Given a HALT is cleared through the canonical operation, when the operation completes, then both
  its body and class sidecar are absent.

#### Negative Paths

- Given replacement stops after the new body is visible but before the new class is readable, when
  the sweep inspects the marker, then it resolves to `unclassified` and retains the HALT.
- Given a clear operation encounters an already absent or unreadable class sidecar, when it clears
  the HALT, then cleanup remains idempotent and does not make another worktree eligible.

### Done When

- [ ] A stale-sidecar test proves a replacement never exposes the old class for the new body.
- [ ] A partial-write test proves the observable intermediate state is `unclassified` and cannot be
      auto-re-kicked.
- [ ] Clear-path tests prove both files are removed and repeated cleanup is harmless.
- [ ] Existing tests that read or clear classified HALTs pass through the shared lifecycle contract.
