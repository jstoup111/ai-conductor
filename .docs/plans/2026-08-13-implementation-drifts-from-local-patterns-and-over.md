# Implementation Plan: Feature-specific pattern reuse and lowest-sufficient testing

**Date:** 2026-08-13  
**Design:** `.docs/decisions/architecture-review-2026-08-13-implementation-drifts-from-local-patterns-and-over.md`  
**Stories:** `.docs/stories/implementation-drifts-from-local-patterns-and-over.md`  
**Conflict check:** Clean as of 2026-08-13  
**Intake:** jstoup111/ai-conductor#1552

## Summary

Update the existing shared lifecycle skills and BUILD agent prompts so applicable local patterns are
identified during DECIDE, carried to isolated implementers and reviewers, and re-resolved on current
HEAD. At the same time, replace file-count and criterion-count test rules with explicit
lowest-sufficient behavioral coverage. Tasks 1-11 are prose-contract tasks changing no parser,
engine module, artifact type, configuration key, or `build_review` surface; Tasks 12-14 deliver the
engine half of amended architecture condition C1 — the `acceptance_specs` outcome-tag evidence
contract and completion gate ship together with the skill wording.

## Technical Approach

- Add one conditional shared precedence rule: approved architecture is authoritative; otherwise,
  reuse a suitable established feature precedent when one exists and no bounded departure has been
  authorized. A verified no-fit result and an operator-authorized bounded departure are valid paths.
- Reuse the existing architecture-decides/plan-carries lifecycle shape. Architecture review records
  a focused semantic basis; plan repeats the relevant context in each affected task; pipeline sends
  that context to isolated implementation and review roles.
- Keep this context as ordinary Markdown prose. Do not add a header grammar, parser, manifest,
  registry, sidecar, project-conventions configuration, or mandatory global pattern catalog.
- Treat exemplar paths and symbols as current-checkout search hints. BUILD rediscovers the semantic
  equivalent on current HEAD; no line number or authoring-time snapshot is a handoff anchor.
- Assign every happy and negative story criterion one concrete coverage disposition. Use existing
  proof or a lower-layer behavioral test when sufficient; generate an acceptance/system spec only
  for a distinct multi-step externally observable flow that cannot be proven below.
- Preserve the parsed exact-copy `Pattern-source` / `Rename-map` contract. Its declared spec-copy
  path remains governed by `adr-2026-08-09-declared-pattern-replication-in-build` and is not
  reclassified by this feature.
- Add no automated tests whose success condition is natural-language skill or agent wording. These
  tasks introduce no executable seam. Each task uses diff/structure checks; the repository's
  existing validation remains the completion authority.

## Local Pattern Context for This Build

**Role:** Carry a design decision through an existing lifecycle without creating a parallel parsed
channel.

**Semantic traits:**

1. The authoritative decision originates in architecture review.
2. The plan carries focused, task-relevant context to BUILD.
3. Isolated roles receive only the context needed for their task or batch.
4. The consumer resolves hints against its current checkout and blocks only when a missing
   equivalent is load-bearing.
5. Review judges material conformance to recorded traits, not exact copying or reviewer taste.
6. Mechanical contracts stay mechanical; semantic guidance does not overload their grammar.

**Current-HEAD search hints:**

- `skills/architecture-review/SKILL.md` — authority ordering, Architectural Alignment, and Wiring
  Surface conventions.
- `skills/plan/SKILL.md` — Technical Approach, task context, `**Files:**`, and the existing parsed
  `Pattern-source` / `Rename-map` header contract.
- `skills/pipeline/SKILL.md` — Subagent context scoping, Context efficiency, evaluator dispatch,
  and declared replication handling.
- `agents/generator.md` and `agents/evaluator.md` — focused context contracts for isolated roles.
- `skills/writing-system-tests/SKILL.md` — existing coverage dispositions and declared replication
  exception.

**Allowed variation:** Section names and prose placement may follow each file's current structure.
No exact wording is required. Do not change the existing parsed exact-replication grammar.

## Prerequisites

- The architecture review is APPROVED and the conflict report is clean.
- The exact-replication ADR remains APPROVED and unchanged.
- No external service, migration, dependency, project configuration, or new skill is required.

## Tasks

### Task 1: Add the conditional pattern-authority rule to the shared harness contract

