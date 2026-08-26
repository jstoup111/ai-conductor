# Architecture Review: One owner per review question (#1805)
**Date:** 2026-08-22
**Tier:** L (full review)
**Inputs reviewed:** PRD `.docs/specs/build-review-re-judges-what-the-plan-architecture-.md` (FR-1–23); architecture `.docs/architecture/build-review-re-judges-what-the-plan-architecture-.md`; track `.docs/track/…` (product; scope boundary: full consolidation, no rename, no new rubrics, no file-list mechanization)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Area | Assessment | Confidence |
|---|---|---|
| Retire three rubrics (FR-1, FR-23) | Registry-driven dispatch exists (`build-review-registry.ts`); branches, exemptions, projections, fixtures and tests are enumerable by rubric id. Deletion is mechanical. | 90% verified |
| Empty rubric container (FR-2) | `config.ts:1093` rejects it today; a one-line rule change plus a no-dispatch PASS path. | 95% verified |
| Retired keys as no-ops (FR-20) | Exact precedent: wiring key kept on the accepted list, ignored (adr-2026-08-14). | 95% verified |
| test-quality scoping (FR-4) | `Covers: FR-N` marker grammar exists in writing-system-tests; extension to story/task ids is a grammar change plus an intersect in the projection builder. | 80% inferred |
| prd_audit run always (FR-8) | `skippableForTracks: ['technical']` at `steps.ts:228`; removing it is one line; GATE_SURFACE extension is a table edit in `artifacts.ts`. | 95% verified |
| Grades + cap (FR-10–13) | Single appender `appendRemediationTasks` (`conductor.ts:10662`, caller `:2756`); cap enforced before the call; ledger already per-gate. | 90% verified |
| Done when: at task close (FR-6) | No engine reader exists (grep empty); new parser in `plan-task-parse.ts`, engine write on task-status. | 90% verified |
| as-built always (FR-15) | Remove `skippableForTiers`/`skipWhenSkipped` at `steps.ts:250-254`; parser in `artifacts.ts:2877` must accept `PLAN_GAP`. | 95% verified |
| Old dispositions ignored (FR-22) | Unknown keys already ignored in stored verdicts (adr-2026-08-14). | 85% inferred |

No new packages, services, or infrastructure. Worktree-isolated (all state is per-worktree `.pipeline/`).

## Complexity

High — 4 gates, config schema, ledger, parser, three skill contracts, ~40 ADRs touched. Not split:
the value is in the ownership map landing at once; a partial land re-creates overlap.

## Alignment

Full repo-wide ADR sweep performed (delegated, all files). Findings resolved as:

- **Superseded (status line, content preserved):** completeness-as-build-review-rubric,
  preservation-anchored-completeness-exemption, removal-anchored-tautology-exemption,
  verify-only-anchored-tautology-exemption.
- **Amended (additive notes appended):** 30 ADRs, listed in each new ADR's `Amends:` line.
- **Reused unchanged:** two-phase no-op retirement (adr-2026-08-11), wiring-rubric retirement
  precedent (adr-2026-08-14), concurrent-group core, manual-test deterministic kickback,
  halt classification + spine, operator-lever, mutation port, event-sink exhaustiveness, ADR
  approval parser, acceptance-RED lifecycle, coherence split, migration-gate waiver.
- **Operator rulings taken during review:** prd_audit is the completion authority; Done when: is
  evidenced only where the block exists; sealing is unchanged — only reseal-rationale judgement moves.

Daemon DECIDE-halt rules (adr-2026-07-27, adr-2026-08-03) are honoured: no new route targets DECIDE;
PLAN_GAP is a halt or a recorded finding.

## Domain Integrity

- Grades are a closed enum, schema-constrained; gate outcome is engine-derived (no catch-all default).
- `FIXABLE` is unrepresentable without `{planTask, criterion}` — parser rejects.
- Growth record `{authored, added, byGate, remaining}` is derived, never hand-edited.
- Halt classes `plan-gap` added to the total classification (adr-2026-07-28 boundary).

## Wiring Surface

| New/changed surface | Called from |
|---|---|
| Registry-driven rubric dispatch + empty-set PASS | `coordinateBuildReviewRubrics` via the build_review step runner |
| Deprecated-key acceptance + `config_deprecated_key` warning | `config.ts` resolver, surfaced in `conduct-ts` config load and the spine |
| `build-review-test-quality` skill | build_review grader dispatch (`step-runners.ts` one-shot path); model table row replaces tautology |
| `Covers:` grammar extension | writing-system-tests skill; projection builder intersect in `build-review-inputs.ts` |
| prd_audit grade schema + parser | `artifacts.ts` verdict reader (`.pipeline/prd-audit.md`), gate-driven SHIP tail |
| Cap enforcement + `Criterion:` on appended tasks | `conductor.ts` remediation path before `appendRemediationTasks` |
| Growth record | `kickback-ledger.ts`; read by `conduct-ts` status and emitted as a `ConductorEvent` |
| Recorded findings → shipped record | `shipped-record` writer at finish |
| `GATE_SURFACE.prd_audit` += stories/specs | invalidation (`artifacts.ts`) |
| as-built per-check policy + `PLAN_GAP` | `steps.ts` registry, `artifacts.ts:2877` parser, architecture-review skill §12 |
| Done when: parser + task-close evidence + `plan-gap` halt | `plan-task-parse.ts`; task-close path in the BUILD runner |
| Config keys: prd_audit caps; as-built per-check/tier | `config.ts` schema + scaffolder |

Overlap scan (advisory): `config.ts` overlaps 14 unmerged spec branches; the others are clean.
Expect rebase friction on `config.ts` only.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Completion authority moves to SHIP; a conformance miss costs a full BUILD→SHIP lap | Technical | Medium | Medium | Done when: evidence at task close catches per-task misses early on new plans |
| Deleting rubric code breaks cache/disposition readers on resumed features | Data | Medium | High | FR-22 tolerant readers; acceptance test resumes a feature with stale dispositions |
| Cap configured to 0 / misconfigured → every FIXABLE halts | Integration | Low | Medium | Validate caps ≥1 lap, ≥1 task; defaults documented in config schema |
| prd_audit on every S-tier refactor adds SHIP cost | Performance | High | Low | Empty criteria set → fast PASS without per-FR dispatch |
| test-quality scoping misses tests lacking `Covers:` | Knowledge | Medium | Low | Rubric is opt-in; unbound tests are out of scope by design, reported as coverage note |
| Config schema is a breaking surface | Integration | High | Medium | PR carries a migration block (or waiver if internal-only) |

## ADRs Created

- adr-2026-08-22-one-owner-per-review-question
- adr-2026-08-22-build-review-opt-in-rubric-container
- adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback
- adr-2026-08-22-as-built-review-runs-always-with-plan-gap
- adr-2026-08-22-done-when-evidence-at-task-close

## Conditions

1. All five ADRs reach APPROVED before stories.
2. The PR carries a `## Migration` block (or a recorded waiver) for the config-schema surface.
3. An acceptance test resumes a feature carrying pre-change dispositions and a `rem-*`-bearing plan
   without `Done when:` and reaches SHIP (FR-21/22).
4. Installed-skill symlinks for the three deleted rubric skills are treated as a consumer migration
   (adr-2026-07-29 precedent).
5. **This repository opts in:** `.ai-conductor/config.yml` enables the `test-quality` rubric for
   ai-conductor itself (the shipped default stays off). Operator direction 2026-08-22.
6. The test-quality grader rides the existing one-shot grader dispatch, so telemetry and token
   accounting come from the current provider integration; no separate requirement.
