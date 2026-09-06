**Status:** Accepted

# Stories: Batch git blob reads in backlog discovery and protected-artifact seal (#2065)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the shared batched read of committed blobs, the daemon backlog discovery reads that drive an idle poll, and the two protected-artifact reads taken at a commit. Cross-poll caching, a persistent reader process, workspace-side protected-artifact reads, and the scoped reseal read remain outside this slice.

## Story 1: Read many committed blobs in one pass

As the engine, I want to read a list of committed file contents in one pass so that read cost stops scaling as one process spawn per file.

### Acceptance Criteria

#### Happy Path

- Given a list of paths committed at a revision, when their contents are read in one pass, then each path yields exactly the bytes a single-path read of that revision and path returns.
- Given a list of several hundred committed paths, when their contents are read in one pass, then the read spawns a bounded number of git processes that does not grow with the number of paths requested.

#### Negative Paths

- Given a requested path is absent from the revision's tree, when the read runs, then that path is reported absent and every other requested path still yields its exact bytes.
- Given a requested path resolves to something other than a file blob at the revision, when the read runs, then that path is reported absent rather than yielding object bytes as content.
- Given a requested path contains a character that the batched request form cannot carry, when the read runs, then that path still yields the same result a single-path read returns and no other path's content is corrupted.
- Given an empty list of paths, when the read runs, then it yields no contents and spawns no git process.

### Done When

- [ ] A temporary-repository test proves batched contents equal single-path contents for text, empty, trailing-newline-free, and multi-line files.
- [ ] A test observes the git invocation count for a several-hundred-path request and asserts it is bounded and independent of the path count.
- [ ] A test covers an absent path, a directory path, a newline-bearing path, and an empty request in one pass without cross-contamination.

## Story 2: Scan the backlog without a process spawn per artifact

As a daemon operator, I want an idle poll's backlog scan to finish quickly so that the daemon is not spending most of its wall clock re-forking git.

### Acceptance Criteria

#### Happy Path

- Given a committed corpus of several hundred plans and decision records, when a backlog scan runs, then it reports the same backlog items, blocked specs, and gated specs it reported before this change.
- Given a backlog scan reads plan, stories, tier marker, track marker, coherence, and intake artifacts across many specs, when the scan completes, then its artifact reads cost a bounded number of git processes rather than one per read.

#### Negative Paths

- Given an artifact a scan asks for is absent from the base-branch tree, when the scan reads it, then the read reports it absent and costs no additional git process for that path.
- Given a scan asks for a committed path outside the enumerated spec directories, when the scan reads it, then the read still returns that path's exact committed content, or absence when it is not committed.
- Given the base branch carries no spec directories at all, when the scan runs, then it completes and reports an empty backlog instead of failing.

### Done When

- [ ] A real-temporary-repository discovery test over a corpus of many plans and decision records produces the identical discovery result before and after the change.
- [ ] The same test observes the git invocation count for one scan and asserts it does not grow with the number of specs in the corpus.
- [ ] Tests cover an absent artifact, a committed path outside the enumerated spec directories, and a base branch with no spec directories.

## Story 3: Read protected artifacts at a commit without unbounded fan-out

As a daemon operator, I want the rebase and reseal protected-artifact read to stay within a bounded process budget so that a large corpus cannot exhaust file descriptors or processes.

### Acceptance Criteria

#### Happy Path

- Given a repository with more than a thousand committed protected artifacts, when a seal is created or protected artifacts are compared at a commit, then the read spawns a bounded number of concurrent git processes regardless of corpus size.
- Given the same commit and corpus, when a seal is created after this change, then every recorded artifact path and fingerprint is identical to the one recorded before this change.

#### Negative Paths

- Given a listed protected-artifact path yields no readable blob at the requested commit, when the seal is created, then seal creation fails rather than recording a seal over a smaller corpus.
- Given a listed protected-artifact path holds bytes that are not valid UTF-8, when the seal is created, then its recorded fingerprint is identical to the one the pre-change read produced for the same bytes.

### Done When

- [ ] A temporary-repository test creates a seal over a multi-hundred-artifact corpus and asserts the recorded paths and fingerprints match those the pre-change per-file read produced.
- [ ] A test observes concurrent git process count during the commit-side read and asserts it stays within a fixed bound as corpus size grows.
- [ ] A test proves seal creation fails when a listed path has no readable blob at the commit, and that a non-UTF-8 artifact keeps its pre-change fingerprint.

## Negative-category review

Resource exhaustion is the originating category and is covered directly by the bounded-process criteria in Stories 1 and 3. Invalid input is covered by absent paths, non-blob paths, unrepresentable path names, and non-UTF-8 content. Partial failure is covered by the requirement that one absent path neither corrupts nor suppresses the other paths' contents, and by fail-closed seal creation. Dependency unavailability is covered by the empty-corpus scan case. Data integrity is covered by the byte-identical content and fingerprint criteria, which are the load-bearing guarantee of this change. Concurrency is bounded by construction: each read pass builds its own reader and shares no mutable state across passes, and the tree source is constructed fresh per scan, so no cross-poll cache exists to go stale. Authorization, timeout, cascade deletion, and idempotency categories are inapplicable: this change adds no new endpoint, no network call, no deletion, and no write of any kind.
