# Architecture Review: Refuted build_review finding cycles to a needs-human halt instead of settling

**Date:** 2026-09-09
**Source:** jstoup111/ai-conductor#2409
**Mode:** lightweight (Tier M, technical track) — Feasibility and Alignment only
**Stories reviewed:** none yet (pre-stories review; input is the explore output and the approved diagrams)
**Verdict:** APPROVED WITH CONDITIONS

## Design under review

The `remediate` case-v1 judge gains one representable move for an existing, already-BUILD-attempted
`act` case: a `refute` row bound by `existingCaseId`, carrying a schema-constrained refutation
(claim, per-assertion `refuted`/`upheld` verdicts with content-region evidence references,
`confidence: high`) and an effect of `none` or a complete deferral for the narrow true remainder.
The engine admits it only when the bound case is open, attempted, `applied`, and unrefuted; resolves
it with a `refuted` terminal; persists the rationale; emits `remediation_case_refuted`; charges no
kickback; and routes PASS. An unrefuted repeat (judge re-proposes `act`) still halts as today; a
second refutation of the same case halts `needs-human`. `build-review findings` renders case state
including the refutation. Scope boundary in `.docs/track/refuted-build-review-finding-cycles-to-a-needs-hum.md`
is binding; nothing here widens it.

## Feasibility

| Check | Assessment | Confidence |
|---|---|---|
| Stack compatibility | Pure TypeScript engine + Markdown skill text; no new packages, services, or infrastructure. | 98% verified |
| Prerequisites | None external. `build_review.adjudication.enabled` (default on) is the existing rollback switch; no new config key is introduced, so the config-key consumer registry is untouched. | 95% verified |
| Integration surface | Touches the case-v1 contract end to end: `remediation-case-artifact.ts` (parse), `remediation-case-validator.ts` (graph rules), `remediation-case-reconciler.ts` (the single legal `act`→`refute` transition, once-per-case), `remediation-case-store.ts` (persisted refutation on the case record), `build-review-adjudication-coordinator.ts` (settle, no charge, residual deferral), `build-review-adjudication.ts` (reducer already treats a non-action finalized outcome as PASS-eligible), `build-review-cli.ts` (`findings` opens the case store), `src/types/events.ts` + `event-sinks.ts` (new member), `skills/remediate/SKILL.md` + `test/engine/remediate-skill-contract.test.ts`. Seven engine modules, one skill, one contract test — bounded, all inside one owner (`remediate` judge + engine). | 95% verified |
| Data implications | `.pipeline/remediation-cases.json` case records gain an optional `refutation` field and the `refute` disposition; the store stays `v1` with an optional additive field, and every existing reader already fails closed on unknown dispositions, so old engines reading a refuted store reject rather than misroute. No migration: the store is feature-local and gitignored. | 90% inferred — additive optional field; BUILD must confirm the exact-key parsers admit the optional field rather than reject it |
| Performance risk | None: one extra reference resolution per evidence anchor, bounded by the existing case/row limits. | 97% verified |
| Worktree isolation | All state is feature-local under `.pipeline/`; no shared resource. | 98% verified |

**Verified facts the design rests on** (all read directly in `src/conductor/src/engine/`):
- The halt is representational, not a judge error: `classifyRemediationCaseReuse` halts only on
  `disposition === 'act'` (reconciler), and any disposition change on an existing case is
  `illegal-disposition-transition` (reconciler, existing-case branch). 100% verified.
- A `reject`/`none` case is already a finalized autonomous outcome that routes PASS
  (`reduceBuildReviewAdjudication`, "all current findings have finalized non-action outcomes").
  100% verified.
- `attemptedCaseIds` comes from `markBuildReviewWorkOrderAttempted` when the order is injected into a
  BUILD prompt; the judge already sees "BUILD attempted" per prior case (`effectPointerFor`). 100%.
- `findings` today reads only `.pipeline/build-review.json`, the disposition store, and the kickback
  ledger; it never opens `RemediationCaseStore`. 100% verified.
- The deferral effect executor files the intake issue through the injected
  `EffectMarkerTrackerClient` seam with the existing marker dedup. 100% verified.
- The D2 no-op escalation guard is consulted only when the source gate fails again
  (`checkKickbackToBuildEscalation`); an effective PASS never reaches it. 100% verified.
- The content-region reference grammar is `path`, `contentHash`, `display`, optional `occurrence`
  (`build-review-domain.ts` region parser) — no line numbers, no SHAs. 100% verified.
- No `refuted`/`withdrawn`/`settled` engine concept exists; the `beyond` record kind of
  adr-2026-08-21 is retained in ADR text only and has no engine producer. 95% verified (grep of
  engine sources returns no `beyond` member).

