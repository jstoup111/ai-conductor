# Implementation Plan: Documentation-Only Delivery (#933)

**Date:** 2026-07-25  
**Design:** Technical track; no PRD  
**Stories:** `.docs/stories/tdd-is-too-literal-933.md`  
**Conflict check:** Skipped — Small tier

## Summary

Add a validated terminal result that lets exploration deliver documentation directly and stop
both conductor paths before artifact authoring, update shared authoring/testing policy, and remove
ai-conductor tests that assert documentation prose or structure. The plan contains 8 cohesive
tasks.

## Technical Approach

- Keep the existing `product | technical` track model. Documentation-only delivery is a terminal
  result from exploration, not a third long-lived track.
- Define one `.pipeline/documentation-delivery.json` contract containing the delivered branch,
  pull-request URL, and source reference. A shared reader validates its shape and verifies through
  GitHub that the pull request body carries the matching closing reference.
- Consume that result immediately after exploration in both orchestration paths:
  `Conductor.run()` and engineer `runAuthoring()`/`processIdea()`. A verified result marks the work
  complete and skips complexity plus every downstream artifact/build step. Missing results retain
  the existing flow; malformed or unverifiable results fail closed.
- Let `/explore` prefer a project-local documentation skill exposed to the host. When none exists,
  it may edit an unambiguous documentation request inline. The delivery agent owns branch, commit,
  push, PR, closing reference, and terminal-result emission.
- Treat the shared skill files as machine-consumed behavior. Update their policy directly without
  adding prose-content tests; executable routing is covered at the engine seams.
- Remove existing tests that constrain documentation wording, headings, layout, or placement.
  Preserve tests of actual behavior, including generated `HARNESS.md` content, release semantics
  driven by `CHANGELOG.md`, and runtime behavior derived from machine-consumed documents.

## Prerequisites

- Accepted technical stories at `.docs/stories/tdd-is-too-literal-933.md`.
- Existing injected GitHub runners remain the verification boundary; no new dependency is added.

## Tasks

### Task 1: Define and verify documentation delivery
**Story:** Stories 1–3  
**Type:** happy-path + negative-path

**Steps:**
1. Write failing unit cases for a valid versioned result and for malformed JSON, missing fields,
   invalid/stale values, branch mismatch, and a PR body without the matching
   `Closes <source_ref>`.
2. Verify RED.
3. Add the typed, project-root-anchored result reader and verify the PR URL, branch, and closing
   reference through the injected GitHub runner.
4. Verify valid delivery passes and every invalid form fails closed; commit.

**Files:** `src/conductor/src/engine/documentation-delivery.ts`, `src/conductor/test/engine/documentation-delivery.test.ts`  
**Wired-into:** `src/conductor/src/engine/conductor.ts#run`, `src/conductor/src/engine/engineer/authoring.ts#runAuthoring`  
**Dependencies:** none

### Task 2: Terminate conductor after documentation delivery
**Story:** Story 1; Story 3 interactive and auto behavior  
**Type:** happy-path + negative-path

**Steps:**
1. Add failing conductor cases for verified delivery, daemon delivery, failed PR verification, and
   no delivery result.
2. Verify RED.
3. After explore, persist the verified PR and completed feature state, emit normal completion, and
   write daemon `DONE` when applicable without dispatching later steps.
4. Fail closed on an invalid result; preserve the existing product/technical flow when no result
   exists.
5. Verify GREEN and commit.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor.test.ts`  
**Wired-into:** `src/conductor/src/index.ts#runConductor`  
**Dependencies:** Task 1

### Task 3: Terminate engineer auto mode after documentation delivery
**Story:** Stories 1–3  
**Type:** happy-path + negative-path

**Steps:**
1. Add failing authoring/loop cases for verified delivery, invalid delivery, and mixed work with no
   delivery result.
2. Verify RED.
3. Add a discriminated delivered result from `runAuthoring()` immediately after explore, before
   complexity or artifact creation.
4. Teach `processIdea()` to record/report the direct PR and skip spec handoff plus daemon startup.
5. Preserve the full existing authoring flow when no result exists; verify GREEN and commit.

**Files:** `src/conductor/src/engine/engineer/authoring.ts`, `src/conductor/src/engine/engineer/loop.ts`, `src/conductor/test/engine/engineer/authoring.test.ts`, `src/conductor/test/engine/engineer/loop.test.ts`  
**Wired-into:** `src/conductor/src/engine/engineer/loop.ts#processIdea`, `src/conductor/src/engine/engineer/loop.ts#runEngineerMode`  
**Dependencies:** Task 1

### Task 4: Teach explore to deliver documentation inline or by project skill
**Story:** Stories 1–3  
**Type:** infrastructure

**Steps:**
1. Classify only purely human-facing documentation for terminal delivery; mixed functional work
   remains on the normal track.
2. Prefer a project-local documentation skill exposed by the host, with inline editing only when
   no skill exists and the request is unambiguous.
3. Require isolated branch, commit, push, PR with `Closes <source-ref>`, and terminal-result
   emission.
4. Fail closed after missing/invalid/partial delegated delivery; run skill integrity checks and
   commit without adding prose-content tests.

**Files:** `skills/explore/SKILL.md`  
**Wired-into:** `src/conductor/src/engine/step-runners.ts#SKILL_COMMANDS`, `src/conductor/src/engine/engineer/authoring.ts#runAuthoring`  
**Dependencies:** Tasks 2, 3

