# Architecture Review: Carry a routed fix up the stack and re-validate the children above (#3212)
**Date:** 2026-10-23
**Inputs reviewed:**
- the technical-track explore output and its scope boundary:
  - `.docs/track/a-routed-fix-is-never-carried-up-the-stack-or-foll.md`
  - `.docs/complexity/a-routed-fix-is-never-carried-up-the-stack-or-foll.md`, Tier L
- the approved diagrams: `.docs/architecture/a-routed-fix-is-never-carried-up-the-stack-or-foll.md`
- the governing ADR: `adr-2026-10-12-routed-whole-feature-repair`, decisions 6, 8, 9 and 12–18
- the publication ADR: `adr-2026-10-17-stacked-feature-publication-as-native-stack`, decision 11
- the 2026-10-12 draft (Tasks 10 and 75–99, plus the later move comments on #3212)
- a drift inventory of the current code

**Verdict:** APPROVED WITH CONDITIONS

## Governing ADRs (reused, no new ADR)

The structural decisions are already made and APPROVED: the routed exit restack (D13), the durable
re-validation queue (D14), the leaf return (D15), the transactional outbox (D16), the N=1 parity
guard (D17) and the flag (D18). The restack-writer exemption from the route-record fence is decided
in D6 ("every route-record writer other than that restack is refused").

This spec makes no new structural decision, so no new ADR is drafted. Two assertions in the governing
ADR are falsified by current code or by later operator decisions. They are amended in place with
dated notes; see *ADR amendments*.

## Feasibility

All work stays inside the TypeScript engine and git plumbing. There is no new dependency, service,
port or external API. Every claim below was checked against the code at `7100adb41d`.

| Intent | Feasible on current code? | Basis |
|---|---|---|
| Host leaves through the exit restack (D13) | Yes. There is no host-exit writer today. Only `admitted`, `repairing`, `reroute-moved` and `rerouted` transitions exist (`round-admission.ts`, `prerequisite-claim.ts`, `host-region-entry.ts`). The `built`, `restacked` and `done` edges are already legal in `route-types.ts`. | verified, 95% |
| Routed lines in the restack's `applied` transaction | Yes, with a refactor. `transitionAppliedWithCascade` emits only the cascade lines and the journal line. Base refresh applies through a plain `transitionState`. Recovery's `synced`→`applied` calls one or the other. A single `appliedTransactionLines` builder must serve all three paths. | verified, 95% |
| The restack writing routing refs past the fence | Needs new machinery. `writeRoutingTransaction` refuses with `restack-journal-open` whenever the journal is not terminal, and appends `verify <journal> <blob>`. The fence is duplicated in `host-region-entry.ts` (`terminalJournal`). There is no `opId` exemption today. | verified, 95% |
| Marker deletion, `closed`, `currentHostIndex` progression | Needs new ops. `writeRoutingTransaction`'s op union has no delete-marker or queue op. `currentHostIndex` is written only at create and at a reroute. Nothing sets `phase: 'closed'`. | verified, 95% |
| Re-validation queue (D14) | Yes, by extending what shipped: `RevalidationQueueRecord`, `revalidationQueueRefFor` (already in teardown), the cursor's `revalidating` field and the execution-child `revalidating` source. The entry today is `{child, closureSha, state: string}` and nothing writes it, so its shape can change without a migration. | verified, 95% |
| Invalidation set at the transition | Yes. `restack-transition.ts` already classifies each closed child with `classifyReplayGateInvalidation` and drops children whose verdict is not `satisfied === true`. For the queue, an unreadable or missing verdict must count as invalidated. | verified, 95% |
| Re-validation review base (D12) | Needs the replay tuple persisted outside the journal. `cleanAppliedJournal` deletes the journal right after `applied`, so "retained from the restack journal" (D12) cannot hold by the time a `revalidate` round runs. The tuple must be copied into the queue entry by the `applied` transaction. See *ADR amendments*. | verified, 95% |
| Rem-block replay union (D9) | Yes. `upperChildHaltRecordTree` is the temporary-index precedent in `restack-replay.ts`. `parsePlanTaskBlocks` and `remediation-append.ts`'s canonical block form can be reused. | verified, 90% |
| Co-origins | Mostly already computed. `resolveActiveChild` fills `coOrigins` and `foreignRoundChildren` from `Round:` trailers while the marker exists, and the preflight already halts on foreign rounds. `runRestack` must accept the routed origin set (host plus co-origins), which the planner derives itself today. | verified, 90% |
| Leaf parking (D15) | Yes. `SelectorInput` is `{steps, state, verdicts, regionStart}`. A parking input that restricts selection to `CHILD_REGION_STEPS` is additive. | verified, 90% |
| Published-stack refusal | Yes. `publishedStackRefusal` exists. Route admission and the automatic preflight restack already refuse on a published stack. The routed exit is the remaining producer. | verified (docs), 85% |
| Flag default flip | Yes. The default is set at two sites in `engine/config.ts`, and `routingSettingOn` reads it. | verified, 98% |

## Complexity

High, and accepted at Tier L. This spec owns three crash-safe commit points (the exit restack's
`applied` transaction, the queue acknowledgement and the leaf return), two state machines (host exit
plus round `closed`, and queue generations), and the change that makes every stacked feature reach
this code.

**Task estimate: about 42 authored tasks.** That is above `/plan`'s 30-task ceiling. On 2026-10-23
the operator declined a further split into separate specs, so the plan carries a
`**Scope-exception:**` citing that decision.

The operator directed stacked delivery for this spec. The `## Slices` manifest is accepted at `/plan`.
It must fit within `stacked_prs.max_slices: 3`, and stories are cut so that each story's tasks fall in
one slice. Each slice ships only primitives whose production caller is in the same slice or an
earlier one (C11). The flag changes only in the last slice, once the whole design is present:

1. **Exit restack:**
   - the journal's routed fields and the shared `appliedTransactionLines`;
   - the journal-owner fence exemption;
   - the delete-marker op;
   - `requestRoutedExit`, wired into the region-exit branch, and the no-commit exit with `hostNoOpEvidence`;
   - the preflight's `built` arm and the `built` arm of `reconcileRounds`;
   - co-origins and the cascade-cap halt;
   - the published-stack refusal;
   - the runbook sections for cascade-cap exhaustion and reroute-moved recovery.
2. **Progression, the return to the leaf, and the replay merge:**
   - the rem-block union, the ownership exclusion and the replay-proof normalisation. These are
     called by every restack replay, so they are reachable without the queue;
   - `selectNextHost` and the return order over child hosts, then the leaf host;
   - the `restacked`, `done` and `rerouted` arms of `reconcileRounds`;
   - the `closed` op;
   - leaf parking in the selector;
   - the leaf host exit;
   - the recorded `returnToLeaf`;
   - leaf gates re-pended under their existing caps.
3. **Re-validation queue and go-live:**
   - the extended entry and parser;
   - queue production on every restack cause, including recovery;
   - the queue arm of the return order, and the standalone consumption hook;
   - `revalidate` rounds, with the restage arm, verify-green acceptance, the `revalidation` and `revalidation-fix` bases, and the per-pass credit;
   - acknowledgement and its guards;
   - failure handled through the child's own exit;
   - base-refresh deferral over follow-ons;
   - the queue outbox;
   - the runbook queue section and the reference docs;
   - the flag's default changed to `true`.

**Balance (operator, 2026-10-23):** three slices, distributed as evenly as reachability allows.
The estimate is about 13, 13 and 16 tasks. Slice 3 cannot shrink further: moving queue production
into an earlier slice would ship a queue writer before its consumer, and a queue that is never
consumed parks the leaf forever when the flag is set explicitly (C11).

## Alignment

- **Event spine.** Re-validation outcomes travel as `child_revalidated` through the queue ref's
  outbox, which drains into `events.jsonl`. This is D16's exception-C durable snapshot, not a
  second channel. The event type and the persister's dedup already exist. Only the constructor and
  the drain are new.
- **Design principle (machinery over judgement).** Every decision in this spec is mechanical: tip
  equality, compare-and-swap guards, the existing gate-invalidation surfaces and position order.
  None needs an LLM judgement.
- **N=1 parity (D17).** The golden routing guard already lists `routes`, `repairing`, `revalidate`
  and `child_revalidated`. Every new read and write here stays behind `routingEligible`.
- **Publication ADR D11.** A published stack is frozen. The routed exit refuses through
  `publishedStackRefusal`. The PR comment on a published child stays with #3269, and refreshing a
  published stack stays with #3268. The issue's 2026-10-17 addendum is superseded (operator,
  2026-10-23).