**Assumptions surfaced:**
1. *(load-bearing, 85% inferred)* The engine can resolve a content-region reference against the
   current tree at adjudication time using the same content-hash computation the scope source uses
   to build `changedTestRegions`. Impact if wrong: the "anchors must resolve" bound needs a small
   resolver helper rather than a reused one — a task-size change, not a design change. Confirm
   at plan time by locating the hash builder in `build-review-scope-source.ts`.

   > **Amended 2026-09-09 by #2409:** confirmed at plan time and falsified in part — the
   > content-region `contentHash` is a sha256 of a whitespace-normalized *test title*
   > (`build-review-domain.ts`, `normalizedTitleHash`), not of file content, so it cannot anchor an
   > arbitrary production excerpt. Refutation evidence therefore uses the `path` reference kind plus
   > a whitespace-normalized excerpt; the engine verifies the path exists and the excerpt occurs in
   > it. D7.2 and Story 2 were updated to say so. No line numbers or SHAs are persisted, so the
   > reference-schema and rebase-translation constraints still hold.
2. *(load-bearing, 90% inferred)* The judge, operating under the skill's "do not re-audit the
   source tree" rule, can still ground a refutation in the evidence the engine already supplies
   (finding evidence locations, prior case rationale, plan contract). The #2409 judge rationale
   cited production `file:line` it was not handed, so refutation quality may depend on the
   judge reading the cited regions. Impact if wrong: the lane admits fewer refutations than hoped,
   never more. Stories will state that the judge may read exactly the regions named by the
   current finding and the prior case, and nothing else.

## Alignment

**Governing ADRs reused (not duplicated).** The design makes no new structural decision: it widens a
durable state-transition design that four APPROVED-or-adopted ADRs already own, so those ADRs are
amended in place (additive `> **Amended 2026-09-09 by #2409:**` notes with numbered decisions), and
no new ADR is created:

| ADR | Amendment | Why |
|---|---|---|
| `adr-2026-08-29-build-review-remediate-case-adjudication` (Superseded; non-conflicting decisions still adopted) | D7.1–D7.6 | Owns the vocabulary (D4), the resolution path (D5), and the semantic-repeat rule (D7) that produced the halt |
| `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` (APPROVED) | D3.4, D5.3 | Owns "repeat still halts" (D3), the permitted-autonomous-outcome set (D3.2/D3.3), and the settled predicate (D5.1) — without D5.3 a refuted case would re-dispatch on the next exact-id re-raise and halt as a regression |
| `adr-2026-07-13-kickback-build-no-op-escalation` (APPROVED) | D2.1 | Hard-codes HALT for the reviewer-wrong case; the amendment records that a refutation ends the cycle through the #1831 "passing effective review" exit, never by touching the D2 baseline |
| `adr-2026-08-13-stable-build-review-finding-dispositions` (APPROVED) | D4.1 | Fixes the `findings` output contract; extended to render case-store state |

**Distinguished from adjacent mechanisms (repo-wide sweep, 310 ADRs):**
- *`beyond` record kind* (adr-2026-08-21 D3–D5): judge-authored, no-kickback, engine-recorded,
  intake-filed, `findings`-rendered — the same *shape*, but `beyond` answers "is this scope outside
  the plan's done-when?" on a fresh finding, while `refute` answers "is this re-raised claim false
  against evidence?" on an *attempted* case bound by durable id. The design reuses the pattern
  (findings lever, additive spine member, intake through the existing adapter) rather than the
  record: a refutation lives on the remediation case it refutes, in the case store, not in the
  disposition store.
- *Rejected Option A of adr-2026-08-16* (LLM equivalence + alias as a suppression matcher):
  refutation never matches identity — identity stays exact `existingCaseId`/source id — it judges a
  claim, once, on a case the engine already proved was attempted.
- *Rejected "auto-accept after N faults, no human in the loop"* (adr-2026-08-18-mechanical L266-268):
  a refutation is never accepted risk (D7.4), is bounded once per case (D7.3), requires `high`
  confidence and resolvable evidence (D7.2), leaves the unrefuted repeat halt intact, and emits an
  audited occurrence (D7.6). The human lever remains `findings` + the existing `accept`.

**Constraints honored:**
- Distinct member `refute`/`refuted` rather than overloading `reject` (adr-2026-08-05-blocked;
  adr-2026-08-06 typed shape); union, fail-closed validator, and every disposition→behavior map widen
  in the same change (adr-2026-08-25 D9); engine lands with or before the skill text
  (adr-2026-07-27 silent-drop precedent).
- Evidence references use the existing content-region grammar; no coordinates or SHAs are persisted
  (adr-2026-08-18-content-anchored-finding-reference-schema; adr-2026-07-12 rebase stamp translation
  is therefore untouched).
- The once-per-case bound lives on the case record, not on `KickbackGateEntry`, so
  adr-2026-08-18-rebase-invalidation D6 does not apply; the durable write is paired with its spine
  occurrence (adr-2026-08-12 exception-C).
- Halts use `writeHaltMarker(…, 'needs-human')`; `HaltClass` is not extended
  (adr-2026-08-05-build-settle D6; adr-2026-07-28 writer inventory gains one entry).
- New event: a *member*, not a field on `remediation_case_reconciled`, because the occurrence is
  one-to-one with a distinct durable write and needs its own sink flags (`audit: true`) that the
  reconciled event does not carry — the same reasoning adr-2026-08-21 used for
  `build_review_beyond_filed`. Registered in the total `EVENT_SINKS` table with all four flags and a
  `renderDaemonEvent` case (adr-2026-07-26; adr-2026-08-11).
