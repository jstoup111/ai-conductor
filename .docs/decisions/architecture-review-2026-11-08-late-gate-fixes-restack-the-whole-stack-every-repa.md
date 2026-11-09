# Architecture Review: Late-gate fixes restack the whole stack every repair round (#3653)

**Date:** 2026-11-08
**Inputs reviewed:**
- the explore output: approach A, operator-confirmed, with track and scope in
  `.docs/track/late-gate-fixes-restack-the-whole-stack-every-repa.md`;
- the approved diagram `.docs/architecture/late-gate-fixes-restack-the-whole-stack-every-repa.md`;
- `adr-2026-10-12-routed-whole-feature-repair`, `adr-2026-10-10-stacked-restack-journaled-replay`,
  `adr-2026-10-17-stacked-feature-publication-as-native-stack` and `adr-014-otel-observability-exporter`;
- the engine source at `1afb534ca6`, which includes #3598's adapted-path acceptance, merged as #3667.

**Verdict:** APPROVED

## Feasibility

Every part of the technical intent maps onto an existing seam. No new dependency, external service
or infrastructure is needed.

- **Leaf execution of audit hosts.**
  - `enterHostRegion` (`routing/host-region-entry.ts`) already separates the host's child state
    from the checked-out branch. `resolveHostEntryTarget` chooses the branch, and
    `resolveExecutionChild` (`routing/execution-child.ts`) chooses whose region state is
    restaged.
  - Pointing the target at the leaf while the execution child stays host k is the change
    (ADR decision 3; assumption A1, 75%).
  - The plan is one file at the same path on every branch, so the frozen blocks can be written
    into the leaf's copy. This is verified from `remediation-append.ts` and the conductor's host
    plans.
- **The `Owner:` stamp.** It extends `round-stamp` (`round-stamp-cli.ts`). That command already
  resolves the marker and the branch identity, and the prepare-commit-msg hook already delegates
  to it (`git-hook-assets.ts`). The one change is replace semantics for both trailers while the
  marker says `execution: 'leaf'`.
- **The routed exit.** `requestRoutedExit` already has a no-restack arm for leaf hosts. A
  leaf-executed host takes an equivalent arm that records `placement: 'deferred'`.
- **The fold.**
  - It is a new planner stage ahead of `planRestackRanges` (`restack/restack-plan.ts`). It produces
    placed commits that extend each target's own range and a drop set for the leaf.
  - The per-commit `merge-tree` replay (`restack/restack-replay.ts`), the resolver, the journal,
    `verifyRestackMove` and the one-transaction move are all reused.
  - Hunk-level acceptance uses the same `merge-tree` three-way primitive. No `git apply` fuzz is
    introduced.
- **Leaf identity.** It is a tree comparison of the staged leaf tip against the pre-fold leaf tip,
  checked before the move. When it holds, `applyRestackTransition`'s `outcomeFor` already yields
  `noop`, so no leaf verdict is invalidated (verified, A2).
- **Re-validation** reuses the queue's production in the `applied` transaction, the shared
  admission helper and `revalidate` rounds unchanged.
  - `runRebaseStepBody` (`conductor.ts`) does not read the queue today. It gains one call to the
    shared admission helper after a fold, which is how the helper is used elsewhere since #3477.
  - `returnToLeaf` gains a `fold` mode beside its existing `abandon` mode.
- **Attribution.** `resolveRebaseConflict` (`step-runners.ts`) can pass a `dispatch` execution
  context. The provider executor already spreads it into `provider_attempt` (`provider-execution.ts`
  `onAttempt`). The span manager's `setDispatchAttributes` and the metrics' bounded dimension sets
  (`otel/span-manager.ts`, `otel/metrics.ts`) take the new attributes (A4, 70%).

**Prerequisites:** none. **Data implications:**
- the additive optional fields on the route record, marker and events;
- one new restack cause;
- one new event type.

There is no migration: absent fields mean today's behaviour.

**Performance.** The fold is O(commits × hunks) using `merge-tree` per placement probe. That is
bounded by the size of the fold set, which is tens of commits in practice, and it replaces up to
N−1 full-stack restacks per round.

**Worktree isolation.** Everything runs inside the feature worktree and its refs. No port, database
or shared resource is added.

## Complexity

High. The change spans four modules: routing, restack, the commit hook and OTel. It touches durable
state transitions on the route record, the marker, the journal and the queue. The design keeps it
tractable: every new behaviour sits behind a frozen per-round execution mode and a non-empty fold
set, so with the flag off, or with no stacked children, the existing paths run unchanged. The
operator declined a split. The plan is about 20 tasks and carries a scope exception citing that
decision.

