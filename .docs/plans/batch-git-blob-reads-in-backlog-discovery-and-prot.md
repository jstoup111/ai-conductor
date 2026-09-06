# Implementation Plan: Batch git blob reads in backlog discovery and protected-artifact seal

**Date:** 2026-09-06
**Stories:** .docs/stories/batch-git-blob-reads-in-backlog-discovery-and-prot.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent preserves every existing contract it touches — the four-method backlog tree source interface, the committed-tree-only read semantics, the seal record schema, and the fail-closed seal refusals.

## Summary

Five bounded tasks deliver #2065 by replacing the one-subprocess-per-file read shape with a single batched git read per pass, in daemon backlog discovery and in the two protected-artifact reads taken at a commit. Cross-poll caching, a persistent reader process, the workspace-side protected-artifact reads, and the scoped reseal read are outside this slice.

## Technical Approach

Add one focused module, `src/conductor/src/engine/git-blob-batch.ts`, exporting a single function that takes a project root, a revision, and a list of repo-relative paths, and returns a map from path to the committed bytes at that revision. It spawns one `git cat-file --batch --buffer` process, writes one `<rev>:<path>` request line per path to its standard input, and reads the concatenated response as raw bytes. The response is parsed strictly in request order: a success record is a header line of object id, type, and byte size, followed by exactly that many content bytes and one terminating newline; an unresolvable request instead echoes the request line followed by a missing or ambiguous marker. Request order is the only binding between response records and requested paths, because the success header echoes the resolved object id rather than the requested path — parse positionally, never by matching the echoed text. Records whose type is not `blob` are treated as absent, matching the failure a single-path read produces for a path that names no file. An empty path list returns an empty map without spawning anything.

Two request forms cannot travel through the newline-delimited batch protocol: a path containing a newline, and an empty path. Partition those out before the batch, read each with the existing single-path form, and merge the results, so the function's observable contract is exactly "the same bytes a per-path read returns, for every path." Their count is bounded by how many such paths the repository actually holds, which is normally zero.

Run the process through `execa` with the request lines as injected standard input, byte encoding on standard output, and an explicit maximum buffer sized for the whole committed documentation corpus (the measured corpus on this checkout is about sixteen megabytes). Accept an optional process-runner parameter defaulting to the real `execa` call, so tests can count invocations and observe concurrency without patching modules; production passes none.

Rewire `gitTreeSource` in `src/conductor/src/engine/daemon-backlog.ts` to serve its reads from one prefetch. The first `readFile` call on a given tree source enumerates the whole committed documentation subtree with a single recursive, NUL-delimited `git ls-tree` at the base branch, batches every enumerated path through the new reader, and memoizes the decoded contents. Every later call is a map lookup. A requested path inside the enumerated subtree that is not in the map returns absent authoritatively — the enumeration is the same tree, so a miss is a genuine absence and must not cost another process, which is the entire point of the change. A requested path outside that subtree falls back to the existing single-path read, preserving behavior for any reference a plan's stories line resolves elsewhere. The tree source is already constructed fresh inside each discovery pass, so the memo lives exactly one scan and no cross-poll staleness is introduced. The four-method interface, the listing methods, and the committed-tree-only semantics are unchanged.

Rewire the two commit-side protected-artifact readers in `src/conductor/src/engine/protected-artifact-seal.ts`. Both already list every protected path in one call before reading; feed that list straight to the new reader instead of an unbounded parallel map of single-path reads. Preserve today's byte semantics exactly: the existing per-file read decodes as UTF-8 and the seal re-encodes that string, so decode each returned blob to a string and re-encode it before fingerprinting or comparing, which keeps fingerprints identical even for bytes that are not valid UTF-8. Preserve today's fail-closed behavior: a listed path the reader does not return must raise, exactly as the current single-path read raises, rather than silently producing a seal over a smaller corpus. Leave the workspace-side readers and the scoped reseal read alone; the scoped read is already bounded by the small explicit reseal path set.

