# Architecture Review: build_review halts when a judgement re-raises a source a resolved case owns

**Date:** 2026-10-19
**Stories reviewed:** none yet. This is the lightweight Medium pre-stories pass, and its input is the
explore decision and the scope boundary in `.docs/track/build-review-halts-when-a-judgement-re-raises-a-so.md`.
**Verdict:** APPROVED WITH CONDITIONS

Source: jstoup111/ai-conductor#3292. It also delivers the core outcome of #2464.

## Feasibility

- **Stack compatibility.** The change is TypeScript inside existing engine modules. It adds no
  dependency, service or infrastructure.
- **Prerequisites.** None. Everything the design relies on already exists on `main` and was verified
  by reading the source:
  - the transition seam `RemediationCaseStore.mutate` and the `rejected-transition` violation (from #3171);
  - the coordinator's `failStore` renderer;
  - the event field `remediation_adjudication_failed.rejectedTransition`.
- **Integration surface.** The change stays inside one module family: `remediation-case-store.ts`,
  `build-review-adjudication.ts`, `build-review-adjudication-coordinator.ts` and
  `remediation-case-effects.ts`, plus one runbook section. It crosses no external API.
- **Data implications.** The persisted format, schema and store version are unchanged, and no
  backfill is needed. Every store the current engine wrote still parses, because the relaxed check
  admits a strict superset (verified: `parseBuildReviewCases` is the only place that enforces the
  invariant). The reverse direction is the one risk: an *older* engine reading a store that holds a
  resolved-shared source reports `malformed-state` (see Risks).
- **Performance.** The selector is one linear pass over at most `MAX_CASES` rows, the same order as
  the existing scans.
- **Worktree isolation.** The state is per-worktree `.pipeline/remediation-cases.json`. There are no
  new ports, databases or shared resources.

### Verified reader inventory (95%, verified by reading each call site)

These are the build_review readers that map a source to a case and **span resolved cases**. Only
they change behavior when history shares a source:

| Reader | Today | Under D5.5 |
|---|---|---|
| `currentSourceCoverageIsConsistent` (`build-review-adjudication.ts`) | every link of every case; conflicting outcomes ⇒ halt "contradictory" | the authoritative link per source |
| `finalizedBuildReviewSourceIds` (`remediation-case-store.ts`; used by coordinator, `build-review-cli.ts`, `build-review-effective.ts`) | any finalizing link settles a source | the authoritative link decides; identical on every store without shared sources |

Readers already restricted to **open** cases need no change, because D5.4 still guarantees at most
one open owner. They are: the decision-owner, consistency-stop and build-route filters in the
reducer, `buildRouteRepairCaseIds`, the `decisionStops` projection and the acceptance-retire pass in
the coordinator. `unfinishedRefutedSourceIds` and the regression `caseSourceIds` evidence read
specific records, not a source→case map, so they are unaffected.

### Confirmed behavior of the unbound path (verified)

- `classifyRemediationCaseReuse` runs only for an explicit `existingCaseId` (coordinator pre-reconcile
  loop) or for a reconciled id already present in the prior store
  (`if (!priorCasesById.has(caseId)) continue`). So a newly minted re-raise case never reaches the
  regression halt, and no new code is needed to keep explicit rebinds halting.
- `persistBuildReviewDecisionStop` already mints a fresh id when the judgement names a **resolved**
  existing case with different sources. Today that branch can only fail on the invariant, and D5.4
  makes it reachable.
- `sameDecisionStop` compares source `recordedAt`, and the coordinator stamps a fresh `recordedAt`
  every lap. A bound stop replayed in a later lap therefore fails `conflicting-case-id` (issue
  #3005 AR-AB-D11-1, re-verified on current `main`).
- `persistBuildReviewDecisionStop` returns `` `case store ${mutation.reason}` `` and drops
  `mutation.violation`, unlike `remediation-case-effects.ts`'s other three mutation helpers, which
  propagate it.

### Issue case 1 outcome (inferred, 85%)

The re-raise is a new act case that reserves a fresh effect. The kickback cap blocked the original
case, so the new effect is charged, fails on the same cap, and the lap halts on the **named kickback
cap** halt, not on a store invariant. This meets the desired outcome ("does not halt … on a
case-store invariant"). The operator chose the cap as the bound.

## Alignment

- **Governing ADR reused, not duplicated.** The source-ownership rule is durable state-transition
  design: it meets the structural prerequisite. It is already governed by
  `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` (APPROVED), which adopts its
  predecessor's D5 store and D7 recurrence rule. So this review **amends** that ADR (D5.4–D5.7) and
  adds a narrowing note beside the predecessor's D7 regression sentence. That is the same two-ADR
  pattern #2409 used. No new ADR.
- **Pattern consistency.** The selector is a pure exported function in the store module, next to
  `finalizedBuildReviewSourceIds` and `selectBuildReviewRemediationCases`. Decision-stop convergence
  mirrors the reconciler's `convergedCaseFor`, which matches on exact source ids and outcomes and
  never on prose.
- **Invalid states.** "Two open owners of one source" stays unrepresentable at the only write seam.
  "Which link is authoritative" is answered once, by the selector, instead of by each reader's own
  scan.
- **Event spine.** No new channel or event type. The existing optional `rejectedTransition` field on
  `remediation_adjudication_failed` carries the decision-stop violation, and a re-raise case emits
  the existing `remediation_case_reconciled` and `remediation_effect_reserved` occurrences.
- **Design Principle.** Re-raise equivalence stays the judge's call, which is a judgement. The
  engine only does the bookkeeping: open-owner uniqueness, link authority and charging. This is the
  reverse of the failed #2464 spec, which tried to make `distinctFrom` sameness mechanical.
- **Security / DI.** No new endpoints, inputs or DI defaults.
- **Diagrams.** `.docs/architecture/build-review-halts-when-a-judgement-re-raises-a-so.md` and its
  sequence diagram show the selector, the admission seams and the halt surface, and match this
  review.

## Wiring Surface

| New or changed surface | Production caller (design-time) |
|---|---|
| `currentBuildReviewSourceLinks` (new export, `remediation-case-store.ts`) | `reduceBuildReviewAdjudication`'s coverage check (reached from the coordinator's `finalize`), and `finalizedBuildReviewSourceIds`, which the coordinator, `build-review-cli.ts` and `build-review-effective.ts` already call |
| Open-scoped `source-linked-by-multiple-cases` in `parseBuildReviewCases` | existing `RemediationCaseStore.load` and `mutate` |
| `persistBuildReviewDecisionStop` violation and convergence | the coordinator's existing escalation and blocked-consistency loops, through `failStore` |
| Runbook rejected-transition section | operator recovery, linked from the HALT text's existing pointer |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A recurring defect re-raised unbound opens a fresh repair cycle each time | Technical | Medium | Medium | Each new act is charged, and the cumulative kickback cap halts with its named class. #3124 stays open as an optional tightening, re-pointed to be blocked by this spec |
| An older engine version (rollback, or a dist pinned before this change) reads a store holding a resolved-shared source and halts `malformed-state` | Data | Low | High | Document it in the runbook section. Forward-only: no store on `main` holds a shared source until this engine writes one |
| Scope creep repeats #2464's 13-lap non-convergence | Knowledge | Medium | High | Track-marker exclusions are binding: no `distinctFrom`, no recurrence limits, no open-owner supersession (#3005 D9.x). Plan estimate is about 7 tasks |
| Textual merge conflict on the mixed-laps ADR with open spec PR #2878 or with #3271 | Integration | Low | Low | Amendment notes are additive blocks at different anchors. #3271 is sequenced after this spec |

## ADRs Created

None. Amended (additive notes, both already on `main`):

- `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`: D5.4–D5.7.
- `adr-2026-08-29-build-review-remediate-case-adjudication`: a narrowing note beside D7's regression
  sentence.

## Conditions

1. Every build_review reader that spans resolved cases and maps a source to a case or outcome reads
   through `currentBuildReviewSourceLinks`. Tests cover both readers in the inventory with a store
   that holds a resolved-shared source.
2. The two observed incidents replay as tests through the real store, reconciler and coordinator,
   with no provider: an unbound act or merged re-raise over a resolved act with a failed effect, and
   an unbound escalation over a resolved act with an applied effect. Neither may produce a
   case-store invariant halt, and the resolved row must be byte-identical after the lap.
3. A proposed state with two **open** owners of one source is still refused, with its violation
   named on the event and in the HALT text, on both the reconciliation path and the decision-stop
   path.
4. An explicit `existingCaseId` rebind of a resolved action case still halts `semantic remediation
   case regression <id>`.
5. Nothing in the excluded list of the track marker is implemented.
