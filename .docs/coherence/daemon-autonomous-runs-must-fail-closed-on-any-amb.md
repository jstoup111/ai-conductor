# Coherence: fail-closed DECIDE entry for autonomous runs

**Date:** 2026-08-03
**Tier:** L
**Track:** technical — FR rows are not applicable and are omitted
**Plan stem:** daemon-autonomous-runs-must-fail-closed-on-any-amb
**Source-Ref:** jstoup111/ai-conductor#550
**Verdict:** covered — zero gaps

## Traceability Mapping

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2, story-7 | covered | story-1 halts on an unsatisfied contracted DECIDE step naming the missing artifact; story-2 closes the resume-clamp path onto DECIDE; story-7 pins the satisfied case fast-forwarding with zero dispatches. |
| outcome | outcome-2 | story-1 | covered | story-1's second negative path asserts an interactive run reaching the same unsatisfied step still dispatches and writes no HALT. |
| outcome | outcome-3 | story-7 | covered | story-7 requires the healthy run to reach acceptance_specs with zero DECIDE provider dispatches and satisfaction answered only by the existing file-I/O predicate. |
| story | story-1 | task-1, task-3 | covered | task-1 unit-pins the halt and interactive-passthrough rules; task-3 wires and acceptance-pins the forward-walk seam. |
| story | story-2 | task-5 | covered | task-5 consults the predicate on the clamped index without mutating conduct-state.json. |
| story | story-3 | task-6 | covered | task-6 widens the scan past topo.kickbackTargets and preserves the cap-before-policy ordering. |
| story | story-4 | task-7 | covered | task-7 replaces the build-defaulting resolver with one that reports unresolved dispositions. |
| story | story-5 | task-2 | covered | task-2 renders the five-field payload and pins the verbatim unresolvable-target case. |
| story | story-6 | task-8 | covered | task-8 implements the grant command, its consumption, and the cleared-HALT-is-not-a-grant negative path. |
| story | story-7 | task-4, task-9 | covered | task-4 retires the DECIDE preseed so satisfaction has one authority; task-9 proves the healthy, Small-tier, contract-less, and unresolved-tier paths end-to-end. |
| task | task-1 | story-1 | covered | Pure predicate whose rule table is the halt/enter decision story-1 depends on. |
| task | task-2 | story-5 | covered | Owns the halt payload contract. |
| task | task-3 | story-1 | covered | Owns the forward-walk seam. |
| task | task-4 | story-7 | covered | Owns preseed retirement and the single satisfaction authority. |
| task | task-5 | story-2 | covered | Owns the resume-clamp seam. |
| task | task-6 | story-3 | covered | Owns the kickback-scan seam. |
| task | task-7 | story-4 | covered | Owns the remediation-resolution seam. |
| task | task-8 | story-6 | covered | Owns the operator grant. |
| task | task-9 | story-7 | covered | Owns the end-to-end healthy-path proof. |
| task | task-10 | story-1, story-6 | covered | Documentation and migration for the new invariant and the grant command it introduces. |

## Verify-Claims Verdict

Every counterpart id above resolves against the accepted stories file (story-1 … story-7), the
approved plan's task tree (task-1 … task-10), or the three staged intake outcome bullets
(outcome-1 … outcome-3). The three outcome rows reproduce #550's `## Desired outcome` bullets
verbatim in scope: never dispatch, interactive unchanged, and healthy-path cost unchanged.

Stories 3, 4, 5, and 6 have no outcome row because they derive from the operator's 2026-08-01
clarification comment on #550 rather than from the issue's original Desired-outcome section. They
remain fully covered at the story→task layer. No ambiguous or transitively-uncovered row remains.