Local test pattern: the nearby engine tests build a real temporary git repository with a pinned initial branch, local identity, and no remote, and drive the production entry point against it. That fits here because git object resolution is the behavior under test. Follow it for every task; use the injected runner rather than a temporary repository only where the assertion is about invocation counts. Search for existing temporary-repository helpers in the daemon backlog and protected-artifact seal test files and reuse them rather than writing new scaffolding. No exact-copy pattern declaration applies.

This change adds no event, metric, span, log line, or report, so it opens no telemetry channel. It adds no flag, configuration key, hook, skill target, or schema field, so no reference documentation page changes and no migration block is owed.

## Preconditions and claim ledger

- Operator approved Small scope, the batched-read approach over bounded concurrency and cross-poll caching, the technical track, and all three stories on 2026-09-06 (delegated).
- Verified: `gitTreeSource` at line 63 of the daemon backlog engine module implements `readFile` at line 115 as one `git show` per call; the interface it satisfies is declared in `src/conductor/src/engine/backlog-tree-source.ts` with exactly four methods.
- Verified: `discoverBacklog` constructs its tree source at line 714 as `opts.treeSource ?? gitTreeSource(...)`, and no production caller passes `treeSource`, so a fresh source is built per scan.
- Verified: the approval loop at line 834 reads every decision record, and the per-plan loop reads plan at 852, tier marker at 915, stories at 922, coherence at 997, intake at 1090, and track marker at 1141.
- Verified: `resolveStoriesRef` at line 1258 reads a candidate path derived from the plan body, which is the one read site not guaranteed to sit under the enumerated subtree; the fallback path exists for it.
- Verified: `src/conductor/src/engine/daemon.ts` calls `discoverBacklog` at lines 1303 and 1316 with `idlePollMs` defaulted to 5000 at line 780.
- Verified: `committedProtectedPaths` at line 542 of the protected-artifact seal module lists every protected path in one call; `contentAtCommit` at line 554 is one `git show` per file; `protectedArtifactsAtCommit` at line 566 and `createSeal` at line 706 each map it under an unbounded `Promise.all`; `protectedArtifactsAtCommit` is called at lines 653 and 657.
- Verified: `fingerprint` at line 323 accepts a string or a buffer, and `protectedArtifactsAtCommit` already round-trips content through a UTF-8 string, so re-encoding preserves current fingerprints exactly.
- Verified: `execa` is already a direct dependency of the engine package and is already imported by the protected-artifact seal module.
- Verified by measurement on this checkout: the committed documentation subtree holds 3,456 files; one recursive listing piped into one `git cat-file --batch` returns the 2,485 files discovery reads in 0.24 seconds, against the roughly 4.2 seconds the issue measured for the per-file shape.
- Scope check: harness-repo-only, since daemon discovery and the self-host protected-artifact seal exist only in this repository; no skill addition; provider-agnostic.
- Verify-claims verdict: CLEAR. No unconfirmed assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Read a list of committed blobs in one git pass
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/git-blob-batch.ts, src/conductor/test/engine/git-blob-batch.test.ts
**Dependencies:** none

**Steps:**
1. Create the two files named above; both are new. Follow the local pattern described in Technical Approach: build a real temporary git repository with a pinned initial branch, local identity, and no remote, and reuse an existing temporary-repository helper from the nearby engine tests if one fits.
2. Write failing tests that commit several files with distinct shapes — multi-line text, an empty file, a file whose last byte is not a newline, and a file with repeated blank lines — then assert that a batched read of all of them returns, for each path, bytes equal to a single-path read of the same revision and path.
3. Write a failing test that requests several hundred committed paths through an injected process runner and asserts the recorded invocation count is a small fixed number, unchanged when the request grows from a few paths to several hundred.
4. Verify both fail (RED), then implement the exported function: partition unrepresentable requests, spawn one batched process for the rest with byte output and an explicit maximum buffer, parse records positionally against the request order, and merge the two result sets into one map.
5. Verify the tests pass (GREEN), run the project's narrowest scoped invocation for this test file plus the typecheck target that covers test files, and commit.