**Story:** Story 1 happy paths 1–3 and negative paths 1–3; Story 4 exact-replication amendment  
**Type:** infrastructure  
**Files:** `HARNESS.md`  
**Dependencies:** none  
**Test disposition:** No new automated test; this is provider-neutral natural-language policy.

**Steps:**

1. Read the current authority and design-conformance conventions in `HARNESS.md` on current HEAD.
2. Add a concise conditional rule: approved architecture outranks observed code; otherwise reuse a
   suitable established pattern when one applies, while allowing verified no-fit and
   operator-authorized bounded departures.
3. State that the rule is feature-specific and does not prescribe universal project styles or a
   pattern catalog.
4. Preserve the exact-replication contract as a distinct mechanical case.
5. Run `git diff --check -- HARNESS.md` and commit with message `docs(harness): prefer applicable local patterns`.

### Task 2: Add the lowest-sufficient behavioral coverage rule to the shared harness contract

**Story:** Story 4 happy paths 1–4 and negative paths 1–4  
**Type:** infrastructure  
**Files:** `HARNESS.md`  
**Dependencies:** Task 1  
**Test disposition:** No new automated test; do not add a substring assertion for policy prose.

**Steps:**

1. Add a shared rule that every happy and negative criterion needs a concrete coverage disposition,
   while a criterion does not automatically require a new acceptance/system spec.
2. Reserve acceptance/system coverage for distinct multi-step externally observable flows and
   retain lower-layer negative-path coverage without duplicating every permutation above it.
3. State that production-file count does not determine test-file count and natural-language skill
   wording is not executable behavior.
4. Preserve genuine RED evidence for every generated acceptance spec and the declared exact-copy
   exception.
5. Run `git diff --check -- HARNESS.md` and commit with message `docs(harness): test at lowest sufficient layer`.

### Task 3: Make architecture review record a focused semantic pattern basis

**Story:** Story 1 all criteria; Story 3 happy path 1 and negative path 2  
**Type:** happy-path  
**Files:** `skills/architecture-review/SKILL.md`  
**Dependencies:** Task 1  
**Test disposition:** No new automated test; no machine-readable output or fixed wording is introduced.

**Steps:**

1. Extend the existing authority ordering so applicable approved decisions remain first and
   conflicting code is explicitly rejected as precedent.
2. When a concrete local precedent matters, have design-time review record its role, semantic
   traits, applicability rationale, allowed variation, and path/symbol search hints.
3. Forbid line-number and authoring-time-snapshot anchors; describe hints as rediscovery seeds for
   current HEAD.
4. Record verified no-fit and operator-authorized bounded departures in ordinary review prose, and
   avoid making this subsection mandatory when no precedent affects the approach.
5. Keep exact replication, project convention configuration, and new-ADR criteria unchanged.
6. Run `git diff --check -- skills/architecture-review/SKILL.md` and commit with message
   `docs(architecture-review): record applicable pattern context`.

### Task 4: Carry focused pattern and test context into affected plan tasks

**Story:** Story 1 done conditions; Story 2 happy path 1 and negative path 1; Story 4 happy path 1 and negative path 1  
**Type:** happy-path  
**Files:** `skills/plan/SKILL.md`  
**Dependencies:** Task 3  
**Test disposition:** No new automated test; retain all existing parsed header contracts unchanged.

**Steps:**

1. Teach plan authors to place focused local pattern context in the Technical Approach and repeat
   the task-relevant subset inside every affected task because isolated implementers do not receive
   the full plan.
2. Keep the context semantic and optional: traits, rationale, allowed variation, and search hints;
   no new required header or parser grammar.
3. Forbid line-number/snapshot anchors and require a no-fit or authorized-departure result when that
   changes a task's approach.
4. Update test-task planning so every criterion maps to a concrete lowest-sufficient disposition,
   without turning every criterion or production file into a distinct test.
5. State clearly that `Pattern-source` / `Rename-map` remains the separate exact-copy declaration.
6. Run `git diff --check -- skills/plan/SKILL.md` and commit with message
   `docs(plan): carry semantic pattern and test context`.

### Task 5: Pass current-HEAD pattern context to isolated implementers and evaluators

