# Complexity assessment: trailer-scan memoization on unchanged HEAD

Tier: M

Source issue: jstoup111/ai-conductor#878

## Rationale

| Signal | Assessment |
| --- | --- |
| New models / entities | One in-process cache record (`{ headSha, mergeBaseKey, commits }`) plus a `projectRoot → originRef` memo. No persisted store, no schema. |
| Integrations | None. `execa` + git plumbing already in use. |
| Auth / identity | Untouched. |
| State machines | None changed. But the cached value **feeds** two decision points that already exist — the build-step exit predicate (`artifacts.ts`) and the stall circuit breaker / daemon re-kick eligibility. |
| Story count | 6 (origin memo; scan memo hit; HEAD-advance invalidation; merge-base-change invalidation; fail-soft + uncacheable paths preserved; anchored path stays uncached). |
| Files touched | `src/conductor/src/engine/autoheal.ts` (memo seam + `resolveOriginRef`), new `src/conductor/src/engine/trailer-scan-cache.ts`, tests in `test/engine/autoheal.test.ts` + `test/engine/task-progress.test.ts` + a new cache unit test, `CHANGELOG.md`, `docs/` note. |
| Blast radius | **Wide read-surface, narrow write-surface.** One function's memoization silently changes the inputs to build completion, the `no_task_progress` circuit breaker, daemon re-kick eligibility, and the #828 per-task floor. A stale cache is a *correctness* regression in gating logic. |

Points to **Medium**, not Small. The diff is small (~100 lines) but the change is a
**cache introduced underneath four gating consumers**, and the load-bearing artifact is
not the code — it is the argument that the invalidation key admits no staleness. That
argument deserves an ADR and an architecture review, which the Small tier skips. Tier
**M**: lightweight architecture review, conflict-check and an architecture note required.

The issue carries both `size: S` and `size: M` labels; M is the correct read for the
reason above.

## Non-trivial details carried into the plan

1. **The invalidation key is the whole design.** `(projectRoot, headSha, mergeBaseKey)` —
   both components re-derived by cheap git plumbing on *every* call. See
   `adr-2026-07-23-trailer-scan-memo-invalidation-key`.
2. **Only the git half is memoized.** `.pipeline/task-status.json` reads in
   `countResolvedTasks` / `resolveTaskIds` stay fully live and uncached — that file is
   the fast-changing input.
3. **Failures are never cached.** Any git error on the key probe bypasses the cache
   entirely and falls through to today's code path, preserving fail-soft semantics exactly.
4. **The anchored (`getEvidenceRange`/`--fork-point`) path is not cached** — its result
   depends on the reflog, which no sha key covers.
5. **Cached arrays are returned as fresh deep copies**, so no consumer can mutate another
   consumer's future result.
6. **A `resetTrailerScanCaches()` export is mandatory** — existing tests build temp repos
   and mutate origin refs in-process, and the per-process origin memo would otherwise make
   them order-dependent.
7. No `bin/conduct` CLI, hook wiring, skill symlink, or `settings.json` schema change ⇒
   no migration block, no release waiver. No VERSION bump (frozen pre-v1). CHANGELOG
   `[Unreleased]` entry required.
