# Architecture Review: Manual-test failure routed to a child that can't hold the fix, no way out (#3605)
**Date:** 2026-11-07
**Mode:** Lightweight (Medium tier): technical feasibility and architectural alignment only
**Inputs reviewed:** explore output and operator decisions (`.docs/track/manual-test-failure-routed-to-a-child-that-can-t-h.md`), approved diagram `.docs/architecture/manual-test-failure-routed-to-a-child-that-can-t-h.md`, `adr-2026-10-12-routed-whole-feature-repair`, `adr-2026-07-13-kickback-build-no-op-escalation`
**Verdict:** APPROVED

## Feasibility

The intake reports two failures on the gem_miner 5-child stack. Round r2 placed a whole-feature
`manual_test` FAIL on child 1, which lacks 7 of the 9 files the fix touches, and then halted
`derived-already-complete`. No supported operator command could close the round or let a leaf
commit through.

Root cause, verified from source:

1. **The taskless host can never dispatch.** `Conductor.admitRoutedTasklessKickback`
   (`src/conductor/src/engine/conductor.ts`) creates an `audit` route record whose host allocation
   is `{ remTaskIds: [], blockBodies: [], retryHint }`. At host entry, the audit no-op guard in
   `enterRoutedHostRegion` (`src/conductor/src/engine/routing/host-region-entry.ts`, the
   `auditAlreadyComplete` block) calls `checkStepCompletion(…, 'build', …)` for the host child. At
   `manual_test` time every child's authored tasks are complete, so the check is satisfied, and
   "every routed task is already evidence-complete" is vacuously true with zero routed tasks. This
   holds on any host, so correct placement alone would not have unblocked the round. With one host,
   `settleDerivedNoOpHost` (`routing/routed-exit.ts`) returns `halt`, because no other host can
   advance. The ADR's own #3212 amendment expects a taskless host to run BUILD and take the
   no-commit exit when it commits nothing, and the host BUILD already receives the allocation's
   `retryHint` (`conductor.ts`, `route.record.allocation[execution.target.child]?.retryHint`). The
   guard is the only obstacle (confidence 90%, verified).
2. **Placement is blind.** The same method sends `runResidueRoutingCall`
   (`routing/residue-routing-call.ts`) a single item, `{ itemId: 'manual-test-fail', rationale:
   'manual-test' }`, plus the declared positions. The FAIL rows go only into the allocation's
   `retryHint`. With no evidence the judge cannot place the work, and `resolveResidueOwner` falls
   to the earliest candidate (verified).
3. **Recovery is closed by design.** `checkRoundSupersession` (`src/conductor/src/engine/stack-rounds-cli.ts`)
   refuses an `admitted` host, a marker that names the round, and the sole non-closed round
   (`closing sole non-closed round … would skip the leaf return`). Those are decision 6's #3459
   rules for the wedge case. `abandonOperatorRound` (`routing/operator-round.ts`) accepts only
   `operator` rounds, yet `stack-commit-guard-cli.ts` tells every audit-round commit to run
   `stack land --abandon` (verified).

The approved approach (C) addresses each failure in place:

- **Taskless guard.** The guard derives `derived-already-complete` only from routed tasks. A host
  that has a hosted item, no rem task and no item carrying `taskIds` holds a taskless obligation and
  dispatches BUILD, with its hint when one is recorded. The custom-step admission records no hint,
  so the predicate is structural rather than keyed on `retryHint`.
- **Evidence-fed placement with a mechanical floor.** The residue item for a taskless obligation
  carries its FAIL evidence and a per-position changed-path manifest. The contract answer gains an
  optional `implicatedPaths`, and the version becomes `v2`. The engine keeps only paths present on
  the leaf tip. It then applies decision 4's existing `selectHost` (`routing/cannot-host.ts`) from
  the judged child, so the host moves up until it contains every kept path. With no kept path, the
  obligation is hosted on the leaf. A hallucinated path can raise a host but cannot halt the round,
  because `selectHost` halts only when the leaf lacks a path, and those paths are dropped first.
- **Sole-round operator close.** `stack rounds --close` also accepts the sole non-closed `open`
  `audit` round when every host is `pending`, `admitted`, `restacked`, `done` or `rerouted` and the
  marker names the round or is absent. In one CAS it writes `admitted` and `pending` hosts `done`,
  closes the round, and deletes the marker. That is the same write shape as `abandonOperatorRound`'s
  `update-record` plus `delete-marker`.
- **Round-kind refusal text.** The commit guard names `stack rounds --close` for `audit` and
  `stack land --abandon` for `operator`.

Per-position changed paths come from refs the engine already reads. `selectHost` resolves
`closureRefFor(slug, n)` and the leaf tip, and the stack base is the slice topology's base. Each
position's set is one `git diff --name-only` between consecutive refs (assumption A2).

| Check | Finding |
|---|---|
| Stack compatibility | No new dependency |
| Prerequisites | None; #3590/#3595's settle and `hostReasons` are on main |
| Integration surface | `engine/routing/` (host entry, residue call, cannot-host reuse), the conductor's taskless admission, two operator CLIs, one event variant |
| Data implications | No route-record schema change. The routing-call contract moves to `v2` with one optional answer field. `routing_round_superseded` gains a `disposition` field (`superseded` or `leaf-return`); `supersededBy` is absent only for `leaf-return` |
| Performance risk | One `git diff --name-only` per declared position per taskless admission, at most the slice count (≤ 5 here). The judge call already exists |
| Worktree isolation | No new shared resource; refs are per-feature under `refs/conductor/«slug»/` |

## Alignment

- **Decision 1 (taskless obligations).** These rewind to `build` with their retry hint and append
  no task. The guard change makes the routed path honor that. No new work kind is introduced.