**Story:** Story 2 happy paths 1–2 and negative paths 1–2; Story 3 happy path 1; Story 4 exact-replication amendment  
**Type:** integration  
**Files:** `skills/pipeline/SKILL.md`  
**Dependencies:** Task 4  
**Test disposition:** No new automated test; dispatch behavior remains a natural-language skill contract.

**Steps:**

1. Add the affected task's focused pattern context to implementer dispatch inputs without sending
   the full plan or unrelated stories.
2. Replace line-range handoff guidance with current-checkout paths, stable symbol/role hints, and
   semantic traits; the receiving agent reads current HEAD to locate the equivalent.
3. Define the stale-basis branch: if a hinted exemplar moved, find the semantic equivalent; if no
   equivalent can be verified and that changes the approach, return `NEEDS_CONTEXT` rather than
   guess, copy obsolete code, or widen scope.
4. Include the same focused basis in evaluator dispatch context so implementation and review use
   one conformance definition.
5. Preserve task marker, scoped verification, fan-out, and declared exact-replication behavior
   verbatim in substance.
6. Run `git diff --check -- skills/pipeline/SKILL.md` and commit with message
   `docs(pipeline): relay current-head pattern context`.

### Task 6: Make generator GREEN conditionally pattern-conforming

**Story:** Story 2 happy paths 2–3 and negative paths 2–3  
**Type:** happy-path  
**Files:** `agents/generator.md`  
**Dependencies:** Task 5  
**Test disposition:** No new automated test; do not assert generator prompt wording.

**Steps:**

1. Add focused local pattern context to the generator's expected GREEN inputs when the task carries
   an applicable basis.
2. Replace “simplest code that passes” with the smallest behavior-complete change conforming to the
   applicable semantic traits.
3. Preserve verified no-fit and operator-authorized bounded departures; do not require conformance
   when no applicable basis exists.
4. Require rediscovery from paths/symbol roles on current HEAD and `NEEDS_CONTEXT` for a
   load-bearing missing equivalent.
5. Keep strict task scope and the prohibition on unrelated extras or unplanned refactors.
6. Run `git diff --check -- agents/generator.md` and commit with message
   `docs(generator): implement against applicable current patterns`.

### Task 7: Align TDD GREEN and test scope with the accepted conditional rule

**Story:** Story 2 happy path 3 and negative path 3; Story 4 happy path 2 and negative paths 3–4  
**Type:** happy-path  
**Files:** `skills/tdd/SKILL.md`  
**Dependencies:** Task 1, Task 2, Task 6  
**Test disposition:** No new automated test; remove no behavioral test and add no skill-text assertion.

**Steps:**

1. Define GREEN as the smallest behavior-complete change conforming to an applicable recorded basis,
   with verified no-fit and authorized departures following their approved approach.
2. Retain no-extras and batch-boundary-refactor constraints so pattern conformance cannot authorize
   opportunistic cleanup.
3. Replace the production-file-to-corresponding-spec rule with behavior/failure-boundary coverage at
   the lowest sufficient layer.
4. Preserve RED-first requirements for new behavior and bug fixes, affected-test execution, domain
   review, and the full delta cycle for declared exact replication.
5. Avoid prescribing specific concrete patterns or project test directory shapes.
6. Run `git diff --check -- skills/tdd/SKILL.md` and commit with message
   `docs(tdd): make green pattern-aware and behavior-tested`.

### Task 8: Make acceptance-spec authoring disposition-driven

**Story:** Story 4 all happy and negative criteria, including its exact-replication amendment  
**Type:** happy-path  
**Files:** `skills/writing-system-tests/SKILL.md`  
**Dependencies:** Task 2, Task 4  
**Test disposition:** No new automated test; preserve executable RED machinery and exact-copy tests unchanged.

**Steps:**

1. Apply a concrete coverage disposition to every happy and negative story criterion on both
   tracks: existing sufficient behavioral test, planned lower-layer behavioral test, or generated
   acceptance/system spec.
2. Generate acceptance/system specs only for distinct multi-step externally observable flows that
   cannot be proven sufficiently below; classify by behavioral scope rather than test-directory
   label.
3. Keep negative permutations below the acceptance layer when that proof is sufficient, while
   blocking any criterion with no existing proof or assigned test.
4. State that ordinary natural-language skill changes and production-file existence do not create
   behavior to test.
5. Preserve the declared `Pattern-source` / `Rename-map` copy path, its fail-closed branches, and
   genuine RED evidence for copied/generated specs.
