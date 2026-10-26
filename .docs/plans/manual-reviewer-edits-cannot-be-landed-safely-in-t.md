# Implementation Plan: Operator route round for closed stacked children (#3203)

**Date:** 2026-10-24
**Stories:** .docs/stories/manual-reviewer-edits-cannot-be-landed-safely-in-t.md
**Conflict check:** Clean as of 2026-10-24 (2 blocking and 12 degrading conflicts resolved; `.docs/conflicts/2026-10-24-manual-reviewer-edits-cannot-be-landed-safely-in-t.md`)
**Architecture:** `adr-2026-10-24-operator-route-round-for-closed-stacked-children`; `architecture-review-2026-10-24-manual-reviewer-edits-cannot-be-landed-safely-in-t` (APPROVED WITH CONDITIONS)
**Scope-exception:** 32 tasks; the operator declined splitting this design into separate specs on 2026-10-24 (adr-2026-10-24-operator-route-round-for-closed-stacked-children decision 19) and approved stacked delivery in three slices instead.

## Summary

An `operator` route kind on the shipped routed-repair machinery, with a feature dispatch lease, a token-owned park, `stack land`, a commit guard, close-over halts, closed-child `rewind`, `stack owners` and a shipped skill. 32 tasks in three stacked slices.

## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | Feature dispatch lease | 1, 2, 3 |
| 2 | Operator landing round | 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 32 |
| 3 | Closed-child rewind, owners, skill and parity | 27, 28, 29, 30, 31 |

## Technical Approach

- **Prerequisite: #3365.** Slice topology is read only through `loadSliceTopology`
  (`src/conductor/src/engine/slice-topology.ts`), and the cursor's unresolvable kind is
  `topology-unavailable`. Every new module joins #3365's slice-topology consumer-boundary allowlist.
- **Feature dispatch lease** (`src/conductor/src/engine/feature-dispatch-lease.ts`, new).
  - The lease is a directory lease under `<repo-root>/.daemon/leases/<slug>/` with an owner record
    `{host, pid, processStartTime, token, purpose}`.
  - Pattern basis: Task 1's steps.
  - Callers:
    - daemon dispatch, before `daemon-runner.ts` prepares the worktree;
    - the daemon re-kick;
    - the interactive conductor run constructed in `src/conductor/src/index.ts` (stacked features
      only, with no park re-check);
    - the four new operator commands.
- **Owned park.** `park-marker.ts` gains `createOwnedPark(root, slug)`, which returns
  `{created, token}`, and `releaseOwnedPark(root, slug, token)`, which deletes only while the marker
  still carries that token. `stack land` and `kickback-budget-cli.ts`'s temporary park use them.
- **Route kind `operator`** (`routing/route-types.ts`).
  - It carries an `operator` section: `origin`, `reason`, `operator`, `entryStep`, `park`,
    `carried`, `otherTips`, `priorRegion`, `declaration` and `abandon`.
  - It adds the host states `abandoning` and `abandoned` to `isLegalHostTransition` and to
    `hasConsistentRouteLifecycle`.
  - Every kind test becomes a `switch` ending in `assertNever`:
    - `restageHostRegion`, the revalidate pin, the derived-already-complete check and the no-op
      guard (`routing/host-region-entry.ts`);
    - settlement (`routing/round-receipt.ts`);
    - the queue close rule (`routing/revalidation-queue.ts`);
    - `resolveChildBase` (`child-cursor.ts`);
    - the revalidating-source check and the prerequisite-claim gate (`conductor.ts`).
- **Operator round module** (`routing/operator-round.ts`, new). It holds:
  - the three predicates (open, declare, abandon), each with a closed refusal union;
  - `openOperatorRound`, which reuses the pin and restage helpers that `enterHostRegion` uses;
    switches with `switchToChild`; and grants with `grantRoutedRepairCredit`;
  - `declareOperatorRound`;
  - the abandon stages, which reuse the `create-pin` and `update-branch` ops of
    `writeRoutingTransaction` and `syncRestackedWorktree`, following the reroute precedent in
    `routing/prerequisite-claim.ts` (pin, compare-and-swap reset, recorded tips, then a guarded
    sync).
- **CLI.** `src/conductor/src/engine/stack-land-cli.ts` and `stack-owners-cli.ts` are new. The
  `stack` command group is registered in `createProgram` (`src/conductor/src/cli.ts`), with
  detectors in `PRE_DISPATCH_COMMANDS` (`src/conductor/src/cli-pre-dispatch.ts`) and dispatch in
  `src/conductor/src/index.ts`. Neither command is in `SESSION_SANCTIONED_SUBCOMMANDS`.
  - Pattern basis and its no-TTY departure: Task 10's steps.
- **Commit guard.**
  - `src/conductor/src/engine/stack-commit-guard-cli.ts` (new) is invoked from the pre-commit body
    in `git-hook-assets.ts`, after the `CONDUCT_ENGINE_COMMIT` return and before the
    `phase-active` return.
  - It is dispatched from `index.ts` with a `CONDUCT_STACK_GUARD_PROJECT_ROOT` env var, and added to
    `SESSION_SANCTIONED_SUBCOMMANDS`.
- **Preflight and exit.**
  - `restack/stack-preflight.ts` gains the operator checks: undeclared round, moved branches, and
    the routing-on unlanded-commit halt. They run after both journal recoveries and before the
    base-refresh deferral and `reconcileRounds`, with the publication check first.
  - `routing/routed-exit.ts` gains the uncarried co-origin halt and the `abandon` mode of
    `returnToLeaf`.
  - `routing/round-admission.ts` `reconcileRounds` returns navigate results carrying `entryStep`,
    and an `abandoning` arm.
  - `conductor.ts` sets the region loop index to `entryStep`, as its post-exit paths do for
    `acceptance_specs`.
- **Work order.** `--done` writes the reason into `allocation[k].retryHint`. Build dispatch reads it
  back, and `assembleBuildReviewInputs` (`build-review-inputs.ts`) adds it as `operatorWorkOrder`
  inside the digested source snapshot.
- **Sequencing.** Slice 1 builds the lease, slice 2 the operator round, and slice 3 rewind, owners, the skill and parity.

## Prerequisites

- #3365 merged (the slice-topology loader and the `topology-unavailable` cursor kind). Merge `main`
  into this branch and re-verify the loader names before Task 6.
- No migration. Every new durable field fails closed in older binaries because the route-kind parser
  rejects unknown kinds.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D1 | task | task-6, task-7 | `parseRouteRecord` accepts an `operator` record with origin, reason, operator, entryStep, park, carried, otherTips, priorRegion, declaration and abandon fields |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D2 | task | task-1, task-2, task-3 | a request while the owner is alive returns `live-owner` naming the owner's purpose and pid |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D3 | task | task-4, task-11 | `releaseOwnedPark` removes a marker carrying its token and leaves in place a marker whose token differs or that was re-created by another `daemon park` |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D4 | task | task-8 | the refusals `round-open`, `queue-non-empty` and `journal-open` each name the open item |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D5 | task | task-9, task-10 | each leaving the worktree on `feat/c1/demo` with one open `operator` record |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D6 | task | task-12, task-13 | refuses tracked-file commits on `feat/c2/demo` and `feat/daemon-demo` during a landing on child 1 |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D7 | task | task-14 | reports `feat/c2/demo` with recorded and current tips after a `--no-verify` commit |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D8 | task | task-17, task-18 | writes a `needs-human` HALT with reason `unlanded-closed-child-commits` naming child 1 and the exact single-child command |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D9 | task | task-19, task-20, task-21, task-32 | the record's `declaration.tip` equals the host tip |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D10 | task | task-15, task-16, task-19 | `--done` removes an `operator-round-undeclared` HALT for its round |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D11 | task | task-27, task-28 | opens a declared `operator` round with origin `rewind` and `entryStep` `test_suite` |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D12 | task | task-7 | adds no gate lap, growth or taskless charge to the kickback ledger |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D13 | task | task-22, task-23, task-24 | `rejected/<roundId>/1` equals the abandoned tip |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D14 | task | task-29 | prints JSON listing children 1 and 2 with positions, branch names and slice titles |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D15 | task | task-30 | instructs running `ai-conductor stack owners` before proposing a child |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D16 | task | task-25, task-26 | a replayed drain leaves exactly one `operator_round` event per `eventId` in `events.jsonl` |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D17 | task | task-31 | no read or write under `.daemon/leases/` and no touch of `refs/conductor/<slug>/routes`, `repairing` or `revalidate` |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D18 | no-change | none | The guidance changes (runbook, skill catalog prose, operator documentation) are maintained outside plan tasks under the plan skill's documentation boundary. |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D19 | no-change | none | A delivery-shape decision: the plan carries it as its Scope-exception and slice manifest, and it changes no implementation. |