### Task 5: Apply the shared no-documentation-obligation policy
**Story:** Story 4  
**Type:** infrastructure

**Steps:**
1. Make stories omit documentation requirements, acceptance criteria, Done-When items, and notes;
   route documentation-only intent back to explore.
2. Make plans omit documentation tasks, subtasks, requirements, and notes, including documentation
   implied by functional work.
3. Make TDD bypass RED/GREEN for ordinary prose and prohibit tests of wording, headings, formatting,
   placement, or explanations.
4. Preserve behavior tests for machine-consumed inputs such as OpenAPI and generated `HARNESS.md`
   surfaces; run skill integrity checks and commit without prose-content tests.

**Files:** `skills/stories/SKILL.md`, `skills/plan/SKILL.md`, `skills/tdd/SKILL.md`  
**Wired-into:** `src/conductor/src/engine/step-runners.ts#SKILL_COMMANDS`  
**Dependencies:** Task 4

### Task 6: Remove standalone prose-only tests
**Story:** Story 5 prose-only cleanup  
**Type:** refactor

**Steps:**
1. Delete tests whose sole assertions constrain README/docs existence, headings, wording, layout,
   relocation, indexes, links, or content preservation.
2. Remove their suite registration references.
3. Run the remaining shell integrity suite and commit.

**Files:** `test/check_task1_choosing_conductor.sh`, `test/check_task2_getting_started.sh`, `test/check_task9_documentation_index.sh`, `test/readme-shape-check.sh`, `test/test_readme_frontdoor.sh`, `test/docs-content-preservation-check.sh`, `test/docs-link-check.sh`, `test/test_harness_integrity.sh`  
**Wired-into:** `none (no new production surface)`  
**Dependencies:** Task 5

### Task 7: Remove prose assertions while preserving executable coverage
**Story:** Story 5 cleanup and false-positive negative path  
**Type:** refactor

**Steps:**
1. Remove examples README assertions while preserving executable usage, invalid-tier, sandbox,
   timeout, and flow checks.
2. Remove README/HARNESS/conductor-README wording assertions from mixed update and provider-routing
   suites.
3. Retain CHANGELOG assertions only for release/migration behavior and generated HARNESS checks
   only for actual generation drift.
4. Leave fixture-only documentation references intact; run affected shell/Vitest suites and commit.

**Files:** `test/test_examples_readme_and_usage.sh`, `test/run_examples_acceptance_specs.sh`, `test/test_bin_update.sh`, `src/conductor/test/integration/provider-model-policy-wiring.integration.test.ts`, `src/conductor/test/model-table-metadata.test.ts`, `src/conductor/test/generate-model-table.test.ts`, `src/conductor/test/acceptance/generate-model-table.acceptance.test.ts`, `test/test_harness_integrity.sh`  
**Wired-into:** `none (no new production surface)`  
**Dependencies:** Task 6

### Task 8: Verify routing, cleanup, and retained functional coverage
**Story:** All stories  
**Type:** infrastructure  
**Verify-only:** yes

**Steps:**
1. Run focused documentation-delivery, conductor, authoring, and engineer-loop tests.
2. Run remaining shell integrity/examples/update tests.
3. Run typecheck and the full conductor Vitest suite.
4. Audit remaining documentation-path references and confirm each is fixture-only or asserts
   machine/runtime behavior; record unrelated findings separately.
5. Emit verification evidence and commit only if a corrective code/test change is required.

**Files:** `src/conductor/test/`, `test/`  
**Wired-into:** `none (no new production surface)`  
**Dependencies:** Tasks 2, 3, 5, 7

## Task Dependency Graph

```text
       ┌→ 2 ─┐
1 ─────┤     ├→ 4 → 5 → 6 → 7 ─┐
       └→ 3 ─┘                   ├→ 8
                2 + 3 + 5 ───────┘
```

## Integration Points

- After Task 2: inline and daemon conductor can terminate after verified documentation delivery.
- After Task 3: engineer auto mode can deliver a documentation PR without spec artifacts or a
  daemon build.
- After Task 5: shared skills consistently omit documentation obligations and prose tests.
- After Task 8: obsolete prose assertions are removed while behavior-driven document coverage
  remains green.

## Acceptance-Criterion Coverage

| Story criterion | Tasks |
|---|---|
| Documentation-only work delivers without SDLC artifacts | 2, 3, 4 |
| Mixed functional/documentation work stays on normal flow | 2, 3, 4 |
| Project documentation skill is preferred | 4 |
| Inline fallback handles unambiguous work | 4 |
| Missing/failed delivery cannot succeed | 1, 2, 3, 4 |
| Isolated branch, PR, and closing issue reference | 1, 4 |
| Merge-linked closure; no premature closure | 1, 3, 4 |
| Auto mode stops after delivery | 2, 3 |
| Stories and plans omit documentation obligations | 5 |
| No prose/structure tests | 5, 6, 7 |
| Machine-consumed behavior remains testable | 5, 7, 8 |
| Prose-only assertions are identified and removed | 6, 7, 8 |
| Functional/fixture references are preserved | 7, 8 |

## Verification

- [x] Every happy and negative path maps to at least one task.
- [x] Dependencies are explicit and acyclic.
- [x] Every new production surface declares its call site.
- [x] Task count is consolidated to 8 cohesive deliverables.
- [x] Project-specific documentation work and the cleanup runbook are omitted from plan tasks.
