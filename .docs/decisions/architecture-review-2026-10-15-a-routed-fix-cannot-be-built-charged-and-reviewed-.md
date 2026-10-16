# Architecture Review: Build, charge and review a routed fix on the child that hosts it (#3211)

**Date:** 2026-10-15
**Stories reviewed:** none yet. This is the pre-stories review of the technical track. Inputs were
`.docs/track/a-routed-fix-cannot-be-built-charged-and-reviewed-.md`,
`.docs/complexity/a-routed-fix-cannot-be-built-charged-and-reviewed-.md` (Tier L),
`.docs/architecture/a-routed-fix-cannot-be-built-charged-and-reviewed-.md`, the approved
`adr-2026-10-12-routed-whole-feature-repair`, spec B's review
(`architecture-review-2026-10-14-admitted-whole-feature-fixes-in-a-stacked-feature-.md`), and the
draft stories and tasks carried on jstoup111/ai-conductor#3211.
**Verdict:** APPROVED WITH CONDITIONS

## Scope

This is spec C of the four-spec split (ADR decision 18). It delivers decisions 5 and 9–12 for the
routed-repair pass, plus the items spec B moved here. The operator-confirmed scope boundary in the
track marker is binding. In particular:

- **Kept in C** from the #3211 draft: Tasks 48–72 and 74, with the re-validation criteria removed
  (below). The items spec B moved here: Task 33 (post-region custom-step kickback as a taskless
  round), Task 37's leaf-hosted blocks written at the leaf's region entry when the leaf is the round's
  current host (its `selectNextHost` half moves to #3212, F16),
  Task 38 (a leaf-hosted item never writes the flat `pendingRepair`), Task 39 (execution projection
  in the membership hook and `task-cli`), Task 45 (every new routing writer refused while a restack
  journal is open), Task 46 (one rewind per round across host entries), Task 47 (crash matrix
  across the append commit and `repairing`), the standalone and FAIL-only `manual_test` routing of
  Story 3 / Task 32, and the `remediationReroutedEvent` constructor of Task 9.
- **Moved to jstoup111/ai-conductor#3212** (operator decision 2026-10-15, recorded on #3212 in
  comments 6205173493 and 6205348347): the `revalidate` restage arm (Task 48's last criterion), verify-green
  acceptance in a revalidate pass (Task 53's revalidate half), the guard exemption for revalidate
  rounds (Task 56's last criterion), selecting and taking the no-commit exit (Task 69 criteria 4–5,
  which need #3212's Task 84), Task 73 whole (the `revalidation` and `revalidation-fix` review
  bases), the re-validation half of the per-pass credit, Story 11 Happy Path 3 and 5, decision 11's
  return path, marker deletion, `selectNextHost` with host progression after a region (F16), and
  decision 9's restack replay merge of appended rem blocks, already in #3212's draft as its Tasks
  89–90, because its first producer is the exit restack (coherence check, 2026-10-15).
- **Plan size.** Estimated 30–33 tasks. The operator chose a scope exception over a further split
  (2026-10-15): a C1 without settlement would build a host with nothing charged. The plan carries a
  `**Scope-exception:**` citing that decision.

The conflict check added #3211 amendment notes to six APPROVED ADRs, including one note on routed
decision 10 that keeps custom-step kickbacks on today's ledger bump (see Conflict-check
resolutions). No other decision changes. Moving delivery between the follow-on specs is recorded in this review, the
track marker and the #3212 comment, following spec B's precedent; decision 18's assignment of
decisions to specs is otherwise unchanged. After this spec a host can reach `repairing` and build,
but nothing moves it to `built` or `done`. With the setting `stacked_prs.route_whole_feature_fixes`
off (its default until #3212), that path is unreachable.

## Review process

| Round | Target | Reviewer | Findings |
|---|---|---|---|
| 1 | source facts vs the draft | 2 Claude read-only agents (code, docs) | V1–V20 below; draft drift D1–D6 |
| 2 | targeted reads by the reviewer | this review | lease reentrancy, routed lap charging, structured-result channel, release-gate surface |
| 3 | this review and diagrams vs ADR and source | 1 Codex (read-only) | 10 findings, all verified against source and folded in as F9–F17 and the V20 correction |

## Verified facts (spec base 8685da1ec8)

Paths are relative to `src/conductor/src/engine/`.

| # | Fact | Basis | Confidence |
|---|---|---|---|
| V1 | `writeRoutingTransaction` (`routing/route-record-store.ts`) has 4 op kinds (`create-record`, `update-record`, `delete-record`, `create-marker`) and puts `verify <journal ref>` in the same `update-ref --stdin` | verified | 95% |
| V2 | Host states `pending, admitted, repairing, reroute-moved, built, restacked, done, rerouted`; legal edges include `admitted→repairing`, `repairing→reroute-moved`, `reroute-moved→rerouted`. Only `admitRound` calls `transitionHost` | verified | 95% |
| V3 | `RouteRecord.receipt` is `Readonly<Record<string, unknown>>`, documented as a placeholder; there is no pinned base, no obligations field, and `RoutedItem.fallback` is always `[]` | verified | 95% |
| V4 | `reconcileRounds` returns `navigate-leaf-to-build` for an `admitted` host and `deferred` for every later host state | verified | 92% |
| V5 | `allocateFrozenBlocks` (`remediation-append.ts`) stores complete block bodies with `**Child:**` and `**Round:**` lines; nothing writes them to a plan | verified | 93% |
| V6 | The routed branch of `planRemediation` returns `route → build` before any budget, append, `recordPendingRepair` or restage; it writes no ledger lap. The in-memory `remediationRounds` counter and its round cap at the gate handler run as for N=1 | verified (read) | 88% |
| V7 | prd_audit and as-built laps are charged durably only at BUILD dispatch, by `settleBuildPendingRepair` → `settlePendingRepair` on the flat ledger | verified | 90% |
| V8 | `withKickbackLedgerLease` takes a non-reentrant directory lease; its comment says the inner writer bypasses it so a transaction never re-acquires | verified (read) | 97% |
| V9 | `resolveExecutionChild` returns `routed-host` for a cursor carrying `routedRepair`; `enterChildRegion` then switches to `feat/c<host>/<slug>` | verified | 90% |
| V10 | `closeChild` writes only `closed/c<k>` (create-only); no `red/c<k>` ref is written; `redRefFor` exists for teardown | verified | 93% |
| V11 | The hook stamps only `Task:`; `Round:` is read only by `child-cursor.ts` (post-closure commit classification). The hook already shells out to `ai-conductor task-membership-check`, the precedent for a hook-invoked subcommand | verified | 95% |
| V12 | `readRemTaskChildLine` (`routing/owner-derivation.ts`) parses one rem `**Child:**` line; membership and `task-progress.ts` still read only the `appendedRemediationTaskChildren` cache | verified | 88% |
| V13 | `RepairAdmission` / `RepairObligation` carry no branch or round; the admission key hashes plan path, source, findings, bindings and current HEAD | verified | 92% |
| V14 | `BuildReviewInputs.baseKind` is `child-parent \| remote \| local`; `resolveChildBase` is the single producer of a child base | verified | 92% |
| V15 | `creditBuildReviewConvergence` (`rebase-transition.ts`) is private and already skips `feature-repair` | verified | 90% |
| V16 | `isHaltRecordOnlyDescendant` (`restack/restack-recovery.ts`) is private; `syncRestackedWorktree` (`restack/restack-sync.ts`) is the tree-sync precedent | verified | 92% |
| V17 | Provider invocations support a terminal structured result (`finalStructuredResult`, `structuredResultFailure: missing \| malformed`); the build dispatch requests none today, and no `blocked-by-prerequisite` schema exists | verified | 85% |
| V18 | `remediation_rerouted` exists on the `ConductorEvent` union and in the persister's dedup; no constructor exists | verified | 95% |
| V19 | `classifyBreakingSurfaces` (`self-host/release-gate.ts`) flags `hook wiring` only for paths under `hooks/`; `engine/git-hook-assets.ts` and a new engine CLI module match no breaking surface | verified | 95% |
| V20 | `task-cli.ts` `task status --child` already reports the routed round's `allocation[child].remTaskIds`; `task start` and `task done` still refuse an authored task whose owner is not the selected child | verified (read) | 92% |
| V21 | The router (`routing/round-router.ts`) records no bound task ids on a `RoutedItem`, allocates no block for an `existing-task` item, and sets `restage: false` on **every** `existing-task` item, not only in mixed rounds | verified (read) | 95% |
| V22 | Repair obligations live only in `.pipeline/engine-state.json` (`repair-restage.ts`, `repair-obligations.ts`), outside any ref transaction | verified | 92% |

**Draft drift** (the draft predates spec B's build):

- D1: spec B's lap-bump risk row is moot (V6). A routed round has no admission-time ledger lap to reconcile. Settlement is the only durable charge.
- D2: the `Child:` reader exists as `readRemTaskChildLine`. Membership reuses it rather than adding `readRemediationChildLines`.
- D3: `readPendingAsBuiltRemediationFindings` lives in `kickback-ledger.ts`, not `as-built-projection.ts`.
- D4: `RoundReceipt` must become a typed, parsed value (F3).
- D5: draft dependencies 75, 78 and 84 are #3212 tasks. Every draft criterion that needed them moved to #3212.
- D6: `KICKBACK_CAP_HALT_CLASS` is in `halt-classification.ts`, and `remediationLapCapForGate` in `remediation-caps.ts`.

## Feasibility

Stack: no new dependency. Every mechanism extends an existing seam:
- the fenced routing writer;
- the remediation-append seam;
- the repair-obligation store;
- the kickback ledger and its lease;
- the single child-base producer;
- the hook's existing `ai-conductor` delegation;
- the provider structured-result channel.

Prerequisites shipped with #2944 and spec B (V1–V5, V9, V18). Integration surface is wide: about 25–30
files across the routing core, the ledger, review inputs and the commit hook. It is bounded by the
default-off setting and the D17 golden guard. Data: refs only. New refs are `rejected/<roundId>/<n>` and `red/c<k>`; the route record
gains typed fields read back fail-closed. No migration: existing records carry `receipt: {}`, which
parses as an unsettled empty receipt (F3). Performance: settlement reads one route ref per open
round, and seal rotation enumerates route refs only when routing is eligible. Worktree isolation: all
state is per feature under `refs/conductor/<slug>/` and the feature's `.pipeline/`.

## Complexity

High (state machines across git ref transactions, a ledger and the worktree, each with crash
recovery). It is not a spike: every step has a shipped precedent (restack sync, fenced CAS, ledger
receipts, verdict structured results). The plan is at the scope ceiling; see Scope.

## Alignment

### Open findings carried from the draft

| Finding | Resolution | Governs |
|---|---|---|
| Task 69 vs Task 84 / decision 13: no-commit exit chosen by tip-versus-closure equality only | Exit selection moves to #3212 with Task 84. This spec records the host's tree-hash baseline at region entry and exposes the build's no-op evidence; it selects no exit | D11, D13 |
| Task 69 vs Task 31 / Story 3: honour `restage: false` for mixed-round existing-task gaps | Region entry restages an `existing-task` item's rows only when its `RoutedItem.restage` is not `false`, and still admits its obligation. The router sets `restage: false` only in a mixed round (F9) | D11 |
| Task 63 vs Task 62: the ledger lease is non-reentrant (V8) | `reconcileReceiptLedger` has a lease-holding entry point and an unlocked inner variant; settlement holds the lease and calls the inner variant | D10 |
| Task 49: where `writeFrozenBlocks` lives | In `remediation-append.ts`, the single appender (as-built D5), called from `enterHostRegion` | D9 |
| Task 69 vs Tasks 48, 49: order of the existing-task restage and obligation admission | Both run after the append commit and before the `repairing` compare-and-swap, as does task-status seeding (F11), so a crash before `repairing` replays them by admission key | D9, D11, reopened D2 |
| Obligation rows to widen (routed D5, D9–D11; prd-audit D6; as-built D5; operator-budget D1, D6; reopened D2; no-op D2; per-child D6, D9, D10; identity D11; acceptance-red D4) | The plan's Architecture Obligation Coverage carries a row for each, naming its task. Rows whose criteria moved to #3212 (no-op D2's escalation; per-child D9's re-validation base) name #3212 | plan |
| O3: a taskless cap halt must leave no `prepared` record | Taskless charging runs before `createRouteRecord`. A cap halt returns before any routing ref is written (F4) | D10 |
| O4: Task 39's "child 2's task status" wording | Task status for a routed host is seeded into that host's child task status through the execution projection, never the flat file; criteria name the host's child, not a fixed position | D9, per-child D6 |
| Spec B risk: admission-time lap bump double-charges | Moot (D1/V6). A test asserts that a routed round's only durable lap charge is the receipt settlement | D10 |

### New findings from this review

| Finding | Resolution | Governs |
|---|---|---|
| F1: the fenced writer has no op to CAS a branch, pin a rejected tip, or move the marker | Extend `RoutingTransactionOp` with `update-branch` (CAS on `refs/heads/…`), `create-pin` (create-only under `rejected/<roundId>/<n>`) and `update-marker`. Every op still rides the one fenced transaction. No routing write bypasses it, including region entry, settlement and the reroute (Task 45) | D5, D6, spec B O2 |
| F2: the builder has no channel for a prerequisite claim (V17) | A routed build dispatch requests an optional terminal structured result `{outcome: 'completed'} \| {outcome: 'blocked-by-prerequisite', paths?, symbols?, child}` with a closed schema. A missing result is `completed` (no claim). A malformed one is an unverified claim, so a failed attempt on the host region's caps. N=1 and non-routed builds request no schema | D5, event-spine (no sidecar file) |
| F3: `RoundReceipt` is opaque (V3) | Replace it with a typed receipt: per-gate laps, declared growth, taskless counters, `settlementId?`, per-host `acks`. A closed parser maps `{}` to unsettled-empty and anything else unparseable to malformed, which settlement treats as exhausted. Also add `pinnedBase` per host, and `fallback` entries `{from, to, evidence, branch, head}` on the record | D10, D12, D5 |
| F4: the `manual_test` counter was process-local (ADR A4) | `chargeTasklessAtAdmission` computes the `manual_test` count from every route record's receipt for this feature plus one. A routed custom-step kickback keeps today's durable, tree-keyed ledger bump under the re-opened gate, before the route record is created, and the receipt only echoes it (conflict B2). It emits the round's single `kickback` event, checks `MAX_KICKBACKS_PER_GATE`, and only then lets `createRouteRecord` carry the charge. Order: counter, event, cap, record | D10, O3 |
| F5: reroute state must not be rebuilt from the worktree | The `reroute-moved` phase carries `{source branch, rejected tip, reset tip, destination}`. `reconcileRounds` gains a `reroute-moved` arm that runs `completeRerouteSync` before any admission or dispatch, and a `repairing` arm that resumes the host region without restaging | D5, D6 |
| F6: the credit and the pinned base must be written atomically with `repairing` | `pinnedBase` and the `routed_repair_phase {credit: true}` outbox entry ride the `admitted→repairing` transaction. The child-ledger `routedRepairCredit {roundId}` is written under the child ledger lease after it, and reconciled from the record on resume | D12, D16 |
| F7: `Round:` stamping must not touch N=1 | `ai-conductor round-stamp` checks `routingEligible` first and reads no routing ref when it is false (D17 golden guard). It is registered in the commander program like `task-membership-check` (`adr-2026-10-14-commander-program-is-the-cli-catalog`) | D5, D9, D17 |
| F8: the builder must see the frozen bodies, not regenerate them | `writeFrozenBlocks` writes the stored body bytes. A reroute re-renders only the `**Child:**` line of each body; every other byte is unchanged | D9, spec B F6 |
| F9: `existing-task` bindings are not durable, and the router marks every one `restage: false` (V21) | `RoutedItem` gains `taskIds` (the bound authored ids, canonical order) for an `existing-task` item. The router sets `restage: false` only in a mixed round (FAIL rows present), per spec B Story 3. The parser treats an `existing-task` item without `taskIds` as malformed | D11, ADR decision 4 |
| F10: obligations cannot join a ref transaction (V22) | The route record is the authority for routed obligations. Each item records `obligation {branch, head, tree}` once bound, written in the `repairing` transaction and re-targeted in the reroute transaction. The `engine-state.json` obligation is a projection, reconciled from the record idempotently at region entry and on every resume before dispatch, keyed by `(roundId, findingId, taskIds)` | D5, D11 |
| F11: `repairing` written before task-status seeding leaves an unseeded host after a crash | Seeding runs before the `repairing` CAS and is idempotent. The `repairing` resume arm re-runs the seed reconciliation, never the restage or the append | D9 |
| F12: a resume that skips the branch switch can build on the wrong branch | Every region entry and resume verifies the checked-out branch is the execution child's branch and switches under the dirty-tree refusal. Only the append, restage and obligation admission are skipped on resume | D9 |
| F13: settlement can acknowledge without repairing a lost ledger write, and a lost CAS is not proof of settlement | Settlement always acquires the ledger lease and runs the unlocked reconcile first, on both the settled and unsettled arms. After a `cas-failed`, it re-reads the record and acknowledges only when the receipt parses as settled. A `restack-journal-open` result halts. Any other change (an outbox drain) retries the whole fenced operation, bounded at 3 attempts, then halts needs-human naming the round | D10 |
| F14: a reroute destination may already hold work in the same round | Hosts are processed lowest first, so a destination strictly above the current host is `pending` or absent. The reroute transaction asserts that and halts needs-human otherwise. It merges the source allocation into the destination's (ids are stack-unique by allocation, so the union is disjoint), re-renders the moved bodies' `Child:` line, and re-points the moved items' `host` | D5 |
| F15: the leaf host has no closure, and a base read after the append is unstable | Region entry first writes `entry {pinnedBase, tree}` for the host by its own CAS, before any mutation: `closed/c<h>` for a closed host, the leaf tip for the leaf host. A retry reuses a recorded pin. The same pin is the review base, the testQuality base and the no-op tree baseline, so grading includes the engine's append commit, which is part of the repair | D11, D12 |
| F16: `selectNextHost` has no production caller in C | Host progression after a region needs a host to reach `built` or `done`, which is #3212's exit. `selectNextHost` moves to #3212 and is added to the #3212 record. This spec enters only the round's current host, which may be the leaf | D18 reachability |
| F17: `task start` and `task done` refuse a bound task on a host that is not its owner (V20) | The execution projection authorizes the current routed host's frozen rem ids and `existing-task` `taskIds`, in `task-cli.ts` and the membership hook alike | D4 execution projection, per-child D6 |

### Pattern basis

- **Tree sync after a ref move.**
  - *Role:* precedent for `completeRerouteSync`.
  - *Traits to keep:* `read-tree -m -u <old> <new>` against the checked-out branch, refusal on a dirty tree, and an idempotent re-run on resume.
  - *Allowed variation:* the source of the old and new tips (route record versus restack journal).
  - *Hints:* `syncRestackedWorktree`, `restack/restack-sync.ts`.
- **Fenced multi-ref CAS.**
  - *Role:* precedent for every new routing op.
  - *Traits to keep:* one `update-ref --stdin` per state change, the journal `verify` line, outbox entries in the same blob, and a `cas-failed` result that never retries blind.
  - *Hints:* `writeRoutingTransaction`, `admitRound`.
- **Receipt-keyed ledger reconciliation.**
  - *Role:* precedent for settling by receipt id.
  - *Traits to keep:* `settlementReceipts[id]` presence means applied; apply under the lease; never refund.
  - *Hints:* `settlePendingRepair`, `kickback-ledger.ts`.
- **Hook-invoked engine subcommand.**
  - *Role:* precedent for `round-stamp`.
  - *Traits to keep:* the launcher is quoted by the hook asset, and the subcommand exits 0 with no change when not applicable.
  - *Hints:* `task-membership-check` in `git-hook-assets.ts` and `task-membership-check-cli.ts`.

### Domain integrity

- Host states, round phases, `RouteKind`, `baseKind`, the claim outcome and the settlement result are closed unions, each consumed by an exhaustive switch with no default arm. The shipped structural guard over routing unions covers the new switches.
- Branch names come only from `childBranchFor` and `leafBranchFor` (a structural test forbids building `feat/c` strings).
- `RoundId`, `ChildId` and settlement ids are the shipped branded types. Settlement ids are derived from `(roundId, receipt digest)`, never a timestamp.
- The obligation `branch` is parsed fail-closed. Absent means the checked-out branch, as N=1 does today.

## Wiring Surface

| Surface | Production caller |
|---|---|
| `routing/host-region-entry.ts` `enterHostRegion` | conductor region entry when `resolveExecutionChild` returns `routed-host` (including the leaf as host); `reconcileRounds`' `repairing` arm on resume |
| `remediation-append.ts` `writeFrozenBlocks` | `enterHostRegion` |
| `routing/host-region-entry.ts` `verifyGreenAcceptance` | the `acceptance_specs` step path in `conductor.ts` for a routed pass; `artifacts.ts`'s completion predicate only reads its recorded result |
| `child-lifecycle.ts` `red/c<k>` write | existing `closeChild` |
| `routing/round-receipt.ts` `settleRoundAtDispatch` | the `settleBuildPendingRepair` closure in `conductor.ts` when the execution child carries `routedRepair` |
| `routing/round-receipt.ts` `reconcileReceiptLedger`, `rebuildLedgerFromReceipts` | conductor resume and `runStackPreflight` after journal recovery; inside settlement (unlocked variant) |
| `routing/round-receipt.ts` `chargeTasklessAtAdmission` | `admitRound` path for taskless and FAIL-only rounds: `handleManualTestFailKickback`, the validation-group FAIL-only join, `scanKickbackVerdicts` custom-step kickback (ledger bump unchanged, receipt echo only) |
| `routing/round-receipt.ts` `grantRoutedRepairCredit` | `enterHostRegion`; consumed by the `build_review` cumulative-bound check in `conductor.ts` |
| `routing/prerequisite-claim.ts` `verifyPrerequisiteClaim`, `rerouteRound`, `completeRerouteSync` | routed build result handling in `conductor.ts`; `reconcileRounds`' `reroute-moved` arm |
| `routing/round-router.ts` `RoutedItem.taskIds` and mixed-round-only `restage: false` (F9) | existing `routeAdmittedRound`, called from `planRemediation` |
| `routing/routing-events.ts` `remediationReroutedEvent` | `rerouteRound` outbox entry, drained by `drainRoutingOutboxes` |
| `repair-obligations.ts` optional `branch`, `retargetObligation`; `repair-restage.ts` `admitRoutedObligation` | `enterHostRegion`; `rerouteRound` and its resume repair |
| branch-aware trailer range in `autoheal.ts`, `task-progress.ts`, `task-seed.ts` | existing task-progress and seed callers when an obligation carries `branch` |
| `round-stamp-cli.ts` (`ai-conductor round-stamp`) | `PREPARE_COMMIT_MSG_HOOK` in `git-hook-assets.ts`, registered in the commander program |
| `Child:`-line membership in `task-membership-check-cli.ts`, `task-progress.ts`, `artifacts.ts` cache rebuild | existing membership hook and task-progress callers |
| frozen-id tolerance in `protected-artifact-seal.ts` | existing `evaluateProtectedArtifactSealRotationInRepository` callers |
| stacked `authored` and frozen-allocation exclusion in `kickback-ledger.ts` `readGrowth` | existing growth readers |
| route-record pending findings in `as-built-projection.ts` | existing as-built prior-findings input |
| `routed-repair` kind in `child-cursor.ts` `resolveChildBase` and `build-review-inputs.ts` | `assembleBuildReviewInputs`, testQuality preflight and materialisation |
| whole-feature gates on the flat ledger in `kickback-budget-cli.ts` | existing `kickback-budget raise|reset` |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A crash between the append commit and `repairing` duplicates blocks or obligations | Data | Medium | High | Idempotent append by `(id, canonical body)`; obligations keyed by `(roundId, findingId, taskIds)`; crash matrix (Task 47) |
| A round is charged twice or refunded across hosts, reroutes or a crash | Data | Medium | High | One settlement CAS as the commit point; acknowledgement-only after; receipt-id reconciliation under the lease; race and crash tests |
| A reroute resets a branch holding operator work | Data | Low | High | Refuse on any unstamped non-halt-record commit; pin the rejected tip; ADR A6 (operator-approved) |
| The structured build result breaks ordinary builds | Technical | Low | High | Requested only for a routed build; a missing result means no claim (F2); N=1 golden guard |
| `Round:` stamping or `Child:` membership changes N=1 commits | Technical | Low | High | `routingEligible` short-circuit before any routing ref read; PATH-shimmed git golden test |
| A host reaches `repairing` and parks, with no exit before #3212 | Technical | High if the setting is on | Medium | The setting stays default-off until #3212 (ADR D18) |
| One credit per round is too few for a repair-sized diff | Technical | Medium | Medium | ADR A8 (operator-approved); the halt names the child and is raise-recoverable |
| A 30+ task plan overruns a build | Knowledge | Medium | Medium | Operator-approved scope exception; tasks grouped by seam with explicit dependencies |

## Conflict-check resolutions (2026-10-15)

The conflict check (`.docs/conflicts/a-routed-fix-cannot-be-built-charged-and-reviewed-.md`)
found 3 blocking and 7 degrading conflicts. The operator chose:

- **B1:** the host-entry no-op guard halts only when every routed task for the host (frozen rem ids
  and restaged bound ids) is already evidence-complete. The outcome rides the halt record, not a
  `kickback` event.
- **B2:** receipt charging covers `manual_test` only. A routed custom-step kickback keeps today's
  durable, tree-keyed bump (`adr-2026-07-26-cross-dispatch-kickback-livelock-bound` D1), echoed in the
  receipt.
- **B3:** amendment notes on `adr-2026-07-21-engine-owned-acceptance-red-execution` (decisions 2 and 5)
  and `adr-2026-08-09-recorded-red-exception-for-remediation` (D2 and D3) for verify-green.
  - The `acceptance_red` event gains `mode: verify-green`.
  - A present marker without provenance is not a refusal; a digest mismatch with `red/c<k>` fails.
  - Two older stories are scoped to non-routed passes.
- **D1:** the cap halt of a whole-feature gate writes typed evidence and a generation to the flat
  ledger. Amendment notes are added to `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class`
  D2 and D3.
- **D2:** the caller emits no second `kickback` for a taskless round. A crash duplicate before the
  marker is accepted.
- **D3:** accept `Round:`-stamping of operator commits through the hook. A reroute keeps them at
  `rejected/<roundId>/<n>`, and `remediation_rerouted` names that ref.
- **D4:** task status stays flat; the execution projection authorizes host 2.
- **D5:** accepted as in spec A.
- **D6:** the old unreadable-ledger append criterion is scoped to N=1.
- **D7:** `red/c<k>` is written only with routing on and a RED marker present. A same-digest blob is
  accepted on a resumed closure.

Re-check leftovers R1–R3 added #3211 notes to routed decision 10 (custom-step charging),
`adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance` decision 1 (the `mode` field) and
`adr-2026-07-13-kickback-build-no-op-escalation` D1 (the halt-record carrier).

Six on-main ADRs gain notes:
- `adr-2026-10-12-routed-whole-feature-repair`;
- `adr-2026-07-21-engine-owned-acceptance-red-execution`;
- `adr-2026-08-09-recorded-red-exception-for-remediation`;
- `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class`;
- `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance`;
- `adr-2026-07-13-kickback-build-no-op-escalation`.

The plan's obligation table carries a row for every decision of each.

## ADRs Created

None. `adr-2026-10-12-routed-whole-feature-repair` (APPROVED) governs every structural decision here.
F1–F17 are implementation choices within decisions 5, 6, 9, 10, 12 and 16, and none contradicts the
ADR. The routed ADR gains one #3211 note on decision 10 (custom-step charging). Five other APPROVED ADRs
gain #3211 notes that apply its decisions 7, 9 and 10 (see Conflict-check resolutions).

## Conditions

1. Every routing ref write in this spec, including region entry, settlement, the reroute and its sync completion, goes through the single fenced writer, extended per F1 (Task 45).
2. Region entry follows the order in the diagram:
   1. the `entry` pin by its own CAS (F15);
   2. the switch;
   3. the audit restage;
   4. the verbatim frozen-block write and append commit;
   5. obligation admission and the existing-task restage (honouring `restage: false`), then task-status seeding;
   6. the no-op guard (audit rounds), which halts only when every routed task for the host is already evidence-complete (conflict B1);
   7. one `admitted→repairing` transaction carrying the obligation bindings and the credit outbox entry.

   A resume verifies the branch, reconciles obligations and seeding from the record, and skips steps 3–5 (F10–F12).
3. The receipt is typed and parsed fail-closed (F3). Settlement always runs under the ledger lease with the unlocked reconcile variant, validates every cap before its CAS, writes the ledger only after the CAS, and treats a lost CAS per F13.
4. Taskless and FAIL-only charging happens before any routing ref exists, in today's order (F4, O3).
5. The builder's claim uses the provider structured-result channel, only for routed builds (F2). An unverified or malformed claim is a failed attempt on the host region's caps, never `escalateBuildFailure`.
6. `reconcileRounds` handles `repairing` (resume) and `reroute-moved` (sync first). `built`, `done`, `restacked` and `rerouted` stay deferred for #3212.
7. Every new reader of routing refs (`round-stamp`, seal rotation, ledger reconciliation, membership) short-circuits on `routingEligible` and is covered by the D17 golden guard.
8. A test asserts that a routed round's only durable lap charge is the receipt settlement (D1).
9. The plan carries the operator-approved `**Scope-exception:**` and the obligation rows listed above, with the moved rows naming #3212.
10. `RoutedItem` carries `taskIds` for `existing-task` items, and the router restricts `restage: false` to mixed rounds (F9). Routed obligations are authoritative in the route record (F10).
11. A reroute destination is asserted `pending` or absent and receives a merged allocation (F14).
12. The execution projection authorizes the current host's frozen rem ids and bound `taskIds` in `task-cli.ts` and the membership hook (F17).

## Early overlap scan (advisory)

`ai-conductor overlap-scan` over the 24 existing Wiring Surface paths, 2026-10-15:

- `origin/spec/daemon-self-host-guardrails`: `conductor.ts`
- `origin/spec/self-host-phase6-wiring`: `conductor.ts`

These are the same two stale branches spec B's scan found (last committed 2026-07-01, with no
routing references). No plan change is required.
