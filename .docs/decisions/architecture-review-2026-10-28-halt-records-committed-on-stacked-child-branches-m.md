# Architecture Review: Halt records committed on stacked child branches make every restack conflict (#3451)
**Date:** 2026-10-28
**Mode:** Lightweight (Medium tier): Technical Feasibility and Architectural Alignment
**Inputs reviewed:** the explore output and track marker
(`.docs/track/halt-records-committed-on-stacked-child-branches-m.md`, scope: restack-only), and
the diagram `.docs/architecture/halt-records-committed-on-stacked-child-branches-m.md`. Also
`adr-2026-10-10-stacked-restack-journaled-replay` (decisions 2, 3, 6),
`adr-2026-10-07-per-child-build-region` (decisions 3, 11),
`adr-2026-08-23-committed-halt-record`, and source under `src/conductor/src/engine/restack/`.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Technical intent | Assessment | Confidence / basis |
|---|---|---|
| The resolver fallback receives halt-record hunks today | When a conflict spans code and the halt record, `replayChildRange` throws `merge-tree failed` (`restack-replay.ts:264`). The executor then falls back to `resolveRestackConflict` (`restack-executor.ts:718`). That function's todo is every non-patch-equivalent commit in the range (`restack-resolver.ts` `replayCandidates`), with no halt-record handling. | 95%, verified (source) |
| Omitting halt-only commits from the todo satisfies FR-9 | The restack resolver passes `expectedSubjects` from its candidates (`restack-resolver.ts` `candidateSubjects`), and `rebase.ts:2143` uses `expectedSubjects` as FR-9's authority in place of `ORIG_HEAD`. | 95%, verified (source) |
| A merge driver set only in the rebase environment keeps the side being rebuilt | Tested with real git: `GIT_CONFIG_COUNT` with `core.attributesFile` and `merge.keep-ours.driver=true` during `rebase -i --onto`. A commit that changed both the halt record and another file replayed without a conflict, kept the upstream record and applied the other file. The resolver already uses `GIT_CONFIG_COUNT` for `core.hooksPath`. | 95%, verified (experiment) |
| Plumbing replay can pin the halt path in a conflict | `upperChildHaltRecordTree` already rewrites one path in a merge-tree result through a temporary index. Taking the accumulator's blob instead of the commit's is the same plumbing. | 95%, verified (source) |
| Omitted commits still need a rewrite entry | An unentered leaf at a pre-region halt-record commit resolves through `rewrites.get(range.oldTip)` and throws when there is no match (`restack-executor.ts:640-660`). The nearest-kept / final-tip mapping keeps that lookup answerable. `translateAfterRebase` receives the same map (`restack-transition.ts:455`). Halt-only commits carry no `Task:` evidence, so mapping them translates nothing material. | 90% verified (leaf lookup); 80% inferred (translation consumers) |
| "Newest" is computable from the record | `Halted at:` is `new Date().toISOString()` (`halt-marker.ts:215`), and `Resolved at:` is written the same way by `supersedeHaltRecordText` (`halt-record.ts:122-129`). Both are ISO-8601 UTC, so they compare chronologically. | 95%, verified (source) |
| Path ownership accepts the bookkeeping commit | Owned paths come from `ownedPaths` (decision 3). The winner rule reuses that same exported function, so the two can never disagree about a path a carried merge supplied automatically. The range's record can win only when the range touched the record, so the path is already owned. When the parent's record wins, the tip's record equals the new parent's, so the path is absent from the `newParent..tip` diff. | 90%, verified (ADR + rule) |

- **Stack compatibility.** No new dependency; the work is git plumbing the engine already uses.
- **Prerequisites.** None.
- **Integration surface.** One module boundary (`engine/restack/`).
- **Data.** No schema change. The halt-record format, the journal shape and the closure refs are
  unchanged.
- **Performance.** One `diff-tree` per range commit for classification. The plumbing path already
  pays a `patch-id` per commit.
- **Worktree isolation.** The merge driver is environment-only, and its attributes file lives in the
  resolver's existing `helpers-` directory under the worktree's gitignored `.pipeline/restack/resolve/`.

## Complexity

Skipped (lightweight mode; tier M recorded in `.docs/complexity/halt-records-committed-on-stacked-child-branches-m.md`).

## Alignment