**Done when:**
1. A temporary-repository test proves a batched read of many committed paths returns bytes identical to a single-path read for each path.
2. A test asserts the git invocation count for a several-hundred-path batched read is bounded and independent of the number of paths requested.

### Task 2: Report absent, non-file, and unrepresentable requests without collateral damage
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/git-blob-batch.ts, src/conductor/test/engine/git-blob-batch.test.ts
**Dependencies:** 1

**Steps:**
1. Write a failing test that interleaves one path absent from the revision among several present paths and asserts the absent path is omitted while every other path still returns its exact bytes.
2. Write a failing test that requests a committed directory path and asserts it is reported absent rather than returning raw object bytes as content.
3. Write a failing test that commits a file whose name contains a newline, requests it alongside ordinary paths, and asserts its content matches a single-path read while no other path's content changes.
4. Write a failing test that passes an empty request list through the injected runner and asserts an empty result with zero recorded invocations.
5. Verify all four fail (RED), then implement: skip non-blob records, treat missing and ambiguous markers as absence, route unrepresentable requests through the single-path form, and short-circuit the empty list before spawning.
6. Verify the tests pass (GREEN), run the scoped invocation and the test-covering typecheck target, and commit.

**Done when:**
1. A batched read that includes an absent path omits only that path and returns exact bytes for every other requested path.
2. A path resolving to a directory at the revision is reported absent rather than yielding raw object bytes as content.
3. A newline-bearing path returns the same result a single-path read returns, and no other path's content is altered.
4. An empty request returns no contents and spawns no git process.

### Task 3: Serve one backlog scan's artifact reads from a single prefetch
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/daemon-backlog.ts, src/conductor/test/engine/daemon-backlog.test.ts
**Dependencies:** 1

**Steps:**
1. Extend the existing daemon backlog test file with a real temporary git repository that commits a corpus of many plans, matching stories, tier and track markers, and many decision records onto the base branch, following the local pattern in Technical Approach.
2. Write a failing test that runs the production discovery entry point against that repository through the real production tree source and asserts the returned backlog items, blocked specs, and gated specs equal the values the current per-file implementation produces for the same corpus. Capture the expected values from the pre-change run so the assertion is a genuine equality check, not a restatement.
3. Write a failing test that runs one scan through an injected process runner and asserts the recorded git invocation count is bounded and unchanged when the corpus grows from a handful of specs to several hundred.
4. Verify both fail (RED), then implement the prefetch inside the production tree source: on the first read, enumerate the committed documentation subtree with one recursive NUL-delimited listing, batch every enumerated path through the Task 1 reader, memoize the decoded contents, and serve later reads from the memo. Leave the four-method interface, the listing methods, and the committed-tree-only semantics unchanged.
5. Verify the tests pass (GREEN), run the scoped invocation for this test file and the test-covering typecheck target, and commit.

**Done when:**
1. A real-temporary-repository scan over many plans and decision records returns discovery output identical to the pre-change scan.
2. The observed git invocation count for one scan is bounded and does not grow with the number of specs in the corpus.

### Task 4: Resolve absent artifacts and out-of-corpus references without extra spawns
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/daemon-backlog.ts, src/conductor/test/engine/daemon-backlog.test.ts
**Dependencies:** 3