| adr-2026-10-12-routed-whole-feature-repair#D1 | task | task-9 | the record has kind `operator`, origin `land` and the reason |
| adr-2026-10-12-routed-whole-feature-repair#D2 | existing | none | `deriveTaskBoundOwner` in `src/conductor/src/engine/routing/owner-derivation.ts` derives task-bound owners. |
| adr-2026-10-12-routed-whole-feature-repair#D3 | existing | none | The residue-routing judgement is `resolveResidueOwner` in `src/conductor/src/engine/routing/residue-routing-call.ts`. |
| adr-2026-10-12-routed-whole-feature-repair#D4 | existing | none | `currentHostOf` and `validatedReroute` in `src/conductor/src/engine/routing/route-types.ts` keep owner and host separate. |
| adr-2026-10-12-routed-whole-feature-repair#D5 | task | task-7 | a verified-shape claim in an `operator` round never calls `rerouteRound` |
| adr-2026-10-12-routed-whole-feature-repair#D6 | task | task-6 | `isLegalHostTransition` allows `admitted→abandoning`, `repairing→abandoning` and `abandoning→abandoned` |
| adr-2026-10-12-routed-whole-feature-repair#D7 | task | task-15, task-20 | a declared landing's preflight returns a navigate result for child 1 |
| adr-2026-10-12-routed-whole-feature-repair#D8 | task | task-18, task-27 | restacks with `originatingChildren` `[1, 2]` |
| adr-2026-10-12-routed-whole-feature-repair#D9 | existing | none | Region-entry appends and the deterministic replay merge are `enterHostRegion` in `src/conductor/src/engine/routing/host-region-entry.ts` and `unionRemBlocks` in `src/conductor/src/engine/routing/rem-block-merge.ts`. |
| adr-2026-10-12-routed-whole-feature-repair#D10 | task | task-7 | acknowledges the receipt with no `settlementId` |
| adr-2026-10-12-routed-whole-feature-repair#D11 | existing | none | Round-keyed repair obligations are admitted by `admitRoutedObligation` in `src/conductor/src/engine/repair-restage.ts`, which requires a valid round id. |
| adr-2026-10-12-routed-whole-feature-repair#D12 | task | task-21 | `assembleBuildReviewInputs` for an `operator` host includes `operatorWorkOrder` equal to the round's reason |
| adr-2026-10-12-routed-whole-feature-repair#D13 | task | task-18, task-27 | with a repair commit the exit restack originates at child 1 and re-validates child 2 |
| adr-2026-10-12-routed-whole-feature-repair#D14 | task | task-18 | the `applied` transaction queues child 2 |
| adr-2026-10-12-routed-whole-feature-repair#D15 | task | task-23 | leaf whole-feature statuses and verdict files are byte-identical to before the landing |
| adr-2026-10-12-routed-whole-feature-repair#D16 | existing | none | The transactional outbox is `withOutboxEvent` in `src/conductor/src/engine/routing/routing-events.ts`, drained by `drainRoutingOutboxes` in `src/conductor/src/engine/routing/route-record-store.ts`. |
| adr-2026-10-12-routed-whole-feature-repair#D17 | existing | none | `routingEligible` in `src/conductor/src/engine/routing/route-types.ts` is false for a flat cursor, so N=1 never reaches the router. |
| adr-2026-10-12-routed-whole-feature-repair#D18 | existing | none | `routingSettingOn` in `src/conductor/src/engine/routing/route-types.ts` reads `stacked_prs.route_whole_feature_fixes`. |
| adr-2026-10-10-stacked-restack-journaled-replay#D1 | existing | none | `runStackPreflight` in `src/conductor/src/engine/restack/stack-preflight.ts` serves stacked features only, and N=1 rebases stay on `performRebase` in `src/conductor/src/engine/rebase.ts`. |
| adr-2026-10-10-stacked-restack-journaled-replay#D2 | existing | none | Range computation is `planRestackRanges` in `src/conductor/src/engine/restack/restack-plan.ts`. |
| adr-2026-10-10-stacked-restack-journaled-replay#D3 | existing | none | Off-worktree replay and path-ownership acceptance are `replayChildRange` in `src/conductor/src/engine/restack/restack-replay.ts` and `checkPathOwnership` in `src/conductor/src/engine/restack/restack-ownership.ts`. |
| adr-2026-10-10-stacked-restack-journaled-replay#D4 | existing | none | The ref-backed journal is `createRestackJournal` and `journalStateUpdateLines` in `src/conductor/src/engine/restack/restack-journal.ts`. |
| adr-2026-10-10-stacked-restack-journaled-replay#D5 | existing | none | The atomic move and loss-free sync are `applyRestackMove` in `src/conductor/src/engine/restack/restack-move.ts` and `syncRestackedWorktree` in `src/conductor/src/engine/restack/restack-sync.ts`. |
| adr-2026-10-10-stacked-restack-journaled-replay#D6 | existing | none | Conflict hand-off and halt are `resolveRestackConflict` in `src/conductor/src/engine/restack/restack-resolver.ts` and `haltRestackConflict` in `src/conductor/src/engine/restack/restack-move.ts`. |
| adr-2026-10-10-stacked-restack-journaled-replay#D7 | existing | none | The one shared preflight is `runStackPreflight` in `src/conductor/src/engine/restack/stack-preflight.ts`. |
| adr-2026-10-10-stacked-restack-journaled-replay#D8 | existing | none | Closed-child invalidation is `queueInvalidation` and `applyRestackTransition` in `src/conductor/src/engine/restack/restack-transition.ts`. |
| adr-2026-10-10-stacked-restack-journaled-replay#D9 | task | task-17, task-27 | writes a `needs-human` HALT with reason `unlanded-closed-child-commits` naming child 1 and the exact single-child command, runs no restack, and moves no ref |
| adr-2026-10-10-stacked-restack-journaled-replay#D10 | existing | none | The per-child cascade cap is `checkCascadeCap` and `applyCascadeAdjustment` in `src/conductor/src/engine/restack/cascade-cap.ts`. |
| adr-2026-10-10-stacked-restack-journaled-replay#D11 | existing | none | Lease-guarded pushes are `executeRemoteGit` in `src/conductor/src/engine/remote-git-operations.ts`; this spec pushes nothing. |
| adr-2026-10-10-stacked-restack-journaled-replay#D12 | existing | none | Restack refusals are emitted by `emitRestackRefused` in `src/conductor/src/engine/restack/restack-events.ts` with `child`. |
| adr-2026-10-10-stacked-restack-journaled-replay#D13 | no-change | none | The proof obligations bind the restack's own mechanics, which this spec does not change. |
| adr-2026-10-07-per-child-build-region#D1 | existing | none | The git-derived cursor and monotone closure ref are `resolveActiveChild` in `src/conductor/src/engine/child-cursor.ts` and `closeChild` in `src/conductor/src/engine/child-lifecycle.ts`. |
| adr-2026-10-07-per-child-build-region#D2 | task | task-17 | with routing off a raw commit runs the `feature-repair` restack moving `closed/c1` to the new tip with no HALT |
| adr-2026-10-07-per-child-build-region#D3 | existing | none | Child creation, switching and the leaf move are `startChild`, `switchToChild` and `moveLeaf` in `src/conductor/src/engine/child-lifecycle.ts`. |
| adr-2026-10-07-per-child-build-region#D4 | task | task-22, task-27 | with the statuses restored through the conduct-state mutation port |
| adr-2026-10-07-per-child-build-region#D5 | existing | none | Per-child acceptance evidence resolves through `pipelinePathFor` in `src/conductor/src/engine/child-context.ts`, used by `src/conductor/src/engine/acceptance-red-runner.ts`. |
| adr-2026-10-07-per-child-build-region#D6 | existing | none | Per-child build state resolves through `pipelinePathFor` in `src/conductor/src/engine/child-context.ts`, used by `src/conductor/src/engine/step-runners.ts`. |
| adr-2026-10-07-per-child-build-region#D7 | existing | none | Per-child `test_suite` evidence resolves through `pipelinePathFor` in `src/conductor/src/engine/full-suite-evidence.ts`. |
| adr-2026-10-07-per-child-build-region#D8 | existing | none | `resolveChildBase` in `src/conductor/src/engine/child-cursor.ts` is the one base producer and already returns `routed-repair` with the pinned closure for a routed host. |
| adr-2026-10-07-per-child-build-region#D9 | existing | none | Child-local `build_review` takes its base from `resolveChildBase` in `src/conductor/src/engine/build-review-inputs.ts`. |
| adr-2026-10-07-per-child-build-region#D10 | existing | none | Per-child caps are `bumpKickbackGate` and `bumpKickbackGateInLedger` in `src/conductor/src/engine/kickback-ledger.ts`. |
| adr-2026-10-07-per-child-build-region#D11 | task | task-10, task-27, task-29 | sets child 1's `test_suite` and `build_review` pending, removes `.pipeline/HALT`, and leaves child 2's and the leaf's conduct state byte-identical |
| adr-2026-10-07-per-child-build-region#D12 | no-change | none | The rebase guard was already lifted by `adr-2026-10-10-stacked-restack-journaled-replay` decision 9; this spec changes no rebase guard. |
| adr-2026-10-07-per-child-build-region#D13 | existing | none | `child_started`, `child_switched` and `child_closed` are emitted in `src/conductor/src/engine/child-lifecycle.ts`; unchanged. |
| adr-2026-10-07-per-child-build-region#D14 | existing | none | `hasDurableChildState` in `src/conductor/src/engine/child-cursor.ts` keeps a feature with no child on the flat path. |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D1 | task | task-27 | refusals naming the missing HALT, the missing reason, #3268 for a published stack, and the live lease owner |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D2 | task | task-27 | sets child 1's `test_suite` and `build_review` pending |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D3 | task | task-27 | leaves child 2's and the leaf's conduct state byte-identical |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D4 | task | task-27 | child 1's `test_suite` and `build_review` verdict files are cleared, the HALT is removed only after the route record is admitted |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D5 | task | task-27 | `operator_rewind` is persisted with `child: 1` and target `test_suite` |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D6 | existing | none | `detectRewindCommand` and `dispatchRewindCommand` in `src/conductor/src/engine/rewind.ts` are reached only from the CLI entry `src/conductor/src/index.ts`. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D1 | existing | none | `parseFeatureBranch`, `childBranchFor` and `leafBranchFor` in `src/conductor/src/engine/feature-branch-identity.ts` stay the only branch-identity owner. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D2 | existing | none | Child arms ahead of non-child logic, e.g. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D3 | no-change | none | Attribution is not authority: `stack owners` reports attribution and the operator confirms the child (new ADR decisions 14 and 15), so the rule is followed, not changed. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D4 | existing | none | The reserved `feat/c<k>` namespace is parsed by `parseFeatureBranch` and `isChildRefOf` in `src/conductor/src/engine/feature-branch-identity.ts`. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D5 | existing | none | Child ids are bounded by `MAX_CHILD_ID` in `src/conductor/src/engine/child-context.ts`; unchanged. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D6 | existing | none | The leaf is `feat/daemon-<slug>` via `leafBranchFor` in `src/conductor/src/engine/feature-branch-identity.ts`. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D7 | no-change | none | Positions stay immutable; this spec only reads the sealed positions and changes none. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D8 | existing | none | Per-child state under `.pipeline/children/<k>/` is `pipelinePathFor` and `childStateExists` in `src/conductor/src/engine/child-context.ts`. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D9 | existing | none | Region caps per child are `bumpKickbackGate` in `src/conductor/src/engine/kickback-ledger.ts`; unchanged. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D10 | existing | none | The active-child contract is `resolveActiveChild` in `src/conductor/src/engine/child-cursor.ts`; unchanged. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D11 | existing | none | The base-override producer is `resolveChildBase` in `src/conductor/src/engine/child-cursor.ts`; unchanged. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D12 | existing | none | Routing events carry the optional `child` (`routedRepairPhaseEvent` and `childRevalidatedEvent` in `src/conductor/src/engine/routing/routing-events.ts`). |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D13 | task | task-27 | with `.pipeline/children/1/` absent the rewind succeeds |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D14 | existing | none | `hasDurableChildState` in `src/conductor/src/engine/child-cursor.ts` keeps N=1 structural. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D15 | no-change | none | An operator round's host region runs only region steps. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D1 | existing | none | Publication is decided from durable state through `activePublicationRecord` in `src/conductor/src/engine/stack-publication-record.ts`. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D2 | existing | none | The ref-backed record is `publicationRefFor` and `readPublicationRecord` in `src/conductor/src/engine/stack-publication-record.ts`. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D3 | no-change | none | This spec adds no FINISH publication transition; operator rounds are refused on a published stack. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D4 | no-change | none | This spec pushes and opens no child PR. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D5 | no-change | none | This spec retargets no leaf and assembles no stack. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D6 | no-change | none | This spec renders no PR body. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D7 | no-change | none | This spec flips no member ready. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D8 | no-change | none | This spec changes no required check or CI trigger. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D9 | no-change | none | The ship gate is unchanged; this spec records no ship. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D10 | no-change | none | This spec changes no sweep observation of non-leaf lifecycle. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D11 | task | task-8, task-10, task-17, task-27 | with an active publication record the HALT class is `needs-human` with reason `published-stack` naming child 1 and no `unlanded-closed-child-commits` HALT is written |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D12 | no-change | none | This spec deletes no child branch; abandon resets `feat/c<k>` to its closure and pins the abandoned tip under `rejected/`. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D13 | no-change | none | This spec adds no remote write; `stack land`, `stack owners` and the rewind are local. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D14 | no-change | none | This spec adds no publication event; its new `operator_round` event belongs to the new ADR's decision 16. |
| adr-2026-07-13-kickback-build-no-op-escalation#D1 | task | task-7 | an `operator` host entry runs neither `checkStepCompletion('build')` nor the route-into-no-op guard |
| adr-2026-07-13-kickback-build-no-op-escalation#D2 | existing | none | Zero-progress plus unchanged-verdict escalation is `classifyBuildProgress` and `shouldEscalateKickback` in `src/conductor/src/engine/kickback-escalation.ts`. |
| adr-2026-07-13-kickback-build-no-op-escalation#D3 | existing | none | The did-work versus no-work distinction is `classifyBuildProgress` in `src/conductor/src/engine/kickback-escalation.ts`, recorded on the existing `kickback` event. |