6. Run `git diff --check -- skills/writing-system-tests/SKILL.md` and commit with message
   `docs(writing-system-tests): choose lowest sufficient coverage`.

### Task 9: Make code review judge material pattern drift and sufficient coverage

**Story:** Story 2 negative path 3; Story 3 all criteria; Story 4 negative paths 1–2  
**Type:** happy-path  
**Files:** `skills/code-review/SKILL.md`  
**Dependencies:** Task 5, Task 8  
**Test disposition:** No new automated test; findings remain judgment output, not parsed policy text.

**Steps:**

1. Add the focused pattern basis, when present, to code-review inputs alongside task criteria and
   affected-test results.
2. In spec compliance, require sufficient behavioral coverage for each criterion rather than one
   corresponding new test per criterion.
3. In code quality, flag concrete material departures from recorded traits and accept allowed or
   immaterial variation.
4. Forbid blocking findings based only on reviewer-preferred abstractions, naming, exact copying,
   or stale line coordinates.
5. Request context when a missing current equivalent makes conformance indeterminate.
6. Run `git diff --check -- skills/code-review/SKILL.md` and commit with message
   `docs(code-review): review material pattern conformance`.

### Task 10: Give the fresh evaluator the same conditional basis

**Story:** Story 3 all criteria; Story 2 negative path 3  
**Type:** happy-path  
**Files:** `agents/evaluator.md`  
**Dependencies:** Task 5  
**Test disposition:** No new automated test; do not test evaluator prose.

**Steps:**

1. Add the batch's focused local pattern basis to evaluator context expectations when one applies.
2. Judge material structure/behavior against recorded traits while accepting allowed and harmless
   variation.
3. Treat a smaller passing but materially non-conforming implementation as incomplete, without
   turning style preferences into findings.
4. Change one-test-per-criterion language to sufficient behavioral coverage and retain mandatory
   happy/negative coverage.
5. Preserve calibrated confidence, impacted-test execution, severity, and fresh-context behavior.
6. Run `git diff --check -- agents/evaluator.md` and commit with message
   `docs(evaluator): use focused pattern and coverage context`.

### Task 11: Keep simplification aligned with the accepted basis and test value

**Story:** Story 3 all criteria; Story 4 negative paths 2–4  
**Type:** happy-path  
**Files:** `skills/simplify/SKILL.md`  
**Dependencies:** Task 5, Task 9, Task 10  
**Test disposition:** No new automated test; retain the existing rejection of wording-only tests.

**Steps:**

1. Have simplification consult an applicable focused pattern basis before recommending extraction,
   inlining, or a competing abstraction.
2. Flag only material unapproved departures; accept allowed variation and the verified
   no-fit/authorized-departure paths.
3. Preserve the declared exact-replication exception and the distinction between duplicated
   business behavior and duplicated shape.
4. Keep no-signal, documentation-wording, mock-only, and superseded-behavior tests as must-fix; add
   production-file mirroring as no independent reason to retain a test.
5. Preserve batch scope, complexity heuristics, and rework-budget behavior.
6. Run `git diff --check -- skills/simplify/SKILL.md` and commit with message
   `docs(simplify): respect accepted pattern and test scope`.

## Task Dependency Graph

```text
Task 1 ──► Task 2
   │          │
   └──► Task 3 ──► Task 4 ──► Task 5 ──► Task 6 ──► Task 7
                         │         │
                         └──► Task 8 ──► Task 9 ──┐
                                   │              ├──► Task 11
                                   └──► Task 10 ──┘
```

Task 7 also depends on Task 2. Task 9 depends on Tasks 5 and 8. Task 11 depends on Tasks 5, 9,
and 10. The graph is acyclic.

## Integration Points

- After Task 4, DECIDE can identify an applicable semantic basis and carry it into affected tasks
  without a new parsed artifact.
- After Task 8, isolated implementation and test-authoring guidance share current-HEAD context and
  lowest-sufficient coverage while exact replication remains unchanged.
- After Task 11, generator, evaluator, code review, and simplification use the same conditional
  definition of material conformance.

## Acceptance-Criterion Coverage

