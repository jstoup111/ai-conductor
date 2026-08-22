# Coherence: Review is bound by each plan task's Done when: criteria

**Plan stem:** plan-tasks-lack-falsifiable-done-criteria-so-revie
**Tier:** M · **Track:** technical · **Source-Ref:** jstoup111/ai-conductor#1763
**Date:** 2026-08-21

Every row below was confirmed against the counterpart artifact file. Thirty-two rows: 5 outcome,
7 story, 19 task, 1 adr. No `fr` rows (technical track, no PRD). No `gap`, no `fail`.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-7 | covered | "Every approved plan task carries explicit, falsifiable completion criteria …" The authoring half shipped in #1764; story-1 makes presence and shape mechanical at land, story-7 makes the rubrics consume the criteria. The "falsifiable" quality of each line remains authoring guidance (ADR D1, adr-2026-07-22 split) — a deliberate, recorded boundary, not a gap. |
| outcome | outcome-2 | story-1 | covered | "A plan containing a task without such criteria is rejected when the plan is authored/reviewed — at DECIDE — not discovered as unmeetable at BUILD lap 5." story-1 rejects at `landSpec` naming the task; its last negative path keeps the 300 merged plans dispatchable (land-only by design). |
| outcome | outcome-3 | story-3, story-4, story-5, story-6, story-7 | covered | "A build_review rubric judging a task with such criteria cannot fail the task for a demand beyond them; a legitimate deeper concern becomes a filed issue, never a finding on the current feature (the shrink-or-file rule of #1718)." story-7 binds the rubric, story-3 carries the binding, story-4 removes `beyond` from the blocking set, story-5 records it once, story-6 files it as intake. |
| outcome | outcome-4 | story-4, story-6 | covered | "A feature that satisfies every task's stated criteria reaches SHIP with zero operator interventions of the kind logged today." story-4's beyond-only lap passes with no kickback or counter advance; story-6 files without an operator and its failure paths never block. Residual: a rubric that wrongly binds a beyond concern still blocks (conservative side, ADR Consequences). |
| outcome | outcome-5 | story-1, story-3, story-4 | covered | "Existing well-formed tasks still land unchanged: criteria that are already explicit are not forced through any new ceremony." story-1's happy path lands a compliant plan with no extra output and the sole existing block passes; story-3 and story-4 keep an absent binding and pre-change dispositions behaving exactly as today. |
| story | story-1 | task-2, task-3, task-4 | covered | Parser, pure shape rule, land rung. |
| story | story-2 | task-5, task-6 | covered | Snapshot criteria evidence; projections incl. Tautology plan body. |
| story | story-3 | task-7, task-8, task-9, task-18 | covered | Optional binding parse, rejections, identity exclusion, contract/drift guard. |
| story | story-4 | task-1, task-10, task-11, task-13 | covered | Reducer relaxation, exit re-derivation, accept refusal, stale-base no-record. |
| story | story-5 | task-12, task-13, task-14 | covered | Record kind, conductor write, rendering. |
| story | story-6 | task-15, task-16, task-17 | covered | Event, daemon filer, failure handling. |
| story | story-7 | task-18, task-19 | covered | Rubric contracts; no-criteria tasks unchanged. |
| task | task-1 | story-4 | covered | Verify-only rebase check; supports every seam named by symbol. |
| task | task-2 | story-1 | covered | `parsePlanTaskDoneWhen`. |
| task | task-3 | story-1 | covered | `validatePlanDoneWhen`. |
| task | task-4 | story-1 | covered | `landSpec` rung; negative paths incl. land-only scoping. |
| task | task-5 | story-2 | covered | `doneWhenContext` on the snapshot. |
| task | task-6 | story-2 | covered | Projection fields, digest-change assertion. |
| task | task-7 | story-3 | covered | `boundTo` parse, shape renderer. |
| task | task-8 | story-3 | covered | Rejections with listing diagnosis; `absent` rerun. |
| task | task-9 | story-3 | covered | Identity exclusion. |
| task | task-10 | story-4 | covered | `beyondFindingIds`; PASS predicate unchanged; exits re-derived by grep. |
| task | task-11 | story-4 | covered | `accept` refuses beyond; fresh-base exit precedes the write. |
| task | task-12 | story-5 | covered | `beyond` record kind; `listReducedCoverage` narrowed. |
| task | task-13 | story-5 | covered | Conductor write point; no tracker in the loop. |
| task | task-14 | story-5 | covered | Findings, PR body, shipped record rendering, fail-closed. |
| task | task-15 | story-6 | covered | `build_review_beyond_filed` + sink row. |
| task | task-16 | story-6 | covered | `reconcileBeyondRecords` in the daemon. |
| task | task-17 | story-6 | covered | Ledger refusal, tracker error, dedup, stamp retry. |
| task | task-18 | story-7 | covered | Four SKILL.md contracts + drift guard. |
| task | task-19 | story-7 | covered | No-criteria tasks grade unchanged. |
| adr | adr-2026-08-21-review-bound-by-plan-done-when-criteria | story-1, story-2, story-3, story-4, story-5, story-6, story-7 | covered | D1→story-1; D2→story-2, story-3; D3→story-4; D4→story-5; D5→story-6; D6→story-3, story-7. Cross-layer consistency pass: outcome-2 (reject at DECIDE) vs task-4's land-only scoping — satisfying either leaves the other intact (merged plans are pre-DECIDE-rule, not "authored" under it); outcome-3 (beyond never blocks) vs task-8 (unresolvable binding rejects the lap) — a rejected envelope reruns as `absent`, it does not block, both hold; outcome-5 vs task-6's one-lap re-judge — the re-judge changes no verdict semantics, both hold. No oscillation found. |