## Alignment

- **The principle on machinery versus judgement** (CLAUDE.md).
  - Placement is mechanical: an engine-stamped `Owner:`, an owner floor, and acceptance by the
    lowest child that takes each hunk cleanly.
  - Correctness is proven mechanically by leaf-tree identity and by per-child re-validation.
  - Judgement is confined to the existing places: routing's residue call and the restack resolver.
  - `Task:` stays telemetry only (#773). `Owner:` is engine-owned, following the `Round:`
    precedent.
- **The event spine** (`.agents/skills/event-spine/SKILL.md`).
  - Everything rides `ConductorEvent`: the `fold` cause, `fold_planned`, the `provider_attempt.restack`
    field and `restack_planned.roundId`.
  - The shipped record's `## Restack` block and the OTel attributes are spine consumers.
  - Commit trailers and the journal are exception-C durable state, as the route record is. They are
    not a telemetry channel.
- **`adr-2026-10-12-routed-whole-feature-repair`.** That ADR rejected Option C. This review records
  a deliberate, operator-approved reversal for `audit` rounds, answered objection by objection, and
  annotates the affected decisions (Option C, D4, D5, D9, D13, D14, D15) with amendment notes.
  `operator` and `revalidate` rounds are untouched.
- **`adr-2026-10-10-stacked-restack-journaled-replay`.** The fold is a new restack cause inside the
  same executor, journal and atomic move. The notes amend D3 (path ownership), D9 (triggers) and
  D10 (cause, refunds and the cap).
- **`adr-2026-10-17-stacked-feature-publication-as-native-stack`.** Publication is unchanged; the
  fold completes before `establishChildPrs`. Published stacks still refuse routing, so a fold never
  runs on a published stack.
- **`adr-014-otel-observability-exporter`.**
  - The new span attributes use the `conductor.*` namespace.
  - `restack_cause` is a bounded metric dimension (five values). Round ids stay span-only, to avoid
    unbounded metric cardinality.
- **The diagram** matches this design. It is updated to name the FINISH `rebase` step's admission
  of the queue and the `fold`-mode leaf return.
- **Security.** No new endpoint or input boundary is added. Trailers are overwritten by the engine,
  so a builder cannot direct placement.
- **Production DI defaults.** The design adds no store. Its durable state is the existing git refs.

## Domain Integrity

- **Execution mode** is an enum on the host entry and the marker (`execution: 'leaf'`; absent
  means `'owner'`), not a boolean.
- **Host placement** is an enum value (`placement: 'deferred'`) on the existing `HostState` record.
- **`RestackCause`** is a closed union extended with `'fold'`. Every switch over it stays
  exhaustive, following the precedent of the routed ADR's exhaustive kind switches.
- **The fold plan** is typed as `{sourceSha, roundId, owner: ChildPosition, placementChild:
  ChildPosition, parts: [{child: ChildPosition | 'leaf', paths, reason: 'owner' |
  'introduced-above-owner'}]}`. No raw strings are used for positions.
- **Halt reasons** reuse existing classes (`needs-human`) with new typed reasons
  (`fold-tree-mismatch`, `fold-owner-invalid`, `fold-misrouted`, `fold-prerequisite-missing`). No new halt class is
  added.

## Wiring Surface

| New or changed surface | Production caller (design-time) |
|---|---|
| `execution: 'leaf'` on host entry and marker | written by `admitRound` (`routing/round-admission.ts`) at audit admission; read by `resolveHostEntryTarget` and `enterHostRegion` via the existing `enterRoutedHostRegion` call in `conductor.ts` |
| `Owner:` / replaced `Round:` stamping | `round-stamp` CLI, invoked by the installed prepare-commit-msg hook (`git-hook-assets.ts`) |
| deferred routed exit (`placement: 'deferred'`) | `requestRoutedExit`, reached from the existing `continueRoutedHostExit` → `exitRoutedHostAndReconcile` chain |
| commit-msg leaf-execution trailer check (fail-closed) | the installed commit-msg hook (`git-hook-assets.ts`), which already invokes the engine's scope check |
| publication refusal while a host is `deferred` | `establishChildPrs` (`finish-publication-production.ts`) |
| fold planner and placement | called by `runRestack({cause: 'fold'})` from `runRebaseStepBody` in `conductor.ts` (FINISH `rebase` step) |
| leaf-tree identity check | inside the restack executor before the move transaction, on the `fold` cause |
| queue admission after fold | the shared admission helper (`round-admission.ts`), called from `runRebaseStepBody` |
| `returnToLeaf` `fold` mode | the existing routing continuation, when the drained queue's generation was fold-produced |
| `fold_planned` event, `restack_planned.roundId`, `provider_attempt.restack` | emitted through `ConductorEventEmitter` → `EventPersister`, consumed by `otel/span-manager.ts`, `otel/metrics.ts` and the shipped-record renderer |
| `## Restack` shipped-record block | the existing shipped-record writer at FINISH (`shipped-record` primitive) |
| `stacked_prs.fold_routed_fixes` config key | read by audit admission through the loaded `StackedPrsConfig` (`types/config.ts`) |

**Early overlap scan (advisory).** `ai-conductor overlap-scan` over the paths above reported
overlap with unmerged spec branches on `conductor.ts`:
- `base-moved-re-kick-skips-test-suite-on-preserved-p`
- `clean-build-review-pass-halts-on-a-deferral-reserv`
- `planner-escalation-to-architecture-review-still-ha`
- `routed-leaf-acceptance-specs-completion-still-requ`
- `routed-verify-green-refuses-the-leaf-host-which-ne`
- `stacked-no-op-rebase-never-satisfies-its-gate-afte`

It reported overlap on `routing/routed-exit.ts` with `routed-round-advance-carries-the-previous-host-s-e`.

`conflict-check` weighs these, together with in-flight #3599 (restack resume), #3495 (per-child
cost in the shipped record) and #3628 (to be superseded).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A fix uses code only a higher child defines, so its placement child fails re-validation | Technical | Medium | Medium | Bounded re-validation repair on that child; a verified prerequisite claim halts naming the fix and both children (D9) |
| The resolver changes content during the fold | Data | Low | High | Leaf-tree identity check before the move; a mismatch moves nothing and halts (D9) |
| Leaf-executed host region steps misread child state (A1) | Technical | Medium | High | Execution child stays host k; the plan covers it with region-entry tests on a three-child fixture; with the flag off, owner-branch execution runs |
| Frozen-block appends do not re-materialize cleanly (A3) | Technical | Low | Medium | Deterministic block merge by `(roundId, id)` and identical canonical bodies; failure halts with nothing moved |
| OTel attribution misses out-of-band resolver attempts (A4) | Integration | Medium | Low | Explicit execution context on the resolver dispatch; `unattributed` row in the shipped block keeps totals honest |
| Commit-msg hook change is classified as `hook wiring` by the self-host release gate | Integration | Medium | Low | The hook asset text changes but its wiring does not; the plan carries a release waiver or a migration block as the gate requires |
| Concurrent in-flight specs edit `conductor.ts` and `routed-exit.ts` | Integration | Medium | Medium | conflict-check sequencing; `blocked-by` where the same decision is edited |