| Story criterion | Owning task(s) |
|---|---|
| Story 1 HP1 — approved architecture outranks conflicting code | 1, 3 |
| Story 1 HP2 — applicable precedent records role, traits, rationale, variation, hints | 3, 4 |
| Story 1 HP3 — context remains feature-bounded | 1, 3 |
| Story 1 NP1 — conflicting code rejected as precedent | 1, 3 |
| Story 1 NP2 — verified no-fit rather than invented exemplar | 1, 3, 4 |
| Story 1 NP3 — unapproved broader refactor cannot reach BUILD | 1, 3, 4 |
| Story 2 HP1 — isolated implementer receives focused context | 4, 5, 6 |
| Story 2 HP2 — moved exemplar resolves to current equivalent | 5, 6 |
| Story 2 HP3 — smallest behavior-complete conforming change | 6, 7 |
| Story 2 NP1 — missing task context blocks dispatch | 4, 5 |
| Story 2 NP2 — load-bearing missing equivalent requests context | 5, 6 |
| Story 2 NP3 — smaller material departure remains incomplete | 6, 7, 9, 10 |
| Story 3 HP1 — implementation and simplification use same basis | 3, 5, 9, 10, 11 |
| Story 3 HP2 — allowed/immaterial variation accepted | 9, 10, 11 |
| Story 3 NP1 — material unapproved departure blocks | 9, 10, 11 |
| Story 3 NP2 — reviewer style preference does not block | 9, 10, 11 |
| Story 4 HP1 — every criterion has a concrete disposition | 2, 4, 8 |
| Story 4 HP2 — one behavior remains at lower layer | 2, 7, 8 |
| Story 4 HP3 — distinct multi-step flow gets one acceptance spec | 2, 8 |
| Story 4 HP4 — lower-layer negative variants are not duplicated above | 2, 8 |
| Story 4 NP1 — uncovered criterion remains incomplete | 2, 4, 8, 9 |
| Story 4 NP2 — existing lower proof prevents redundant acceptance spec | 2, 8, 9, 11 |
| Story 4 NP3 — production files do not require mirror tests | 2, 7, 11 |
| Story 4 NP4 — skill wording alone is not tested | 2, 7, 8, 11 |
| Story 4 amendment — declared exact-copy specs remain governed by their ADR | 1, 2, 4, 5, 7, 8, 11 |

## Advisory Overlap Scan

The required scan reported overlap with a large number of retained local and remote spec branches
because almost every historical plan names the same shared lifecycle skills. The rendered report
was surfaced as produced. Its actionable intersections are the already-reviewed exact-replication
spec and the existing acceptance-coverage work; both are explicitly preserved or built upon here.
No `build_review` surface is included. The scan is advisory and changes no task dependency.

## Verification

- [ ] All 24 happy/negative criteria and the exact-copy amendment map to at least one task.
- [ ] Every task has an explicit dependency and a single authoritative `**Files:**` set.
- [ ] No task outside 12-14 creates or modifies a parser, engine module, configuration key,
      artifact type, new skill, project convention system, or `build_review` surface; Tasks 12-14
      touch only the `acceptance_specs` evidence validator and completion gate named by amended
      architecture condition C1.
- [ ] No task adds an automated assertion of natural-language skill or agent wording.
- [ ] No task is a terminal whole-feature validation or speculative repair task.
- [ ] All tasks are scoped to approximately 2–5 minutes and the dependency graph is acyclic.
### Task rem-pipeline-coverage-gate-1: skills/pipeline/SKILL.md:388 — replace the evaluator checklist question requiring corresponding tests for every acceptance criterion with the shared lowest-sufficient-layer coverage rule: require concrete sufficient behavioral proof for every happy and negative criterion, permit compatible criteria to share coverage, and do not require one new test per criterion

---

### Task 12: Validate the tagged acceptance-spec evidence union

