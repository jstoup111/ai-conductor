# Conflict Check: Task dependency gate is a presence check; unorderable plans pass it (#1393)

**Date:** 2026-11-05
**Stories checked:** `.docs/stories/task-dependency-gate-is-a-presence-check-unorderab.md` (Stories 1–5) against all 671 files in `.docs/stories/`, narrowed to the 13 that assert plan dependency, dependency-tree, or `## Task Dependency Graph` behavior.
**Result:** PASS. 1 blocking conflict found and resolved; 0 degrading conflicts.

## ADRs

- **Examined:** `adr-2026-09-29-plan-slice-manifest` (decisions 2 and 4 amended by this spec during architecture review); `adr-2026-10-10-source-grounded-adversarial-plan-review-step` (plan review consumes `parsePlanDependencyGraph`; this spec leaves that consumer unchanged); `adr-2026-07-12-wired-into-contract` (mentions plan dependency sections only as authoring structure; no conflict); `adr-2026-08-30-shared-plan-task-reference-resolver` (D1: ids resolve through the shared resolver, which the stories respect).
- **Narrowed out:** every other ADR. None governs plan dependency grammar, the land dependency rung, the `plan` gate's dependency predicate, or backlog dependency eligibility.

## Conflict: Land acceptance of free-form and section-only unsliced plans

**Stories involved:** #2723 Story 2 vs #1393 Stories 1 and 2
**Files:** [.docs/stories/plans-cannot-declare-ordered-slices-of-one-feature.md] vs [.docs/stories/task-dependency-gate-is-a-presence-check-unorderab.md]
**Type:** contradiction
**Severity:** blocking

**Description:** #2723 Story 2 said that land commits an unsliced plan carrying free-form Dependencies prose ("Tasks 1–9 all passing"), and that the presence-only check accepts a plan that has only a `## Task Dependency Graph` section. #1393 Stories 1 and 2 reject both at land. The root is the design: `adr-2026-09-29-plan-slice-manifest` decision 4 limited strict parsing to sliced plans, and the architecture review has already amended that decision.

**Resolution Options:**
1. Amend #2723 Story 2 in place so its two criteria and its Done When item assert only their slice intent (no `plan-slices` refusal) and defer dependency acceptance to the dependency rung.
2. Exempt free-form and section-only unsliced plans from the new land rung. This contradicts the confirmed outcome that declaring the section alone no longer suffices.

**Recommendation and resolution:** Option 1, operator-selected 2026-11-05. It is applied in place in commit "spec: amend #2723 slice stories …". BUILD must update `src/conductor/test/engine/engineer/land-spec-plan-slices.test.ts`, which pins the old acceptance.

## Interactions checked, no conflict

- **`no-decide-sweep-covers-task-versus-task-oscillatio` Story 3** requires the plan skill to keep "dependencies are acyclic" and "tasks do not invalidate each other" as separate checklist items. #1393 Story 5 changes only the dependency-line guidance. Each story holds when the other is satisfied, in both directions, so the plan must preserve both items.
- **`annotated-stories-line-makes-a-merged-spec-silentl`**, **`phase-9.3-engineer-redesign`** and **`2026-07-26-daemon-decide-phase-coherence-ownership-971`** require backlog `no-dependency-tree` blocking. #1393 Story 4 keeps it unchanged.
- **`port-test-conduct-worktree-sh-coverage-to-the-ts-s`** pins `planHasDependencyTree` results. The function is unchanged.
- **`source-grounded-plan-defects-pass-every-decide-gat`** requires plan review to use the parser that `validatePlanSlices` uses and requires plan-slices behavior to stay unchanged. #1393 adds a separate rung and does not alter either.
- **`ci-needs-a-daemon-end-to-end-smoke-step-drive-a-1-`** and **`codex-lacks-preventive-hook-parity-protected-artif`** concern heading recognition, not dependency validation.
- **Oscillation sweep:** the #1393 Story 3 merged-plan rule (presence check) and the Story 1/2 strict rule apply to disjoint plan sets (present versus absent at the merge-base). Satisfying either leaves the other true.