## Tasks

### Task 1: Add the feature dispatch lease
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/feature-dispatch-lease.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `feature-dispatch-lease.ts` at `<repo-root>/.daemon/leases/<slug>/`. Copy `createConductStateLease`'s directory-lease shape (owner record, recovery claim, refusal on an unreadable owner) and `isJournalOwnerAlive`'s pid plus start-time liveness. The lease is keyed by slug at the repository root, not by store path. The heartbeat of `otel/spool-lease.ts` is a verified no-fit.
4. Verify GREEN and commit.

**Done when:**
- [test] `feature-dispatch-lease.test.ts` asserts `acquireFeatureDispatchLease` on a free lease writes an owner record carrying pid, process start time, token and purpose, and `release` removes it.
- [test] `feature-dispatch-lease.test.ts` asserts a request while the owner is alive returns `live-owner` naming the owner's purpose and pid, and the owner record is byte-identical after the refusal.
- [test] `feature-dispatch-lease.test.ts` asserts an owner with a dead pid, or a pid whose start time differs, is reclaimed by the next acquire, and an unparseable owner record returns `unreadable-owner` naming the lease path with no reclaim.

**Files likely touched:**
- `src/conductor/src/engine/feature-dispatch-lease.ts` — new lease
- `src/conductor/test/engine/feature-dispatch-lease.test.ts` — new tests

**Dependencies:** none

### Task 2: Take the lease on daemon dispatch and re-kick before worktree preparation
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-dispatch-lease.test.ts` for every Done-when check below.
2. Verify RED.
3. Wire `acquireFeatureDispatchLease` into the daemon dispatch path (`daemon.ts` `guardedDispatchWith` / `daemon-runner.ts` before `prepareWorktree`) and into `daemon-rekick.ts` (dispatch and `rekickSweep`, before `abortRebase` and `clearMarker`). Re-check `isOperatorParked` after acquiring, and map both skips to the existing dispatch-skip outcome. Only features with durable child state take the lease.
4. Verify GREEN and commit.

**Done when:**
- [test] `daemon-dispatch-lease.test.ts` asserts the recorded order is lease acquire, then `prepareWorktree`, then lease release at unit end, for both the daemon dispatch path and the re-kick path of a stacked feature, and that `rekickSweep` acquires the lease before `abortRebase` and `clearMarker` and skips a slug whose lease a live owner holds.
- [test] `daemon-dispatch-lease.test.ts` asserts a daemon dispatch and a re-kick that each find the park marker after acquiring release the lease, skip the unit, never call `prepareWorktree`, and write no `.pipeline/HALT`.
- [test] `daemon-dispatch-lease.test.ts` asserts a dispatch facing a live operator-held lease never acquires it, leaves the operator's owner record byte-identical and the worktree's HEAD, index and files unchanged, skips the unit, writes no `.pipeline/HALT`, and never calls `prepareWorktree`.
- [test] `daemon-dispatch-lease.test.ts` asserts a flat feature's dispatch performs no read or write under `.daemon/leases/`, and each lease skip is recorded through the existing dispatch-skip outcome with reason `feature-lease-held` or `parked-after-lease`, with no new event member.

**Files likely touched:**
- `src/conductor/src/engine/daemon.ts`
- `src/conductor/src/engine/daemon-runner.ts`
- `src/conductor/src/engine/daemon-rekick.ts`
- `src/conductor/test/engine/daemon-dispatch-lease.test.ts`

**Dependencies:** Task 1

### Task 3: Take the lease on interactive conductor runs without consulting the park
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/interactive-run-lease.test.ts` for every Done-when check below.
2. Verify RED.
3. In the interactive construction in `src/conductor/src/index.ts`, acquire the lease for stacked features before the conductor's first mutation and release it on exit. Do not add the boundary park predicate (boundary parking stays daemon-only).
4. Verify GREEN and commit.

