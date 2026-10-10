# Conflict Report: Dependency edges are hand-maintained (#536)

**Date:** 2026-10-09
**Stories checked:** .docs/stories/dependency-edges-are-hand-maintained-intake-and-de.md (Stories 1–13), against the related story corpus
**ADR corpus:** repo_wide (341 ADRs, narrowed by subject overlap)
**Result:** PASSED. 0 blocking. 3 degrading conflicts were found and resolved; none remain.

## Corpus

**Examined ADRs:**
- adr-2026-07-03-{issue-dependencies-api-surface, dependency-fail-closed-and-cache,
  dependency-gate-backlog-waiting-channel, prose-to-link-migration, engineer-checkpoint-commits-idempotent-land}
- adr-2026-07-21-{decide-time-unmerged-overlap-scan, intake-only-enforcement}
- adr-2026-07-22-{coherence-gate-placement-and-validation-split, coherence-waiver-and-duplicate-claim,
  canonical-tracker-client-seam, intake-closed-issue-reconciliation}
- adr-2026-07-23-intake-label-authority-scoped-replace
- adr-2026-08-23-{criterion-layer-is-structural-at-land, coverage-claims-grounded-by-verbatim-quote}
- adr-2026-08-31-coverage-binding-judge-step
- adr-2026-09-06-inbound-intake-trust-boundary
- adr-2026-09-11-github-operation-ownership
- adr-2026-06-30-background-intake-brain-loop, adr-009, adr-011, adr-012
- adr-2026-07-07-audit-trail-event-sink, adr-2026-07-26-event-sink-registry-exhaustiveness,
  adr-2026-08-11-halt-events-ride-the-persisted-spine

**Narrowed out (no subject overlap):** daemon halt/stall/worktree-guard, provider/credential,
build/review/kickback, priority-banding, PR-label sweep, and memory ADRs. No examined ADR was
excluded as superseded.

**Examined stories:**
- dependency-ordered-intake-and-dispatch
- link-intake-depends-on-with-a-typed-issue-id
- surface-evidence-path-overlap-as-suggested-depende
- spec-authoring-is-blind-to-unmerged-dependent-work
- intake-only-enforcement
- github-issue-text-reaches-an-autonomous-build-with
- record-land-gate-rejections-on-the-event-spine
- intake-claim-closed-issue-guard-and-brain-sweep
- canonical-tracker-client-seam-with-per-backend-tra
- land-time-validation-that-every-plan-task-carries-
- fetch-intake-outcomes-for-an-unclaimed-source-ref
- plans-cannot-declare-ordered-slices-of-one-feature
- sliced-plans-can-be-landed-whose-stories-span-chil
- reject-non-date-named-adrs-at-spec-land
- engineer-handoff-pushes-spec-branch-331

## Conflict: Offline land vs. dependency gate refusing when the tracker is unreachable

**Stories involved:** Story 8 vs. ADR: coherence waiver and duplicate claim
**Files:** .docs/stories/dependency-edges-are-hand-maintained-intake-and-de.md vs. .docs/decisions/adr-2026-07-22-coherence-waiver-and-duplicate-claim.md
**Type:** contradiction
**Severity:** degrading
**ADR filename stem:** adr-2026-07-22-coherence-waiver-and-duplicate-claim
**Story ID:** Story 8
**ADR opposing sentence (verbatim):** "`land` must work offline (no-remote local-commit fallback) — a blocking check may not depend on network reachability."
**Story opposing sentence (verbatim):** "Given the tracker is unreachable, when land runs without a skip acknowledgement, then land exits non-zero, nothing is committed, and the output names the cause and how to acknowledge a skip."

**Resolution options:**
1. Make a narrow, recorded exception for `--source-ref` land, with an explicit skip escape.
2. Fail open when offline and auto-record the skip.

**Resolution (operator, option 1):** adr-2026-10-09-dependency-reconciler-and-edge-write-ownership
decision 6 records the exception, and the older ADR carries an additive amendment note. Land
without `--source-ref` stays fully offline.

## Conflict: Advisory overlap scan vs. refuse-until-decided gate

**Stories involved:** Stories 5/6 vs. spec-authoring-is-blind (TR-4) and ADR: DECIDE-time unmerged-overlap scan
**Type:** overlap
**Severity:** degrading
**ADR filename stem:** adr-2026-07-21-decide-time-unmerged-overlap-scan
**Story ID:** Story 6
**ADR opposing sentence (verbatim):** "Advisory, never blocking; stateless; build side untouched."
**Story opposing sentence (verbatim):** "Given proposals #520 and #600, when land runs with only #520 decided, then land exits non-zero, nothing is committed, no link is written, and the output names #600 and states how to accept or decline it."

**Resolution (operator):**
- Only linkable overlaps become proposals. Marker-less, closed and cross-repo overlaps stay
  advisory and never block.
- The standalone DECIDE-time scan is unchanged.
- ADR 1 decision 3 and a new Story 5 negative path carry this.

## Conflict: Migration ADR's "drifted prose is ignored by design" vs. standing prose linking

**Stories involved:** Stories 1–2 vs. ADR: prose-to-link migration
**Type:** contradiction
**Severity:** degrading
**ADR filename stem:** adr-2026-07-03-prose-to-link-migration
**Story ID:** Story 1
**ADR opposing sentence (verbatim):** "Prose that drifts from the recognized patterns after migration is ignored by design (PRD Non-Goal: native links are the only recognized form going forward)."
**Story opposing sentence (verbatim):** "Given open issue #10 exists in the same repository, when a non-form issue #20 is opened with body "This is blocked by #10.", then #20's blocked-by list contains #10."

**Resolution (operator):** The non-goal is reversed for the three recognized patterns. The older
ADR carries an amendment note; ADR 1 decision 2 states the reversal.

## Assumptions resolved

- **GitHub operation ownership (adr-2026-09-11 D2/D3).** Edge writes are limited to issues
  assigned exclusively to the operator. Other issues are refused and reported (FR-1, Story 4).
  Form-field linking already used this runner, so there is no regression.
- **Inbound trust boundary.** Edges come from the raw tracker body as numeric ids only. No body
  text is forwarded.
- **Land-gate rejection recording.** A refusal is recorded once, as `land_gate_rejected`, under
  three new closed-enumeration identifiers. Validation runs after the target is resolved.
  `land_dependency_decided` is emitted on success only.
- **Concurrent writers.** All writes are additive and idempotent, and the drift sweep is read-only,
  so there is no oscillation. Prose is the declaration of record (Story 2): to drop a dependency,
  remove the prose and then delete the link. The composer skill text must state this.

## Re-check

A re-check after the resolutions found 0 blocking and 0 degrading conflicts, and no new conflicts
against the examined corpus.