## Cross-provider adversarial review

Codex (`codex exec -s read-only`) reviewed the ADR against the source. Every finding was folded
into the ADR before approval:

1. **Blocking.** Raising hunks could silently leave a misrouted fix entirely above its owner. The
   ADR now halts with `fold-misrouted` when no part of a host's work lands on its placement child
   (D7).
2. **Blocking.** A successful fold did not retire its inputs. Host placement now moves from
   `deferred` to `placed` in the `applied` transaction, leaf hosts are never deferred, and the fold
   set is defined by host boundary ranges (D4–D8).
3. **Major.** Stamping fails open. A commit-msg check now enforces it while a leaf-executed marker
   is set, and boundary ranges, not trailers, now define each host's work (D4).
4. **Major.** The interactive rebase step returns before any restack. The fold now runs before that
   return, and publication refuses while a host is `deferred` (D6).
5. **Major.** Empty evidence commits would vanish. They are now placed whole on the placement child
   (D7).
6. **Minor.** The replay fact ignored merge classification. The Context is corrected, and merges
   inside a boundary range halt `fold-owner-invalid` (D7).

## ADRs Created

- `adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish` (new; it reverses, for
  `audit` rounds, the Option C rejection in `adr-2026-10-12-routed-whole-feature-repair`).
- Amendment notes were added to `adr-2026-10-12-routed-whole-feature-repair` (Option C, D4, D5, D9,
  D13, D14, D15) and to `adr-2026-10-10-stacked-restack-journaled-replay` (D3, D9, D10).