**Done when:**
- [test] `interactive-run-lease.test.ts` asserts an interactive run started through the `ai-conductor` run entry in `index.ts` on a stacked feature with a park marker present acquires the lease before any worktree preparation or conduct-state write and starts its first step without reading `.daemon/parked/demo`.
- [test] `interactive-run-lease.test.ts` asserts an interactive run facing a live lease owner exits non-zero naming the owner's purpose and pid, and dispatches no step.

**Files likely touched:**
- `src/conductor/src/index.ts`
- `src/conductor/test/engine/interactive-run-lease.test.ts`

**Dependencies:** Task 1

### Task 4: Give park creation an ownership token
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/park-marker-ownership.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement both functions in `park-marker.ts` with `wx` creation. Keep the marker body readable by `isOperatorParked` and `getProvenanceType` (never starting with `auto-parked:`).
4. Verify GREEN and commit.

**Done when:**
- [test] `park-marker-ownership.test.ts` asserts `createOwnedPark` returns `created: true` with a token for a fresh slug, `created: false` for an existing marker, and exactly one `created: true` across two concurrent calls.
- [test] `park-marker-ownership.test.ts` asserts `releaseOwnedPark` removes a marker carrying its token and leaves in place a marker whose token differs or that was re-created by another `daemon park`.
- [test] `park-marker-ownership.test.ts` asserts `isOperatorParked` returns true for an owned marker and `getProvenanceType` reports it as operator provenance.

**Files likely touched:**
- `src/conductor/src/engine/park-marker.ts`
- `src/conductor/test/engine/park-marker-ownership.test.ts`

**Dependencies:** none

### Task 5: Release only an owned park in kickback-budget
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/kickback-budget-owned-park.test.ts` for every Done-when check below.
2. Verify RED.
3. Replace the temporary park's boolean ownership in `kickback-budget-cli.ts` with `createOwnedPark` and `releaseOwnedPark`.
4. Verify GREEN and commit.

**Done when:**
- [test] `kickback-budget-owned-park.test.ts` asserts that after another process re-creates the park marker during `raise`, the command's release leaves `.daemon/parked/<slug>` present.
- [test] `kickback-budget-owned-park.test.ts` asserts a `raise` that created the park removes it on completion, as before.

**Files likely touched:**
- `src/conductor/src/engine/kickback-budget-cli.ts`
- `src/conductor/test/engine/kickback-budget-owned-park.test.ts`

**Dependencies:** Task 4

### Task 6: Add the `operator` route kind, its section and its host states
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/route-types.test.ts` for every Done-when check below.
2. Verify RED.
3. Extend `RouteKind`, the parser set, `RouteRecord` and the host-state union in `routing/route-types.ts`. `sealedAuthored` is set from `routedSealedAuthored`.
4. Verify GREEN and commit.

**Done when:**
- [test] `route-types.test.ts` asserts `parseRouteRecord` accepts an `operator` record with origin, reason, operator, entryStep, park, carried, otherTips, priorRegion, declaration and abandon fields, and rejects an `operator` record without the section and an `audit` record with one.
- [test] `route-types.test.ts` asserts `isLegalHostTransition` allows `admitted→abandoning`, `repairing→abandoning` and `abandoning→abandoned` and refuses `built→abandoning`, and `hasConsistentRouteLifecycle` accepts a closed round with an `abandoned` host.

**Files likely touched:**
- `src/conductor/src/engine/routing/route-types.ts`
- `src/conductor/test/engine/routing/route-types.test.ts`

**Dependencies:** none

### Task 7: Make every route-kind test exhaustive, and give `operator` its branches
**Story:** Story 11
**Type:** happy-path

**Steps:**
1. Write failing tests in `routing/round-receipt.test.ts`, `routing/prerequisite-reroute.realgit.test.ts`, `routing/host-region-entry.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Convert every kind test listed in the Technical Approach to a `switch` ending in `assertNever`, and add the `operator` arms. Disable the prerequisite-claim gate in `conductor.ts` for `operator` rounds.
4. Verify GREEN and commit.

**Done when:**
- [test] `round-receipt.test.ts` asserts an `operator` round's build dispatch adds no gate lap, growth or taskless charge to the kickback ledger and acknowledges the receipt with no `settlementId`.
- [test] `prerequisite-reroute.realgit.test.ts` asserts a verified-shape claim in an `operator` round never calls `rerouteRound`, the marker host stays 1, and `feat/c1/demo` keeps its tip.
- [test] `host-region-entry.realgit.test.ts` asserts an `operator` host entry runs neither `checkStepCompletion('build')` nor the route-into-no-op guard, and `child-cursor.test.ts` asserts `resolveChildBase` returns `routed-repair` with the pinned closure for that host.
- [test] A conductor-level kickback test asserts an `operator` round whose kickbacks exhaust child 1's `build_review` cap and credit writes a HALT with today's cap halt class naming child 1.
- [test] `revalidation-queue.test.ts` asserts acknowledging an `operator` host follows the `audit` close rule, a conductor test asserts an `operator` host is not treated as a revalidating source, and `tsc --noEmit` passes with every route-kind switch ending in `assertNever`.

**Files likely touched:**
- `src/conductor/src/engine/routing/host-region-entry.ts`
- `src/conductor/src/engine/routing/round-receipt.ts`
- `src/conductor/src/engine/routing/revalidation-queue.ts`
- `src/conductor/src/engine/child-cursor.ts`
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/routing/round-receipt.test.ts`
- `src/conductor/test/engine/routing/prerequisite-reroute.realgit.test.ts`
- `src/conductor/test/engine/routing/host-region-entry.realgit.test.ts`
- `src/conductor/test/engine/child-cursor.test.ts`

**Dependencies:** Task 6

### Task 8: Add the open predicate and its refusal set
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/operator-round-predicates.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `checkOpenOperatorRound` in `routing/operator-round.ts`, returning a closed refusal union. It reads topology through `loadSliceTopology`, publication through `publishedStackRefusal`, and open state through `routedRoundOpen` and `routingFenceOpen`.
4. Verify GREEN and commit.

**Done when:**
- [test] `operator-round-predicates.test.ts` asserts `checkOpenOperatorRound` returns `published-stack` naming #3268, `leaf-target` naming child 3, `unknown-position` naming 1, 2 and 3, `target-open` for a child without a closure ref, `topology-unavailable` naming the #3365 cause, `not-stacked`, and `routing-off`, that every refusal's text names its next command, and that refs, the park marker and state files are byte-identical after each.
- [test] `operator-round-predicates.test.ts` asserts the refusals `round-open`, `queue-non-empty` and `journal-open` each name the open item and leave the existing route record, queue ref and journal ref byte-identical, `dirty-worktree` leaves the uncommitted change intact on `feat/daemon-demo`, and `reason-missing` fires for empty and whitespace reasons.
- [test] `operator-round-predicates.test.ts` asserts `verify-green-contract-missing` for a child that owns criteria with neither `red/c1` nor `acceptance-specs-run.json`, and acceptance for a child with no owned criteria.
- [test] `operator-round-predicates.test.ts` asserts `uncarried-commits` names child 2 and the exact `ai-conductor stack land --slug demo --child 1 --carry 2 --reason "<why>"` command, and `carried-below-host` names `stack land --child 1 --carry 2`.
- [test] `operator-round-predicates.test.ts` asserts a flat feature's check performs no read of `refs/conductor/<slug>/routes`, `repairing`, `revalidate` or `.daemon/leases/`.

**Files likely touched:**
- `src/conductor/src/engine/routing/operator-round.ts`
- `src/conductor/test/engine/routing/operator-round-predicates.test.ts`

**Dependencies:** Task 6

### Task 9: Open an operator round and enter its host
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/operator-round-open.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `openOperatorRound` in `routing/operator-round.ts`, in this order:
   1. `createRouteRecord` `prepared` with the full section, `priorRegion` read before any mutation;
   2. `writeGitHooksAndWire`;
   3. the shipped marker transaction;
   4. pin the entry;
   5. `switchToChild`;
   6. `restageHostRegion`;
   7. `repairing`;
   8. `grantRoutedRepairCredit`.

   Reuse the pin and restage helpers that `enterHostRegion` uses, exported from `routing/host-region-entry.ts` rather than copied. Each stage is recorded and idempotent.
4. Verify GREEN and commit.

**Done when:**
- [test] `operator-round-open.realgit.test.ts` asserts that after `openOperatorRound` the checked-out branch is `feat/c1/demo`, `refs/conductor/demo/repairing` names host 1, the record has kind `operator`, origin `land` and the reason, and child 1's region shows `acceptance_specs`, `test_suite` and `build_review` pending with `build` done.
- [test] `operator-round-open.realgit.test.ts` asserts that pre-existing commits past `closed/c1` remain on the branch and the record's pinned base equals the `closed/c1` tip.
- [test] `operator-round-open.realgit.test.ts` asserts a crash after the marker transaction followed by a re-run performs the switch, pin and restage exactly once each, and the feature has exactly one non-closed route record.

**Files likely touched:**
- `src/conductor/src/engine/routing/operator-round.ts`
- `src/conductor/src/engine/routing/host-region-entry.ts`
- `src/conductor/test/engine/routing/operator-round-open.realgit.test.ts`

