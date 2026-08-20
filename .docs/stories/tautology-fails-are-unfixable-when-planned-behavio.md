**Status:** Accepted

# Stories: Verify-Only-Anchored Tautology Exception (#1579)

Technical track — acceptance criteria derive from
`adr-2026-08-15-verify-only-anchored-tautology-exemption.md` (D1–D5) and the four intake outcomes
of jstoup111/ai-conductor#1579.

## Story 1: Engine derives verify-only task evidence from the plan

**Requirement:** ADR D1 (outcome-4)

As the build_review input assembler, I want a deterministic `verifyOnlyContext` derived from the
plan body so that the grader's exemption decision is auditable from engine-recorded evidence.

### Acceptance Criteria

#### Happy Path
- Given a plan whose Task 3 block carries `**Verify-only:** yes` and declares `` `src/a.ts` `` and
  `` `test/a.test.ts` ``, when build_review inputs are assembled, then `verifyOnlyContext` contains
  exactly one entry `{ taskId: "3", paths: ["src/a.ts", "test/a.test.ts"] }`.
- Given a plan whose Task 5 block carries `**Type:** implementation+verification`, when inputs are
  assembled, then Task 5 appears in `verifyOnlyContext` (union semantics with the Verify-only
  marker).
- Given any assembled inputs, when the source snapshot is built, then `verifyOnlyContext` is part
  of the frozen snapshot and its digest (same treatment as `removalContext`).

#### Negative Paths
- Given a plan with no verify-only or verification markers, when inputs are assembled, then
  `verifyOnlyContext` is empty — no task is ever inferred.
- Given a Task block with `**Verify-only:** maybe` or an empty marker value, when inputs are
  assembled, then that task is NOT in `verifyOnlyContext` (fail-closed, exact-match "yes" only).
- Given a plan body that matches no task headers at all, when inputs are assembled, then
  `verifyOnlyContext` is empty and input assembly does not throw.

### Done When
- [ ] `BuildReviewInputs` exposes `verifyOnlyContext` entries of task id + plan-declared paths,
      derived via the existing `parsePlanTaskVerifyOnly`/`parsePlanTaskPaths` parsers
- [ ] `sourceSnapshot` (and its digest) includes `verifyOnlyContext`; unit test proves two
      assemblies differing only in a verify-only marker produce different digests
- [ ] Unit tests cover the marker-absent, `maybe`-value, and headerless-plan negatives

## Story 2: The grader prompt renders the verify-only evidence block and the fourth closed exception

**Requirement:** ADR D2, D3 (outcome-1, outcome-4)

As the grader prompt assembler, I want the verify-only evidence rendered as a closed-list
exception so that a changed test documenting plan-requested pre-existing behavior can pass
Tautology.

### Acceptance Criteria

#### Happy Path
- Given inputs with a non-empty `verifyOnlyContext`, when the grader prompt is assembled, then it
  contains an "Engine-parsed verify-only tasks" evidence section listing each task id with its
  declared paths, framed as evidence, not an exemption.
- Given the assembled prompt, when the closed exception list is rendered, then it enumerates four
  exceptions and states the three-condition per-test verify-only-maintenance predicate (engine
  block lists the task; the changed test's lines reference that task's declared files or verified
  behavior; no new assertion about diff-introduced behavior), evaluated per changed test.

#### Negative Paths
- Given inputs with an empty `verifyOnlyContext`, when the prompt is assembled, then the evidence
  section renders `(none)` and the exception cannot anchor to any task.
- Given a `verifyOnlyContext` path containing a backtick, when the prompt is assembled, then the
  value is escaped with the existing `escapeEvidence` treatment (no prompt-injection via plan
  content).
- Given the rendered prompt, when the exception list is read, then it still states that a changed
  test qualifying under none of the four exceptions is measured normally — the closed-list
  sentence survives the edit.

### Done When
- [ ] `buildGraderPrompt` renders the fifth evidence block (`(none)` when empty) and the fourth
      exception with its three-condition per-test predicate
- [ ] Existing prompt unit tests still pass; new tests assert block rendering, escaping, and the
      preserved closed-list sentence