**Steps:**
1. Write a failing test whose committed corpus omits the coherence and intake artifacts for several specs, and assert through the injected runner that reading those absent artifacts reports absence and records no additional invocation beyond the scan's fixed budget.
2. Write a failing test that commits a markdown file outside the enumerated documentation subtree, reads it through the production tree source, and asserts it returns that file's exact committed content; add a companion case for an uncommitted path outside the subtree asserting absence.
3. Write a failing test whose base branch carries no documentation subtree at all and assert the scan completes and reports an empty backlog rather than throwing.
4. Verify all three fail (RED), then implement: treat an in-subtree memo miss as authoritative absence, fall back to the existing single-path read only for paths outside the enumerated subtree, and let an empty or missing subtree enumeration yield an empty memo.
5. Verify the tests pass (GREEN), run the scoped invocation and the test-covering typecheck target, and commit.

**Done when:**
1. An artifact absent from the base-branch tree is reported absent and costs no additional git process for that path.
2. A committed path outside the enumerated spec directories returns its exact committed content, and an uncommitted one returns absence.
3. A base branch carrying no spec directories yields an empty backlog without failing.

### Task 5: Bound the protected-artifact read taken at a commit
**Story:** Story 3
**Type:** happy-path
**Files:** src/conductor/src/engine/protected-artifact-seal.ts, src/conductor/test/engine/protected-artifact-seal.test.ts
**Dependencies:** 1

**Steps:**
1. Extend the existing protected-artifact seal test file with a real temporary git repository committing several hundred protected artifacts across the protected directories, following the local pattern in Technical Approach.
2. Write a failing test that creates a seal over that corpus through the exported seal-creation entry point and asserts the recorded path list and fingerprints equal the values the current per-file read produces for the same commit, captured from a pre-change run.
3. Write a failing test that supplies an optional injected process runner on the seal-creation options and asserts the peak number of simultaneously in-flight git invocations stays within a fixed bound as the corpus grows.
4. Write failing tests for the two refusals: a listed protected path with no readable blob at the requested commit must make seal creation raise, and an artifact whose committed bytes are not valid UTF-8 must keep the fingerprint the pre-change read produced.
5. Verify all fail (RED), then implement: feed the already-listed protected paths straight to the Task 1 reader in both commit-side readers, decode each blob to a string and re-encode it before fingerprinting or comparing so byte semantics match today exactly, and raise when a listed path is missing from the reader's result. Leave the workspace-side readers and the scoped reseal read untouched.
6. Verify the tests pass (GREEN), run the scoped invocation for this test file and the test-covering typecheck target, then run the project's configured aggregate test command and commit.