**Dependencies:** Tasks 7, 8

### Task 10: Ship `ai-conductor stack land` (open) with the lease and an owned park
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-land-cli.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `stack-land-cli.ts` (open path). Register the `stack` group and `land` in `createProgram` (`cli.ts`), add its detector to `PRE_DISPATCH_COMMANDS` (`cli-pre-dispatch.ts`), and dispatch from `index.ts`. Follow `kickback-budget-cli.ts`: refusals before mutation, `createOwnedPark` (recording the token only when created), `resolveMachineOperatorIdentity`, and each refusal emitted before exit. No TTY guard.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-land-cli.test.ts` asserts `ai-conductor stack land --slug demo --child 1 --reason "…"` exits 0 for a clean child 1, for a child 1 carrying pre-existing commits, for a child 1 with no owned criteria, and on a re-run after a crash following the marker transaction, each leaving the worktree on `feat/c1/demo` with one open `operator` record, the lease owner record naming the command's pid at every recorded mutation, the lease released after exit and `.daemon/parked/demo` present.
- [test] `stack-land-cli.test.ts` asserts that against a live lease owner the command exits non-zero naming the owner's purpose and pid, and refs, the park marker and state files are byte-identical.
- [test] `stack-land-cli.test.ts` asserts `stack land --slug demo --child 1 --carry 2 --reason "…"` opens one round with host 1 and `carried` `[2]` and removes an `unlanded-closed-child-commits` HALT naming children 1 and 2, `stack land --child 1` removes such a HALT naming child 1 alone, while `stack land --child 1` without `--carry 2` exits non-zero and leaves that HALT byte-identical.
- [test] `stack-land-cli.test.ts` asserts `stack land` exits non-zero with stderr naming the cause for each refusal: `published-stack` with #3268, the leaf, an undeclared position naming 1, 2 and 3, a flat feature named as not stacked with no lease read or written, routing off naming `stacked_prs.route_whole_feature_fixes`, an open round, queue or journal naming which, a dirty worktree, a missing reason, a missing verify-green contract, an uncarried child 2 naming the `--carry 2` command, a carried child below the host naming `stack land --child 1 --carry 2`, and an unreadable lease owner record that is not reclaimed; empty and whitespace-only reasons are both refused; every refusal leaves refs, the park marker, state files and the lease owner record byte-identical and the worktree on `feat/daemon-demo` with any uncommitted change intact; and a flat feature's refusal reads no `routes`, `repairing` or `revalidate` ref.
- [test] `stack-land-cli.test.ts` asserts a run with `CONDUCT_DAEMON_SESSION=1` is refused as not sanctioned in a daemon session with nothing changed, and `pre-dispatch-registry.test.ts` passes its set-equality check with `stack land` registered.

**Files likely touched:**
- `src/conductor/src/engine/stack-land-cli.ts`
- `src/conductor/src/cli.ts`
- `src/conductor/src/cli-pre-dispatch.ts`
- `src/conductor/src/index.ts`
- `src/conductor/test/engine/stack-land-cli.test.ts`
- `src/conductor/test/cli/pre-dispatch-registry.test.ts`

**Dependencies:** Tasks 1, 4, 9, 17

### Task 11: Release only the owned park at `--done`
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-land-park.test.ts` for every Done-when check below.
2. Verify RED.
3. Make the release in `stack-land-cli.ts` go through `releaseOwnedPark` with the round's recorded token.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-land-park.test.ts` asserts `.daemon/parked/demo` exists between open and `--done` for a landing that created it and is absent after `--done`, while an operator's earlier park is still present after `--done`.
- [test] `stack-land-park.test.ts` asserts `--done` leaves a marker re-created by another `daemon park` in place, and a round that lost the park race records no token and never deletes the marker.
- [test] `stack-land-park.test.ts` asserts a crash injected after parking and before the `prepared` record leaves `.daemon/parked/demo` present and the daemon backlog filter excludes `demo`.

**Files likely touched:**
- `src/conductor/src/engine/stack-land-cli.ts`
- `src/conductor/test/engine/stack-land-park.test.ts`

**Dependencies:** Tasks 10, 19

### Task 12: Add the commit guard
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-commit-guard.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `stack-commit-guard-cli.ts`. Classify the branch with `parseFeatureBranch` and read positions through `loadSliceTopology`. Abstain before any routing read when the feature has no durable child state.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-commit-guard.test.ts` asserts `runStackCommitGuard` refuses tracked-file commits on `feat/c2/demo` and `feat/daemon-demo` during a landing on child 1, both without a trailer and with `Task: 4`, naming `feat/c1/demo` and `stack land --abandon`, and accepts host commits and a halt-record-only commit on `feat/daemon-demo`.
- [test] `stack-commit-guard.test.ts` asserts that during an `audit` round hosted on child 1 a commit on `feat/c2/demo` is refused naming host child 1.
- [test] `stack-commit-guard.test.ts` asserts that after declaration a host commit without `CONDUCT_DAEMON_SESSION` is refused naming the declaration, and one with `CONDUCT_DAEMON_SESSION=1` passes.
- [test] `stack-commit-guard.test.ts` asserts an unreadable route record with a marker present refuses naming it, and a flat feature exits 0 with no read of `refs/conductor/<slug>/repairing`, `routes` or `revalidate`.

**Files likely touched:**
- `src/conductor/src/engine/stack-commit-guard-cli.ts`
- `src/conductor/test/engine/stack-commit-guard.test.ts`

**Dependencies:** Task 6

### Task 13: Wire the commit guard into the pre-commit hook
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-commit-guard.hook.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Add the guard step to the pre-commit body in `git-hook-assets.ts`, after the `CONDUCT_ENGINE_COMMIT` return and before the `phase-active` return. Dispatch `stack-commit-guard` from `index.ts` with `CONDUCT_STACK_GUARD_PROJECT_ROOT`, register its detector in `cli-pre-dispatch.ts`, and add it to `SESSION_SANCTIONED_SUBCOMMANDS`.
   Export `writeGitHooksAndWire` from `worktree-prepare.ts` for `openOperatorRound`. Fixture commits made by a fake provider on a declared host in other tests must carry `CONDUCT_DAEMON_SESSION=1` once this guard is installed.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-commit-guard.hook.realgit.test.ts` asserts that on a worktree whose `.pipeline/git-hooks/pre-commit` lacks the guard, `openOperatorRound` leaves it containing the `stack-commit-guard` invocation before returning.
- [test] `stack-commit-guard.hook.realgit.test.ts` asserts `git commit` on `feat/c2/demo` exits non-zero through the installed pre-commit hook with no `.pipeline/phase-active` present, and `git commit` on `feat/c1/demo` succeeds.
- [test] `daemon-session-enforcement.test.ts` asserts `stack-commit-guard` is in `SESSION_SANCTIONED_SUBCOMMANDS` and `stack land` and `stack owners` are not.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/src/engine/worktree-prepare.ts`
- `src/conductor/src/index.ts`
- `src/conductor/src/cli-pre-dispatch.ts`
- `src/conductor/src/execution/daemon-session.ts`
- `src/conductor/test/engine/stack-commit-guard.hook.realgit.test.ts`
- `src/conductor/test/execution/daemon-session-enforcement.test.ts`

**Dependencies:** Tasks 9, 12

### Task 14: Check recorded branch tips at `--done` and in the preflight
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/operator-tip-check.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `checkOperatorTips` in `routing/operator-round.ts` and call it from `restack/stack-preflight.ts` for an open operator round with host `admitted` or `repairing`, before the undeclared-round check. Add the one reason-line helper (`formatOperatorHaltReason` and `parseOperatorHaltReason`, line `Operator-Halt: <reason> <roundId>`) that every operator halt writer and clearer uses.
4. Verify GREEN and commit.

**Done when:**
- [test] `operator-tip-check.realgit.test.ts` asserts `checkOperatorTips` reports `feat/c2/demo` with recorded and current tips after a `--no-verify` commit, reports a moved carried child with both tips, and ignores a halt-record-only leaf commit.
- [test] `operator-tip-check.realgit.test.ts` asserts the HALT's reason line round-trips through `parseOperatorHaltReason`, and `runStackPreflight` writes a `needs-human` HALT with reason `operator-round-branch-moved` (not `operator-round-undeclared`) naming `feat/daemon-demo`, moves no ref and runs no restack when the leaf moved during an undeclared landing.
- [test] `operator-tip-check.realgit.test.ts` asserts that after the exit restack moved `feat/c2/demo` and the leaf, the resumed preflight reports no moved branch and resumes the round.

**Files likely touched:**
- `src/conductor/src/engine/routing/operator-round.ts`
- `src/conductor/src/engine/restack/stack-preflight.ts`
- `src/conductor/test/engine/routing/operator-tip-check.realgit.test.ts`

**Dependencies:** Task 9

### Task 15: Halt on an undeclared landing before any dispatch or restack
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/stack-preflight-operator.test.ts` for every Done-when check below.
2. Verify RED.
3. In `restack/stack-preflight.ts`, after both journal recoveries and before the base-refresh deferral and `reconcileRounds`, read the open operator round and halt through the preflight's existing halt path with a machine-readable reason line.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-preflight-operator.test.ts` asserts `runStackPreflight` writes a `needs-human` HALT with reason `operator-round-undeclared` whose text names the round id, child 1, `stack land --done` and `stack land --abandon`, that no branch, closure ref or route record changed, and that no restack, region step or routed exit ran.
- [test] `stack-preflight-operator.test.ts` asserts that with a due base refresh the halt precedes the deferral, no ref moves, the re-kick request file remains, and `events.jsonl` has no `restack_refused` with reason `deferred-base-refresh`.
- [test] `stack-preflight-operator.test.ts` asserts a declared landing's preflight returns a navigate result for child 1 and writes no HALT.

