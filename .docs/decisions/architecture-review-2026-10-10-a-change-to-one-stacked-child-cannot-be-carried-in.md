# Architecture Review: Multi-branch restack for stacked child plans (#2943)

**Date:** 2026-10-10
**Stories reviewed:** none yet. This is the pre-stories full review for a Large feature. Its
inputs are:
- the track scope and the complexity marker;
- `.docs/architecture/a-change-to-one-stacked-child-cannot-be-carried-in.md`;
- the explore design;
- seven adversarial reviews: two on approaches, one on diagrams, three on the ADR, and one
  convergence pass. Three of them ran git experiments in scratch repositories.

**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Pure TypeScript engine work plus git plumbing: `merge-tree --write-tree --merge-base`, `commit-tree`, `update-ref --stdin` transactions, `read-tree -m -u`, `patch-id` and `hook run`. No new packages or services. `merge-tree --merge-base` is already used (`rebase.ts:816`), which sets a de facto floor of git 2.40. Nothing here raises it. `git replay` is deliberately not used. Verified on git 2.53 in scratch repositories. |
| Prerequisites | Already on main at `0bca4a2822`: #3019 identity and per-child state, #3039 slices and ownership, and #3053 (#2942) with its cursor, closure refs, `startChild`/`moveLeaf` and per-child stores. Verified via `.docs/shipped/build-loop-cannot-complete-a-feature-child-by-chil.md` and the code map. |
| Integration surface | Rebase, translation, transition and replay modules; the child cursor and lifecycle; conductor resume and the FINISH `rebase` step; daemon re-kick and dispatch; the kickback ledger and budget CLI; the remote-git chokepoint; four force-push callers; teardown; every engine commit site in a feature worktree; and events. That is far beyond three module boundaries. |
| Data implications | New engine refs under `refs/conductor/<slug>/`: `restack/journal`, `restack/staging/c<j>`, `cascades`, `pushed/<branch>` plus the intent, and `leaf-moved`. All are deleted at teardown. The stacked rebase operation record gains `cause`. No `.pipeline/` schema changes for N=1. The flat rewrite map gains restack entries. |
| Performance risk | The replay costs two `merge-tree` calls per commit per child, plus one `update-ref` transaction. That is negligible beside a dispatch. Each force push gains a single-branch fetch and an `ls-remote`. |
| Worktree isolation | Refs live in the shared `.git` under per-slug names, so they cannot collide across features. The resolver's temporary worktree lives under the feature worktree's gitignored `.pipeline/` and is pruned on every exit. The self-host live boundary excludes `.git/` and `.pipeline/`. |

## Complexity

High. Story-level ratings come with `/stories`. The riskiest areas, in order:
1. **The journal state machine and the commit fence.** Crash windows, cross-process engine commits,
   and the halt-seam re-entry guard.
2. **The plumbing replay rules.** Merges (ancestry-only, Q-carried, flattened), patch equivalence
   against commits new to the stack, the empty-commit rules, and path-ownership acceptance.
3. **The stack preflight ordering.** It covers the daemon dispatch, `consumeResumeAuthorizations`,
   `resumeRebaseFirst` and conductor resume, plus the `repair-pending` cursor kind.
4. **The lease decision table and recording** at `executeRemoteGit`, including the upgrade path for
   features already in flight.
5. **Cascade-cap recovery** through the `restack` pseudo-gate.

## Alignment

- **Governing ADRs reused:**
  - `adr-2026-10-07-per-child-build-region`: the cursor, closure refs, `moveLeaf` and per-child
    stores;
  - `adr-2026-10-03-stacked-child-plans-identity-and-state`;
  - `adr-2026-09-11-selective-post-rebase-verification`: the tuple policy, applied to the active
    child and to the whole stack;
  - `adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history`: the classification helper and
    trailers;
  - `adr-2026-06-29-rebase-conflict-resolution-dispatch`: the resolver and its FR-8/FR-9 guards;
  - the event-spine skill: new variants, with the ref state justified under exception C.
- **New structural decision:** `adr-2026-10-10-stacked-restack-journaled-replay`. It covers the
  journaled off-worktree replay, the atomic move, the stack preflight, cause and cap, and
  expected-SHA leases.
- **Departures recorded as amendments:** 15 decisions across 14 approved ADRs, listed in that ADR's
  "Amendments made by this decision". Each amendment note is committed to its ADR in a
  `spec: amend …` commit ahead of the landed artifacts.
- **Focused local pattern basis:**

  | Precedent | Where to find it | Traits to preserve | Why it applies | Variation allowed |
  |---|---|---|---|---|
  | Ref-backed durable state | `startChild` in `child-lifecycle.ts`, `refs/conductor/<slug>/positions` | `hash-object -w` plus a compare-and-swap `update-ref`; the ref sits outside `refs/heads` and is never pushed | The journal, cascades, pushed tips and leaf-moved state all need the same survival across worktree recreation | A multi-ref transaction instead of a single `update-ref` |
  | Compare-and-swap ref moves | `moveLeaf` in `child-lifecycle.ts` | An expected old value on every ref | Every restack ref move needs the same guarantee | None |
  | Untracked-collision quarantine | The untracked-collision path in `rebase.ts` | Moving colliding untracked files aside, never deleting them | The worktree sync can hit the same collision | Reused as-is; no change |

- **Verified no-fit:** no existing guarded-commit helper exists, so decision 4 introduces one.

## Domain Integrity

- **Cause** is a closed union, `'feature-repair' | 'base-refresh'`. An absent value is defined, not
  a default branch.
