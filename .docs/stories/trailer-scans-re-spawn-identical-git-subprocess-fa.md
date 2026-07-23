**Status:** Accepted

# Stories: trailer scans do not re-spawn identical git subprocess fans on unchanged HEAD (#878)

**Track:** technical (no PRD — requirements from
`adr-2026-07-23-trailer-scan-memo-invalidation-key`, APPROVED)
**Tier:** M
**Plan stem:** `trailer-scans-re-spawn-identical-git-subprocess-fa`

Requirement tags trace to the ADR's decision clauses: **D1** trailer-scan memo, **D2**
origin-ref memo, **D3** failures bypass the cache, **D4** anchored path uncached,
**D5** deep copy, **D6** bounded + resettable, **D7** status reads stay live.

> **Coordination note (#879, no overlap):** a concurrent spec reorders `wiring_check` vs
> `build_review` in `steps.ts`. This spec touches only `autoheal.ts`, a new
> `trailer-scan-cache.ts`, and engine tests. Step ordering does not change what
> `listCommitsWithTrailers` returns and this cache does not change when steps run — the
> two are independent and may land in either order.

> **Dependency note (#859):** the third trailer scan per completion check
> (`artifacts.ts:1314`, `resolveTaskIds` in the build exit predicate) has **already
> landed** (`8dd28bb2`). These stories are written against that 3-scan world; no
> sequencing remains.

---

## Story: The origin default branch is derived at most once per project root per process

**Requirement:** D2

As the engine, I want the `origin/<default>` ref resolved once per project root, so that
repeated trailer scans stop re-running `symbolic-ref` and its fallback probes.

### Acceptance Criteria

#### Happy Path
- Given a repo with `refs/remotes/origin/HEAD` set, when `listCommitsWithTrailers(root)`
  is called three times in one process, then `git symbolic-ref refs/remotes/origin/HEAD`
  is executed exactly **once**.
- Given two distinct project roots in one process, when each is scanned, then each root
  derives its own origin ref independently (one derivation per root, no cross-talk).

#### Negative Paths
- Given a repo with **no** `origin/HEAD` and no `origin/main` / `origin/master`, when
  scanned twice, then resolution returns null **both** times and is **re-attempted** on
  the second call (a null result is never memoized).
- Given a repo that has no origin on the first call and gains a valid `origin/HEAD`
  before the second, when scanned again, then the second call resolves the new ref rather
  than serving a cached failure.
- Given `resolveOriginRef` falls back to probing `origin/main`, when the same root is
  scanned again, then the probe is not re-run (the successful fallback result is memoized
  like any positive result).

### Done When
- [ ] `resolveOriginRef` consults a per-`projectRoot` memo before deriving.
- [ ] Only non-null results are stored.
- [ ] A test counts git invocations across repeated calls and asserts exactly one
      derivation per root.

---

## Story: A repeat scan on unchanged HEAD does not re-spawn the git log fan

**Requirement:** D1

As the daemon and the build loop, I want an unchanged-HEAD trailer scan served from
memory, so that N parked slugs × every sweep stops recomputing an identical answer.

### Acceptance Criteria

#### Happy Path
- Given a repo scanned once, when `listCommitsWithTrailers(root)` is called again with
  HEAD and merge-base unchanged, then **no** `git log` process is spawned and **no**
  origin-ref derivation runs — only the two key-probe commands (`rev-parse HEAD`,
  `merge-base`) execute.
- Given the same conditions, when the result of the second call is compared to the first,
  then the two arrays are **deeply equal** — same commits, same order, same subjects,
  same trailer keys and values (the byte-for-byte guarantee).
- Given the key probe, when the two commands are issued, then they run concurrently so
  the warm path costs one round of subprocess latency.

#### Negative Paths
- Given a repo scanned once, when the scan is repeated after a **failed** first attempt
  (git error), then nothing was cached and the second call performs a full cold scan.
- Given a repo whose `mergeBase..HEAD` range is empty, when scanned twice, then the
  second call is still a cache hit returning an empty array — an empty *successful*
  result is cacheable and is not confused with a failure.

### Done When
- [ ] The memo is consulted only on the no-anchor branch of `listCommitsWithTrailers`.
- [ ] A test instruments subprocess invocations and asserts `git log` runs once across
      two identical scans.
- [ ] A test asserts cold-result and warm-result deep equality.

---

## Story: A HEAD change is always observed on the next call

**Requirement:** D1

As the build-completion predicate and the stall circuit breaker, I want any HEAD movement
reflected immediately, so that a memo can never report a stale resolved-task count.

### Acceptance Criteria

#### Happy Path
- Given a repo scanned once, when a new commit carrying `Task: T3` is created on the same
  branch (merge-base unchanged) and the scan repeats, then the returned commits include
  the new commit and `git log` is re-run.
- Given that sequence via the real consumer, when `countResolvedTasks(root)` is called
  before and after the commit, then the second count is strictly greater — the stall
  breaker sees forward progress exactly as it does today.

#### Negative Paths
- Given a repo scanned once, when the branch is reset backwards to an earlier commit
  (HEAD moves *down*), then the next scan returns the smaller commit set, not the cached
  larger one.
- Given a repo scanned once, when the branch is force-updated to an unrelated commit with
  the same commit *count*, then the next scan returns the new commits (the key is the
  sha, never a count or a length).
- Given a repo scanned once, when `git commit --amend` rewrites HEAD's message to add a
  `Task:` trailer, then the next scan reflects the new trailer.

### Done When
- [ ] `headSha` from `git rev-parse HEAD` is re-probed on every call and is part of the key.
- [ ] Tests cover advance, reset-backwards, and amend.

---

## Story: A merge-base change is always observed on the next call

**Requirement:** D1

As the engine, I want the lower bound of the scan range to be part of the key, so that a
rebase or a moved base branch cannot serve a stale commit set.

### Acceptance Criteria

#### Happy Path
- Given a repo scanned once, when the feature branch is rebased onto an advanced
  `origin/<default>` such that merge-base changes while HEAD's sha also changes, then the
  next scan re-runs `git log` and returns the rebased range.
- Given a repo where `origin/<default>` advances but the feature branch is untouched,
  when scanned again, then the recomputed merge-base is compared against the cached one
  and the scan is refreshed if (and only if) it differs.

#### Negative Paths
- Given a scan whose merge-base resolution **failed** (range fell back to `-n 100 HEAD`),
  when merge-base resolution later **succeeds**, then the next scan is a miss — the
  fallback sentinel and a real merge-base sha are never treated as the same key.
- Given a scan whose merge-base succeeded, when it later fails, then the next scan is a
  miss and returns the fallback range.

### Done When
- [ ] `mergeBaseKey` is the merge-base sha, or a distinct sentinel for the fallback range,
      and is re-probed on every call.
- [ ] Tests cover merge-base change, and both directions of the fallback transition.

---

## Story: Fail-soft and uncacheable paths behave exactly as before

**Requirements:** D3, D4, D7

As every consumer, I want error handling and the anchored path unchanged, so that adding
a cache introduces no new failure mode.

### Acceptance Criteria

#### Happy Path
- Given `listCommitsWithTrailers(root, anchor)` with an anchor, when called twice with
  identical arguments, then **both** calls run the full `getEvidenceRange` path — the
  anchored result is never stored in or served from the cache.
- Given `countResolvedTasks` / `resolveTaskIds`, when `.pipeline/task-status.json` changes
  between two calls with HEAD unchanged, then the second call reflects the new file
  contents — the status read is never cached.

#### Negative Paths
- Given a directory that is not a git repository, when scanned twice, then both calls
  return `[]` without throwing, and nothing is written to the cache.
- Given a repo with an **unborn HEAD** (no commits), when scanned, then `rev-parse HEAD`
  fails, the cache is bypassed entirely, and the call returns `[]` exactly as today.
- Given a repo where `git log` exits non-zero, when scanned, then `[]` is returned and
  **no** cache entry is written, so a subsequent healthy call performs a real scan.
- Given the existing engine test suites (`autoheal.test.ts`, `task-progress.test.ts`,
  `artifacts.test.ts`, `per-task-floor.integration.test.ts`,
  `daemon-cli-progress-rekick-wiring.test.ts`, the `no_task_progress` acceptance test),
  when run against the change, then all pass **unmodified in their assertions** — only
  `beforeEach` reset wiring may be added.

### Done When
- [ ] Cache read/write happens strictly inside the no-anchor branch.
- [ ] No cache write on any error path.
- [ ] Full existing engine suite green with no assertion edits.

---

## Story: The cache is isolated, bounded, and resettable

**Requirements:** D5, D6

As a maintainer and as the test suite, I want the cache unable to leak memory, leak state
between roots, or leak mutable objects between consumers.

### Acceptance Criteria

#### Happy Path
- Given a cache hit, when the caller mutates the returned array or a returned commit's
  `trailers` record, then a subsequent hit for the same key returns pristine data.
- Given more than 64 distinct project roots scanned in one process, when the 65th is
  scanned, then the map holds at most 64 entries (least-recently-used evicted) and every
  surviving entry still serves correct results.
- Given `resetTrailerScanCaches()`, when called, then both the trailer-scan memo and the
  origin-ref memo are emptied and the next scan is a full cold scan.

#### Negative Paths
- Given two project roots at different paths with identical HEAD shas (e.g. two worktrees
  of the same branch), when both are scanned, then each is keyed separately and neither
  serves the other's entry.
- Given the same project root scanned repeatedly as HEAD advances many times, when
  inspected, then the map still holds exactly **one** entry for that root — entries are
  overwritten, never accumulated per sha.

### Done When
- [ ] Hits return freshly constructed arrays and commit records (deep copy).
- [ ] One entry per `projectRoot`, LRU-capped at 64 roots.
- [ ] `resetTrailerScanCaches()` is exported and called in `beforeEach` of every affected
      test file.