- **Diagrams.** The approved diagrams match this review.

## Domain Integrity

| Finding | Resolution |
|---|---|
| `RevalidationQueueEntry.state: string` and `child_revalidated.outcome: string` are untyped primitives | Make both closed unions: entry `state` becomes `queued`; `outcome` becomes `passed` or `fixed`. Switches over them are exhaustive with no `default` arm, added to `routing-exhaustive-switch.test.ts` |
| A queue whose entries are not in position order, or that lists a child twice, is representable | `parseRevalidationQueueRecord` fails closed on a duplicate child, entries out of position order, or an abbreviated SHA. The cursor's `entries[0]` is then the lowest queued child by construction |
| The draft's `RegionGate` would be a fourth spelling of the region steps | Derive the type from `CHILD_REGION_STEPS` (`typeof CHILD_REGION_STEPS[number]`) and reuse it everywhere |
| The draft's separate `inputIdentity` hash would duplicate the closure SHA | See condition C3 |
| The routed exit's result kinds (`noop`, `no-commit-done`, `restacked`, `halted`) | Use a closed result union, consumed by exhaustive switches |

## Wiring Surface

| New surface | Production caller (design-time) |
|---|---|
| `requestRoutedExit` (new `routing/routed-exit.ts`) | The `build_review` region-exit branch in `conductor.ts`, when the execution child's source is `routed-host`, in place of `advanceChildRegion`; also `runStackPreflight`'s `built` arm |
| `hostNoOpEvidence` | `requestRoutedExit`'s exit choice |
| `nextAfterRestacked` / `selectNextHost` | `reconcileRounds`' `restacked`, `done` and `rerouted` arms, and the loop after a host settles |
| Standalone queue consumption | `runStackPreflight`, after `reconcileRounds`, when no marker exists, no route record has a pending child host, and the queue has entries. This covers a queue produced by an operator-commit repair or a base refresh, which have no routed round to settle (C12) |
| `returnToLeaf` | The `leaf-gates` arm of `nextAfterRestacked`, and resume reconciliation |
| `appliedTransactionLines` and `RunRestackOptions.routed` | `runRestack` for feature-repair and base refresh, and `restack-recovery.ts`'s `synced`→`applied` path |
| Journal-owner exemption in `writeRoutingTransaction` | The restack's `applied` transaction, through `routeRecordUpdateLines` |
| Delete-marker, queue and `closed` ops | The exits, the queue acknowledgement and the leaf return |
| Queue merge, consume and acknowledge (new `routing/revalidation-queue.ts`) | `appliedTransactionLines` for merge; the loop's `revalidate` arm in `nextAfterRestacked` for consumption; the revalidate exit for acknowledgement |
| `revalidate` arm of `enterHostRegion` | Region entry for a `revalidate` round, which replaces today's #3212 refusal |
| `revalidation` / `revalidation-fix` base kinds | New `ChildBaseResolution` kinds from `resolveChildBase` (`child-cursor.ts`), which today returns `routed-repair` for any host whose marker matches and which is `repairing`, without checking the round kind. They are then assembled into `baseKind` in `build-review-inputs.ts` and carried into testQuality materialisation and evidence binding |
| `childRevalidatedEvent`, and the queue outbox in `drainRoutingOutboxes` | The revalidate exit (outbox write); `stack-preflight.ts`'s existing drain call |
| `unionRemBlocks` (new `routing/rem-block-merge.ts`) | `restack-replay.ts`'s pre-resolver step; `restack-ownership.ts` |
| `SelectorInput.routedParking` | `conductor.ts`'s `selectNextGate` call site, set only after `routingEligible` |
| The flag default `true` | `engine/config.ts` defaults, read by `routingSettingOn` and the two direct reads in `conductor.ts` |
| Runbook sections | The halt detail written by the routed cascade-cap halt |