- [ ] The reviewer-output JSON schema line is unchanged (no new verdict fields)

## Story 3: Completeness reads the same verify-only evidence

**Requirement:** ADR D4 (outcome-1)

As the build_review grader, I want plan-marked verify-only tasks to contribute no required
implementation diff so that a declared verify-only task cannot fail Completeness for having no
code.

### Acceptance Criteria

#### Happy Path
- Given the assembled prompt, when the Completeness rubric guidance is read, then it states that a
  task listed in the engine-parsed verify-only block legitimately contributes no implementation
  diff and its absence from the diff is not a Completeness gap.

#### Negative Paths
- Given the assembled prompt, when the Completeness guidance is read, then holistic judgement and
  the prohibition on per-task SHA/reachability chasing remain stated verbatim — the new line
  narrows nothing else.
- Given a plan task NOT in the verify-only block whose work is absent from the diff, when the
  rubric is applied as written, then the guidance provides it no shelter (the line names only
  engine-block-listed tasks).

### Done When
- [ ] The Completeness section of `buildGraderPrompt` carries the verify-only line, scoped to
      engine-block-listed tasks only
- [ ] Prompt unit test asserts both the new line and the preserved holistic/no-per-task-chasing
      language

## Story 4: tdd and writing-system-tests gain the "no legitimate RED" boundary

**Requirement:** ADR D5 (outcome-2, outcome-3)

As a BUILD maker session, I want a sanctioned path when a task's requested behavior already
exists so that I never invent unrelated assertions and the same Tautology finding cannot recur on
my next lap.

### Acceptance Criteria

#### Happy Path
- Given `skills/tdd/SKILL.md`, when the boundary section is read, then it instructs the declared
  case (plan-marked verify-only/verification task: author at most the documenting test the plan
  asks for) and the discovered case (behavior already exists, plan unmarked: do not author a test
  that cannot fail; delete any redundant test authored this lap; close the task with the existing
  skipped mechanism — an empty commit carrying `Task: <id>` and `Evidence: skipped <reason>`
  trailers, from which the engine derives `status: 'skipped'` (#677)).
- Given `skills/writing-system-tests/SKILL.md`, when the boundary is read, then the same rule
  governs acceptance-spec generation (no spec invented for already-existing behavior outside a
  plan-marked task).

#### Negative Paths
- Given a task that adds, changes, or fixes behavior, when the boundary is read, then it
  explicitly does NOT apply — the failing-test-first cycle remains mandatory for behavioral
  change.
- Given the discovered case, when the instructions are followed, then no step amends the sealed
  plan and no step requires an operator act — the path stays inside maker-writable state.
- Given the boundary text, when a maker looks for a "make the test pass pre-diff anyway" option,
  then none exists — inventing unrelated behavioral assertions is named as the forbidden move.

### Done When
- [ ] Both SKILL.md files carry the boundary with the declared/discovered split and the explicit
      non-applicability to behavioral change
- [ ] `test/test_harness_integrity.sh` passes (frontmatter, cross-references, model table intact)
- [ ] The boundary text names the `Evidence: skipped` empty-commit closure (#677) as the
      discovered-case exit and forbids plan amendment

## Story 5: /plan marks verification-shaped tasks at DECIDE time

**Requirement:** ADR D5 (outcome-1, outcome-3)

As a DECIDE planner, I want tasks that verify or document possibly-pre-existing behavior marked
verify-only in the plan so that the grader's exception can anchor to them on the first lap.

### Acceptance Criteria

#### Happy Path
- Given `skills/plan/SKILL.md`, when the task-authoring guidance is read, then it instructs
  marking a task that verifies or documents possibly-pre-existing behavior with
  `**Verify-only:** yes` (or `**Type:** verification`), citing that the marker is review-load-bearing.

#### Negative Paths
- Given the guidance, when a task delivers new or changed behavior, then it is explicitly NOT
  marked — over-marking is named as widening the exemption and forbidden.

### Done When
- [ ] `skills/plan/SKILL.md` carries the strengthened marker guidance including the
      over-marking prohibition
- [ ] `test/test_harness_integrity.sh` passes
