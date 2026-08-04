# Implementation Plan: Implementation-only remediation routing

**Date:** 2026-08-02
**Design:** Technical track; no PRD
**Stories:** `.docs/stories/implementation-only-remediation-falsely-requires-d.md`
**Conflict check:** Clean as of 2026-08-02

## Summary

Tighten the existing remediation judgment contract without changing its JSON schema, and add deterministic contract/routing coverage for the reported classification boundary. Five scoped TDD tasks preserve genuine DECIDE halts while making conforming implementation drift a BUILD disposition.

## Technical Approach

Keep the current `RemediationDisposition` union and engine phase guard. First pin the closed semantic rule in a contract test over both machine-consumed instruction surfaces. Then update the skill and planner prompt independently under RED/GREEN. Finally, exercise `planRemediation` with faithful remediation-plan fixtures to prove that the intended `build` output routes autonomously while genuine `architecture_review` output still halts. No ordinary documentation task is included; repository documentation upkeep remains the configured post-implementation step.

## Prerequisites

- The approved architecture review and Accepted stories for this feature.
- No external credentials or third-party calls; all tests operate on instruction files or injected/local engine fixtures.

## Tasks

### Task 1: Pin the closed remediation-authority contract

**Story:** S1 — first happy and negative criteria; the shared contract also supports S2 and S3
**Type:** negative-path

**Steps:**
1. Write a failing acceptance-contract test that reads `skills/remediate/SKILL.md` and `agents/remediation-planner.md` and requires both surfaces to reserve `architecture_review` for changing or clarifying approved architecture, route conforming implementation/test/documentation drift to `build`, and include both contradiction directions.
2. Verify the focused test fails because the current texts classify clear ADR drift as `architecture_review`.
3. Add no production change in this task; retain the RED test for Tasks 2 and 3.
4. Verify the failure identifies each missing contract independently.
5. Commit with message: "test remediation authority routing contract"

**Files:**
- `src/conductor/test/acceptance/remediation-authority-routing.acceptance.test.ts` — static, deterministic contract assertions over both instruction surfaces

**Wired-into:** none (no new production surface)

**Dependencies:** none

### Task 2: Close the remediate skill taxonomy

**Story:** S1 — all criteria; the taxonomy also supports S2 and S3
**Type:** happy-path

**Steps:**
1. Run the Task 1 contract test and confirm the skill-specific assertions are RED.
2. Rewrite the `architecture_review` row and judgment rules so it is valid only when approved architecture must change or be clarified; route drift that preserves approved architecture to `build` even when reported by the as-built architecture validator.
3. Add explicit forbidden examples for both contradiction directions and distinguish an in-scope plan omission from an architecture decision.
4. Verify the skill half of the focused contract passes while the planner half remains RED.
5. Commit with message: "close remediation skill authority taxonomy"

**Files:**
- `skills/remediate/SKILL.md` — authoritative skill disposition rubric and output guidance

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 3: Align the remediation-planner judgment rubric

**Story:** S3 — all criteria; the aligned rubric also supports S1 and S2
**Type:** happy-path

**Steps:**
1. Run the Task 1 contract test and confirm only planner-agent assertions remain RED.
2. Apply the identical closed rule and positive/negative examples to `agents/remediation-planner.md`, retaining evidence-grounded confidence calibration and concrete BUILD-task requirements.
3. State that audit origin or an ADR-shaped finding id never determines authority by itself.
4. Verify the complete focused contract test passes.
5. Commit with message: "align remediation planner authority judgment"

**Files:**
- `agents/remediation-planner.md` — planner-agent disposition judgment contract

**Wired-into:** none (no new production surface)

**Dependencies:** Task 2

### Task 4: Prove conforming implementation drift routes to BUILD

**Story:** S1 — second happy criterion and both Done-When items; the route also supports S3
**Type:** happy-path

