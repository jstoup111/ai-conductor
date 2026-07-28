# Conflict Check: trailer-scan memoization (#878)

**Date:** 2026-07-23
**New stories:** `.docs/stories/trailer-scans-re-spawn-identical-git-subprocess-fa.md`
**Scanned against:** all `.docs/stories/` (189 files) and `.docs/plans/`, filtered to
every artifact mentioning `listCommitsWithTrailers`, `autoheal`, `originDefaultBranch`,
`resolveOriginRef`, or `merge-base`; plus the two specs known to be in flight (#879
step reorder, #859 trailer-union completion).
**Result: PASSED** — 0 blocking conflicts. 3 adjacencies reviewed and cleared, 1
degrading overlap noted with a resolution rule.

---

## Adjacency: `evidence-range-anchor-rung-engages-producer-writes` (#510, Accepted, unshipped)

**Overlap:** both specs live inside `autoheal.ts` and both concern how a commit range is
resolved. #510 fixes the **anchor rung** of `getEvidenceRange` so the primary
(anchor-based) rung actually engages instead of always falling through to merge-base.

**Cleared — disjoint by construction.** This spec's ADR clause **D4** excludes the
anchored path from the cache entirely, precisely because `getEvidenceRange`'s ladder uses
`merge-base --fork-point` (a reflog read) whose result no sha key can validate. #510
operates exclusively on that excluded path; this spec operates exclusively on the
no-anchor branch, which returns before `getEvidenceRange` is reached. Neither changes the
other's inputs or outputs.

**Standing rule if #510 lands first:** no change required here — the exclusion is
unconditional. If this lands first, #510's implementers must not "helpfully" extend the
memo to the anchored path; the ADR states why.

---

## Adjacency: `per-task-work-happened-floor` (#781 / #828, Accepted)

**Overlap:** `per-task-commit-floor.ts:37` is a no-anchor `listCommitsWithTrailers`
consumer.

**Cleared — pure beneficiary.** The floor consumes the return value read-only and gains
the speedup with zero code change. The one hazard — a consumer mutating a shared cached
array — is closed by ADR clause **D5** (deep copy on every hit), which is a story
acceptance criterion here. No contradiction.

---

## Adjacency: `#859` trailer-union build completion (SHIPPED, `8dd28bb2`)

**Overlap:** #859 added the third per-completion-check scan (`artifacts.ts:1314`,
`resolveTaskIds` inside the build exit predicate) — the very call this spec optimizes,
and the one where a stale result would be most damaging (a stale count could make a
finished build look unfinished, or vice versa).

**Cleared — this spec is defined as semantics-preserving relative to #859.** ADR clause
**D7** keeps `.pipeline/task-status.json` reads live and uncached, and the "cold result
deeply equals warm result" acceptance criterion pins `resolveTaskIds` output identity.
`adr-2026-07-23-trailer-union-build-step-routing` remains authoritative for *what*
resolution means; this spec changes only *how many subprocesses* computing it costs.

---

## Degrading overlap (non-blocking): `#879` — `wiring_check` / `build_review` reorder in `steps.ts`

**Type:** none at the file level (`steps.ts` vs `autoheal.ts` + new
`trailer-scan-cache.ts`); potential contention only in shared engine test fixtures.
**Severity:** degrading, not blocking.

**Description:** #879 changes step *ordering*; this spec changes the cost of a function
called *within* steps. Reordering does not change what `listCommitsWithTrailers` returns
for a given git state, and memoization does not change when a step runs. The only
realistic friction is a merge conflict if both specs edit the same engine test file.

**Resolution rule (whichever lands second):** rebase and re-run the full engine suite;
if a shared test file conflicts, keep both changes — they are additive (a
`resetTrailerScanCaches()` call in `beforeEach` versus a step-order assertion). Do **not**
resolve by dropping the reset call; without it the origin memo makes tests order-dependent.

---

## Verified-clean pairs (reasoned, not assumed)

- **`autoheal-path-corroboration-rejects-valid-build-co` (#707, shipped)** — operates on
  `fileMatchesPlanPath` / `deriveCompletion`, a different function family in the same
  file. No shared state with the scan cache.
- **`rebase-orphans-every-sha-anchored-evidence-citatio` (#535)** — rewrites *stamps*
  after a rebase. A rebase changes both HEAD and (usually) merge-base, so the cache
  invalidates by construction; the merge-base-change story covers exactly this.
- **`demote-task-stamping-to-telemetry` / `unify-build-completion-evidence-derivation`** —
  both define what trailers *mean*. This spec is meaning-neutral.
- **Daemon re-kick (`daemon-cli.ts:435`) and the `no_task_progress` breaker** — both read
  a count that must be able to *increase*. The HEAD-advance story asserts increases are
  still observed; the cache cannot pin a count because HEAD movement is re-probed on
  every call.
- **State conflicts / resource contention** — the cache is per-process, in-memory, and
  never written to disk. It contends for no file, lock, worktree, or branch.
