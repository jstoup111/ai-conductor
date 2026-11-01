# Architecture Review: Refusing a newly raised OVER_SCOPE criterion halts as malformed-history
**Date:** 2026-10-31
**Mode:** Lightweight (Tier M): §2 Technical Feasibility and §4 Architectural Alignment
**Inputs reviewed:** explore output and track `.docs/track/refusing-a-newly-raised-over-scope-criterion-halts.md`
(Approach A, technical track); approved diagram
`.docs/architecture/refusing-a-newly-raised-over-scope-criterion-halts.md`; and
`adr-2026-09-07-durable-prd-widening-decision-reconciliation` (D1, D3, D4, D8).
**Verdict:** APPROVED

## Technical intent

1. **Per-entry capture scope.** `capturePrdWideningDecisions` stops choosing between a whole-block legacy
   import and a whole-block offer validation for a current-format block. Each parsed entry is captured on
   its own terms:
   - an entry left `pending` grants nothing;
   - an NC entry, or any entry carrying an offer reference, must match its persisted offer (unchanged rule);
   - a story-criterion entry with no offer reference is captured with criterion-only scope, from its rendered
     criterion, summary, explicit decision and rationale, through the existing deterministic
     criterion-and-summary provenance (`legacyClearReference`, `materializeLegacySource`) and the existing
     replay and supersession check (`sameLegacyAuthority`), and only when its criterion is an
     outside-visible OVER_SCOPE finding in the persisted verdict (`readPrdAuditVerdict`,
     `.pipeline/prd-audit.json`). A criterion the halt never offered is an `unknown-criterion` defect; an
     absent or unreadable verdict is a distinct defect whose recovery says to leave the entry pending.
     This applies in the legacy whole-block import too (conflict-check resolution, honoring accepted
     story `over-scope-halt-accepts-one-criterion-per-clear-so` criterion "entry for a criterion the
     halted blocking set did not contain").
   One entry's defect never rejects a sibling.
2. **Legacy import kept.** A block whose entries all lack offer references and all carry an explicit
   decision still takes the existing legacy whole-block import (D4). The retired formats (single-line
   `OVER_SCOPE_ACCEPT:`, a non-array document) still report `unsupported-legacy-clear`.
3. **Named defects.** Each `PrdWideningCaptureDefect` carries the entry's criterion when the entry is
   readable, alongside its existing optional `offerEntryId`.
4. **Total recovery mapping.** The PRD-audit entry path in `conductor.ts` replaces its precedence chain,
   whose fallthrough is `malformed-history`, with an exhaustive mapping from every
   `PrdWideningCaptureDefectKind` to a `PrdWideningRecoveryReason`. The halt renders one recovery line per
   distinct reason, each naming its affected criteria. `prd-widening-recovery.ts` gains the reasons a cleared
   block needs: one for a changed or missing offer reference, one for an unparsable decision block or entry,
   and one for a duplicated entry. `malformed-history` remains only for corrupt stored widening history.
5. **Total stored-history mapping (operator-confirmed).** The migration-failure branch in `conductor.ts`
   (`prepared.migration.kind === 'failed'`) replaces its `reason.includes('unsupported')` test with an
   exhaustive mapping over the closed migration `reason` union in `engine/prd-widening-migration.ts`:
   `corrupt-history` → `malformed-history`; `unsupported-history`, `unknown-history-version` and
   `unsupported-legacy-row` → `unsupported-history`; `foreign-feature-history` → `foreign-feature`;
   `unreadable-legacy`, `case-write-failed` and `decision-write-failed` → `persistence-failed`. Today
   `unknown-history-version`, `foreign-feature-history`, `unreadable-legacy` and both write failures
   halt as `malformed-history`. (verified by source reading, 95%)

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | Pure TypeScript in the existing engine. No new package, module, store or service. (verified, 98%) |
| Prerequisites | None. The criterion-only capture primitives already exist in `engine/prd-widening-capture.ts` (`legacyClearReference`, `materializeLegacySource`, `sameLegacyAuthority`) and the per-entry parser `parseEntry` already reads `pending`, offer references and criterion. (verified, 95%) |
| Root cause | `routeTypedPrdAuditOverScope` (`engine/prd-audit-routing.ts`, `editable`) renders a story-criterion finding as an editable entry with no offer reference, because offers are persisted only for NC findings (`reconcileCurrentPrdWidening` in `engine/conductor.ts` filters `isPrdAuditNoOwnerOrdinal`). When any sibling carries `offerEntryId`, capture takes the offer-validating loop, where `matchesPersistedOffer` fails for the story entry and pushes `changed-offer-reference` without an `offerEntryId`. The conductor's mapping does not name that kind, so it falls to `malformed-history` with "affected no specific record". (verified by source reading, 95%) |
| Sibling defect (in scope, operator-confirmed) | A block of only story criteria with any entry left `pending` fails `parseLegacyPrdWideningClear` (it accepts only `accept`/`refuse`), and with no offer reference present capture returns `unsupported-legacy-clear`, rendered as an "upgrade conductor" recovery. Per-entry capture covers it. (verified by source reading, 95%) |
| Effective authority | A story-criterion decision becomes effective by criterion name with no case relationship: `classifyPrdWideningProjection` (`engine/prd-widening-classification.ts`) and the story branch of `routeTypedPrdAuditOverScope` both select the latest decision whose `criterion` matches. Refusal rework for a story criterion needs only the decision id, revision and rationale (`buildRefusalReworkEvidence`). (verified, 95%) |
| Offered-set source | `.pipeline/prd-audit.json` is written by `persistPrdAuditVerdict` and cleared only by rewind (`engine/rewind.ts`); PRD-audit entry runs capture before the next dispatch, so the verdict that rendered the halt is still on disk. Its typed relations come from the existing `prdAuditTypedRouteReport`. (verified by source reading, 85%) |
| Provenance reuse | The `legacy-clear-` identifiers are produced by `prd-widening-capture.ts` and `prd-widening-migration.ts`, and no production code branches on that prefix. Reusing the provenance for a current story entry changes no reader. (verified by grep, 90%) |
| Integration surface | Four production files: `engine/prd-widening-capture.ts`, `engine/prd-widening-recovery.ts`, `engine/prd-widening-entry.ts` (passes the offered story-criterion set from the persisted verdict into capture), and the capture- and migration-defect branches of `engine/conductor.ts`. Existing tests to extend: `test/engine/prd-widening-capture.test.ts`, `test/engine/conductor-prd-widening-routing.test.ts`, `test/engine/prd-widening-migration.test.ts`. |
| Data implications | No schema change. `accepted-widenings.json` v2 decisions and `remediation-cases.json` `prd_widening` cases keep their shapes; a story capture writes the same record kinds the legacy import already writes. |
| Performance | Unchanged: one offer read and at most one append per entry. |
| Worktree isolation | Per-feature `.pipeline/` state only. No shared resource. |

## Alignment

- **Governing decision reuse.** Capture authority is governed by D1, D3 and D4 of
  `adr-2026-09-07-durable-prd-widening-decision-reconciliation`. D1 already says story-criterion decisions
  keep criterion-only scope; the code applies that only to whole legacy blocks. No new structural decision
  is made, so no new ADR is drafted. D3 and D4 are amended in place to state per-entry capture scope and
  the recovery-reason rule.
- **Authority safety.** Nothing becomes authority without an explicit `accept` or `refuse`, a rationale and
  a resolved operator, which are the existing checks. NC entries keep full offer validation, so a renumbered
  NC cannot borrow a story entry's looser scope: the scope is chosen by the criterion's grammar
  (`isPrdAuditNoOwnerOrdinal`) and by the presence of an offer reference, never by operator choice.
- **Exhaustive matching.** The defect-to-reason mapping is a total `Record` over
  `PrdWideningCaptureDefectKind`, so a new defect kind fails to compile rather than falling through. This
  removes the catch-all `else` that caused the misleading halt.
- **Event spine.** Rejections keep using `emitPrdWideningRejections` → `prd_widening_reconciled` with
  `outcome: rejected`. The source id changes from the generic `prd-audit:entry` to the criterion when known.
  No new event type and no side channel.
- **Production DI defaults.** Unchanged; stores are the existing file-backed `RemediationCaseStore` and
  `AcceptedWideningDecisionStore`.
- **Out of scope (operator-confirmed).** The validation group's three attempts on a deterministic capture
  defect are unchanged. Offers are not persisted for story criteria (rejected Approach B).

## Domain Integrity

Skipped in lightweight mode, except the exhaustive-matching point above, which is the defect's cause.

## Wiring Surface

- **Per-entry capture** is reached through the existing call chain: PRD-audit entry in `conductor.ts` →
  `preparePrdWideningEntry` → `capturePrdWideningDecisions`. No new caller.
- **New recovery reasons** are rendered by the existing `renderPrdWideningRecovery`, called from the same
  capture-defect branch in `conductor.ts`.
- **Defect `criterion` field** is consumed by that branch and by `emitPrdWideningRejections`.
- **Offered story-criterion set** is read at PRD-audit entry from the existing `readPrdAuditVerdict` and passed through `preparePrdWideningEntry` into `capturePrdWideningDecisions`.

Advisory overlap scan over the three paths: four open spec branches touch `conductor.ts`
(`planner-escalation-to-architecture-review-still-ha`, `routed-leaf-acceptance-specs-completion-still-requ`,
`routed-verify-green-refuses-the-leaf-host-which-ne`, `stacked-no-op-rebase-never-satisfies-its-gate-afte`).
None touches the PRD-widening capture branch or the other two files. No in-flight spec amends
`adr-2026-09-07`.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A story entry whose summary was hand-edited is captured with the edited text as its provenance snapshot | Data | Low | Low | Already true for pure legacy blocks; authority is still criterion-keyed and operator-attributed, and the summary is evidence only |
| Replaying the same cleared block appends a duplicate story decision | Data | Low | Medium | Reuse `sameLegacyAuthority` replay detection and supersession, as the legacy path does; covered by a replay test |
| Per-entry change regresses the pure legacy import | Technical | Low | Medium | Keep the legacy branch for all-decided, offerless blocks; existing migration and capture tests stay green |
| Conductor.ts merge contention with four open specs | Integration | Medium | Low | Change is confined to the capture-defect branch |

## ADRs Created

None. `adr-2026-09-07-durable-prd-widening-decision-reconciliation` is amended in place: D3 (per-entry
capture scope, named defects, `malformed-history` reserved for stored history) and D4 (a current-format
array is never a retired format).