**Story:** Story 4 all happy and negative criteria, delivering amended architecture condition C1  
**Type:** happy-path  
**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/artifacts.acceptance-specs.test.ts`  
**Dependencies:** Task 8  
**Test disposition:** New engine tests at the evidence-validator seam.

**Steps:**

1. Replace the RED-only evidence model at `src/conductor/src/engine/artifacts.ts:1323-1477` with a
   validated tagged union keyed by `specs-generated` or `disposition-only`.
2. Preserve Outcome A (`specs-generated`) unchanged: RED fields, run contract, and the existing
   remediation exception.
3. Define Outcome B (`disposition-only`) as exhaustive per-criterion records drawn from the closed
   set — `existing-sufficient-test` with a test citation, or `planned-lower-layer-test` with owning
   task and layer — with verifiable citations.
4. Write failing tests rejecting missing, unknown-tag, incomplete, and internally inconsistent
   shapes; verify RED, implement, verify GREEN.
5. Commit with message `feat(acceptance-specs): validate the tagged evidence union`.

---

### Task 13: Branch the acceptance_specs completion gate on the outcome tag

**Story:** Story 4 all happy and negative criteria, delivering amended architecture condition C1  
**Type:** happy-path  
**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/artifacts.acceptance-specs.test.ts`  
**Dependencies:** Task 12  
**Test disposition:** New engine tests at the completion-gate seam covering both outcomes and every fail-closed refusal class.

**Steps:**

1. Branch `acceptance_specs` completion at `src/conductor/src/engine/artifacts.ts:2128-2172` on the
   validated outcome tag.
2. For `specs-generated`, preserve every existing requirement: spec files, run contract, genuine
   RED counters, committed-spec checks, remediation exceptions, and declared-replication refusals.
3. Accept `disposition-only` only with zero spec files, no run contract or RED counters, and a
   complete citation-bearing disposition record; refuse every mixed or partial shape fail-closed.
4. Write failing tests for both outcomes and each existing refusal class; verify RED, implement,
   verify GREEN.
5. Commit with message `feat(acceptance-specs): admit a disposition-only completion outcome`.

---

### Task 14: Record the outcome tag in the skill's evidence contract

**Story:** Story 4 all happy and negative criteria, delivering amended architecture condition C1  
**Type:** happy-path  
**Files:** `skills/writing-system-tests/SKILL.md`  
**Dependencies:** Task 12  
**Test disposition:** No new automated test; the engine tests of Tasks 12-13 prove the contract.

**Steps:**

1. Require `.pipeline/acceptance-specs-red.json` to record `specs-generated` or `disposition-only`
   in the skill's evidence sections (§224's zero-spec branch and the §6/§7 evidence and
   verification checklists).
2. Define `disposition-only` as exhaustive happy and negative criterion records using exactly
   `existing-sufficient-test` with a test citation or `planned-lower-layer-test` with owning task
   and layer.
3. Make the RED-run, run-contract, failing-spec commit, and verification obligations conditional on
   the recorded tag, keeping declared replication governed by `specs-generated`.
4. Run `git diff --check -- skills/writing-system-tests/SKILL.md` and commit with message
   `docs(writing-system-tests): record the acceptance-spec outcome tag`.
### Task rem-build-review-root-cause-2: src/conductor/test/engine/artifacts.acceptance-specs.test.ts:1 and src/conductor/src/engine/artifacts.ts:1323-1477,2128-2172 — execute approved Tasks 12-13 with a regression proving disposition-only completes from exhaustive citation-bearing records with zero specs, run contract, or RED counters while specs-generated still requires its unchanged genuine-RED contract; update skills/writing-system-tests/SKILL.md:224,489,671 per Task 14 so the producer records the matching tag and shape
### Task rem-build-review-task12-1: src/conductor/src/engine/artifacts.ts:1323-1477 and src/conductor/test/engine/artifacts.acceptance-specs.test.ts:1 — execute Task 12 RED/GREEN: add the validated specs-generated/disposition-only union, preserve every specs-generated field and exception, require exhaustive closed-set disposition-only records with verifiable citations, and reject missing tags, unknown tags, incomplete records, missing citations, and mixed shapes
### Task rem-build-review-task13-1: src/conductor/src/engine/artifacts.ts:2128-2172 and src/conductor/test/engine/artifacts.acceptance-specs.test.ts:1 — execute Task 13 RED/GREEN: branch completion on the validated tag, retain all specs-generated requirements, accept disposition-only only with zero spec files, no run contract or RED counters, and complete citations, and cover every mixed, partial, and existing refusal class fail-closed
### Task rem-build-review-task14-1: skills/writing-system-tests/SKILL.md:224,489,671 — execute Task 14 by requiring specs-generated or disposition-only, defining exhaustive happy and negative records as exactly existing-sufficient-test with a test citation or planned-lower-layer-test with owning task and layer, and making RED-run, run-contract, failing-spec-commit, and verification duties conditional on the tag