- The residual is a complete deferral effect with `exclusionRationale` (predecessor ADR D4) and files
  through the existing sanitizing tracker seam (adr-2026-09-06; adr-2026-07-22-canonical-tracker).
- The refutation composes through the reserved post-judgement resolution seam and never enters
  rubric projections; the raw aggregate stays FAIL, only the effective route changes
  (adr-2026-08-13-engine-managed-rubric-branches L246-250).
- Tier-invariant; no build_review→simplify seam (adr-2026-07-21 S-tier knobs: no parallel flow).

**State management.** The transition set is explicit and closed: `act` → `refute` is the only legal
disposition change; `refute` is terminal (`resolved`); a refuted record cannot be re-bound. Invalid
states are unrepresentable by construction: a `refute` row without `existingCaseId`, without a
`refuted` assertion, with non-`high` confidence, with an unresolvable reference, or bound to an
unattempted/unapplied/already-refuted case is rejected before persistence.

**Diagram accuracy.** `.docs/architecture/refuted-build-review-finding-cycles-to-a-needs-hum.md` and
`sequences/…` (approved 2026-09-09) match this design; no update needed.

**Production DI defaults.** Unchanged; the case store and disposition store remain filesystem-backed.

## Wiring Surface

| New production surface | Called from |
|---|---|
| `refute` disposition / `refuted` outcome / refutation record parse | `readRemediationCaseJudgement` in `remediation-case-artifact.ts`, invoked by the coordinator after the `remediate` dispatch returns |
| Refutation admission (attempted, applied, unrefuted, once) and `act`→`refute` transition | `reconcileRemediationCases` existing-case branch in `remediation-case-reconciler.ts`, called by `coordinateBuildReviewAdjudication` |
| Evidence reference resolution | a small resolver invoked by the coordinator before reconciliation: canonical repo-relative path check from `build-review-domain.ts` plus a normalized-excerpt occurrence check against the worktree file |
| Persisted `refutation` on the case record | `RemediationCaseStore.mutate` under the existing lease, from reconciliation |
| Settled-predicate widening (D5.3) | `finalizedSourceIds` in `build-review-adjudication-coordinator.ts`, consulted when assembling the live source set |
| `remediation_case_refuted` event | emitted by the coordinator through `input.emit` → `ConductorEventEmitter`; declared in `EVENT_SINKS`; rendered in `renderDaemonEvent` |
| Second-refutation halt | coordinator `failUnlessAccepted('refutation repeat <caseId>')` → `conductor.ts` adjudication halt branch → `writeHaltMarker(…, 'needs-human')` |
| Residual deferral | existing `applyBuildReviewDeferralEffect` path in `remediation-case-effects.ts`, driven by the coordinator exactly as a `defer` case |
| `findings` case-store rendering | `build-review-cli.ts` `findings` handler, dispatched from `src/index.ts` `build-review` command table |
| Skill contract | `skills/remediate/SKILL.md` case-v1 section, loaded by the existing `remediate` step dispatch; pinned by `test/engine/remediate-skill-contract.test.ts` |

Early overlap scan (`ai-conductor overlap-scan --files …` over the paths above): no overlap
detected, no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Judge over-refutes to escape the repeat halt | Technical | Medium | High | Once-per-case bound; `high` confidence required; every evidence reference must resolve; unrefuted `act` repeat still halts; audited spine event; `findings` shows the rationale for operator review |
| Evidence-reference resolution helper is not reusable as assumed | Technical | Low | Low | Assumption 1 above; confirm at plan time; worst case is one small resolver task |
| Old engine reads a store carrying `refute` | Data | Low | Medium | Parsers already fail closed on unknown dispositions; the store is feature-local, and the daemon respawns on the new dist before the lane produces any record |
| Skill text lands ahead of engine parser | Integration | Low | Medium | Single self-host PR carries both; contract test pins the vocabulary both directions |
| Refuted case re-raised by exact id on a later lap | Technical | Medium | High | D5.3 excludes finalized `refute` sources from the live set; story covers the negative path |

## ADRs Created

None. Four existing ADRs amended (table above); no uncovered structural decision remains.

## Conditions

1. Stories MUST carry the negative paths as first-class criteria: unrefuted `act` repeat halts
   unchanged; second refutation of one case halts `needs-human`; `refute` without binding, without a
   `refuted` assertion, with non-`high` confidence, with an unresolvable reference, or against an
   unattempted/unapplied case is rejected fail-closed.
2. The plan MUST land the engine vocabulary and the skill text in the same change, with the
   contract test extended in that change (adr-2026-08-25 D9 shape discipline).
3. The plan MUST confirm assumption 1 (reference resolution helper) before the reconciler task is
   authored, and record the located symbol as a rediscovery hint, not a line number.
4. `findings` rendering MUST fail closed on an unreadable case store and label autonomous outcomes
   distinctly from operator dispositions (D4.1).
5. No new config key: rollback remains `build_review.adjudication.enabled: false`.