**Steps:**
1. Add a failing narrow `planRemediation` test using a fresh temporary project and faithful `.pipeline/remediation.json` fixture modeled on #1250: ADR-keyed id, `build`, `category: null`, rationale preserving approved architecture, and pending file-scoped tasks.
2. Bound the fixture at `planRemediation`; inject the runner and avoid a full `Conductor.run()` or any provider/GitHub call.
3. Make only the smallest engine adjustment if the faithful fixture exposes a routing defect; otherwise complete as verify-only with evidence pointing to the passing existing behavior.
4. Verify the outcome is `route` to `build`, the tasks are appended/seeded, and no DECIDE halt is emitted.
5. Commit with message: "prove implementation remediation returns to build"

**Files:**
- `src/conductor/test/engine/conductor-remediation-authority-routing.test.ts` — bounded engine routing regression
- `src/conductor/src/engine/conductor.ts` — only if the faithful fixture exposes an engine routing defect

**Wired-into:** none (no new production surface)

**Verify-only:** yes

**Dependencies:** Task 3

### Task 5: Preserve genuine DECIDE protection and plan-scope diagnosis

**Story:** S2 — second happy criterion and both negative criteria; the matrix also supports S3
**Type:** negative-path

**Steps:**
1. Extend the focused routing test with an `architecture_review` fixture whose rationale requires changing or clarifying approved architecture, plus a `plan` fixture for an in-scope omission.
2. Verify RED if either genuine DECIDE target bypasses the daemon phase guard or is mislabeled as BUILD.
3. Preserve the existing phase-derived `decideKickbackDisposition` behavior; make the smallest correction only if the new fixture exposes a regression.
4. Verify daemon mode halts for both genuine DECIDE targets while the Task 4 BUILD fixture still routes.
5. Commit with message: "preserve human gates for remediation decisions"

**Files:**
- `src/conductor/test/engine/conductor-remediation-authority-routing.test.ts` — negative-path daemon routing matrix
- `src/conductor/src/engine/kickback-policy.ts` — only if a genuine DECIDE protection regression is exposed

**Wired-into:** none (no new production surface)

**Verify-only:** yes

**Dependencies:** Task 4

## Task Dependency Graph

```text
Task 1 → Task 2 → Task 3 → Task 4 → Task 5
```

## Integration Points

- After Task 3: both machine-consumed judgment surfaces express one closed taxonomy.
- After Task 4: the #1250-shaped output is proven to enter the existing BUILD route.
- After Task 5: the routing matrix proves the correction does not weaken operator-only DECIDE protection.

## Acceptance Coverage

- S1: Tasks 1–4 cover conforming implementation drift, audit-origin independence, evidence-backed tasks, and BUILD routing.
- S2: Tasks 1–3 define the judgment boundary; Task 5 proves genuine architecture and plan decisions remain protected.
- S3: Task 1 pins contradictory outputs; Tasks 2–3 correct both prompt surfaces; Tasks 4–5 prove consistent downstream routing.

## Verify-Claims Ledger

### Claims

- [verified] Both `skills/remediate/SKILL.md` and `agents/remediation-planner.md` currently classify clear approved-ADR drift as `architecture_review`.
- [verified] `planRemediation` accepts a parsed remediation plan, appends tasks, derives the earliest target, and consults the phase-based daemon guard.
- [verified] existing tests already call the private `planRemediation` boundary with injected/local fixtures, so no broad conductor run is required.

### Assumptions

- [non-load-bearing, 95% inferred] The new contract assertions may fit an existing test file rather than the proposed new acceptance file; implementation may colocate them if that is the narrower repository convention.

Verdict: CLEAR

## Verification

- [x] Every happy and negative story criterion maps to at least one task.
- [x] Negative paths are explicit tasks, not a terminal catch-all.
- [x] Tasks declare an acyclic dependency tree.
- [x] Tests use deterministic local files and injected engine seams; no third-party boundary is called.
- [x] No task introduces a new production surface.