**Done when:**
1. A seal created over a multi-hundred-artifact corpus records paths and fingerprints identical to those the pre-change per-file read produced.
2. The observed concurrent git process count during the commit-side protected-artifact read stays within a fixed bound as corpus size grows.
3. Seal creation fails when a listed protected path has no readable blob at the requested commit.
4. A protected artifact holding non-UTF-8 bytes keeps the fingerprint the pre-change read produced.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a list of paths committed at a revision, when their contents are read in one pass, then each path yields exactly the bytes a single-path read of that revision and path returns. | 1 | "A temporary-repository test proves a batched read of many committed paths returns bytes identical to a single-path read for each path." | diff-local |
| Story 1 happy: Given a list of several hundred committed paths, when their contents are read in one pass, then the read spawns a bounded number of git processes that does not grow with the number of paths requested. | 1 | "A test asserts the git invocation count for a several-hundred-path batched read is bounded and independent of the number of paths requested." | diff-local |
| Story 1 negative: Given a requested path is absent from the revision's tree, when the read runs, then that path is reported absent and every other requested path still yields its exact bytes. | 2 | "A batched read that includes an absent path omits only that path and returns exact bytes for every other requested path." | diff-local |
| Story 1 negative: Given a requested path resolves to something other than a file blob at the revision, when the read runs, then that path is reported absent rather than yielding object bytes as content. | 2 | "A path resolving to a directory at the revision is reported absent rather than yielding raw object bytes as content." | diff-local |
| Story 1 negative: Given a requested path contains a character that the batched request form cannot carry, when the read runs, then that path still yields the same result a single-path read returns and no other path's content is corrupted. | 2 | "A newline-bearing path returns the same result a single-path read returns, and no other path's content is altered." | diff-local |
| Story 1 negative: Given an empty list of paths, when the read runs, then it yields no contents and spawns no git process. | 2 | "An empty request returns no contents and spawns no git process." | diff-local |
| Story 2 happy: Given a committed corpus of several hundred plans and decision records, when a backlog scan runs, then it reports the same backlog items, blocked specs, and gated specs it reported before this change. | 3 | "A real-temporary-repository scan over many plans and decision records returns discovery output identical to the pre-change scan." | diff-local |
| Story 2 happy: Given a backlog scan reads plan, stories, tier marker, track marker, coherence, and intake artifacts across many specs, when the scan completes, then its artifact reads cost a bounded number of git processes rather than one per read. | 3 | "The observed git invocation count for one scan is bounded and does not grow with the number of specs in the corpus." | diff-local |
| Story 2 negative: Given an artifact a scan asks for is absent from the base-branch tree, when the scan reads it, then the read reports it absent and costs no additional git process for that path. | 4 | "An artifact absent from the base-branch tree is reported absent and costs no additional git process for that path." | diff-local |
| Story 2 negative: Given a scan asks for a committed path outside the enumerated spec directories, when the scan reads it, then the read still returns that path's exact committed content, or absence when it is not committed. | 4 | "A committed path outside the enumerated spec directories returns its exact committed content, and an uncommitted one returns absence." | diff-local |
| Story 2 negative: Given the base branch carries no spec directories at all, when the scan runs, then it completes and reports an empty backlog instead of failing. | 4 | "A base branch carrying no spec directories yields an empty backlog without failing." | diff-local |
| Story 3 happy: Given a repository with more than a thousand committed protected artifacts, when a seal is created or protected artifacts are compared at a commit, then the read spawns a bounded number of concurrent git processes regardless of corpus size. | 5 | "The observed concurrent git process count during the commit-side protected-artifact read stays within a fixed bound as corpus size grows." | diff-local |
| Story 3 happy: Given the same commit and corpus, when a seal is created after this change, then every recorded artifact path and fingerprint is identical to the one recorded before this change. | 5 | "A seal created over a multi-hundred-artifact corpus records paths and fingerprints identical to those the pre-change per-file read produced." | diff-local |
| Story 3 negative: Given a listed protected-artifact path yields no readable blob at the requested commit, when the seal is created, then seal creation fails rather than recording a seal over a smaller corpus. | 5 | "Seal creation fails when a listed protected path has no readable blob at the requested commit." | diff-local |
| Story 3 negative: Given a listed protected-artifact path holds bytes that are not valid UTF-8, when the seal is created, then its recorded fingerprint is identical to the one the pre-change read produced for the same bytes. | 5 | "A protected artifact holding non-UTF-8 bytes keeps the fingerprint the pre-change read produced." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: each is decided entirely by the changed reader, the changed tree source, the changed seal readers, and fixtures those tasks create in temporary repositories. Nothing outside this diff can flip any of them.

Task 1 and Task 2 own the reader's own boundary at unit scope against a real temporary git repository, because git object resolution is the behavior under test and no third party is involved. Task 3 owns the integration proof for backlog discovery: it drives the production discovery entry point through the real production tree source against a committed corpus, which proves the application actually reaches the batched read rather than only that the helper works. Task 4 owns the discovery negative paths at that same entry point. Task 5 owns the integration proof for the seal: it drives the exported seal-creation entry point over a committed corpus, and covers both seal refusals there.

Invocation counting and concurrency observation use an injected process runner on the reader and, for the seal, an optional injected runner on the seal-creation options; no test patches modules, spawns a provider, contacts a network service, or calls a real language model. No aggregate suite invocation runs from inside a test. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3 -> Task 4
Task 1 -> Task 5