Overlap scan (advisory): only `conductor.ts` and `config.ts` overlap. They overlap with four open
spec branches (`planner-escalation-to-architecture-review-halts-as`,
`run-resolves-another-feature-s-track-marker-when-s`, `daemon-self-host-guardrails`,
`self-host-phase6-wiring`). These are routine merge surfaces. No open PR touches the routing,
restack or preflight modules, or the governing ADR.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Flipping the default turns routing on for in-flight stacked features mid-build. Their closed children have verdicts from before re-validation existed, and a missing verdict counts as invalidated, so the first restack re-validates every moved child | Technical | Medium | Medium | Accepted price (D14 "Cost"). Bounded by the cascade and region caps. Runbook queue section |
| A queue written while routing is ineligible (flag off) is never consumed, which parks the leaf forever | Technical | Low | High | C5: production and parking both gate on `routingEligible`. A flag-off test asserts that no queue ref is written |
| A non-empty queue with no marker redirects region execution to the queued child before its round exists (`resolveExecutionChild` already returns `revalidating` from the queue alone) | Technical | Medium | High | C6: consumption happens before any region entry. Region entry refuses a `revalidating` source that has no `revalidate` round marker |
| The `applied` transaction's routed compare-and-swap is invalidated by a concurrent writer | Data | Low | High | The fence exemption covers the journal owner only. A failed `applied` CAS on a routed or queue ref halts needs-human naming the ref (D13); it never retries |
| A crash between the leaf switch and its record dispatches a leaf gate early | Data | Low | High | `returnToLeaf` is idempotent and records before `closed`. Leaf parking holds until `closed` |
| A rollback re-runs the exit restack in a loop | Technical | Low | Medium | Rollback halts (restack D5). The preflight's `built` arm returns `halted` while that HALT is live |
| The re-validation review base is lost when the journal is deleted | Data | High if unaddressed | High | C4: the replay tuple is copied into the queue entry inside `applied` |
| A follow-on base refresh moves refs while re-validation is pending, or an empty queue ref defers base refresh forever | Technical | High if unaddressed | High | C12 and C13. Load-bearing assumption A1 |
| An audit round closes before its leaf-hosted items run | Data | High if unaddressed | High | C8: the last host includes the leaf |

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | Keeping the REKICK sentinel (unconsumed on the preflight path, re-armed before the journal is deleted on the recovery path), while suppressing the follow-on through the existing `suppressFollowOn` path, retains a deferred base refresh durably until a later preflight runs it | inferred | 85% | yes | A deferred base refresh would be lost until the next FINISH or daemon re-kick requests it again | APPROVED by operator 2026-10-23 |
| 42 tasks exceed the plan ceiling | Knowledge | High | Medium | Operator-declined split recorded as the scope exception. Three stacked slices |