**Files likely touched:**
- `src/conductor/src/engine/restack/stack-preflight.ts`
- `src/conductor/test/engine/restack/stack-preflight-operator.test.ts`

**Dependencies:** Tasks 9, 14

### Task 16: Refuse an undeclared operator round at region entry
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/host-region-entry.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Add the undeclared-operator refusal to `enterHostRegion` for dispatch-side callers. `openOperatorRound` does not call `enterHostRegion`.
4. Verify GREEN and commit.

**Done when:**
- [test] `host-region-entry.realgit.test.ts` asserts `enterHostRegion` returns an `operator-round-undeclared` refusal for an undeclared landing, and the conductor test asserts a `needs-human` HALT with no provider dispatch.
- [test] `operator-round-open.realgit.test.ts` still passes, showing `openOperatorRound` is not refused by the region-entry check.

**Files likely touched:**
- `src/conductor/src/engine/routing/host-region-entry.ts`
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/routing/host-region-entry.realgit.test.ts`

**Dependencies:** Task 9

### Task 17: Halt on unlanded closed-child commits instead of closing them over
**Story:** Story 7
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/stack-preflight-unlanded.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. In `restack/stack-preflight.ts`, with routing eligible, replace the automatic `feature-repair` restack for `repair-pending` with no marker by the halt, after the publication check. Update the shipped tests that asserted the automatic restack so they run with `stacked_prs.route_whole_feature_fixes: false`:
   - `restack/stack-preflight*.test.ts`;
   - the `feature-repair` cases in the restack integration tests for #2942 and #2943.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-preflight-unlanded.realgit.test.ts` asserts `runStackPreflight` writes a `needs-human` HALT with reason `unlanded-closed-child-commits` naming child 1 and the exact single-child command, runs no restack, and moves no ref.
- [test] `stack-preflight-unlanded.realgit.test.ts` asserts raw commits on children 1 and 2 produce the exact `--carry 2` command.
- [test] `stack-preflight-unlanded.realgit.test.ts` asserts that with an active publication record the HALT class is `needs-human` with reason `published-stack` naming child 1 and no `unlanded-closed-child-commits` HALT is written.
- [test] `stack-preflight-unlanded.realgit.test.ts` asserts a halt-record-only commit writes no HALT, and with routing off a raw commit runs the `feature-repair` restack moving `closed/c1` to the new tip with no HALT.

**Files likely touched:**
- `src/conductor/src/engine/restack/stack-preflight.ts`
- `src/conductor/test/engine/restack/stack-preflight-unlanded.realgit.test.ts`
- `src/conductor/test/engine/restack/stack-preflight-gating.test.ts`

**Dependencies:** Tasks 9, 14

### Task 18: Carry only declared co-origins through the routed exit
**Story:** Story 7
**Type:** negative-path

**Steps:**
1. Write failing tests in `routing/routed-exit.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. In `child-cursor.ts`, report `coOrigins` only for children in the open operator round's `carried` list. In `requestRoutedExit` (`routing/routed-exit.ts`), halt on any other unstamped non-host child. Update the shipped co-origin tests (#2944 Story 7 and #3212 Story 3 cases in `routing/routed-exit*.test.ts` and `child-cursor.test.ts`) to use a carrying operator round.
4. Verify GREEN and commit.

**Done when:**
- [test] `routed-exit.realgit.test.ts` asserts `requestRoutedExit` in an `audit` round with an uncarried unstamped commit on child 2 writes a `needs-human` HALT with reason `unlanded-closed-child-commits` naming child 2 and runs no restack.
- [test] `routed-exit.realgit.test.ts` asserts a declared landing on child 1 carrying child 2 restacks with `originatingChildren` `[1, 2]`, charges one cascade on each, and the `applied` transaction queues child 2.

**Files likely touched:**
- `src/conductor/src/engine/child-cursor.ts`
- `src/conductor/src/engine/routing/routed-exit.ts`
- `src/conductor/test/engine/routing/routed-exit.realgit.test.ts`
- `src/conductor/test/engine/child-cursor.test.ts`

**Dependencies:** Tasks 9, 17

### Task 19: Declare a landing done
**Story:** Story 8
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-land-done.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `checkDeclareOperatorRound` and `declareOperatorRound` in `routing/operator-round.ts`, and the `--done` path in `stack-land-cli.ts`, under the lease. Clear only matching operator halts through rewind's atomic HALT clear (`clearHaltAtomically`).
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-land-done.realgit.test.ts` asserts `stack land --done` exits 0, the record's `declaration.tip` equals the host tip, `allocation[1].retryHint` contains the reason, the round-created park marker is removed, and stdout prints the next step naming the dispatch that re-validates child 1.
- [test] `stack-land-done.realgit.test.ts` asserts `--done` refuses naming the empty landing and `--abandon` with no commit past the closure and with only a `.docs/halted/demo.md` commit, refuses naming `feat/c1/demo` from the leaf branch, refuses naming the dirty worktree, and records no declaration in each case.
- [test] `stack-land-done.realgit.test.ts` asserts `--done` against a live lease owner exits non-zero naming the owner and records no declaration, and after a `--no-verify` commit on `feat/c2/demo` exits non-zero naming `feat/c2/demo` with its recorded and current tips and records no declaration, and with a carried child 2 that moved names child 2's recorded and current tips.
- [test] `stack-land-done.realgit.test.ts` asserts that after a moved branch is restored, `--done` on an undeclared round removes the `operator-round-branch-moved` HALT naming its round, and re-running `stack land --slug demo --child 1` on a declared round removes it with the round unchanged.
- [test] `stack-land-done.realgit.test.ts` asserts `--done` removes an `operator-round-undeclared` HALT for its round, and leaves an unrelated `needs-human` HALT byte-identical while naming it in its output.

**Files likely touched:**
- `src/conductor/src/engine/routing/operator-round.ts`
- `src/conductor/src/engine/stack-land-cli.ts`
- `src/conductor/test/engine/stack-land-done.realgit.test.ts`

**Dependencies:** Tasks 10, 14, 15

### Task 20: Start the host region at the round's entry step
**Story:** Story 8
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/integration/operator-landing.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Make `reconcileRounds` (`routing/round-admission.ts`) return a navigate result carrying the record's `entryStep` for `operator` rounds. In `conductor.ts`, set the region loop index to that step, as the post-exit paths do for `acceptance_specs`.
4. Verify GREEN and commit.

**Done when:**
- [test] `operator-landing.realgit.test.ts` asserts the `step_started` order for child 1 after `--done` is `acceptance_specs`, `test_suite`, `build_review`, with no `build` dispatch before `acceptance_specs`, `acceptance_specs` run in verify-green mode, and `build_review` graded against the `closed/c1` base with the landing reason among its inputs.
- [test] `operator-landing.realgit.test.ts` asserts that after the region passes, `requestRoutedExit` runs a `feature-repair` restack with origin child 1, a `revalidate` round runs for child 2, the checked-out branch is `feat/daemon-demo`, and `prd_audit` and `manual_test` are pending.
- [test] `operator-landing.realgit.test.ts` asserts a landing on a child that owns no acceptance criteria and has no `red/c<k>` ref passes `acceptance_specs` vacuously and proceeds to `test_suite`.
- [test] `operator-landing.realgit.test.ts` asserts a failed `build_review` kicks back to a provider `build` in child 1's region under child 1's ledger, and the round exits with origin child 1.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-admission.ts`
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/integration/operator-landing.realgit.test.ts`

**Dependencies:** Tasks 7, 19

### Task 21: Carry the operator work order into build and build_review
**Story:** Story 8
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-inputs.test.ts`, `src/conductor/test/engine/routing/operator-work-order.test.ts` for every Done-when check below.
2. Verify RED.
3. Add `operatorWorkOrder` to `BuildReviewInputs` and its snapshot digest. Make build dispatch in `conductor.ts` merge `allocation[host].retryHint` into the first-attempt hint of an `operator` host's build, alongside any in-memory kickback hint.
4. Verify GREEN and commit.

**Done when:**
- [test] `build-review-inputs.test.ts` asserts `assembleBuildReviewInputs` for an `operator` host includes `operatorWorkOrder` equal to the round's reason and the snapshot digest changes when the reason changes.
- [test] `operator-work-order.test.ts` asserts that an in-process `build_review` kickback build's first-attempt hint contains both the kickback hint and the round's reason, and that after a restart pinned between `test_suite` and `build_review` the resulting kickback build's hint again contains both, the reason read from `allocation[1].retryHint`.

**Files likely touched:**
- `src/conductor/src/engine/build-review-inputs.ts`
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/build-review-inputs.test.ts`
- `src/conductor/test/engine/routing/operator-work-order.test.ts`

