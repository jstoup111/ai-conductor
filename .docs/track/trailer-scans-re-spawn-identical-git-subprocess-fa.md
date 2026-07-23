# Track: trailer scans re-spawn identical git subprocess fans on unchanged HEAD

Track: technical

Source issue: jstoup111/ai-conductor#878

## Why technical

Pure engine-internal performance work behind an unchanged public surface. No product
domain, no user-facing feature, no data model, no CLI/config surface. The single
user-observable requirement is a *negative* one — that `countResolvedTasks` /
`resolveTaskIds` results remain byte-for-byte identical — which is mechanically
expressible as acceptance criteria in stories. No PRD.

## Context (verified by direct read against `main` @ `3cc8e67b`, 2026-07-23)

### The subprocess fan is real and is where the issue says it is

`listCommitsWithTrailers(projectRoot)` (`src/conductor/src/engine/autoheal.ts:349-379`),
called with **no anchor**, does:

1. `resolveOriginRef(projectRoot)` (`autoheal.ts:147-162`)
   - `originDefaultBranch(makeGitRunner(projectRoot))` → `git symbolic-ref
     refs/remotes/origin/HEAD` (`rebase.ts:90-99`) — **1 subprocess**
   - on null, probes `git rev-parse --verify origin/main` then `origin/master` —
     **0–2 more subprocesses**
2. `git merge-base <defaultRef> HEAD` — **1 subprocess**
3. `git log --format=%H%x09%s%x00%(trailers)%x1e <mergeBase>..HEAD` (or `-n 100 HEAD`
   on merge-base failure) — **1 subprocess, and the expensive one** (formats up to N
   commit messages with full trailer expansion)

Total **3–5 subprocesses per call**, none of them cached at any stage.

### The call sites, all confirmed present

| Site | What it does |
| --- | --- |
| `conductor.ts:3042` | `countResolvedTasks` **before** a build attempt |
| `conductor.ts:3764` | `countResolvedTasks` **after** the attempt (stall breaker delta) |
| `artifacts.ts:1314` | `resolveTaskIds` inside `CUSTOM_COMPLETION_PREDICATES.build` — **the third scan; #859 has LANDED** (`8dd28bb2 feat: trailer-union-build-completion (#884)`) |
| `conductor.ts:1922,1945` | `countResolvedTasks` in the progress-watcher path |
| `conductor.ts:4252,4267` | `countResolvedTasks` refreshing `TaskEvidence.lastResolvedCount` |
| `daemon-cli.ts:435` | `countResolvedTasks(slugRoot)` per parked/halted slug, **per sweep** |
| `per-task-commit-floor.ts:37` | `listCommitsWithTrailers` (#828 floor) — a fourth consumer that benefits for free |

### Dependency state: #859 / PR #876 — LANDED, scope is the 3-scan world

PR #876 is **MERGED** (2026-07-23) but it is a *spec* PR (`spec/build-dispatcher-…`,
artifacts only). The **implementation** also landed, as `8dd28bb2 feat:
trailer-union-build-completion (#884)`, and `artifacts.ts:1309-1314` now carries the
live `resolveTaskIds` call inside the build completion predicate. So the issue's
conditional ("once #859 lands, a third trailer scan per completion check") is **already
the present tense**. This spec is designed against the 3-scan world, not the 2-scan one.
No sequencing dependency remains.

### The daemon sweep is the real multiplier

`buildProgressReKickDeps` (`daemon-cli.ts:417-441`) builds
`isProgressReKickEligible(slug)` which runs `countResolvedTasks(slugRoot)` for every
parked/halted slug on every sweep. Parked worktrees do not advance HEAD, so the entire
3–5-subprocess fan recomputes an identical answer, N slugs × every sweep, forever.

## Options considered (divergent)

- **A. Do nothing.** Free, honest — the issue itself grades the impact "minor
  optimization, not a bottleneck". Rejected because the daemon-sweep multiplier is
  unbounded in slug count and the fix is small and provably behavior-preserving.
- **B. Cache only `originDefaultBranch`.** Smallest possible change; removes 1–3
  subprocesses of the fan but leaves the expensive `git log` re-running every call.
  Partial.
- **C. Memoize the whole no-anchor trailer scan on a git-derived key** (chosen). Removes
  the `git log` *and* the origin derivation on a repeat; leaves two cheap plumbing calls
  to prove freshness. Covers all four consumers at one seam.
- **D. Time-based TTL cache.** Rejected outright: a TTL cache is *definitionally* stale
  inside its window, and the issue's hard requirement is "a HEAD or merge-base change is
  always observed on the next call". A 100 ms TTL would silently return a stale resolved
  count into build-completion logic. Non-starter.
- **E. Push caching up into `countResolvedTasks`.** Rejected: that would also cache the
  `.pipeline/task-status.json` read, which is the input that changes *most* often and
  has no cheap git-derived invalidation key. Caching must stop at the git boundary.

**Chosen: C**, with B folded in as its first stage. Details and the invalidation-key
argument are in `adr-2026-07-23-trailer-scan-memo-invalidation-key`.

## Explicitly out of scope

- **The anchored path** (`listCommitsWithTrailers(root, anchor)` → `getEvidenceRange`).
  It resolves via `git merge-base --fork-point`, which reads the **reflog** — its result
  is *not* a pure function of the commit shas involved, so no sha-derived key can prove
  freshness. Left uncached.
- **`seedTaskStatus` mtime early-exit** (the issue's "Optional" third bullet). Rejected
  for this spec: `seedTaskStatus` (`task-seed.ts:112-130`) performs an **unconditional
  side effect** — `rm` of the `.pipeline/current-task` stale stamp file — that is not
  represented in any plan/status mtime key. An mtime early-exit would skip that cleanup
  and change build behavior, which violates the issue's own byte-for-byte constraint.
  The residual saving (one plan read + one idempotent atomic status write) does not
  justify the risk. Recorded as a follow-up candidate, not built here.
- **The double `.pipeline/task-status.json` read** inside `countResolvedTasks` (reads it
  once itself, then `resolveTaskIds` reads it again). Collapsing them would change which
  file content each half observes under a concurrent write — a behavioral change, not a
  pure optimization. Left alone.