## ADR amendments

Each amended ADR is on main, so each amendment is a dated note beside the original text. The
original text is left unchanged. The D13, D14, restack D7 and as-built D9 notes come from the
conflict check (`.docs/conflicts/a-routed-fix-is-never-carried-up-the-stack-or-foll.md`).

- **D12 (re-validation base).** The old and new replay tuple is copied into the child's queue entry
  by the restack's `applied` transaction, and the `revalidate` round reads it from there. The
  journal is deleted at `applied` (`cleanAppliedJournal`), so "retained from the restack journal"
  cannot hold.
- **D18 (delivery split).** #3212 also delivers the items specs B and C moved to it:
  - decision 9's rem-block replay merge;
  - decision 12's re-validation bases and per-pass credit;
  - `selectNextHost` host progression;
  - `hostNoOpEvidence`;
  - the restack-writer exemption.

  It wires the routed-exit restack to the publication ADR's D11 refusal. The PR comment on a
  published child and refreshing a published stack are #3269 and #3268, not #2945.
- **D13 (no-commit exit).** A taskless host whose build commits nothing is a third no-commit case;
  the leaf `manual_test` PASS is then refused and no-op escalation D2 applies. A host's own queue
  acknowledgement records `child_revalidated`.
- **D14 (queue).** Gated on `routingEligible`; entry shape and gate-union merge (C4); the
  acknowledgement compare-and-swap is on generation and closure SHA, with per-gate freshness (C3);
  the last acknowledgement leaves the round open for `returnToLeaf` (C8).
