# Architecture Review: New review concern at a resolved anchor halts as malformed case state

**Date:** 2026-10-02
**Mode:** Lightweight (Medium tier) — technical track, pre-stories
**Input:** jstoup111/ai-conductor#2464; explore approach A (lifecycle-scoped source ownership plus a
judge-declared `distinctFrom`); `.docs/architecture/new-review-concern-at-a-resolved-anchor-halts-as-m.md`
and its sequence diagram
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

Verified against current source (read-only):

- **Root cause confirmed (verified, 95%).** `parseBuildReviewCases` in `remediation-case-store.ts`
  keeps one global source-id set and returns `malformed-state` on a repeat. `RemediationCaseStore.mutate`
  re-parses the next state with the same function, so a rejected *transition* is reported exactly like
  corrupt *persisted* history. `convergedCaseFor` in `remediation-case-reconciler.ts` excludes resolved
  `act` cases, so an unbound proposal at their source appends a new case and trips that check.
  `build-review-adjudication-coordinator.ts` maps the store failure to `case store malformed-state`
  on `remediation_adjudication_failed`.
- **Why the source stays live (verified, 90%).** The coordinator's finalized-source set drops a
  resolved action case's source only when its link outcome is `merged`. A resolved `act` link with
  outcome `acted` stays in the live set, so the judge sees it again. That is the only path D6.2 opens.
- **Identity collision is structural (verified, 85%).** The testQuality source id hashes rubric,
  contract version, concern kind, and the content-anchored locus. The testQuality concern-kind
  vocabulary has a single member, so two different concerns at one anchored region share an id.
  Changing that derivation is excluded by scope and by adr-2026-08-13-stable-build-review-finding-dispositions.
- **Stack:** TypeScript engine only; no new dependency, service, or migration. Store validation,
  reconciler, case-row parser/validator, coordinator diagnostics, the `remediate` skill contract text,
  and its pinned contract test.
- **Integration surface:** stays inside the build_review remediation slice plus the existing event
  union. The `prd_widening` namespace is untouched.
- **Data:** no envelope version change (operator decision). New record field is optional; all
  existing stores parse unchanged. A downgrade fails closed, which the governing ADR already requires.
- **Worktree isolation:** feature-scoped `.pipeline/` state only; no shared resource.

## Alignment

Governing APPROVED ADRs (a repo-wide sweep of 638 decision files):

| ADR | Relationship | Action |
|---|---|---|
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication (store, recurrence, settled predicate; inherits predecessor D5/D7) | Owner | Additive amendment **D6** (D6.1–D6.7) |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation D2 ("validate source uniqueness within its domain namespace") | Conflicted as written | Additive amendment **D2.1** narrowing build_review uniqueness to unresolved owners |
| adr-2026-09-10-portable-build-review-policy D9 (case-v2 fields), D8 (no mechanical re-derivation of judgement), D11 (no new ledger/store), D12 (events) | Extended | Additive amendment **D9.1** (`distinctFrom` field); D8/D11/D12 conformed |
| adr-2026-08-13-stable-build-review-finding-dispositions, adr-2026-08-18-content-anchored-finding-reference-schema | Identity is never prose-derived | Conforms; derivation unchanged |
| adr-2026-08-12-cumulative-build-review-convergence-bound | Every first-time BUILD route charges | Conforms via D6.4 |
| adr-2026-08-11-halt-events-ride-the-persisted-spine | Additive event fields | Conforms via D6.6 |

- **Machinery vs judgement.** Whether a concern is new is a judgement (CLAUDE.md design principle).
  The judge declares it inside a constrained schema. The engine validates exact references, exact set
  membership, and lifecycle state, and never matches prose. An undeclared reuse falls back to the
  existing exact-id recurrence halt, so the default stays conservative.
- **State management.** Resolution stays the existing `open | resolved` enum. Ownership is derived from
  it, and no boolean flag is introduced.
- **Event spine.** The new diagnostics are additive fields on the existing
  `remediation_adjudication_failed` event and reuse `remediation_semantic_repeat_halt`. No new channel.
