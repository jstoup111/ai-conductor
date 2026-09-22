# Architecture Review: Daemon reclaim sweep deletes a worktree that holds uncommitted work
**Date:** 2026-09-21
**Mode:** lightweight (Tier M, technical track, pre-stories)
**Input:** jstoup111/ai-conductor#2636, `.docs/track/daemon-reclaim-sweep-deletes-a-worktree-that-holds.md`
**Verdict:** APPROVED

## Feasibility

- **Stack:** plain git (`status --porcelain`, existing ancestry and `gh pr list` probes). No new dependency. Verified: `reconcileMergedPark` already injects `runGit` and `runGh` (`src/conductor/src/engine/park-reconciliation.ts`, `reconcileMergedPark`).
- **Root cause (verified):** the helper removes with `git worktree remove --force` and never inspects the tree. When ancestry holds, `unproven` is empty, so the merged-PR head probe never runs and a non-`feat/daemon-*` branch skips the shipped-record gate (`requiresShippedRecord`). A fresh branch cut from `origin/main` therefore reaches deletion on ancestry alone.
- **Key fact (~95%, reasoned from git semantics):** `merge-base --is-ancestor B origin/main` is true exactly when `merge-base(B, origin/main) == B`, so "zero commits beyond base" and "ancestry-proven" are the same set. The operator confirmed on 2026-09-21 that ancestry must be corroborated by a merged-PR head or a shipped record (amendment D9).
- **Integration surface:** one module plus the `RefusalReason` union it exports and its existing event and log reporting. No schema, config, or migration change. Worktree isolation is not affected.
- **Performance:** one extra `git status --porcelain` per candidate that reaches the destructive step, and one `gh pr list` per ancestry-proven candidate without a record. Both are bounded by the candidate count and already follow the sweep's existing gh-capability fallback.

## Alignment

- **Governing ADRs:** `adr-2026-07-27-ancestry-proven-park-reconciliation` (single guarded helper, re-verify at the point of deletion, "no force flag exists anywhere") and `adr-2026-08-01-multi-proof-park-deletion-authority` (proof set, named refusals). Both are reused. The 08-01 ADR is amended in place with D9 to D11. No new ADR is needed: this narrows an existing structural decision and does not make a new one.
- **Pattern:** the new guard and refusal follow D3's "every refusal names its cause". Retention reporting reuses `worktree_reclaim_failed` and the sweep log (event spine, no parallel channel).
- **Existing drift noted:** the code calls `worktree remove --force` even though 07-27 D3 says "no force flag exists anywhere". D10's pre-removal porcelain check restores the intent of that clause. Removing the flag itself is out of scope under the track's scope boundary; `--force` is still needed for gitignored build output.
- **State:** `RefusalReason` stays a closed string union and gains one member, `dirty-worktree`. Exhaustive switches on it must be updated, with no default case.
- **Diagram:** `.docs/architecture/daemon-reclaim-sweep-deletes-a-worktree-that-holds.md` (approved 2026-09-21) matches this design.

## Wiring Surface

- `dirty-worktree` refusal, and the corroboration requirement for ancestry: emitted inside `reconcileMergedPark`, which production reaches from the daemon's `reconcileParkedFeatures` sweep in `daemon-cli.ts` and from the operator reconcile verb. No new entry point.
- The refusal reaches operators through the existing `worktree_reclaim_failed` → `daemon-cli.ts` sweep log formatter.
- Overlap scan over `src/conductor/src/engine/park-reconciliation.ts`: no overlap, no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Worktrees merged locally without a PR are no longer reclaimed | Technical | Medium | Low | Retained with `no-merge-proof` and visible in the log; the operator removes them by hand. Accepted by the operator. |
| gh unavailable blocks corroboration | Integration | Low | Low | Fails closed to retention, matching the existing `capability-unavailable` handling. |
| Porcelain probe fails and is misread as clean | Data | Low | High | D10 makes a probe failure refuse. A story negative case covers it. |

## ADRs Created

None. Amended: `adr-2026-08-01-multi-proof-park-deletion-authority` (D9, D10, D11).