- **`adr-2026-10-10-stacked-restack-journaled-replay` D7.** A deferred follow-on base refresh is
  suppressed in the preflight and in the `applied`-with-follow-on recovery row, and the request
  survives in `REKICK` (A1, C13).
- **`adr-2026-08-25-as-built-remediable-findings-bounded-build-route` D9.** Only tip equality
  selects the no-commit exit.

## Conditions

- **C1 — one `applied` builder.** Feature-repair, base refresh and recovery's `synced`→`applied`
  build their `applied` lines through one `appliedTransactionLines`. The routed lines (marker delete,
  host `restacked`, the host's own queue-entry acknowledgement) and the queue merge are written there
  and nowhere else. A recording `GitRunner` test proves it on both the normal and the recovery path.
- **C2 — the fence exempts only the journal owner.** `writeRoutingTransaction` and
  `host-region-entry.ts`'s duplicate fence share one predicate. The only writer allowed past a
  non-terminal journal is that journal's own `applied` transaction, identified by its `opId`. Every
  other writer is still refused.
- **C3 — the queue entry is keyed by closure, and gate freshness stays with the gates.** The
  queue answers "which closed children must re-run which gates". It does not answer "is this PASS
  fresh". That question stays with each gate's existing freshness machinery: the full-suite
  fingerprint covers config, selectors and environment, and the `build_review` input identity
  covers base, plan and repair context.
  - **Acknowledgement.** The compare-and-swap is on `(generation, closureSha)`. A PASS counts only
    when each required gate's verdict is fresh under its own existing check at that closure.
  - **Skip rule.** A moved child is skipped only when the existing
    `classifyReplayGateInvalidation`, run over the delta between its old and new closure,
    preserves every region gate, **and** each preserved gate's verdict is present, readable and
    fresh. Consequences:
    - An unproved replay invalidates the feature-scoped reviews, as it does today.
    - `test_suite` (`any-codetest`) is invalidated by any code or test change below the child,
      which covers an API change in a file the child does not own.
    - Acceptance verify-green re-runs whenever `test_suite` does.
  - **Inherited rem blocks (D14).** The replay-proof comparison normalises inherited rem-* blocks
    out of the plan file, using the same parser as the union merge. A replay whose only difference
    is the union of inherited blocks therefore still proves `unchanged`. Rem blocks under
    `.docs/plans/` are not code or test paths, so they never invalidate `test_suite`.
  - The draft's separate per-gate `gateInputIdentity` hash is not added. The gates' existing
    identities are the authority.
- **C4 — the replay tuple travels in the queue entry, and a merge never loses an obligation.**
  - **Entry shape.** Each entry carries `{child, position, closureSha, gates, replay: {oldParent,
    newParent}}`.
  - **Merging into an existing entry.** It keeps the newest `closureSha` and the newest replay
    tuple, which describes that closure. It takes the **union** of `gates` with the entry already
    queued, so a gate one generation required is still required until it is acknowledged.
  - **Review bases.** `revalidation` grades the replayed contribution against `newParent`.
    `revalidation-fix` pins the pre-fix tip at region entry in the route record's existing `entry`.
    No parallel field is added.
- **C5 — eligibility gates everything.** Queue production in `applied`, queue consumption, leaf
  parking and every marker or queue read happen only when `routingEligible`. With the flag off, or
  at N=1, a restack writes no queue and the golden guard stays green.
- **C6 — no execution without a round.** The loop consumes the lowest queued child into a
  `revalidate` round, with the marker set before any mutation, before it enters any region. Region
  entry refuses a `revalidating` execution child that has no matching `revalidate` round.
- **C7 — reuse what shipped.** Extend `RevalidationQueueEntry`, `RevalidationQueueRecord`,
  `revalidationQueueRefFor`, `HostEntry`, `routedRepairCredit`, `drainOutbox` and `nextRoundId`.
  Replace `round-admission.ts`'s hard-coded queue ref string with the builder. Add no parallel types.
- **C8 — open findings carried from the draft are resolved as D6's table states.**
  - **The last host includes the leaf.** An audit round is `closed` only when every host has
    settled (`restacked`, `done` or `rerouted`), including a leaf host. While child hosts are done
    but a leaf host is still `pending`:
    - the round stays open with `currentHostIndex` on the leaf;
    - the queue is consumed through separate `revalidate` rounds;
    - the leaf host is admitted only when the queue is empty (D13 order: child hosts, then the
      queue, then leaf-host items, then leaf gates).
  - **Closing the round.** When its last host settles: if another round is open or the queue is
    non-empty, the round is `closed` in that same compare-and-swap. Otherwise `returnToLeaf`
    records the switch first, then closes the round.
  - **Journal ordering.** The journal's `routeNew` is computed after the invalidation set is
    journalled.
- **C9 — obligation table.** The plan's Architecture Obligation Coverage table has a row for every
  decision of `adr-2026-10-12-routed-whole-feature-repair`, because the ADR is amended. It also
  widens the rows the earlier specs deferred to #3212:
  - reopened-task D8;
  - restack D4, D7, D9 and D10;
  - no-op escalation D2;
  - publication D11's routed-exit refusal.

  Because the conflict check amended them, every decision of
  `adr-2026-10-10-stacked-restack-journaled-replay` and of
  `adr-2026-08-25-as-built-remediable-findings-bounded-build-route` also gets a row.
- **C11 — slice reachability.** Each slice's primitives have a production caller in the same slice
  or an earlier one:
  - Slice 1's exit is called from the region-exit branch and the preflight.
  - Slice 2's progression and leaf return are called from `reconcileRounds` and the loop.
  - Slice 3 adds the queue arm to slice 2's return order, and changes the default.

  Because the flag stays off until slice 3, a merged slice 1 or 2 is reachable only when an operator
  sets the flag explicitly. With the flag set, slices 1 and 2 still route correctly, but without
  re-validation. The runbook says so.
- **C12 — standalone consumption and an empty queue.**
  - **Where consumption runs.** Queue consumption has its own entry in `runStackPreflight`, after
    `reconcileRounds`, so a queue produced by an operator-commit repair or a base refresh is
    consumed even with no routed round.
  - **What counts as open.** `routedRoundOpen` parses the queue and treats it as open only when it
    has entries. An unreadable queue fails closed as open. An empty queue ref is kept while its
    outbox has events. It is deleted in the compare-and-swap that drains its last event when it has
    no entries.
- **C13 — deferral covers the follow-on base refresh.** Two paths run a base refresh as a follow-on
  of an automatic repair: the preflight's follow-on (`stack-preflight.ts`) and recovery's follow-on
  (`restack-recovery.ts`). When `routedRoundOpen` is true after the repair's `applied` transaction,
  both must defer:
  - The follow-on is suppressed. This uses the existing `suppressFollowOn` path, so the journal
    becomes terminal and the route-record fence releases.
  - `restack_refused` is emitted with reason `deferred-base-refresh`.
  - The request is retained in the REKICK sentinel. On the preflight path the deferral happens
    before `consumeRekick`, so the sentinel is never removed. On the recovery path REKICK was
    already consumed when the journal named the follow-on, so recovery re-arms it (writes the
    sentinel) before deleting the journal. The first preflight after the queue drains runs it.
    Operator decision 2026-10-23: re-arm on deferral rather than moving `consumeRekick` later.
- **C10 — release.** The flag flip changes consumer-visible default behaviour. The implementation
  PR declares `Release-Disposition: note` (Changed, minor). No `settings.json`, hook, symlink or
  CLI surface changes, so no migration block is needed.

## ADRs Created

None. The governing ADR is reused and amended (D12, D18).