**Dependencies:** Task 19

### Task 22: Abandon a landing through recorded stages
**Story:** Story 9
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/operator-abandon.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement stages 1–3 of `abandonOperatorRound` in `routing/operator-round.ts`: one transaction pins, resets and sets `abandoning`; then `syncRestackedWorktree`; then restore `priorRegion` (`stage: synced`); then one transaction sets `abandoned` and deletes the marker.
4. Verify GREEN and commit.

**Done when:**
- [test] `operator-abandon.realgit.test.ts` asserts after abandon that `feat/c1/demo` equals `closed/c1`, `rejected/<roundId>/1` equals the abandoned tip, the host is `abandoned`, and `refs/conductor/demo/repairing` is absent.
- [test] `operator-abandon.realgit.test.ts` asserts child 1's region statuses and verdict files are byte-identical to their pre-landing snapshot, with the statuses restored through the conduct-state mutation port.
- [test] `operator-abandon.realgit.test.ts` asserts a rewritten host is abandoned with its rewritten tip pinned, and a carried child's branch keeps its commits.

**Files likely touched:**
- `src/conductor/src/engine/routing/operator-round.ts`
- `src/conductor/test/engine/routing/operator-abandon.realgit.test.ts`

**Dependencies:** Task 9

### Task 23: Return to the leaf after an abandon and recover each stage
**Story:** Story 9
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/operator-abandon-recovery.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Add an `abandon` mode to `returnToLeaf` (`routing/routed-exit.ts`) that records the switch and closes the round without `restageLeafGates`. Add `reconcileRounds`' `abandoning` arm resuming from the recorded stage.
4. Verify GREEN and commit.

**Done when:**
- [test] `operator-abandon-recovery.realgit.test.ts` asserts after abandon the checked-out branch is `feat/daemon-demo`, the round is `closed`, and leaf whole-feature statuses and verdict files are byte-identical to before the landing.
- [test] `operator-abandon-recovery.realgit.test.ts` asserts a crash after each recorded stage followed by the next `runStackPreflight` completes the remaining stages exactly once, completes the sync from the recorded rejected and reset tips while on the host branch, and never invokes `syncRestackedWorktree` while on the leaf branch.
- [test] `operator-abandon-recovery.realgit.test.ts` asserts the preflight after abandoning a landing that carried child 2 halts `unlanded-closed-child-commits` naming child 2.

**Files likely touched:**
- `src/conductor/src/engine/routing/routed-exit.ts`
- `src/conductor/src/engine/routing/round-admission.ts`
- `src/conductor/test/engine/routing/operator-abandon-recovery.realgit.test.ts`

**Dependencies:** Tasks 17, 22

