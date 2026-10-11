# Conflict Check: Plan task structure becomes one strict compiled contract (#623)

**Date:** 2026-10-10
**Inventory:** all 575 story files, screened by keyword for task-heading grammar, task ids, slices,
Done when, task count, the protected-artifact seal, remediation append, digests and reopen,
discovery vetting, land gates, coherence and prd_audit task citations, attribution, the growth
cap, and plan-skill contract tests. About 20 candidate files were read in full.
**ADR corpus:** `repo_wide` (per `.ai-conductor/config.yml`). 358 APPROVED ADRs were examined.
29 were narrowed in (plan slices, story ownership, stacked child plans, per-child build region,
reference resolver, task-trailer alias, reopened-task resolution, Done-when review binding and
evidence, criterion layer at land, plan-scope containment, task stamping, the seal ADRs, DECIDE
amendment, prd_audit authority, as-built remediation, coverage binding, engine-owned task status,
the coherence parser at discovery, discovery preseed and ADR-conformance preconditions, halt
classification and resolution, reseal audit, no-diff evidence). The rest were narrowed out as
off-subject. None was excluded as superseded: the three that carry SUPERSEDED text are partial and
were retained.
**Result:** **PASS. Zero blocking conflicts remain.** Eleven degrading conflicts were found, all
from one root: existing stories and ADRs that do not distinguish marked from unmarked plans. The
operator accepted every resolution on 2026-10-10. Delegated adversarial scans did the reading; an adversarial re-check after the edits found two more internal contradictions, both fixed (see Resolved gaps).

## Story-versus-story conflicts

### Conflict: Presence-only dependency check versus required Dependencies declarations
**Stories involved:** "plans-cannot-declare-ordered-slices" Story 2 vs new Stories 4 and 6
**Type:** contradiction. **Severity:** degrading.
**Existing (verbatim):** "Given a plan with no `## Slices` section but a `## Task Dependency Graph` section and no per-task Dependencies lines, when land runs, then no slice refusal is raised and the existing presence-only dependency check still accepts the plan"
**New (verbatim):** "Given a marked plan with an authored task […] that lacks a Files, Story, Dependencies, or Done-when declaration, when it is compiled, then compilation fails"
**Resolution:** the existing criterion is scoped to unmarked plans.

### Conflict: Tasks with no Story line versus required Story declarations
**Stories involved:** "sliced-plans-can-be-landed" Story 1 and "bind-story-n-task-references" (orphan check) vs new Story 4
**Type:** contradiction and sequencing. **Severity:** degrading.
**Existing (verbatim):** "Given an eligible baseline in which a task with no `**Story:**` line, and a task whose Story line is `n/a`, sit in slice 2 […] then the spec commits"
**New (verbatim):** as above (required Story declaration).
**Resolution:** both existing criteria are scoped to unmarked plans. For marked plans the
plan-compile gate reports the missing Story line first.

### Conflict: `plan-slices` gate id versus one plan-compile gate
**Stories involved:** "plans-cannot-declare-ordered-slices" Story 4 and "sliced-plans-can-be-landed" Story 3 vs new Story 5
**Type:** contradiction. **Severity:** degrading.
**Existing (verbatim):** "Given a sliced plan whose Task 6 appears in no slice, when land runs, then land refuses with the `plan-slices` refusal"
**New (verbatim):** "Given a spec whose marked plan has compile errors, including a malformed Done-when tag or a slice violation, when the spec is landed, then land refuses it under one plan-compile gate id"
**Resolution:** the existing criteria and the Done When line are scoped to unmarked plans.

### Conflict: `no-dependency-tree` versus `plan-compile-failed` at discovery
**Stories involved:** "annotated-stories-line-makes-a-merged-spec-silentl" vs new Story 6
**Type:** contradiction. **Severity:** degrading.
**Existing (verbatim):** "Given a merged spec whose plan carries no dependency tree, when a discovery pass runs, then the blocked list contains that slug with reason `no-dependency-tree`"
**Resolution:** the existing criterion is scoped to unmarked plans. New Story 6 states that
`plan-compile-failed` takes precedence for marked plans.

## ADR-versus-story conflicts

### Conflict: Slice grammar ownership and its discovery scope
**ADR filename stem:** adr-2026-09-29-plan-slice-manifest
**Story ID:** Stories 2, 4, 6
**ADR opposing sentence (verbatim):** "It reads task ids from `TASK_HEADER_PATTERN` headings and never re-derives task-id validity. […] Daemon discovery and `planHasDependencyTree` stay presence-only and unchanged."
**Story opposing sentence (verbatim):** "Given a merged spec whose marked plan has compile errors, including a task with no dependency declaration, when discovery vets it, then it is not dispatched"
**Type:** contradiction. **Severity:** degrading.
**Resolution:** additive amendment beside D2 (the compiler owns parsing; presence-only for unmarked plans only).

### Conflict: `plan-slices` land gate id
**ADR filename stem:** adr-2026-09-29-plan-slice-manifest
**Story ID:** Story 5
**ADR opposing sentence (verbatim):** "Any `invalid` result throws `landGateError('plan-slices', …)`, a new `LandGateIdentifier` member."
**Story opposing sentence (verbatim):** "[…] then land refuses it under one plan-compile gate id"
**Type:** contradiction. **Severity:** degrading.
**Resolution:** additive amendment beside D5 (marked plans report under `plan-compile`).

