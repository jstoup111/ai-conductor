# Architecture Review: trailer-scan memoization (#878)

**Date:** 2026-07-23 · **Tier:** M (lightweight) · **Verdict: APPROVED**
**Scope reviewed:** `.docs/track/`, `.docs/complexity/`, `.docs/architecture/` for
`trailer-scans-re-spawn-identical-git-subprocess-fa`, and
`adr-2026-07-23-trailer-scan-memo-invalidation-key`.

## Feasibility

Confirmed by direct read against `main` @ `3cc8e67b`:

- The seam exists and is single (`autoheal.ts:349-379`); all four consumers reach the git
  scan only through it.
- `resolveOriginRef` (`autoheal.ts:147-162`) is private to `autoheal.ts` — memoizing it
  has no external surface.
- The anchored and no-anchor branches are already separated by an early return, so
  restricting the cache to the no-anchor branch is a structural fact, not a convention.
- No public type or signature changes. `CommitWithTrailers` is unchanged.

## Alignment with harness principles

- **"Deterministic where possible; LLM only where necessary."** Satisfied — this is
  entirely mechanical. No agent judgement is introduced anywhere.
- **Correctness over micro-optimization.** The review's main question was whether the
  chosen key can go stale. Option A re-measures both key components on every call, so the
  only assumption remaining is *git commit objects are immutable* — the same assumption
  the existing code already depends on. **The reviewer specifically rejected Option B**
  (single-probe, tip-derived key), which would have imported a `merge-base`-purity
  assumption that shallow clones and `git replace` falsify.
- **Fail-soft preservation.** Requirement 3 of the ADR (probe failure ⇒ bypass cache
  entirely, never write) means the error paths are byte-identical to today by
  construction, not by test coverage alone.

## Risks and mitigations

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Cache serves a stale commit list into build-completion gating | High if realized | Key re-probed every call; the only uncovered mutation is commit-object rewriting under a fixed sha, which git makes impossible |
| Stale `origin/<default>` after `remote set-head` mid-process | Low | Positive-only memo, process-bounded, `resetTrailerScanCaches()` escape hatch; documented as accepted residual in the ADR |
| Existing in-process tests become order-dependent | Medium (test-only) | `resetTrailerScanCaches()` in `beforeEach` is a **mandatory** plan task, not optional |
| Consumer mutates a cached array | Low | Deep copy on every hit |
| Unbounded map growth in a long-lived daemon | Low | One entry per root, LRU-capped at 64 |

## Interaction with concurrent work

- **#859 / PR #876 (trailer-union build completion)** — already merged and *implemented*
  (`8dd28bb2`). This spec is written against the post-#859 3-scan world; there is no
  ordering dependency left, and the ADR here explicitly extends the #859 routing ADR
  rather than contradicting it. `resolveTaskIds` semantics are untouched.
- **#879 (reordering `wiring_check` vs `build_review` in `steps.ts`)** — being specced
  concurrently. **No file overlap**: this spec touches `autoheal.ts`, a new
  `trailer-scan-cache.ts`, and engine tests; #879 touches `steps.ts`. The step *order*
  change does not alter what `listCommitsWithTrailers` returns, and this cache does not
  alter when steps run. Reviewed as **independent** — either can land first. Noted rather
  than coordinated, per instruction.
- **#828 (per-task commit floor)** — `per-task-commit-floor.ts:37` is a no-anchor consumer
  and inherits the speedup with no change. No conflict.

## Conditions on approval

1. The plan must include a test that asserts the **cold-path result and the warm-path
   result are deeply equal** for a fixed repo state — the byte-for-byte guarantee.
2. The plan must include invalidation tests for **both** key components independently:
   HEAD advances with merge-base fixed, and merge-base changes (rebase onto a moved base).
3. The plan must assert the **anchored path is never served from the cache**.
4. No behavior change may be introduced into `countResolvedTasks` / `resolveTaskIds`
   themselves beyond what the memo transparently provides.

All four are reflected in the stories and plan. **APPROVED.**
