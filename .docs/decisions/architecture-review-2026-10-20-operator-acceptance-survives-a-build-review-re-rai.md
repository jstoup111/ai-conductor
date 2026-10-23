# Architecture Review: Operator acceptance survives a build_review re-raise (respec of #3271)

**Date:** 2026-10-20
**Mode:** Full (Tier L), pre-stories
**Input:** `.docs/track/operator-acceptance-survives-a-build-review-re-rai.md` (technical track,
full scope including #3303), the approved diagrams in
`.docs/architecture/operator-acceptance-survives-a-build-review-re-rai.md` and
`.docs/architecture/sequences/operator-acceptance-survives-a-build-review-re-rai.md`, and source at
`origin/main` 38af19d290. Re-verified on 2026-10-21 against `main` 4ee0afbe44, where #3292's spec (#3313)
had landed.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack:** no new package, service or infrastructure. Everything sits in
  `src/conductor/src/engine/`, `src/conductor/src/types/events.ts`, the CLI dispatch and
  `skills/remediate/SKILL.md` (verified, 95%).
- **Data:** the case store bumps v2 → v3. The v1 → v2 precedent shows the shape: the legacy
  version is accepted by `parseState` and upgraded on the next `mutate()` write
  (`remediation-case-store.ts`, `LEGACY_STORE_VERSION`). With v3, both v1 and v2 must parse. The
  parser is exact-keyed, so each new optional field must be added to the expected key lists for
  its disposition shape, and the outbox to the envelope (verified, 97%).
- **Crash-safe occurrences:** `EventPersister.persistDurably` already drops repeated `eventId`s for
  a fixed type set (`OBSERVATION_EVENT_TYPES`, `ROUTING_OCCURRENCE_TYPES`). Separately,
  `ConductorEventEmitter.emitOrThrow` awaits async handlers and surfaces their failures. Together
  they give the drain an acknowledgement before the outbox entry is removed (verified, 95%).
- **Prerequisites:** #3292's build. Its spec (#3313) is on `main` and adds
  `currentBuildReviewSourceLinks`, open-scoped source ownership and converging decision stops
  (mixed-laps D5.4–D5.7). #3271 is blocked by #3292, so this plan targets post-#3292 code (ADR A8).
  #3294 (#3312) is blocked by both and reconciles after this lands.
- **Integration surface:** wide but internal. The coordinator, reconciler, store, effective
  verdict (8 call sites), adjudication context, CLI, accepted-risk renderer, clean-PASS settlement
  in `conductor.ts`, event union and sinks, persister, and the remediate skill. That is more than
  three module boundaries, which is why Tier L and these conditions apply.
- **Worktree isolation:** all state is feature- and child-scoped under `.pipeline/`. No new port,
  database or shared resource.

## Complexity

**High.** It involves a durable schema change, a new operator write surface, a crash-safe delivery
protocol, and changes to roughly ten consumers.

**Estimated plan size:** about 17 tasks:

1. store v3
2. events, sinks and dedup
3. outbox drain
4. shared retirement predicate
5. `finalize` origins
6. carry classification and lane, act path
7. escalate path
8. reuse-halt linking
9. coordinator drain wiring and crash windows
10. settled reader
11. effective resolver required parameters and every caller
12. adjudication context
13. remediate skill
14. clean-PASS settlement
15. `resolve-case` CLI and halt text
16. findings CLI
17. PR renderer

An end-to-end #3211 replay folds into item 6. That is below the 20-task split threshold (§3a), so
no split is proposed.

## Alignment

- **The reverted contradictions are structurally excluded:**
  - **Revert cause 1 (two owners of carry):** carry is decided only by `classifyRemediationCaseReuse`
    (ADR D3). Readers consume the persisted `carried` outcome through
    `finalizedBuildReviewSourceIds` (D4). No component takes dispositions plus links and decides
    carry.
  - **Revert cause 2 (persist then emit):** every new occurrence is written into the outbox in the
    same `mutate()` as its state change and drained with dedup (D6). The crash windows are
    enumerated in the sequence diagram.
- **Single owners**, named so `/plan` can keep each rule in one component:

  | Rule | Owner | Consumers (route only, never re-implement) |
  |---|---|---|
  | Carry eligibility and decision | `classifyRemediationCaseReuse` + reconciler carry lane | coordinator partitions (reuse, `neverBuilt` strip, escalation split, action authorization) |
  | Acceptance-origin write | coordinator `finalize` retirement mutation | carry eligibility, adjudication context, findings CLI |
  | Open-case retirement | one exported reconciler predicate | reconciler absence resolution, `finalize`, clean-PASS settlement |
  | Carry as settled | `finalizedBuildReviewSourceIds` | effective verdict, settled-id read, CLI, coordinator live set |
  | Occurrence delivery | one outbox drain function | coordinator entry and post-mutate, settlement entry and exit |
  | Operator case resolution | `build-review resolve-case` | carry eligibility, findings CLI, renderer |

- **Prior authority:** operator dispositions keep their prior authority
  (`adr-2026-08-29-build-review-remediate-case-adjudication` D2 as amended). The judge can only
  extend an acceptance through a binding the engine validates. It can never write origins or
  resolutions.
- **Event spine:** the outbox stores `ConductorEvent` values and drains onto the existing bus, with
  no second schema or reader. That is the routing outbox precedent, under exception C for the
  store (verified by the `event-spine` skill §3–§4).
- **Local pattern basis:**
  - **Outbox drain.** The precedent is `drainOutbox` in `routing/route-record-store.ts`. Traits to
    keep:
    - the head entry is persisted before it is removed;
    - the removal is a separate durable write;
    - a crash in between is a duplicate, which the persister drops by `eventId`;
    - the envelope's `eventId`/`occurredAt` are authoritative.

    Allowed variation: a leased `mutate()` instead of a git-ref CAS, and emitting through
    `emitOrThrow` instead of calling `persistDurably` directly, so live subscribers also see the
    occurrence. Search hints: `drainOutbox`, `withOutboxEvent`, `observationEventId`.
  - **Carry lane.** The precedent is the refutation and deferral admission lanes in
    `remediation-case-reconciler.ts` (`admitsRefutation`, `admitsDeferral`). Trait: one admission
    predicate per lane, applied inside the single `mutate()`. Search hints: `admitsRefutation`,
    `admitsActionRetry`.
  - **Schema upgrade.** The precedent is `parseV1State` in `remediation-case-store.ts`.
- **Diagram accuracy:** the approved diagrams match the ADR. Two refinements need folding in: the
  carry-eligible case is `resolved` (ADR D3), and the retirement predicate is shared with
  reconciler absence resolution (ADR D5).

## Domain Integrity

- **Outcome vocabulary:** `carried` is a closed source-outcome literal, not a boolean flag.
- **Case marks:** `operatorAcceptance` and `operatorResolution` are optional typed fields. Each is
  valid on any disposition shape, and the exact-key parser rejects unknown keys.
- **Reuse classification:** `classifyRemediationCaseReuse` returns a closed union, extended by
  `carry`. Every switch over it must be exhaustive, with no default branch.
- **Source ids:** source ids stay rubric-namespaced strings through `buildReviewAdjudicationSourceId`
  for both built-in and custom findings. One current-source projection
  (`projectBuildReviewAggregateSources`) feeds every new rule. No built-in-only map is admitted,
  which was the parked build's custom-finding defect.

## Wiring Surface

| New or changed surface | Production caller |
|---|---|
| Case store v3 fields, outbox, `carried` | existing `RemediationCaseStore` construction in the coordinator, conductor settlement and CLI |
| `classifyRemediationCaseReuse` → `carry`; reconciler carry lane | `coordinateBuildReviewAdjudication` reuse partition, before the `neverBuilt` strip (only caller: `applyBuildReviewOutcome` ← `conductor.ts` build_review path) |
| Reuse-halt source linking | the coordinator's pre- and post-reconcile reuse halt branches |
| Shared retirement predicate | reconciler absence resolution; coordinator `finalize`; `settleRemediationCasesOnCleanBuildReview` |
| `finalize` acceptance origins | `finalize`'s existing retirement `mutate()` |
| Outbox drain | coordinator entry, after each adding `mutate()`, and settlement entry and exit; emits via the conductor's `events.emitOrThrow` passed as coordinator input |
| `build_review_acceptance_carried`, `remediation_case_operator_resolved`, `remediation_case_reconciled.eventId` | `ConductorEvent` union, `EVENT_SINKS`, the persister dedup set; emitted only by the drain |
| `resolveEffectiveBuildReviewVerdict` required `child` / `adjudicationEnabled` | `conductor.ts` (3 sites), `step-runners.ts` (2), `artifacts.ts` (2); `build-review-cli.ts` reads `finalizedBuildReviewSourceIds` directly |
| `operatorAccepted` prior-case projection | `assembleBuildReviewAdjudicationContext`, already called by the coordinator |
| `build-review resolve-case` | CLI detector and commander help (`cli.ts`), `cli-pre-dispatch.ts`, `index.ts` dispatch, beside `accept` |
| `findings` carried and operator-resolved rows; `--child` | `dispatchBuildReviewFindings` |
| Accepted-risk carried and operator-resolved rows | `renderBuildReviewAcceptedRisk` via finish publication and the shipped-record writer |
| Remediate binding guidance | `skills/remediate/SKILL.md` (read by the remediate dispatch) |

**Overlap scan** (`ai-conductor overlap-scan`, advisory): `conductor.ts` overlaps only with stale
spec branches (`spec/daemon-self-host-guardrails`, `spec/self-host-phase6-wiring`). #3313 has
landed and amends the remediate-case and mixed-laps ADRs at different anchors; the conflicting
mixed-laps note was resolved by keeping both notes in date order. Open spec PR #3312 edits the same
ADRs and is blocked by #3271.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A component re-implements carry or retirement outside its owner (the #3319 class) | Technical | Medium | High | Condition 1: single-owner guard tests plus the owner table carried into the plan |
| An outbox entry is never drained because an exit path returns first | Technical | Medium | High | Condition 2: drain at coordinator entry before any return, plus crash tests at every intermediate point |
| An effective-verdict caller reads the flat store for a child, or reads cases with adjudication off | Integration | Medium | High | Required parameters (ADR D4), so the compiler enumerates callers |
| Custom-rubric findings take a built-in-only path | Technical | Medium | High | Condition 3: every carry and retirement test has a custom-finding twin |
| A v3 store cannot be read after an engine rollback | Data | Low | Medium | Documented in ADR Consequences; v2 and v1 stay readable forward |
| Absence retirement of a failed action case hides a still-present defect | Data | Low | High | Applies only on mechanically healthy laps; a still-raised unaccepted source blocks (operator-approved A7) |
| `resolve-case` used while a coordinator is mid-lap | Data | Low | Medium | The store lease serializes the writes; the coordinator re-reads before routing |

## ADRs Created

- `adr-2026-10-20-operator-acceptance-is-durable-case-state`: APPROVED by the operator on 2026-10-21;
  the composer session settled scope, approach and the four
  sub-decisions.
- Amendment notes added to the on-main ADRs:
  - `adr-2026-08-29-build-review-remediate-case-adjudication`: D2, D4, D5, D7, D9
  - `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`: D5
  - `adr-2026-08-13-stable-build-review-finding-dispositions`: D2, D4, D6
  - `adr-2026-09-10-portable-build-review-policy`: D9

## Conditions

1. **One owner per rule, guarded mechanically.** The plan names each owner from the Alignment
   table in its Technical Approach and in every task that touches that rule.
   - **Steps:** no task step may implement a carry, retirement or origin rule in a component that
     is not the owner.
   - **Guard test:** a test fails, naming the file, when any production file other than the owner
     makes the owner's decision. Concretely:
     - it constructs a `carried` link or an `operatorAcceptance` origin outside the reconciler lane
       or `finalize`;
     - it compares `operatorAcceptance` origin laps outside `classifyRemediationCaseReuse`;
     - it filters cases for retirement outside the shared predicate.
2. **Crash coverage at every intermediate point.** For each outbox-producing transition (carry,
   operator resolution, settlement retirement), tests cover a crash at each of four points:
   - after the state `mutate()` and before any emit;
   - after the persist and before the outbox removal;
   - before the transition;
   - after the full drain.

   Each case asserts exactly one persisted event per `eventId` and identical final state. A test
   also proves every coordinator early-exit path drains a pending entry.
3. **Built-in and custom parity.** Every carry, origin, retirement and settled-read test runs
   with a built-in finding and with a custom-rubric finding.
4. **Every caller enumerated.** The plan lists every production caller of the effective-verdict
   resolver by file, with its child and adjudication source. It also adds a test proving a child
   review reads only its child's case store.
