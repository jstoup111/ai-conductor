# ADR: Trailer-scan memo invalidates on `(projectRoot, headSha, mergeBase)`, re-probed every call

**Date:** 2026-07-23
**Status:** APPROVED
**Deciders:** Operator (jstoup111), via /engineer DECIDE for #878
**Relates to:** adr-2026-07-23-trailer-union-build-step-routing (#859 — added the third scan),
#828 (per-task commit floor — a fourth consumer)

<!-- Filename stem is the identifier: adr-2026-07-23-trailer-scan-memo-invalidation-key -->

## Context

`listCommitsWithTrailers(projectRoot)` with no anchor spawns 3–5 git subprocesses and
caches nothing (`autoheal.ts:349-379`, `autoheal.ts:147-162`, `rebase.ts:90-99`). It is
called 3× per build-completion check (`conductor.ts:3042`, `conductor.ts:3764`,
`artifacts.ts:1314`) and once per parked slug per daemon sweep (`daemon-cli.ts:435`),
overwhelmingly with unchanged HEAD.

The waste is milliseconds. What makes this ADR non-trivial is the **blast radius of
getting the cache wrong**: this value feeds the build-step exit predicate, the
`no_task_progress` circuit breaker, and daemon re-kick eligibility. A memo that returns a
stale count would either halt a finished build or re-kick a stalled one — a correctness
regression in gating logic that is strictly worse than the waste being removed. #878
states the constraint directly: *"no staleness — a HEAD or merge-base change is always
observed on the next call."*

So the decision under review is **not** "should we cache" but **"what is the invalidation
key, and can we prove it admits no staleness."**

## What determines the scan's output

On the no-anchor path the returned array is produced by exactly one command:

```
git log --format=%H%x09%s%x00%(trailers)%x1e <mergeBase>..HEAD     # or: -n 100 HEAD
```

Its output is a function of:

- the **commit set** in `mergeBase..HEAD` — determined by the pair of shas `(mergeBase,
  HEAD)`, because git commit objects are content-addressed and immutable, so the DAG
  reachable from two fixed shas cannot change; and
- each commit's **message/trailers** — part of the commit object, therefore immutable.

Plus the degenerate fallback: when merge-base resolution fails, the range is `HEAD` with
`-n 100`, determined by the `HEAD` sha alone.

Therefore `(projectRoot, headSha, mergeBaseKey)` — where `mergeBaseKey` is the merge-base
sha, or the sentinel `"HEAD"` for the fallback — is a **complete** key.

## Options Considered

### Option A: `(projectRoot, headSha, mergeBaseSha)`, both re-probed every call (CHOSEN)

Run `git rev-parse HEAD` and `git merge-base <ref> HEAD` on **every** call (in parallel),
build the key, and serve the memo only on an exact key match. Cache the expensive
`git log` fan and the origin-ref derivation; never cache the freshness probe itself.

- **Pros:** staleness is structurally impossible — every observable that can change the
  answer is re-measured before the cache is consulted. Correct under shallow clones,
  `git replace`, grafts, ref rewrites, force-pushes, rebases, worktree switches, and
  concurrent daemon writes. The proof is one paragraph, not a risk register. It is also
  exactly the key #878's own hypothesis proposed.
- **Cons:** the warm path costs 2 subprocesses, not the "~1" the issue's observable
  suggests; the cold path costs one *more* subprocess than today (the added
  `rev-parse HEAD`).

### Option B: `(projectRoot, headSha, defaultRefTipSha)` via a single `git rev-parse HEAD <ref>`

Derive the key in **one** subprocess and treat `merge-base` as a pure function of the two
tips, computing it only on a miss. Hits the issue's literal "~1" target.

- **Cons — decisive:** `merge-base(A, B)` is *not* a pure function of `(A, B)` in general.
  In a **shallow clone** the answer depends on the graft boundary, which `git fetch
  --deepen`/`--unshallow` moves without touching either tip; `git replace` refs and
  `.git/info/grafts` likewise rewrite reachability with tips fixed. The daemon's worktrees
  share the primary repo's object store, so a shallow primary makes every worktree
  shallow. Buying one subprocess by importing a falsifiable purity assumption into
  build-completion gating is the wrong trade. **Rejected.**

### Option C: TTL / time-based cache (e.g. 100–500 ms)

- **Cons:** definitionally stale within the window; directly contradicts the issue's
  "always observed on the next call". The three scans per completion check happen
  milliseconds apart and *straddle a build attempt that commits* — precisely the window a
  TTL would poison. **Rejected outright.**

### Option D: Cache at `countResolvedTasks` / `resolveTaskIds` instead

- **Cons:** would also cache the `.pipeline/task-status.json` read. That file is the
  fastest-changing input (the session hook and gates write it mid-build) and has no cheap
  git-derived key. **Rejected** — caching must stop at the git boundary.

### Option E: `originDefaultBranch` memo only

- **Cons:** removes 1–3 subprocesses but leaves the expensive `git log` running every
  call. Kept as a **component** of Option A, not as the whole answer.

## Decision

**Adopt Option A.** Specifically:

1. **Trailer-scan memo.** In `listCommitsWithTrailers`, no-anchor path only: probe
   `headSha` (`git rev-parse HEAD`) and `mergeBaseKey` (`git merge-base <ref> HEAD`, or
   the sentinel `"HEAD"`) in parallel on every call; serve a stored entry only when
   `projectRoot`, `headSha`, and `mergeBaseKey` all match exactly; otherwise run the
   `git log` fan and overwrite the single entry for that `projectRoot`.
2. **Origin-ref memo.** `resolveOriginRef` memoizes its result per `projectRoot` for the
   process — **positive results only**. A `null` (no origin/HEAD, no `origin/main`, no
   `origin/master`) is never cached, so a repo that gains an origin mid-process is picked
   up, and the fail-closed path is never latched.
3. **Failures bypass the cache.** If the key probe fails (unborn HEAD, non-repo directory,
   git unavailable), do **not** key, do **not** read or write the cache — fall through to
   the existing code path unchanged. Never cache an empty/error result.
4. **The anchored path is not cached.** `listCommitsWithTrailers(root, anchor)` delegates
   to `getEvidenceRange`, whose ladder uses `merge-base --fork-point` — a **reflog**
   read, not a pure sha function. No sha key can prove its freshness. Left as-is.
5. **Deep copy on return.** Cache hits return a freshly constructed array of freshly
   constructed commit records so no consumer can mutate another's future result.
6. **Bounded and resettable.** One entry per `projectRoot`, LRU-capped at 64 roots;
   `resetTrailerScanCaches()` exported for tests and explicit invalidation.
7. **Status-file reads stay live.** No change to how `countResolvedTasks` /
   `resolveTaskIds` read `.pipeline/task-status.json`.

## Consequences

**Positive**

- Warm repeat cost drops from 3–5 subprocesses to 2 cheap ref-plumbing calls issued in
  parallel; the dominant `git log --format=…%(trailers)…` fan is eliminated on repeats.
- The daemon's per-sweep, per-parked-slug cost drops accordingly — parked worktrees never
  advance HEAD, so every sweep after the first is a hit.
- All four consumers benefit at one seam; none of them change.
- `originDefaultBranch` is derived at most once per project root per process on the happy
  path, satisfying #878's first desired outcome.

**Negative / accepted**

- **2 subprocesses on the warm path, not "~1".** An accepted, documented deviation from
  #878's illustrative observable, in service of its binding "no staleness" constraint.
  Acceptance criteria are written against "the `git log` fan and the origin-ref
  derivation are not re-spawned", which is the substantive claim.
- **Cold path is one subprocess more expensive** than today (added `rev-parse HEAD`).
  Amortized away by the second call, which is guaranteed to exist at every call site.
- **Residual: `origin/HEAD` re-pointed mid-process.** If someone runs `git remote set-head
  origin -a` and the default branch name changes (e.g. `main` → `trunk`) while a daemon
  process is alive, the memo serves the old name until the process restarts. Bounded by:
  positive-only caching, the process boundary, and `resetTrailerScanCaches()`. Judged
  acceptable — this is a repo-reconfiguration event, and #878 explicitly scopes the
  freshness guarantee to "a HEAD or merge-base change", sanctioning a per-process origin
  memo in its own desired outcomes.
- One new module and one new export to keep in test setup discipline (`beforeEach` reset).
