**Status:** Accepted

# Stories: Run memory-store setup on daemon dispatch (#2062)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the daemon's worktree-preparation path and the placement report it produces. Memory read paths, provider selection, and the migration algorithm itself remain outside this slice.

## Story 1: Establish the canonical memory store on every daemon dispatch

### Acceptance Criteria

#### Happy Path

- Given a daemon-dispatched worktree whose `.memory/` is absent, when the daemon prepares that worktree, then `.memory/` is a symlink to the project's canonical store before the project's setup script is run.
- Given a daemon-dispatched worktree whose `.memory/` is already a symlink to the canonical store, when the daemon prepares that worktree, then the symlink target and the store's existing entries are unchanged.
- Given a daemon-dispatched worktree holding a real `.memory/` directory with entries, when the daemon prepares that worktree, then those entries are readable in the canonical store and `.memory/` is a symlink to it.

#### Negative Paths

- Given memory-store setup throws for a daemon-dispatched worktree, when the daemon prepares that worktree, then preparation continues to the project setup step and the dispatch is not aborted.

### Done When

- [ ] A preparation fixture observes the canonical symlink for the absent, already-canonical, and real-directory starting states.
- [ ] A migrated fixture's entry content is readable through the canonical store after preparation.
- [ ] An injected setup failure leaves the daemon's preparation binding completing normally rather than throwing.

## Story 2: Report the store's placement on the event spine

### Acceptance Criteria

#### Happy Path

- Given the daemon prepares a worktree, when memory-store setup completes, then one event records the state observed before setup and whether `.memory/` is canonical afterwards.
- Given that event reaches the daemon renderer, when the daemon log line is written, then it names the canonical verdict and the state observed before setup.

#### Negative Paths

- Given memory-store setup fails, when the event is emitted, then it reports a non-canonical verdict carrying the failure reason rather than being omitted.

### Done When

- [ ] The new event type is declared in the sink map as persisted and rendered, and reaches the persisted ledger through the existing persister.
- [ ] Renderer fixtures cover a canonical payload, a non-canonical payload, and a failure payload carrying its reason.

## Negative-category review

Input integrity is covered by the three distinct pre-existing `.memory/` states, which are the only inputs this path takes. Dependency failure is covered by the injected setup failure, which is the single failure mode reachable here and which must stay non-fatal. Idempotency is covered by the already-canonical criterion, and data preservation by the migrated-entries criterion — the migration path is copy-verify-swap and aborts non-destructively on its own verification failure, so no additional loss case is introduced. Permission, network, queue, upload, transaction, and deletion categories are inapplicable: the path performs only local filesystem work under the operator's home, contacts no service, and deletes nothing. Concurrency across simultaneous worktrees is already covered by the existing store's file-per-entry and append-only index contracts and is not re-litigated here.