- **Decision 3 (residue judgement).** The call stays one engine-owned judgement that places
  already-admitted work and never admits or supplies an operator decision. Only its inputs widen.
  Its output stays schema-constrained, and machinery (`selectHost`) enforces the placement floor,
  which follows the repo's design principle. Replacing the earliest-candidate default with the leaf
  applies only to taskless obligations, whose code may span every child. Task-bound residue keeps
  #2940's earliest-candidate default.
- **Decision 4 (owner and host).** The decision says the host moves up only on evidence. Kept
  implicated paths are that evidence, and `selectHost` is the existing mechanism.
- **Decision 6 (route record authority).** The sole-round close is a new `closed` writer case. Its
  invariant matches #3459's: no host that a provider has touched is closed. #3459 refused the sole
  round because the survivor's exit performs the leaf return. Here no survivor exists, so the close
  itself returns to the leaf. The kickback that opened the round already navigated the leaf back to
  `build` and restaged `manual_test` stale, so the whole-feature gates re-run on the leaf
  (assumption A1).
- **Decision 7 (admission and the no-op guard).** The guard change is a narrowing of #3211's
  "every routed task", not a new seam. The operator CLI follows #3459's writer rules: dispatch
  lease, approved identity, refusal predicate before the lease, and no reconcile or HALT clear.
- **Decision 16 (event spine).** The close's occurrence rides the route-record outbox on the
  existing `routing_round_superseded` type. No new channel is added.
- **`adr-2026-07-13` D1.** The halt for genuinely empty work is kept for task work. A taskless
  obligation is not empty work.
- **#3597 (in-flight spec).** Its Story 2 keeps whole-feature gates off while routed work is
  outstanding. A sole-round close leaves no open round and no marker, so its fence passes and the
  leaf gates may run. The two specs are compatible. Both amend `adr-2026-10-12` decision 7 with
  additive notes in the same section, so whichever lands second resolves a text-only merge.

No new structural decision is made: no boundary, decomposition, integration pattern, state model
or technology changes. Per §7 the governing ADRs are amended, not superseded, and no new ADR is
created.

## Wiring Surface

| Surface | Production caller |
|---|---|
| Taskless exemption in the audit no-op guard | `enterRoutedHostRegion`, already called by `Conductor` at routed host region entry |
| Evidence + changed-path manifest on the taskless residue item | `Conductor.admitRoutedTasklessKickback`, already called by `handleManualTestFailKickback` and the post-region custom-step kickback |
| `implicatedPaths` answer field and `v2` contract | Parsed in `runResidueRoutingCall`, already called by `admitRoutedTasklessKickback` and `routeAdmittedRound` |
| Leaf fallback and path floor for taskless placement | `selectHost`, called from `admitRoutedTasklessKickback` |
| Sole-round close predicate and CAS | `checkRoundSupersession` / `supersedeRound`, reached from the existing `ai-conductor stack rounds --close` dispatch in `stack-rounds-cli.ts` |
| `routing_round_superseded.disposition` | Written into the route-record outbox by `supersedeRound`, and drained to `.pipeline/events.jsonl` by the next dispatch's reconciliation |
| Round-kind recovery text | `stack-commit-guard-cli.ts` refusal, run by the installed commit hook |

The advisory `ai-conductor overlap-scan` over these paths reported other spec branches touching
`conductor.ts` and both ADRs. All are merged except `spec/refused-over-scope-rework-can-t-start-while-a-rout`
(#3597, in DECIDE), which shares only `adr-2026-10-12`.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A misplaced taskless host now dispatches BUILD on a child without the files instead of halting | Technical | Low | Medium | Placement floor plus leaf fallback make this unlikely. If it happens, the build commits nothing, the host takes the no-commit exit, and the leaf's next `manual_test` PASS is refused by anti-whitewash, which escalates under the existing cap. Before the host is entered, while it is still `admitted`, the operator can close the round instead |
| Operator closes a sole round and lands nothing, so the leaf's `manual_test` re-runs on unchanged code | Technical | Medium | Low | Existing anti-whitewash and kickback caps bound it; the close prints that a leaf commit is expected |
| The judge names paths spanning several children | Technical | Medium | Low | `selectHost` takes the lowest host that contains all of them, which is at worst the leaf |
| A mixed-round FAIL still goes to the earliest task-owned host (decision 3, Mixed rounds) | Technical | Low | Medium | Out of scope by operator decision; the sole-round close recovers it |
| Text conflict with #3597 on decision 7's amendment notes | Integration | High | Low | Additive notes; resolve at the second merge |

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | After a sole-round close deletes the marker, the next dispatch runs the leaf from its kickback-set state, so the restaged `manual_test` re-runs after the operator's leaf commit | inferred | 75% | yes | Close would need an explicit navigate to the leaf gates | APPROVED by operator 2026-11-07 |
| A2 | Each position's changed paths are `git diff --name-only` between consecutive refs: stack base → child 1 closure, closure N-1 → N, last child closure → leaf tip | inferred | 85% | yes | Manifest would need the per-child plan file lists instead | APPROVED by operator 2026-11-07 |
| A3 | Dropping implicated paths absent from the leaf tip before `selectHost` means a judged path can never halt the round | verified | 95% | yes | — | — |
| A4 | The host BUILD receives the allocation `retryHint` for a routed host | verified | 95% | yes | — | — |

## ADRs Created

None. Amended (dated notes beside the existing assertions):

- `adr-2026-10-12-routed-whole-feature-repair`, decisions 3, 6 and 7 (two notes)
- `adr-2026-07-13-kickback-build-no-op-escalation`, D1
