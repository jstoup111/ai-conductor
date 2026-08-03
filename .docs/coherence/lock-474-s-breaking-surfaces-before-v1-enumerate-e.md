# Coherence Check: v1 interface lock for parallel task-stream dispatch (#552)

**Date:** 2026-08-02
**Tier:** L
**Track:** technical
**Plan:** `.docs/plans/lock-474-s-breaking-surfaces-before-v1-enumerate-e.md`
**ADR:** `adr-2026-08-02-v1-parallel-dispatch-surface-lock` (APPROVED)

This is a technical-track specification with no PRD, so FR rows are not required. The staged
intake marker contains no enumerated desired-outcome bullets, so outcome rows are not
required either; #552's three desired outcomes are traced in prose under
[Outcome tracing](#outcome-tracing) below.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-1 | task-1 | covered | Task 1 pins the stamp's exact format, the unique-or-absent contract, the abstain path, and the reserved lanes directory. |
| story | story-2 | task-2 | covered | Task 2 implements the charset validation, its rejection messages, its inertness for configs without a parallel block, and the CHANGELOG escalation entry. |
| story | story-3 | task-3 | covered | Task 3 proves unknown row fields survive a seed round-trip and that a wrong-shaped file still fails. |
| story | story-4 | task-4 | covered | Task 4 adds the plural field, corrects the scalar to unique-or-absent, holds the single-task case byte-identical, and surfaces the plural to the operator. |
| story | story-5 | task-5 | covered | Task 5 serializes the counter mutations, preserves the corrupt-file path, and records the build-scoped pin. |
| story | story-6 | task-6 | covered | Task 6 freezes the dispatch-count line grammar by test, proves no widened line is produced, and reserves the correlation sidecar. |
| story | story-7 | task-7 | covered | Task 7 pins the marker format and the union-of-prefixes rule, and proves the shipped docs-guard hook needs no change. |
| story | story-8 | task-8 | covered | Task 8 implements the dependency-value parser with the sequential fail-safe, the non-blocking lint, and unchanged plan eligibility. |
| story | story-9 | task-9 | covered | Task 9 implements the veto predicate with the empty-set rule and leaves the existing path parser and its four consumers unchanged. |
| story | story-10 | task-10 | covered | Task 10 reserves the successor config key with type validation and no consumer, and pins the existing key's name, default, and resolver. |
| story | story-11 | task-11 | covered | Task 11 pins every verb, exit code, mismatch behavior, and the id charset, and reconciles the CLI reference. |
| task | task-1 | story-1 | covered | Cites Story 1; implements its happy path and both negative paths. |
| task | task-2 | story-2 | covered | Cites Story 2; implements its happy path and all three negative paths. |
| task | task-3 | story-3 | covered | Cites Story 3; implements its round-trip and wrong-shape criteria. |
| task | task-4 | story-4 | covered | Cites Story 4; implements the zero-, one-, and two-row cases plus the operator-visibility criterion added by conflict-check. |
| task | task-5 | story-5 | covered | Cites Story 5; implements the concurrent-increment and corrupt-file criteria. |
| task | task-6 | story-6 | covered | Cites Story 6; implements the grammar freeze, the reserved path, and the unparseable-payload case. |
| task | task-7 | story-7 | covered | Cites Story 7; implements the format, union, block, and absent-marker criteria. |
| task | task-8 | story-8 | covered | Cites Story 8; implements all six grammar cases plus the no-parse-error and unchanged-eligibility criteria. |
| task | task-9 | story-9 | covered | Cites Story 9; implements the disjoint, shared, empty-set, and all-undeclared cases. |
| task | task-10 | story-10 | covered | Cites Story 10; implements the reservation, the type error, and the unchanged-defaults criteria. |
| task | task-11 | story-11 | covered | Cites Story 11; implements every pinned verb and error path. |

## Outcome tracing

#552's three desired outcomes, each mapped to the artifacts that satisfy it:

1. **A merged spec with APPROVED ADRs enumerating every consumer-visible surface and pinning
   a v1-compatible shape for each** → the ADR's 14-row surface table, Stories 1–11, and
   Tasks 1–11. Every pin needing v1 enforcement has a story and a task; the surfaces needing
   none are recorded as explicit no-code decisions in the ADR.
2. **The issue closes when the spec PR merges, not when #474 ships** → the plan's scope
   statement and the ADR's consequences. No task dispatches concurrently, detects streams, or
   vetoes overlap, so #474 stays open and stays blocked by #531.
3. **Negative path: a surface that cannot be made forward-compatible ships breaking in v1,
   escalated before the cutover** → the ADR's Escalation section, Story 2, and Task 2.
   Exactly one surface qualifies — the parallel-branch name charset — and it carries the
   required CHANGELOG entry.

## Surface-to-story tracing

The ADR's surface table, not the story list, is this feature's primary deliverable, so each
pinned surface is traced here. A surface with neither enforcement nor an explicit no-code
finding would be an unpinned pin.

- **S1** (current-task format) and **S2** (reserved lanes path) → Story 1 → Task 1
- **S3** (branch-name charset — the one breaking-in-v1 item) → Story 2 → Task 2
- **S4** (task-status field tolerance) → Story 3 → Task 3
- **S5** (telemetry plural plus the scalar's corrected meaning) → Story 4 → Task 4
- **S6** (evidence counters build-scoped and single-writer) → Story 5 → Task 5
- **S7** (dispatch-count grammar) and **S8** (reserved correlation sidecar) → Story 6 → Task 6
- **S9** (phase-active worktree-global) → Story 7 → Task 7
- **S10** (dependency grammar with fail-safe) → Story 8 → Task 8
- **S11** (undeclared file set vetoes parallelism) → Story 9 → Task 9
- **S12** (validation_concurrency frozen) and **S13** (build_concurrency reserved) → Story 10 → Task 10
- **S14** (task CLI contract) → Story 11 → Task 11

## Deliberate non-coverage

The ADR's "Engine-internal, explicitly NOT pinned" section names six contention points — the
shared step-runner counters, the auto-finish environment variable, the single-slot full-suite
carriers, the step-heartbeat record, and the group join's literal policy chains. These have no
story and no task **by decision**, not by omission: they are invisible to consumers, so #474
may change them freely post-v1. Recording them in the ADR is what makes their absence here
auditable rather than a gap.

## Verdict

All required rows are covered. Every cited outcome, story, and task id exists in its source
artifact; every ADR surface resolves either to a task or to an explicit no-v1-code decision;
and no ambiguous or load-bearing traceability assumption remains.