- **Governing ADR reused, no new ADR.** The decision changes the replay membership rule of an
  APPROVED ADR. It establishes no new boundary, persistence model or integration, so it fails the
  structural prerequisite for a new ADR. `adr-2026-10-10-stacked-restack-journaled-replay` is
  amended in place (2026-10-28 notes beside decision 2's halt-record bullet and after decision 6),
  and its original text is preserved.
- **Build-region decision 11 is unchanged.** Halt records still commit to the active child with a
  `Child:` field and are never pushed to a child (scope boundary). Decision 3's leaf move is
  preserved by the omitted-commit rewrite mapping.
- **One rule, two paths.** The classification predicate and the newest-record choice live in one
  new module, `engine/restack/halt-record-bookkeeping.ts`, consumed by both replay paths and the
  executor. This keeps decision 6's invariant that "the todo lists exactly the commits the plumbing
  replay would apply".
- **Flat features untouched.** Decision 1 keeps N=1 on `performRebase`, which this change does not
  touch.
- **Focused local pattern basis.** Precedent: the append-only rem-* plan union
  (`restack-replay.ts` `unionPlanConflictTree`, ADR decision 6's 2026-10-12 note). Traits to
  preserve:
  - a deterministic, engine-owned resolution of one known bookkeeping path;
  - applied before any resolver call;
  - built off-worktree through a temporary index.

  It applies because the halt record is likewise engine bookkeeping with a mechanical merge rule.
  Allowed variation: this rule is applied on every stacked restack, not only a routed repair.
- **Existing tolerances are out of scope.** The halt-record-only predicates in child-cursor,
  operator-round, restack-plan, restack-recovery and stack-commit-guard keep working unchanged. The
  bookkeeping commit is itself halt-record-only, so they tolerate it. Consolidating them was
  excluded by the scope boundary.
- **Security.** No new input surface. The merge driver command is the fixed literal `true`.

## Domain Integrity

Skipped (lightweight mode).

## Wiring Surface

| New production surface | Production caller (design-time) |
|---|---|
| `engine/restack/halt-record-bookkeeping.ts`: the halt-record-only predicate | `replayChildRange` (`restack-replay.ts`) and `replayCandidates` (`restack-resolver.ts`), both reached from `runRestack` in `restack-executor.ts` through the stack preflight and the routed exit |
| Newest-record choice and tip bookkeeping commit | Inside `replayChildRange` and `resolveRestackConflict`, so their returned tip already carries it. Both are called from `runRestack` (`restack-executor.ts`) and from planned journal recovery (`restack-recovery.ts`), so a recovered replay produces the same tip as the original run |
| Omitted-commit rewrite mapping | The same two functions' returned `rewrites`, which `runRestack` and recovery pass to `updateRestackChildStatus` |
| Halt-record path removed from the conflict hand-off path set | Both `replayConflict` copies (`restack-executor.ts`, `restack-recovery.ts`), whose paths feed the conflict halt and `restack_conflict` |
| Environment-only merge driver for `.docs/halted/<slug>.md` | `resolveRestackConflict`'s rebase environment (beside the existing `core.hooksPath` entry) |

Overlap scan (`ai-conductor overlap-scan` over `restack-replay.ts`, `restack-resolver.ts`,
`restack-executor.ts`): no overlap detected, and no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A real feature commit is misclassified as halt bookkeeping and dropped | Data | Low | High | The predicate requires every changed path to equal exactly `.docs/halted/<slug>.md`, the same predicate five shipped sites use. Path ownership and FR-9 still guard every kept commit. A test asserts that a mixed commit is kept. |
| The in-flight #3421 build changes `restack-resolver.ts` and `restack-executor.ts` (candidate subjects, consumption of an operator-recorded resolution) | Integration | High | Medium | Propose a depends-on #3421 edge at land. The plan targets `replayCandidates`, which #3421 composes from, so the recorded subjects inherit the filter. A consumed operator resolution passes through the same post-resolver bookkeeping site. |
| A record with an unreadable timestamp picks the wrong winner | Data | Low | Medium | The tie and unreadable rules are fixed in the ADR note (the new parent's record wins), and each is tested. |
| An omitted commit's rewrite mapping misleads evidence translation | Data | Low | Medium | Halt-only commits carry no `Task:` trailer. A test asserts that a leaf at a pre-region halt commit still moves. |

## ADRs Created

None. Amended: `adr-2026-10-10-stacked-restack-journaled-replay` (decision 2, decision 6).

## Conditions

1. **C1.** Both replay paths and the executor consume one shared module for classification and the
   newest-record choice. No second copy of either rule.
2. **C2.** The merge driver and its attributes file exist only in the resolver's rebase environment
   and helpers directory. Nothing is written to `.git/config`, `.git/info/attributes` or a tracked
   `.gitattributes`.
3. **C3.** An unentered leaf whose tip is an omitted halt-record-only commit still resolves to
   exactly one rewrite and moves in the same transaction.
4. **C4.** Flat (N=1) halt-record and rebase behavior is unchanged. No edit to `performRebase`,
   `halt-record.ts` or `halt-marker.ts`.
