# Architecture Review: Refused over-scope rework can't start while a routing round is open

**Date:** 2026-11-07
**Mode:** Lightweight (Tier M): sections 2 and 4 only
**Inputs reviewed:** explore output and track marker
(`.docs/track/refused-over-scope-rework-can-t-start-while-a-rout.md`, Balanced scope, Approach A),
the approved diagram (`.docs/architecture/refused-over-scope-rework-can-t-start-while-a-rout.md`),
intake jstoup111/ai-conductor#3597, and the wedged feature
`path-policy-still-decides-feature-ownership-by-fol` (events, HALT, routing refs `routes/r1`,
`routes/r2`, `repairing`)
**Verdict:** APPROVED WITH CONDITIONS

## Root cause (evidence)

- **RC1, verified (90%).** Host 1 of round r2 failed `build_review`. Remediation adjudication
  rejected its only case, so the build_review outcome is `settled`. The `settled` arm in
  `conductor.ts` (stable symbol: the `outcome.kind === 'settled'` branch that calls
  `settleRemediationCasesOnCleanBuildReview`) marks `build_review` done and runs a bare
  `continue`. That skips the child-region closure, the only in-loop caller of
  `continueRoutedHostExit`. The loop's linear `i++` then entered `manual_test` and the
  `prd_audit` / `architecture_review_as_built` group on the host child with r2 still open
  (events 2026-11-03T13:05:27, no `child` field). Host 1 stays `repairing` and host 2 never runs.
- **RC2, verified (95%).** The round-admission fence returns `fence: true`, and the stacked-route
  admission maps it to `mechanical`. Refusal rework then drops that class: the serial and grouped
  refusal-rework callers keep only the detail, and `writeRefusalReworkHalt` always writes the
  over-scope class with a `revise-decision` block. The operator is asked to re-decide a recorded
  refusal (decision `b0c918f9…`, revision 2), and the daemon retains the feature as `over-scope`
  rather than re-kicking it.
- **RC3, verified mechanism.** Each lap re-imports the recorded refusal, re-runs refusal rework and
  hits the same fence, so `halt clear` reproduces the same halt.
