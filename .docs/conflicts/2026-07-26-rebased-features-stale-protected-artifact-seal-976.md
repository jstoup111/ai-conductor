# Conflict Check: protected-artifact seal rebaselining (#976)

**Stem:** `2026-07-26-rebased-features-stale-protected-artifact-seal-976`
**Stories:** ST-976-1 … ST-976-4
**Verdict:** CLEAR — no blocking conflict. Three collisions found, all resolved below and carried
into the plan.

## Internal consistency (story vs story)

| Pair | Assessment |
|---|---|
| ST-976-1 vs ST-976-2 | Complementary, not overlapping. Both can rotate a seal, but ST-976-1 rotates proactively inside the rebase step while ST-976-2 rotates defensively at verification. They must share **one** rotation implementation, or the two paths can drift into different permission rules. Plan enforces a single exported rotation entry point used by both. |
| ST-976-2 vs ST-976-3 | Direct tension by design: ST-976-2 wants a non-ancestor seal to self-heal, ST-976-3 wants a feature-authored mutation to keep blocking. Resolved by the ADR's two-clause predicate — non-ancestry only *triggers* the evaluation; provable base inheritance *permits* the rotation. No contradiction remains. |
| ST-976-1 negative path vs ST-976-2 happy path | Both touch the "already violated before the rewrite" case. ST-976-1 blocks it at rebase time (verify-before-rotate); ST-976-2 blocks it at verify time (the violating path is not inherited from the base). Consistent outcomes via different routes. |

## Collisions with existing behaviour

**C1 — Pinned immutability test.** `test/engine/protected-artifact-seal.test.ts:88-99` asserts a
seal "reuses the original durable baseline instead of resealing a later commit", and the table at
:117-136 asserts several outcomes "without refreshing the seal". These directly contradict any
rotation.
*Resolution:* narrow, do not delete. Those fixtures advance HEAD on the **same history**, so the
baseline stays an ancestor and no rotation triggers — the assertions remain true under the new
predicate. The plan re-runs them unchanged as a regression guard and adds new non-ancestor cases
alongside. Flagged as a review condition (R4) in the architecture review.

**C2 — Seal-as-fixture in rebase tests.** `rebase-resolution-wiring.test.ts`,
`rebase-translate-acceptance.test.ts`, `merged-pr-guard-rebase.test.ts`, and
`daemon-lock-boundary.test.ts` all pre-seal at HEAD purely so the BUILD/SHIP guard passes before
entering at the `rebase` step. Adding rotation inside `performRebase` changes what those fixtures
observe after the rebase.
*Resolution:* these fixtures seal at HEAD and then rebase, so they will now legitimately rotate.
The plan requires each to be re-run and, where it asserts on `.pipeline` contents, updated to
expect a rotated seal rather than the original. No fixture is deleted.

**C3 — `.pipeline` translation ordering.** `translateAfterRebase` already rewrites
`task-evidence.json`, `task-status.json`, and `rebase-rewrites.json`
(`adr-2026-07-12-rebase-evidence-stamp-translation`). Seal rotation must not race or interleave
with those rewrites, and must not run on the `conflict_halt` path where translation is skipped.
*Resolution:* rotation is sequenced inside the same post-clean-rebase block as the existing
translation, after it, and is gated on the same clean-outcome classification. ST-976-1's
`conflict_halt` negative path pins this.

## Non-conflicts confirmed

- **Docs-guard hook classifier.** `classifyMutationTarget` (re-exported by
  `generate-docs-guard-hook.ts`) covers the whole `.docs` tree with a per-step allowlist and is a
  separate mechanism from the seal's four-directory scope. Untouched by this change; no shared
  state.
- **`build_review` fresh-base resolution.** Also consults `origin/<default>` but for grading scope,
  with its own fail-soft degradation. Read-only on both sides; no contention.
- **Merged-PR guard / daemon lock boundary.** Operate on branch and lock state, not on `.pipeline`
  seal contents.
- **Coherence and release gates.** Operate on committed `.docs` at land time, before any seal
  exists. No interaction.

## Resource contention

None. The seal file is per-worktree, gitignored, and written only by the seal module. Rotation
reuses the existing create path's `wx`-then-EEXIST-recover discipline, extended to an explicit
replace; the plan requires the replacement to be atomic (write-temp-then-rename) so a crash mid
rotation cannot leave a truncated seal that reads as `invalid`.