- **Focused local pattern basis.** The #2409 refutation lane is the precedent.
  - Role: a judge-authored, schema-constrained case-row extension, admitted by mechanical validation.
  - Traits to keep: an optional row field, parsed in `remediation-case-artifact.ts`, reference-checked
    in `remediation-case-validator.ts`, and gated by store state in `remediation-case-reconciler.ts`.
  - Also keep: skill contract text in `skills/remediate/SKILL.md` pinned by
    `remediate-skill-contract.test.ts`.
  - Allowed variation: `distinctFrom` carries references only; it carries no evidence anchors.
- **Diagrams** are accurate for the proposed change.

## Wiring Surface

- **`distinctFrom` case-row field:**
  - Parsed by the existing case-v2 artifact parser that the adjudication coordinator calls on
    `.pipeline/remediation.json`.
  - Validated in `validateRemediationCaseGraph` against the prior-case references the coordinator
    already supplies.
  - Consumed by `reconcileRemediationCases` inside the existing coordinator lap.
- **Lifecycle-scoped ownership check:** replaces the global set inside `parseBuildReviewCases`, which
  both `RemediationCaseStore.load` and `RemediationCaseStore.mutate` call.
- **Next-state rejection reason:** returned by `RemediationCaseStore.mutate` and surfaced through the
  reconciler's existing `store-failure` passthrough to the coordinator's `fail` path.
- **Recurrence binding for an undeclared reuse:** in the reconciler. Consumed by the coordinator's
  existing `classifyRemediationCaseReuse` branch, which emits `remediation_semantic_repeat_halt`.
- **Current-owner reads:**
  - `currentSourceCoverageIsConsistent` and `reduceBuildReviewAdjudication` in
    `build-review-adjudication.ts`.
  - The coordinator's finalized-source set.
  - All are reached from the existing build_review adjudication lap.
- **Additive `remediation_adjudication_failed` fields:**
  - Defined in the `ConductorEvent` union in `src/conductor/src/types/events.ts`.
  - Emitted by the coordinator's `fail`.
  - Registered in `event-sinks.ts`.
- **Lineage rendering:** the existing `build-review-cli.ts` findings case line.
- **Judge guidance:** the case-v2 section of `skills/remediate/SKILL.md`, which the engine already
  injects into the remediate dispatch.

Early overlap scan (`ai-conductor overlap-scan` over these paths): no overlap detected, no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Judge over-declares `distinctFrom` to escape a regression halt | Technical | Medium | Medium | Exact-set and `act`/resolved/unfinalized validation; each admitted case charges kickback (D6.4) under the cumulative bound; skill text states when declaration is legitimate |
| A source→case reader still assumes global uniqueness and contradicts the current owner | Data | Medium | High | D6.5 names every reader; stories must cover coverage-consistency, routing, decision stops, and the settled predicate with a shared resolved+open fixture |
| Store field added to an `exactKeys` record breaks older-engine reads | Data | Low | Low | Accepted by operator: fail-closed downgrade per prd-widening D2 |
| Case-row key-set enumeration in the artifact parser grows combinatorially | Technical | Medium | Low | Allowed: refactor to an optional-key check during BUILD; no behavior change |
| Remediate contract test regex pins the field list | Technical | High | Low | Update the test alongside the skill text |

## ADRs Created

None. Three operator-approved additive amendments:
`adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D6,
`adr-2026-09-07-durable-prd-widening-decision-reconciliation` D2.1, and
`adr-2026-09-10-portable-build-review-policy` D9.1.

## Conditions

1. Stories must cover all three outcomes on a store holding a resolved `act` case at the reused
   source: the declared distinct case is admitted, the undeclared reuse halts as a regression, and an
   invalid declaration is rejected with a typed reason.
2. The issue's recorded replay is an acceptance case. Given the saved store shape and a judgement that
   declares `distinctFrom`, the lap admits the new case, and both it and the sibling action case reach
   one work order.
3. Rejected transitions must be distinguishable from malformed persisted state in both the store
   result and the event, and no path may clear or rewrite resolved history.
4. Every reader named in D6.5 is covered; none may treat a resolved link as contradicting the current
   owner's outcome.