- **Journal state** is an explicit enum with legal transitions. There are no boolean flags.
- **Cursor kind** gains `repair-pending` as a typed result, not a flag on `active`.
- **Refusal reasons** are a closed union on `restack_refused`.
- **Lease outcome** is an exhaustive decision table, with no catch-all except an explicit refusal.
- **Primitive obsession risk.** Old and new SHAs, ranges and refs should be typed (for example
  `CommitSha`, `ChildRange`), not bare strings across the planner, journal and transaction. The plan
  should carry this as a condition.

## Wiring Surface

| New production surface | Called from (design-time commitment) |
|---|---|
| Stack preflight (journal recovery and automatic repair) | Daemon dispatch, ahead of `consumeResumeAuthorizations` and `resumeRebaseFirst` (`daemon-cli.ts`); conductor resume, ahead of the halt-record supersede, the cursor and `classifyRebaseOperation` (`conductor.ts`) |
| Restack planner and executor (replay, ownership check, transaction, sync) | FINISH `runRebaseStep` (`conductor.ts`) and `resumeRebaseFirst` (`daemon-rekick.ts`) when the feature has durable child state; the preflight's repair |
| Narrow resolver primitive | The restack executor's conflict branch only |
| Guarded engine-commit helper | Every engine commit site in a stacked feature worktree: `halt-record.ts`, `daemon-deps.ts` supersede, the plan-amendment commit in `conductor.ts`, `setup-triage.ts`, `finish-publication-production.ts`, `shipped-record-cli.ts`, `shipment-evidence-cli.ts` (build-failure escalation only pushes) |
| `repair-pending` cursor kind | `resolveActiveChild` (`child-cursor.ts`); consumed by the preflight; tolerated by `consumeResumeAuthorizations`, `kickback-budget-cli.ts`, `task-cli.ts` and `rewind.ts` |
| Cause field and cause-scoped refund | `applyRebaseTransition` and `creditBuildReviewConvergence` (`rebase-transition.ts`); `advanceTail`'s legacy refund guarded |
| Cascade counter and `restack` pseudo-gate | Planner pre-check; `kickback-budget raise|reset` (`kickback-budget-cli.ts`); `RECOVERABLE_CAP_HALT_CLASS_BY_GATE` (`halt-classification.ts`) |
| Pushed-tip recording and the lease helper | `executeRemoteGit` (`remote-git-operations.ts`) records the tip; the helper is called by the `ship-draft-pr.ts` lease push, `pushRefreshedBranch` (autoresolve and ci-fix) and `publishHaltRecord` |
| Ref cleanup | Shipped-record teardown in `mergeable-sweep.ts` |
| Pinned git config | `performRebase`, `startFeatureReplay`, the restack replay and the resolver primitive |
| Events `restack_*` and `push_lease_refused` | Declared in `types/events.ts` and `event-sinks.ts` (`persist: true`); emitted by the planner, executor, preflight and lease helper |

**Advisory overlap scan.** `ai-conductor overlap-scan` over these paths flags two unmerged spec
branches:
- `origin/spec/daemon-self-host-guardrails` touches `rebase.ts`, `conductor.ts` and
  `daemon-rekick.ts`;
- `origin/spec/self-host-phase6-wiring` touches `conductor.ts`.

Both are old spec branches. This is advisory only and does not block.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A crash or a concurrent engine commit during the move reverts or corrupts a branch | Data | Medium | High | Journal state moves in the same transaction as the refs; the guarded commit helper races the move by compare-and-swap on HEAD; recovery runs from refs; real-git crash tests at every state (ADR decisions 4, 5, 7 and 13) |
| A child silently drops its parent's fix inside a path it owns | Data | Low | High | Rebase-equivalent by design. `parentOverlapPaths` flags it for the leaf gates and #2944. A revert outside owned paths halts. |
| The plumbing replay diverges from `git rebase` on unusual histories | Technical | Low | High | 155/155 fuzz parity in testing; path-ownership acceptance; the hazard suite in decision 13 |
| Expected-SHA leases refuse legitimate N=1 pushes | Integration | Medium | Medium | The ancestor rule covers ci-fix; the no-record path reproduces today's semantics; every push records a tip; `push_lease_refused` names both SHAs |
| Closed children moved by a restack ship without child-level re-validation until #2944 | Technical | Medium | Medium | Leaf whole-feature gates re-run; `wouldInvalidate` and `parentOverlapPaths` are emitted; member CI comes in #2945; the scope is handed to #2944 in a comment on the issue |
| User git config alters the engine's replays | Technical | Low | Medium | Pinned config on every engine replay |
| The `kickback-budget` change breaks consumer scripts | Integration | Low | Low | A `## Migration` block in the PR body |

## ADRs Created

- `adr-2026-10-10-stacked-restack-journaled-replay` (DRAFT → requires operator approval).

## Conditions

1. **Amendments.** Every ADR amendment listed in the new ADR is committed, as an
   `> **Amended 2026-10-10 by #2943:**` note on the target ADR, before landing.
2. **Typed values.** The plan types SHAs, ranges, cause and journal state; no bare strings cross
   module boundaries.
3. **N=1 golden suite.** #3019's suite stays byte-identical. The plan names it as a gate on every
   task that touches `performRebase`, `rebase-transition.ts` or `remote-git-operations.ts`.
4. **Commit sites.** The plan enumerates every engine commit site in a feature worktree. A test
   proves no unguarded engine `git commit` remains there.
5. **Hazard tests.** Every hazard in ADR decision 13 has a real-git test in a temporary repository,
   following the repository's process-isolation rules.
6. **Release.** The PR body carries a `## Migration` block for the `kickback-budget` change. A
   waiver is not acceptable.
7. **Hand-off to #2944.** The scope handed to #2944 is recorded as a comment on that issue before
   handoff.