### Task 24: Ship `stack land --abandon`
**Story:** Story 9
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-land-abandon.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement the abandon predicate (the round's own authority only) and the `--abandon` path in `stack-land-cli.ts`, under the lease and an owned park.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-land-abandon.test.ts` asserts `stack land --abandon` exits 0, removes the round-created park marker, and removes an `operator-round-undeclared` HALT for the round, leaving no HALT naming the round.
- [test] `stack-land-abandon.test.ts` asserts `--abandon` with a `built` host exits non-zero naming the exit restack, and against a live lease owner exits non-zero naming the owner, with the branch, marker, route record, park marker and child 1's region state byte-identical in both.
- [test] `stack-land-abandon.test.ts` asserts `--abandon` with an uncommitted change exits non-zero naming the dirty worktree and the change is intact, and `--abandon` on a host whose history was rewritten past its closure exits 0.
- [test] `stack-land-abandon.test.ts` asserts that after a crash injected after `stage: moved`, re-running `stack land --abandon` exits 0 and completes the sync from the recorded tips while on the host branch, never syncing from the leaf branch, then the restore and leaf return once, and that child 1's per-child ledger counts and routed-repair credit spent before the abandon are unchanged by it.

**Files likely touched:**
- `src/conductor/src/engine/stack-land-cli.ts`
- `src/conductor/src/engine/routing/operator-round.ts`
- `src/conductor/test/engine/stack-land-abandon.test.ts`

**Dependencies:** Tasks 10, 15, 23

### Task 25: Emit `operator_round` events on the spine
**Story:** Story 14
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/operator-round-events.test.ts` for every Done-when check below.
2. Verify RED.
3. Add the `operator_round` member to `types/events.ts`, its `EVENT_SINKS` entry (`event-sinks.ts`), its builder in `routing/routing-events.ts`, and `eventId` dedup in `event-persister.ts`. Write the event in the transactions of Tasks 9, 19 and 22.
4. Verify GREEN and commit.

**Done when:**
- [test] `operator-round-events.test.ts` asserts the persisted event order for an opened, declared and exited landing, that each `operator_round` event carries round id, child 1, origin `land` and the reason, and that `remediation_routed` carries kind `operator`.
- [test] `operator-round-events.test.ts` asserts a replayed drain leaves exactly one `operator_round` event per `eventId` in `events.jsonl`, and an abandoned landing records `abandoned` with no `child_revalidated` for its round.

**Files likely touched:**
- `src/conductor/src/types/events.ts`
- `src/conductor/src/engine/event-sinks.ts`
- `src/conductor/src/engine/event-persister.ts`
- `src/conductor/src/engine/routing/routing-events.ts`
- `src/conductor/src/engine/routing/operator-round.ts`
- `src/conductor/test/engine/routing/operator-round-events.test.ts`

**Dependencies:** Tasks 19, 22

### Task 26: Show an open landing in daemon status
**Story:** Story 14
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-dashboard.test.ts` for every Done-when check below.
2. Verify RED.
3. Extend the routed-repair rendering in `daemon-dashboard.ts`, reading the record's kind and declaration.
4. Verify GREEN and commit.

**Done when:**
- [test] `daemon-dashboard.test.ts` asserts the `demo` line of `daemon status` output names an operator landing open on child 1 awaiting `--done` for an undeclared round.
- [test] `daemon-dashboard.test.ts` asserts the same line no longer says awaiting `--done` once the round is declared, and a feature with no operator round renders as before.

**Files likely touched:**
- `src/conductor/src/engine/daemon-dashboard.ts`
- `src/conductor/test/engine/daemon-dashboard.test.ts`

**Dependencies:** Task 19

### Task 27: Open a declared operator round from a closed-child rewind
**Story:** Story 10
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/rewind-closed-child.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Replace the closed-child refusal in `rewind.ts` with a call to `openOperatorRound` (origin `rewind`, `entryStep` the target, declared at creation) under the lease. Validate a closed `k` by `closureRefFor`. Update the shipped refusal tests (#2942 Story 12, #2943 Story 9, #2944 Story 7 rewind cases) to the missing-HALT refusal. Fake-provider commits on the declared host must carry `CONDUCT_DAEMON_SESSION=1`.
4. Verify GREEN and commit.

**Done when:**
- [test] `rewind-closed-child.realgit.test.ts` asserts the closed-child rewind exits 0, opens a declared `operator` round with origin `rewind` and `entryStep` `test_suite`, sets child 1's `test_suite` and `build_review` pending, removes `.pipeline/HALT`, and leaves child 2's and the leaf's conduct state byte-identical.
- [test] `rewind-closed-child.realgit.test.ts` asserts that with `.pipeline/children/1/` absent the rewind succeeds and child 1's region state, written through the conduct-state mutation port, shows `acceptance_specs` and `build` done and `test_suite` and `build_review` pending.
- [test] `rewind-closed-child.realgit.test.ts` asserts child 1's `test_suite` and `build_review` verdict files are cleared, the HALT is removed only after the route record is admitted, and `operator_rewind` is persisted with `child: 1` and target `test_suite`.
- [test] `rewind-closed-child.realgit.test.ts` asserts the next dispatch's first child 1 `step_started` is `test_suite`; with no new commit the round takes the no-commit exit, the checked-out branch returns to `feat/daemon-demo` and the leaf gates are re-pended, and with a repair commit the exit restack originates at child 1 and re-validates child 2.
- [test] `rewind-closed-child.realgit.test.ts` asserts refusals naming the missing HALT, the missing reason, #3268 for a published stack, and the live lease owner, and that an open active child's `rewind --child 2 --to build` produces the same state as before this change.

**Files likely touched:**
- `src/conductor/src/engine/rewind.ts`
- `src/conductor/test/engine/rewind-closed-child.realgit.test.ts`

**Dependencies:** Tasks 9, 20

### Task 28: Declare `--child` and `--reason` on the rewind command
**Story:** Story 10
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/cli/help-router.test.ts`, `src/conductor/test/cli/pre-dispatch-registry.test.ts` for every Done-when check below.
2. Verify RED.
3. Declare both options on `rewind` in `createProgram` (`cli.ts`) and accept `--reason` in `detectRewindCommand`.
4. Verify GREEN and commit.

**Done when:**
- [test] `help-router.test.ts` asserts `ai-conductor rewind --help` output lists both `--child` and `--reason`.
- [test] `pre-dispatch-registry.test.ts` asserts `detectRewindCommand` returns `--child 1`, `--to test_suite` and `--reason` with its value for `rewind --child 1 --to test_suite --reason x`.

**Files likely touched:**
- `src/conductor/src/cli.ts`
- `src/conductor/src/engine/rewind.ts`
- `src/conductor/test/cli/help-router.test.ts`
- `src/conductor/test/cli/pre-dispatch-registry.test.ts`

**Dependencies:** Task 27

### Task 29: Ship `ai-conductor stack owners`
**Story:** Story 12
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-owners-cli.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `stack-owners-cli.ts` using the range construction of `restack/restack-plan.ts` (export `planRestackRanges` or `ownedPaths`), titles from `loadSliceTopology`. Register `stack owners` in `cli.ts` and `cli-pre-dispatch.ts`, and dispatch from `index.ts`.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-owners-cli.realgit.test.ts` asserts `ai-conductor stack owners --slug demo --path src/flag.ts` prints JSON listing children 1 and 2 with positions, branch names and slice titles, and `--diff` reports every path changed in the range with the children that touched it.
- [test] `stack-owners-cli.realgit.test.ts` asserts an untouched path is reported with an empty child list and exit 0, a flat feature exits non-zero naming not stacked, and a loader `unavailable` result exits non-zero naming its cause.
- [test] `stack-owners-cli.realgit.test.ts` asserts refs, `.daemon/leases/`, the park marker and state files are byte-identical after each call.

**Files likely touched:**
- `src/conductor/src/engine/stack-owners-cli.ts`
- `src/conductor/src/engine/restack/restack-plan.ts`
- `src/conductor/src/cli.ts`
- `src/conductor/src/cli-pre-dispatch.ts`
- `src/conductor/src/index.ts`
- `src/conductor/test/engine/stack-owners-cli.realgit.test.ts`

**Dependencies:** none

### Task 30: Ship the stack-landing skill
**Story:** Story 13
**Type:** happy-path

**Steps:**
1. Write failing tests in the files listed below for every Done-when check below.
2. Verify RED.
3. Author `skills/stack-land/SKILL.md` and `skills/stack-land/agents/openai.yaml`. The skill:
   - runs `ai-conductor stack owners` for the paths involved;
   - proposes the owning child with its title and evidence;
   - asks the person to confirm before `stack land`;
   - on rejection asks which child, never running `stack land` for the rejected child;
   - relays any refusal's cause and next command without working around it;
   - wraps its command regions in the operator-only session-command-context marker (the daemon-session command-contract audit).
4. Verify GREEN and commit.

**Done when:**
- [test] `test/test_harness_integrity.sh` passes with `skills/stack-land/` present, its frontmatter name matching the catalog naming rule, `operator_only: true`, and `agents/openai.yaml` present.
- `skills/stack-land/SKILL.md` instructs running `ai-conductor stack owners` before proposing a child, proposing the lowest child that owns the code being changed unless the change needs code first present higher up, guiding the person through `--done` or `--abandon`, naming the proposed child with its slice title and the `stack owners` evidence, confirming the proposed child before running `stack land`, asking for another child on rejection, and relaying a refusal's cause and next command unchanged without retrying or working around it.

**Files likely touched:**
- `skills/stack-land/SKILL.md`
- `skills/stack-land/agents/openai.yaml`
- `src/conductor/src/engine/worktree-prepare.ts` — `OPERATOR_ONLY_SKILLS`

**Dependencies:** Task 29

### Task 31: Keep flat features and routing-off stacks unchanged
**Story:** Story 15
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-land-cli.test.ts`, `stack-preflight-unlanded.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Add the new modules to #3365's slice-topology consumer-boundary allowlist (`plan-slices-consumer-boundary.test.ts` / its slice-topology counterpart). Fix any parity gap the tests expose.
4. Verify GREEN and commit.

**Done when:**
- [test] `n1-golden-routing-guard.test.ts` asserts the N=1 golden suite passes unchanged with no read or write under `.daemon/leases/` and no touch of `refs/conductor/<slug>/routes`, `repairing` or `revalidate` for a flat feature's dispatch, build and finish.
- [test] `stack-land-cli.test.ts` asserts `stack land`, `stack owners` and `rewind --child 1` each exit non-zero on a flat feature naming it as not stacked, and with routing off `stack owners` and the closed-child `rewind` each exit non-zero naming `stacked_prs.route_whole_feature_fixes`, with refs and state files byte-identical.
- [test] The slice-topology consumer-boundary test passes with `operator-round.ts`, `stack-land-cli.ts`, `stack-owners-cli.ts` and `stack-commit-guard-cli.ts` in its allowlist.

**Files likely touched:**
- `src/conductor/test/engine/n1-golden-routing-guard.test.ts`
- `src/conductor/src/engine/rewind.ts`
- `src/conductor/src/engine/stack-owners-cli.ts`
- `src/conductor/test/engine/stack-land-cli.test.ts`
- `src/conductor/test/engine/plan-slices-consumer-boundary.test.ts`

**Dependencies:** Tasks 10, 17, 27, 29

### Task 32: Refuse `--done` on a declared, rewind or mid-restack round
**Story:** Story 8
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-land-done-refusals.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Add the three refusals to `checkDeclareOperatorRound` in `routing/operator-round.ts`.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-land-done-refusals.realgit.test.ts` asserts `--done` exits non-zero naming the existing declaration on a declared landing, and naming origin `rewind` on a rewind round.
- [test] `stack-land-done-refusals.realgit.test.ts` asserts `--done` with a non-terminal restack journal exits non-zero naming the journal, and that the route record, branches and HALT files are byte-identical after each refusal.

**Files likely touched:**
- `src/conductor/src/engine/routing/operator-round.ts`
- `src/conductor/test/engine/stack-land-done-refusals.realgit.test.ts`

**Dependencies:** Task 19

## Task Dependency Graph

```
Slice 1: 1 ─┬─ 2
            └─ 3
Slice 2: 4 ── 5
         6 ─┬─ 7 ─┐
            ├─ 8 ─┴─ 9 ─┬─ 10 (+1, 4) ─┬─ 19 (+14) ─┬─ 20 (+7) ── (27)
            │           │              │            ├─ 21
            │           │              │            ├─ 26
            │           │              │            └─ 11 (+10)
            │           ├─ 13 (+12)    └─ 24 (+23)
            │           ├─ 14 ── 19
            │           ├─ 15, 16
            │           ├─ 17 ── 18
            │           └─ 22 ── 23 ── 24
            └─ 12 ── 13
         25 (19, 22)
Slice 3: 27 (9, 20) ── 28;  29 ── 30;  31 (10, 17, 27, 29)
```

### Task rem-as-built-rem-as-built-r5: src/conductor/src/engine/daemon-runner.ts: acquire the feature dispatch lease (and re-check the park) before createWorktree/prepareWorktree for stacked features; extend daemon-dispatch-lease.test.ts to assert lease acquire is recorded before any git worktree add from worktree-shared.ts
**Gate:** as-built
**Rationale:** Verified 98%. Tasks 2 and 3 already require the lease to be acquired before prepareWorktree and before any interactive worktree or conduct-state mutation. The code acquires it after createWorktree (daemon-runner.ts:421 vs :427) and after session/context setup (index.ts:1916-1917 vs :2109). This is implementation drift from approved D2 and is admitted by Tasks 2 and 3.
**Governing clause:** adr-2026-10-24-operator-route-round-for-closed-stacked-children decision 2
**Done when:**
- adr-2026-10-24-operator-route-round-for-closed-stacked-children decision 2 is satisfied by this task.
- The repair for task rem-as-built-rem-as-built-r5 is committed and its targeted tests pass.
**Child:** 1
**Round:** r1
### Task rem-as-built-rem-as-built-r6: src/conductor/src/index.ts interactive run: move stacked-feature lease acquisition ahead of session-state creation (~:1916) and managed-context preparation (~:1917); extend interactive-run-lease.test.ts to assert the lease is held before either mutation
**Gate:** as-built
**Rationale:** Verified 98%. Tasks 2 and 3 already require the lease to be acquired before prepareWorktree and before any interactive worktree or conduct-state mutation. The code acquires it after createWorktree (daemon-runner.ts:421 vs :427) and after session/context setup (index.ts:1916-1917 vs :2109). This is implementation drift from approved D2 and is admitted by Tasks 2 and 3.
**Governing clause:** adr-2026-10-24-operator-route-round-for-closed-stacked-children decision 2
**Done when:**
- adr-2026-10-24-operator-route-round-for-closed-stacked-children decision 2 is satisfied by this task.
- The repair for task rem-as-built-rem-as-built-r6 is committed and its targeted tests pass.
**Child:** 1
**Round:** r1
