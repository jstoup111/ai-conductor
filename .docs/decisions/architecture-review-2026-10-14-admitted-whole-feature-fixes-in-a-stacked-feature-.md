# Architecture Review: Place admitted whole-feature fixes in the owning stacked child (#3210)

**Date:** 2026-10-14
**Stories reviewed:** none yet. This is the pre-stories review of the technical track. Inputs were
`.docs/track/admitted-whole-feature-fixes-in-a-stacked-feature-.md`,
`.docs/complexity/admitted-whole-feature-fixes-in-a-stacked-feature-.md` (Tier L),
`.docs/architecture/admitted-whole-feature-fixes-in-a-stacked-feature-.md`, the approved
`adr-2026-10-12-routed-whole-feature-repair`, and the draft stories and tasks carried on
jstoup111/ai-conductor#3210.
**Verdict:** APPROVED WITH CONDITIONS

## Scope

This is spec B of the four-spec split (ADR decision 18). It delivers decisions 1–4 and 7, and the
route-record writers of decisions 6 and 16. The operator-confirmed scope boundary in the track
marker is binding. In particular:

- **Kept in B** from the draft: Tasks 9, 20–32 (except the standalone-FAIL criteria of Task 32),
  34–36 and 40–44.
- **Moved to jstoup111/ai-conductor#3211**, because each needs machinery that spec owns: Task 33
  (custom-step kickback; needs Task 65's taskless charging), Task 37's region-entry criterion
  (needs Task 48/49), Task 38 (needs Task 60), Task 39 (needs Tasks 52/54), Task 45 (needs Tasks
  48, 58 and 60), Task 46 (needs Task 48), Task 47 (needs Task 49), and the standalone
  `manual_test` FAIL criteria of Story 3 and Task 32 (see finding F2). Task 37's `selectNextHost`
  also moves to #3211: its first production caller is host progression after a region, and B's
  admission needs only the round's ordered host list. Of Task 9's constructors, only
  `remediationRoutedEvent` and `routedRepairPhaseEvent` stay in B; `remediationReroutedEvent` moves
  to #3211 with the reroute and `childRevalidatedEvent` to #3212 with the queue, each with its
  first producer, so B ships no constructor without a production caller.

The foundation shipped with #2944 (PR #3219) is the base: route types and parsers, ref names and
teardown, the store's read and CAS update with the restack-journal fence, the outbox drain, the
cursor fields, the execution-child resolver and the default-off setting.

## Review process

| Round | Target | Reviewer | Findings |
|---|---|---|---|
| 1 | source facts | 2 Claude read-only agents | 14 verified facts; F1–F10 derived |
| 2 | this review, diagrams, ADR vs source | 1 Codex (read-only) | 4 findings, all verified and folded in: F1 halt and target ordering, O2 atomic fence, F8 recovery follow-on, V5 FAIL-only join |
| 3 | conflict check | 1 Claude agent | F11 (duplicate routed event); F8 recovery follow-on reworked to a fence refusal to avoid a latent #3212 deadlock |

## Verified facts (spec base 8aedc143fa)

Paths are relative to `src/conductor/src/engine/`. Confidence and basis are given per fact.

| # | Fact | Basis | Confidence |
|---|---|---|---|
| V1 | `planRemediation` (`conductor.ts`) admits OVER_SCOPE and refusal rework first, then the prd_audit and as-built admission sets, then the per-gap ladder, then budget checks, then `appendConductorRemediationTasks` and `recordAppendedRemediationTaskIds(…, this.activeRegionChild)`, then `recordPendingRepair`, then the halt check, then the `routingEligible` placeholder | verified (read) | 92% |
| V2 | The `routingEligible` placeholder is **after** the leaf append, so it cannot redirect the append | verified | 92% |
| V3 | `planRemediation` returns `{kind:'route'\|'halt'\|'none'}`; the `kickback` emission and `navigateBack` are done by its callers (about 15 sites) | verified | 90% |
| V4 | A prd_audit FIXABLE finding binds one `ownerTaskId`. An as-built `plan-task` reference may hold a comma-joined list of task ids. An `existing-task` gap may bind several ids | verified | 85% |
| V5 | A standalone `manual_test` FAIL (`handleManualTestFailKickback`) and a post-region custom-step kickback (`scanKickbackVerdicts`) never call `planRemediation`. A validation-group join whose only failure is `manual_test` also calls `handleManualTestFailKickback` directly. Only a join that also has unsatisfied gap members, within its round cap, calls `planRemediation` once with `consolidatedManualTestFail` | verified | 95% |
| V6 | `sliceMembership.taskSlices` exists on the sealed envelope (read by `readCoverageBindingEnvelope`) and excludes rem-* ids | verified | 92% |
| V7 | Nothing parses a `**Child:**` line yet; rem membership today is the `appendedRemediationTaskChildren` cache written by `recordAppendedRemediationTaskIds` | verified | 85% |
| V8 | `dispatchRebaseRegradeJudgement?(prompt)` on `step-runner-types.ts` is an optional judge port; absence fails closed | verified | 95% |
| V9 | `route-record-store.ts` has no create-only write, no marker write, and no multi-ref transaction; `writeRouteRecord` is a single-ref CAS update behind the journal fence | verified | 96% |
| V10 | `runStackPreflight` runs a `feature-repair` restack for any `repair-pending` cursor, even when `routedRepair` is set; nothing skips it while a marker exists | verified | 97% |
| V11 | Base refresh runs at four sites with no round check: the preflight follow-on, `recoverRestackJournal`'s follow-on for an `applied` journal carrying `followOnCause` (`restack/restack-recovery.ts`), `daemon-rekick.ts` `resumeRebaseFirst`, and the FINISH rebase in `conductor.ts`. `restack_refused` already has reason `deferred-base-refresh` | verified | 96% |
| V15 | `writeRouteRecord` reads the restack journal, then writes the route ref in a separate `update-ref --stdin` call that does not re-check the journal ref (`refs/conductor/<slug>/restack/journal`, `journalRefFor`) | verified | 97% |
| V16 | In `planRemediation`, the mixed-plan halt check and `earliestRemediationTarget` (with its unresolved-disposition halt) run after the leaf append | verified | 95% |
| V12 | The four routing event members exist on `ConductorEvent` with persister dedup; no constructor exists | verified | 99% |
| V13 | No shared closure-ref or path-at-commit helper exists; the closure ref name is inlined at about nine sites | verified | 90% |
| V14 | Gate contract versions are `PRD_AUDIT_JUDGMENT_CONTRACT_VERSION = 'v1'` and `AS_BUILT_VERDICT_CONTRACT_VERSION = 'v2'` | verified | 99% |

## Feasibility

Feasible on the current stack with no new dependency. Every ref write uses `git update-ref --stdin`
start/prepare/commit transactions, already used by the restack executor. Path presence at a closure
uses `git ls-tree <commit> -- <path>` through the existing `GitRunner`: an empty listing is an absent
path, and a non-zero exit is an unreadable tree, which halts rather than moving the host. The residue call follows
the `dispatchRebaseRegradeJudgement` precedent (V8).

Prerequisites: none beyond #3219. Integration surface: `conductor.ts`, `restack/stack-preflight.ts`,
`daemon-rekick.ts`, `daemon-cli.ts`, `step-runner-types.ts`, `step-runners.ts`,
`remediation-append.ts` (a dry-run renderer), and new files under `routing/`. Data: three ref kinds
already defined, now written for the first time; no `.pipeline/` schema change. Performance: one
`cat-file -e` per cited path per candidate closure, bounded by `MAX_CHILD_ID`. Worktree isolation:
all state is under the feature's `refs/conductor/<slug>/` namespace.

## Complexity

High, as the tier says, but no further split is needed: the kept set is estimated at about 24 plan
tasks, below the 30-task ceiling. Crash ordering is the hard core; it is bounded here to two
writes (record create, marker transaction) and one abort path.

## Alignment

All of the following apply the approved ADR; none needs a new or superseding ADR.

### Open findings carried from the split

| Finding | Resolution | Basis |
|---|---|---|
| O1: nothing moves a round out of `prepared`; reconciliation could abort an open round between hosts | The marker transaction moves the round `prepared` → `open` and the lowest host `pending` → `admitted` in one CAS. Reconciliation aborts only a `prepared` round with no marker. Decision 6 lists phase `open` but names no writer, so this fills the gap without contradicting it | ADR D6, D7 |
| O2: multi-ref transactions bypassed the writer fence | The store gains one fenced transaction writer used for every route-record and marker write in B: create-only record, record plus marker, CAS update and CAS delete. The fence is atomic: the writer reads the journal ref, refuses when the journal is non-terminal or is `applied` with a pending `followOnCause`, and puts a `verify refs/conductor/<slug>/restack/journal <observed value or zero>` line in the same `update-ref --stdin` transaction, so a journal created or advanced between the read and the commit fails the transaction (V15). The shipped `writeRouteRecord` and the outbox drain move onto this writer. No writer is exempt in B; the restack `applied` exemption is #3212's | ADR D6 "Writers during a restack" |
| O3: a taskless cap halt must leave no `prepared` record | Moves to #3211 with Task 33 and Task 65 | scope |
| O4: Task 39's "child 2's task status" wording | Moves to #3211 with Task 39 | scope |

Task 9 (event constructors and `transitionHost`) is in B, because admission is its first production
caller. The other primitives moved from #2944 are in B: `nextRoundId`, the `MAX_ROUTE_ROUNDS` halt,
`isLegalHostTransition`, `isLegalRoundPhaseTransition`, `createRouteRecord`, and the outbox append
written in the same CAS blob as the state change. The `RoutingPorts` interface and
`ConductorOptions.routing` are in B only as far as B's own ports need them: router, routing call
and admission.

### New findings from this review

- **F1: routing takes over only where today's path would route to a region step, and before the
  leaf append (V1, V2, V16).** When `routingEligible` is true, `planRemediation` first evaluates,
  without side effects, the predicates today's path applies after the append: the mixed-plan halt
  check, `earliestRemediationTarget` and its unresolved-disposition halt, and whether the target is
  a region step (`isRegionStep`). If any of them would halt, or the target is at or before
  `coverage_binding`, the stacked feature follows today's path byte for byte, append included, and
  no routing ref is read or written. Only otherwise does the routing branch run, after admission,
  the per-gap ladder and the budget checks, and before `appendConductorRemediationTasks`; it skips
  the leaf append, `recordAppendedRemediationTaskIds` and `recordPendingRepair` for that round. The
  placeholder is removed. With the setting off, or `no-child`, the code path is unchanged.
- **F2: FAIL-only routing moves to #3211 (V5).** A standalone `manual_test` FAIL, and a
  validation-group join whose only failure is `manual_test`, both bypass `planRemediation` and
  charge their own counter, so routing them needs Task 65's taskless admission charge. Mixed rounds
  from a validation-group join go through `planRemediation` and stay in B: the FAIL obligation goes
  to the earliest task-owned host, and the FAIL rows ride every host's hint (ADR D3). B's residue
  call therefore covers only as-built REMEDIABLE findings citing only `<adr-stem> D<n>`, and refusal
  rework.
- **F3: the route travels on the return value (V3).** `planRemediation` admits the round itself and
  returns `{kind:'route', target:'build', …, routedRound: roundId}` only on `admitted`. Callers emit
  their single `kickback` and call `navigateBack` exactly as today, so there is one rewind per round
  with no caller change beyond carrying the roundId on the event. A halt or refusal from admission
  returns `{kind:'halt'}`.
- **F4: one owner for several bound tasks (V4). Operator decision 2026-10-14.** When a task-bound
  item binds tasks owned by more than one child, the owner is the lowest of those children, with
  reason `multi-task-earliest` and no judgement. Cannot-host still moves the host upward when an
  input is missing. This mirrors decision 3's residue-default rule (#2940 decision 4b).
- **F5: rem-task owners before `Child:` lines exist (V6, V7).** For a rem-* id, owner derivation
  reads the block's committed `**Child:**` line, else the `appendedRemediationTaskChildren` cache,
  else halts needs-human naming the task. This is decision 9's "fails closed only when both are
  absent" rule, applied before #3211 writes any `Child:` line.
- **F6: frozen block bodies are complete at admission. Operator decision 2026-10-14.** B renders each
  host's rem blocks through a dry-run of the existing appender in `remediation-append.ts`, including
  `**Child:** <host>` and `**Round:** <roundId>` lines, and stores those bytes in the frozen
  allocation. #3211's writer writes them verbatim. Ids are allocated against the union of the leaf's
  plan and every host plan (decision 6). B writes no block to any plan. Each host's retry hint (for example, mixed-round FAIL rows) is
  stored as an optional `retryHint` on that host's frozen allocation entry, so it survives to that
  host's region entry in #3211.
- **F7: reconciliation re-navigates in the conductor, not the preflight.** `reconcileRounds` runs in
  `runStackPreflight` after both journal recoveries and the outbox drain, and before
  `resolveActiveChild`. It aborts a `prepared` round with no marker by CAS-delete. For a host
  `admitted` it returns an action; the conductor's resume applies the leaf navigation to `build`,
  because only the conductor owns step state. Later phases return `deferred-to-later-spec` without
  acting.
- **F8: the preflight skip and the deferral (V10, V11).** While a marker exists, the preflight never
  calls `runRestack` with cause `feature-repair` and returns `clear`. A shared `routedRoundOpen` is
  true when any route record is not `closed` or the queue ref is non-empty. While it is true, all
  three caller-owned base-refresh sites (the preflight follow-on, `daemon-rekick.ts`
  `resumeRebaseFirst`, the FINISH rebase) emit `restack_refused` with reason
  `deferred-base-refresh`, move no ref, and leave `REKICK` unconsumed. The re-kick resume then
  continues instead of halting; the FINISH rebase returns failure, so nothing is published. The
  fourth site, `recoverRestackJournal`'s follow-on, is not deferred: the fence refuses every route
  write while an `applied` journal carries a pending follow-on (O2), so no round can be open when
  recovery starts one. Keeping that journal outstanding instead would block #3212's exit restack
  (restack decision 9's `restack-outstanding`), so the round could never close.
- **F9: a missing judge fails closed (V8).** With no `dispatchResidueRoutingJudgement` on the step
  runner, a round with residue halts needs-human naming the items, before any ref write.
- **F11: the routed event is written at the marker, and orphaned `prepared` rounds abort.** The
  conflict check found that an event written at the `prepared` create is drained on resume before
  reconciliation aborts the round, so a re-admitted round emits a second `remediation_routed`. The
  event is therefore written by the marker transaction, with the host's `routed_repair_phase`; an
  aborted round emits nothing. Reconciliation aborts every `prepared` round that no marker names,
  including one whose marker transaction lost to another round.
- **F10: helpers (V13).** B adds `closureRefFor(slug, child)` beside the other ref helpers in
  `routing/routing-refs.ts` for its own reads; existing inlined sites are not migrated.

### Pattern basis

- **Optional judge port.** `dispatchRebaseRegradeJudgement` in `step-runner-types.ts` and its
  implementation in `step-runners.ts`. Traits to keep: an optional method, a
  `(prompt) => Promise<{success; output?}>` shape, provider resolution through `resolvedConfigFor`
  for a named step, and fail-closed absence. Variation allowed: its own step key and schema.
- **Multi-ref CAS transaction.** The restack executor's `transaction(lines)` and
  `journalStateUpdateLines` in `restack/`. Traits to keep: one `update-ref --stdin` call with
  start/prepare/commit, explicit old values, and a zero old value for create. Variation allowed: the
  helper lives in `route-record-store.ts`, and carries a `verify` line for the journal ref in the
  same transaction.

### Domain integrity

- **State:** the host and round phases are closed unions (`HostState`, `RoundPhase`). Transitions go
  through `isLegalHostTransition` and `isLegalRoundPhaseTransition`, and every switch is exhaustive
  with `assertNever` and no default arm (the #2944 structural guard covers `routing/`).
- **Primitives:** `ChildId`, `RoundId` and `CommitSha` are branded parsers; owner reasons are a
  closed union (`task-slice`, `rem-child-line`, `rem-cache`, `multi-task-earliest`, `residue-judged`,
  `residue-default`, `mixed-round`, `prerequisite-paths`).
- **Production DI:** every store is ref-backed; there is no in-memory production default.
- **Security:** the residue call's output is untrusted. It is schema-validated, and every child and
  candidate must be a declared slice position.

## Wiring Surface

| Surface | Production caller |
|---|---|
| `routing/owner-derivation.ts` `deriveTaskBoundOwner` | `routeAdmittedRound` |
| `routing/cannot-host.ts` `classifyCitedPaths`, `selectHost` | `routeAdmittedRound` |
| `routing/residue-routing-call.ts` `runResidueRoutingCall` | `routeAdmittedRound`, judge wired from `conductor.ts` |
| `routing/round-router.ts` `routeAdmittedRound` (with the ordered host list) | `planRemediation` stacked branch in `conductor.ts` |
| `routing/round-admission.ts` `admitRound` | `planRemediation` stacked branch |
| `routing/round-admission.ts` `reconcileRounds` | `runStackPreflight`, reached from conductor resume, FINISH and `daemon-cli.ts` re-kick |
| `routing/round-admission.ts` `routedRoundOpen` | `runStackPreflight`, `daemon-rekick.ts` `resumeRebaseFirst`, the FINISH rebase in `conductor.ts` |
| `routing/routing-events.ts` `remediationRoutedEvent`, `routedRepairPhaseEvent` | the marker transaction in `admitRound` and `transitionHost`; drained by the existing `drainRoutingOutboxes` |
| `route-record-store.ts` `createRouteRecord`, `transitionHost`, the fenced transaction writer, `nextRoundId` | `admitRound`, `reconcileRounds` |
| `StepRunner.dispatchResidueRoutingJudgement` | `step-runners.ts` implementation; consumed via the `judge` port in `planRemediation` |
| `remediation-append.ts` dry-run renderer | `routeAdmittedRound` allocation |

Every surface is reached only when `routingEligible` is true. With the default-off setting, none
runs in production until #3212 turns it on; the as-built reachability sweep must accept the gated
caller chain from `planRemediation` and `runStackPreflight`.

Early overlap scan over these paths is recorded below.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A crash between the record create and the marker leaves a stranded round | Data | Medium | High | O1: abort a `prepared` round with no marker by CAS-delete; crash tests at each boundary |
| The automatic restack closes over a half-built fix | Data | Medium | High | F8: skip `feature-repair` while a marker exists; tested with post-closure commits |
| A restack starts between the fence read and the route write | Data | Low | High | O2: the journal ref is verified inside the same `update-ref --stdin` transaction; tested with an injected writer |
| A routed round bypasses a halt or pre-region target today's path enforces | Technical | Medium | High | F1: those predicates are evaluated first and fall through to today's path; parity tests for each |
| A routed round parks on the host region with nothing appended while the setting is on | Technical | High if the setting is on | Medium | The setting stays default-off until #3212 (ADR D18); runbook note in #3212 |
| Residue judgement mis-places work | Technical | Medium | Medium | Declared-position validation, one re-ask, earliest-candidate default, halt on invalid |
| The routing branch changes N=1 or flag-off behaviour | Technical | Low | High | ADR D17 golden guard (shipped) plus parity tests for every refusal kind |
| Leaving today's admission-time lap bump in the ledger for a routed round double-charges once #3211 settles the receipt | Integration | Medium | Medium | Recorded on #3211: its receipt settlement must reconcile the bump B leaves |

## ADRs Created

None. `adr-2026-10-12-routed-whole-feature-repair` (APPROVED) governs every structural decision here.
F4 and F6 are operator-approved interpretations within decisions 2, 6 and 9, and O1 fills decision
6's unnamed `open` writer without contradicting it. No ADR is amended.

## Conditions

1. The routing branch sits before the leaf append and skips the leaf append and its bookkeeping
   for a routed round (F1).
2. Every route-record and marker write goes through the store's single fenced transaction writer
   (O2), and the marker transaction is the writer of round phase `open` (O1).
3. Admission happens inside `planRemediation`; the routed round reaches callers only through the
   `route` return (F3).
4. The multi-task owner rule (F4), rem-owner fallback (F5) and complete frozen bodies (F6) are
   implemented as stated.
5. The preflight skip and the deferral apply at the three caller-owned base-refresh sites, and the
   fence refuses route writes while an `applied` journal has a pending follow-on (F8, O2).
6. Routing runs only where today's path would route to a region step, after its halt and target
   predicates are evaluated (F1).
7. jstoup111/ai-conductor#3211 is updated to carry the moved tasks, the FAIL-only routing and
   the lap-bump reconciliation risk before this spec lands.
8. `remediation_routed` is written by the marker transaction, never by the `prepared` create, and
   reconciliation aborts every `prepared` round no marker names (F11).


## Early overlap scan (advisory)

`ai-conductor overlap-scan` over the Wiring Surface paths, 2026-10-14:

- `origin/spec/daemon-self-host-guardrails`: `conductor.ts`, `daemon-rekick.ts`
- `origin/spec/self-host-phase6-wiring`: `conductor.ts`, `daemon-cli.ts`

Both branches were last committed on 2026-07-01, and their `conductor.ts` diffs contain no reference
to `planRemediation`, `runStackPreflight` or `routingEligible` (verified). No plan change is required.
