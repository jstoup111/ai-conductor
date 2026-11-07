# Architecture Review: Restack accepts resolutions that adapt the new parent's files
**Date:** 2026-11-07
**Inputs reviewed:** explore output and approach B (`.docs/track/restack-refuses-child-resolution-that-adapts-tests.md`), `.docs/complexity/restack-refuses-child-resolution-that-adapts-tests.md`, `.docs/architecture/restack-refuses-child-resolution-that-adapts-tests.md`, intake jstoup111/ai-conductor#3598
**Mode:** lightweight (Tier M): technical feasibility and architectural alignment
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack compatibility.** No new dependency, service, or infrastructure. The work is Git plumbing over existing helpers in `restack-ownership.ts`: `changedPaths`, `ownedPaths`, and `fileAt`. Verified.
- **Prerequisites.** jstoup111/ai-conductor#3438 must ship first. Its build is in flight and changes the resolver hand-off, the unresolved-conflict halt, and its `--tip` recipe start (`flattened-tip`) in the same files. The operator approved a blocked-by edge (2026-11-07).
- **Integration surface.** One module family, the stacked restack engine (`src/conductor/src/engine/restack/`), plus its operator command `stack-restack-resolve-cli.ts` and the `restack_applied` event type in `src/conductor/src/types/events.ts`. That is two boundaries, the restack engine and the event union.
- **Data implications.** No migration. One new engine-owned ref under the existing conflict family, `refs/conductor/<slug>/restack/conflict/refused-tip`. One additive optional field, `adaptedPaths`, on `restack_applied`. The restack journal blob is unchanged, because adapted paths are recomputed, not stored.
- **Performance.** At most one extra `git diff --name-only oldParent newParent` plus one `git show` per candidate adapted path per resolved child. These are bounded by the conflicted child's path count and run only on the resolved path.
- **Worktree isolation.** All refs are slug-scoped under `refs/conductor/<slug>/`. There are no shared ports, files, or databases.

**Verified source facts the design rests on:**

- Every resolved-tip acceptance site calls `checkPathOwnership`: `restack-executor.ts` for a recorded resolution and a resolver result, `restack-recovery.ts` for the same two, and `stack-restack-resolve-cli.ts` `checkRestackResolution`. The clean-replay site in both files stays on the strict rule.
- Today a refused resolver result reaches `haltUnresolvedConflict(..., 'replay-mismatch')`. That pins only `range.oldTip`, aborts, and writes a bare `replay-mismatch` halt with no conflict record, so `restack-resolve --tip` cannot answer it. The resolver's tip becomes unreachable.
- The conflict record and parent pin are written by `writeConflictRecord` and deleted by `conflictDeleteLines`, `restack-refs-cleanup.ts`, the applied transaction, and `retireRecordedResolution`. #3438 adds `flattened-tip` to the same lifecycle, which is the precedent for `refused-tip`.
- **Falsified assumption, design corrected (operator-approved 2026-11-07).** `restack-transition.ts` `normalizedReplayComparison` measures a child's contribution by `changedPaths(base, previous)` only. A resolution confined to parent-delta paths leaves that surface unchanged. The comparison is then normalized to `unchanged`, and `classifyReplayGateInvalidation` preserves feature-scoped reviews. The design therefore makes the transition count recomputed adapted paths as child contribution.

## Alignment

- **Governing ADRs reused; no new ADR.** The acceptance rule is owned by `adr-2026-10-10-stacked-restack-journaled-replay` decision 3. The operator check and the conflict halt are owned by `adr-2026-10-25-operator-recorded-restack-conflict-resolution` decisions 2 and 3. The change refines both rules without adding a boundary, component, integration pattern, or state architecture. Both are amended in place by additive notes dated 2026-11-07.
- **Silent-revert guard preserved.** Decision 3 adopted path ownership because it caught both silent-revert fuzz cases. The amendment keeps the strict rule for clean replay, where widening would add nothing. It widens only resolved tips, and only by paths the parent delta touched. Whole-file reverts on those paths are refused mechanically. Partial in-file reverts are the limit decision 3 already states, and they are backstopped by re-opened feature-scoped review. This is machinery for the bookkeeping, with an LLM judgement where legitimacy is a judgement call (CLAUDE.md design principle).
- **One rule for every source.** Resolver, operator `--tip`, and recovery consumption all use the same resolved-tip function, which satisfies the fourth desired outcome. A recorded `--tip` accepted at record time cannot then be refused at consumption, because both use one rule.
- **Event spine.** Adapted paths travel on the existing `restack_applied` event, and refusals keep `restack_refused` with reason `replay-mismatch`. No parallel channel; follows `.agents/skills/event-spine/SKILL.md`.
- **Domain integrity.** The ownership result stays a discriminated union. A refused path carries a closed cause, `unowned` or `parent-revert`, not a free-form string.

## Wiring Surface

- **Resolved-tip acceptance** (a new export in `restack-ownership.ts` beside `checkPathOwnership`). It is called by `runRestack` for the resolver result and recorded-resolution consumption, by recovery's `resumePlanned` for the same two, and by `checkRestackResolution` in the `stack restack-resolve` command.
- **Adapted-path computation** (exported from `restack-ownership.ts`). Its callers are the resolved-tip acceptance, the `restack_applied` emission in `runRestack` and recovery, and `applyRestackTransition`'s replay comparison in `restack-transition.ts`.
- **`adaptedPaths` on `restack_applied`.** Emitted where `parentOverlapPaths` is emitted today, and persisted by the existing `EventPersister`.
- **`refused-tip` ref helper** (in `restack-conflict-record.ts` beside `conflictParentRefFor`). It is written by `haltUnresolvedConflict` on an ownership refusal and by its recovery counterpart. It is deleted wherever the parent pin is deleted, and named by `haltRestackConflict`'s detail and `--tip` recipe.

The advisory overlap scan over these paths reported no open overlap. It cannot see #3438's unpushed in-flight build, which the blocked-by edge covers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A resolver rewrites an upstream test to hide a real regression inside an adapted file | Technical | Low | High | The whole-file revert guard, plus the transition counting adapted paths so `build_review` re-opens and judges the adaptation |
| Merge conflict with #3438's resolver and halt changes | Integration | High if built in parallel | Medium | Blocked-by #3438. The plan builds on #3438's shipped `flattened-tip` lifecycle |
| Refused-tip ref leaks past the conflict's life | Data | Low | Low | Add it to every delete site of the parent pin, and test cleanup at apply, retire and teardown |
| Plan-review prompt size: `adr-2026-10-10` is about 800 lines | Technical | Medium | Low | Cite only the amended ADRs; no Coverage Check in the plan |

## ADRs Created

None. Amended in place by additive notes:
- `adr-2026-10-10-stacked-restack-journaled-replay`, decision 3.
- `adr-2026-10-25-operator-recorded-restack-conflict-resolution`, decisions 2 and 3.

## Conditions

1. The plan's tasks must cover every resolved-tip acceptance site named under Wiring Surface, and must leave the clean-replay sites on the strict rule.
2. A test must prove that a resolution confined to parent-delta paths re-opens the child's `build_review` through the restack transition.
3. The refused-tip ref must be deleted at every site that deletes the conflict parent pin.
4. Implementation starts from #3438's merged code (the blocked-by edge).