- **RC4, inferred (55%).** Re-kicks on 2026-11-03 19:18 and 2026-11-06 00:16 re-entered at the
  `prd_audit` group, not at host 1's region. Not confirmed; see condition C2.

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependency, module, ref or persisted format. All three changes live in existing engine code |
| Prerequisites | None. Routing (`stacked_prs.route_whole_feature_fixes`), the round fence (#3445), routed parking and the bounded routing stall (#3455) are all on main |
| Integration surface | `conductor.ts` (build_review outcome arms, child-region closure, whole-feature gate entry, refusal-rework halt writer), `routing/round-admission.ts` (fence detail), `selector.ts` (existing `RoutedParking`). One module boundary, already crossed today |
| Data implications | None. The halt body and the fence detail string change; no persisted schema changes. `HALT.class` values are existing values (`mechanical`) |
| Performance risk | One `repairing`-marker ref read (plus a queue read when no marker) per whole-feature gate entry, only on a stacked feature with routing on. This is the read gate selection already performs |
| Worktree isolation | No new ports, databases or shared files |

The intake's hypotheses were checked. Folding refusal work into the open round (hypothesis 1) is
unnecessary once leaf gates cannot run mid-round, and is outside the Balanced scope. Hypothesis 2
(the planner fault is reported through the over-scope path) is confirmed as RC2.

## Alignment

Governing ADR: `adr-2026-10-12-routed-whole-feature-repair` (APPROVED). Each part of Approach A
conforms to a decision already on main. No decision changes.

- **Shared region closure ↔ D13 (as amended by #3445 and #3455).** "When the host region passes"
  the host takes its routed exit through the one exit continuation. A `build_review` that settles
  by adjudication is a pass: the step is marked done and every region gate is satisfied. Today
  only the clean-PASS fallthrough reaches the closure. Making both arms call one closure is
  conformance, not a new decision. The same closure also closes an ordinary (non-routed) non-leaf
  child, whose settled `build_review` skips `advanceChildRegion` today for the same reason. The
  operator included that case on 2026-11-07, because one shared helper fixes both.
- **Whole-feature gate guard ↔ D15 and D7 (#3455 amendment).** D15 re-pends the leaf gates only
  when no marker and no queue entry remain. #3455 already parks gate selection on a marker or
  queue (`RoutedParking` in `selector.ts`, kinds `child`, `leaf-host`, `queue`). On a host whose
  region gates are all satisfied, #3455 takes the routed exit. Otherwise it records the bounded
  `routing_rounds_stalled` stop (mechanical twice, needs-human on the third identical stop). The
  hole is that the conductor's linear advance enters a whole-feature gate without consulting that
  parking. The guard reuses the existing parking derivation at that entry. It also refuses while
  any route record is not `closed`, because the marker is deleted between hosts (D7). It adds no
  new stop kind.
- **Fence class in refusal rework ↔ D7 (#3445 amendment).** "A fence refusal ends the run with a
  `mechanical` HALT naming the blocking round." Refusal rework must keep that class. Naming the
  round's open host, the host's state and a runnable recovery adds detail within the same
  decision. Today the stacked-route fence halt is written `mechanical` directly, with no attempt
  count, so a fence that never clears would re-kick without bound. The fence stop is recorded
  through the existing bounded routing stall (`recordRoundStall`, #3445: needs-human on the third
  identical stop). That reuses the decision's own bound and adds no new stop kind.
- **Scope boundary honoured.** No fold or supersede mechanism, and no change for features with no
  open round. For a flat or N=1 feature, the parking read is skipped, exactly as gate selection
  skips it today (D17 N=1 parity).

**Focused local pattern basis.** The guard follows the routed-parking derivation used by gate
selection. Rediscover it on the BUILD checkout from the `RoutedParking` type in `selector.ts` and
its producer in `conductor.ts`. That producer is the block that reads `resolveSealedLeaf`, then
`readRepairMarker`, then `readRevalidationQueue`, before `selectNextGate`.

Traits to preserve:
- the routing-on and leaf > 1 precondition;
- marker first, then queue;
- the `leaf-host` vs `child` distinction;
- an unreadable queue counts as parked.

Allowed variation: extracting it into a shared helper that both the selector caller and the linear
advance use. This basis does not set a project-wide convention.

**ADR decision.** The structural prerequisite (§7) for a new ADR is not met. The change creates no
boundary, decomposition, integration pattern, state model or technology. The conflict check
(`.docs/conflicts/2026-11-07-refused-over-scope-rework-can-t-start-while-a-rout.md`) found that
three parts change the wording of D7 as amended by #3445. The operator therefore approved one
additive #3597 amendment note on D7 on 2026-11-07. It covers three things:

- whole-feature gates wait for any outstanding routed work, meaning a marker, a queue entry or a
  non-closed route record, not the marker alone;
- every stacked-route fence stop is bounded through the routing stall;
- a fence refusal is a routing deferral, not the refused-HALT outcome of
  `adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework` D3.

D13 and D15 need no note: an adjudication-settled `build_review` is already a region pass.

## Wiring Surface

- **Shared routed-region closure helper** (new private conductor method or an extracted
  function). It is called from the clean-PASS child-region closure in the conductor's step loop and
  from the build_review adjudication `settled` arm. Both are existing in-loop sites. It delegates to
  the existing `continueRoutedHostExit` → `exitRoutedHostAndReconcile`.
- **Routed-work-outstanding test** (the existing routed-parking derivation plus the non-closed
  route record test that `routedRoundOpen` already performs). It is called by the existing `selectNextGate` caller and at the conductor's linear entry into any
  non-region (whole-feature) step on a stacked feature, including the parallel validation group
  entry and the resume entry.
- **Fence detail** (`checkRoundAdmissionFence` in `routing/round-admission.ts`). It is produced for
  the existing callers: the stacked-route admission in the conductor, `admitRound`, and revalidation
  queue admission.
- **Refusal-rework HALT class** (`writeRefusalReworkHalt` plus its serial and grouped callers). The
  existing refusal-rework paths reach it. No new caller.

No new CLI flag, config key, event variant or hook. Advisory overlap scan: only
`src/conductor/src/engine/conductor.ts` overlaps, with six spec branches. The one touching
build_review adjudication (`spec/clean-build-review-pass-halts-on-a-deferral-reserv`, #3592) is
already merged.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The settled arm's durable settlement (`settleRemediationCasesOnCleanBuildReview`) and the routed exit run in the wrong order, so a halted exit leaves cases settled with the host still `repairing` | Technical | Medium | Medium | Settle first, then close. A refused exit stops through the existing exit-refusal path (#3455 says a re-entered host whose region gates are satisfied takes the exit), so a re-kick resumes the exit |
| The guard stalls a feature whose marker is stale but whose round is effectively done | Technical | Low | Medium | Reuse reconciliation and the #3455 bounded stall: two mechanical re-kicks, then needs-human with the round named. No new stop kind |
| Another linear-advance path (not settled, not PASS) also skips the closure | Technical | Medium | High | The guard is the backstop at every whole-feature gate entry. A test drives the linear advance into a whole-feature gate with a marker present |
| RC4 resume entry bypasses both fixes | Technical | Medium | High | Condition C2 |
| Overlap with in-flight edits to `conductor.ts` | Integration | Medium | Low | Edits are localized to the named arms; rebase conflicts are mechanical |

## ADRs Created

None. `adr-2026-10-12-routed-whole-feature-repair` governs. Its D7 gains the operator-approved
#3597 amendment note; D13 and D15 are cited and reused unchanged.

## Conditions

- **C1.** Tests drive the real conductor loop, not only helpers: a stacked routed host whose
  `build_review` FAILs and adjudication settles must reach the routed exit (host `built` → restacked
  → next host). No whole-feature gate step may start while the round's marker exists.
- **C2.** The plan traces the resume entry (conductor resume or stack preflight) that re-entered the
  `prd_audit` group with r2's host 1 `repairing`, and names its file and symbol. Either the guard
  covers it, or the plan adds the fix. If the trace shows a cause outside this design, stop and
  return to the operator.
- **C3.** A refusal-rework fence refusal writes `HALT.class` `mechanical` with no `revise-decision`
  block, bounded through the existing routing stall (needs-human on the third identical stop). Its first line names the blocking round, open host, host state and a recovery command
  that exists in the CLI (for example `ai-conductor stack rounds --slug <slug>`). Recorded refusals
  stay preserved for the next lap.
- **C4.** A feature with no open round admits a new audit round exactly as today (regression test).