### Conflict: Remediation exemption by id prefix
**ADR filename stem:** adr-2026-09-29-plan-slice-manifest
**Story ID:** Story 4 and the Terms section
**ADR opposing sentence (verbatim):** "Engine-appended remediation tasks (`isEngineAppendedRemediationTaskId`) are exempt"
**Story opposing sentence (verbatim):** "Every other task is an **authored task**, whatever its id looks like."
**Type:** state-conflict. **Severity:** degrading.
**Resolution:** additive amendment beside D3 (marked plans classify by the engine's record).

### Conflict: Strict Dependencies grammar scope
**ADR filename stem:** adr-2026-09-29-plan-slice-manifest
**Story ID:** Story 4
**ADR opposing sentence (verbatim):** "Unsliced plans keep today's presence-only check, so the 229 existing free-form lines are unaffected."
**Story opposing sentence (verbatim):** "Given a marked plan whose Dependencies line is a range (`Tasks 1-3`) or prose (`all prior tasks`), when it is compiled, then compilation fails naming the task and listing the accepted forms."
**Type:** overlap. **Severity:** degrading.
**Resolution:** additive amendment beside D4 (marked plans apply the D4 grammar to every authored task, acyclic).

### Conflict: Done-when rung scope and gate id
**ADR filename stem:** adr-2026-08-21-review-bound-by-plan-done-when-criteria
**Story ID:** Stories 4, 5, 6
**ADR opposing sentence (verbatim):** "It is **not** added to daemon discovery or the conductor plan gate: 300 of 301 merged plans lack the block and must keep building."
**Story opposing sentence (verbatim):** "Given a merged spec whose marked plan has compile errors […] then it is not dispatched and daemon status shows a blocked entry with reason `plan-compile-failed`"
**Type:** contradiction. **Severity:** degrading.
**Resolution:** additive amendment beside D1 (unchanged for unmarked plans; compile errors for marked plans).

### Conflict: Story-line grammar owner
**ADR filename stem:** adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility
**Story ID:** Story 2
**ADR opposing sentence (verbatim):** "`plan-task-parse.ts` stays the Story-line grammar owner and gains the normalizing reader."
**Story opposing sentence (verbatim):** "Given an engine source file outside the compiler module containing a regular expression for a per-task field token (`**Files:**`, […] `**Story:**` […]), when the single-owner audit runs, then it fails naming that file and line."
**Type:** contradiction. **Severity:** degrading.
**Resolution:** additive amendment beside decision 2 (the compiler owns the Story-line grammar).

### Conflict: Resume after a fixed plan versus reopen on a changed digest
**ADR filename stem:** adr-2026-09-06-reopened-task-resolution
**Story ID:** Story 7
**ADR opposing sentence (verbatim):** "When a recorded digest differs from the current one, seeding admits an obligation with source authority `plan_amendment`"
**Story opposing sentence (verbatim, before the fix):** "Given a halted build whose plan has been fixed, when the halt is cleared and the build re-dispatched, then it resumes from its recorded task progress."
**Type:** state-conflict. **Severity:** degrading.
**Resolution:** Story 7 reworded: it resumes, except that a task whose text changed is reopened under the existing rule.

## Resolved gaps (no conflict after the fix)

- **Scope containment** (adr-2026-08-02-plan-scope-containment-at-commit-boundary): "Only an explicit `**Files:**` line is a declaration." is kept for both modes. Today's declaration-line grammar already includes `**Files**:` and `**Files likely touched:**` (`plan-task-parse.ts` `FILES_LINE`); only prose-harvested paths are excluded. Story 4 asserts exactly that, and the new ADR's D5 records whether each task's paths came from a declaration line.
- **The compiler and the shared resolver** (adr-2026-08-30-shared-plan-task-reference-resolver): new ADR D3 requires references to resolve through `resolvePlanTaskReference`.
- **Story 9 versus appended ids:** the engine's appended-id record is applied by the plan check to the compiled plan, which then enforces authored-task required fields and reports violations as plan-compile errors (new ADR D5, Terms). Found by the re-check.
- **Story 5 internal precedence:** the coherence-citation criterion now applies to a marked plan that compiles cleanly and cites an undeclared id, so it does not compete with the compile-first rule. Found by the re-check.
- **Precedence:** compile errors first, then the task-count stop, then coherence (new ADR D6, Story 5); a marked plan with zero tasks is a compile error (Story 4); free-form infrastructure Story labels are accepted (Story 4).

## Near-misses the plan must respect

- `auto-park-empty-missing-plan-check-false-positives.md` Story 1 relies on `### Task N — Title`, `### Task 1-3`, `### Task 1, 2` and bare `### Task N` parsing unchanged. This is covered for unmarked plans by new Story 1's goldens.
- `tasks-close-with-boilerplate-done-when-evidence-mi.md` Story 1 refuses malformed `[test]` tags at land without naming a gate id. For marked plans the refusal arrives under `plan-compile`, still naming the task and check.
- Fixtures in `sliced-plans-can-be-landed-whose-stories-span-chil.md` use `T2`/`T3`/`T5` ids. They are unmarked fixtures and stay legacy.
- Stacked child plans (adr-2026-10-03-stacked-child-plans-identity-and-state) forbid changing slice positions once child state exists. Stripping the marker cannot change slice membership, because the golden equivalence covers slices. Stacked delivery is not used for this feature.
