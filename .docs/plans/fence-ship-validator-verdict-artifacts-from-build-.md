# Implementation Plan: Fence SHIP validator verdict artifacts from BUILD writers

**Date:** 2026-10-02
**Stories:** .docs/stories/fence-ship-validator-verdict-artifacts-from-build-.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the change adds read-only guidance to three skills and alters no engine contract or other feature's behavior.

## Summary

Two bounded skill-text tasks deliver the operator-approved skill-only fix for #2874. Task 1 adds a read-only rule for SHIP validator verdict artifacts to the `pipeline` skill (BUILD orchestrator) and the `tdd` skill (BUILD implementer), proven by the existing pipeline skill-contract script. Task 2 marks the same artifacts read-only in the `remediate` skill's gap-based inputs, proven by the existing remediate skill-contract test. No engine, hook, provider, schema, or event change is made; the mechanical per-step write policy is a separate low-priority intake.

## Technical Approach

The five verdict artifacts are `.pipeline/prd-audit.md`, `.pipeline/architecture-review-as-built.md`, `.pipeline/architecture-review-as-built.json`, `.pipeline/prd-audit-code-stamp.json`, and `.pipeline/architecture-review-as-built-code-stamp.json`. Each skill names all five in one list so a reader never infers that an unlisted sibling is writable.

In `skills/pipeline/SKILL.md`, add a bold-led paragraph immediately after the existing **Task status tracking** paragraph, matching its style: the verdict artifacts are owned by their SHIP validators and the engine; BUILD sessions, including remediation retries whose prompt cites them, read them for the finding and never write, delete, rename, or recreate them; only the validator's own next dispatch produces a new verdict; a fixed finding is proven through `conduct task done` evidence. State that reading `.pipeline/remediation.json` and the cited verdict artifact remains expected. Also add one bullet to the implementer dispatch requirements so every dispatch prompt carries the read-only rule, since the implementer does not receive the `pipeline` skill.

In `skills/tdd/SKILL.md`, add a short `### SHIP verdict artifacts are read-only` subsection after `### Suite-failure repair`, naming the five paths, the never-write, never-delete, never-rename, never-recreate rule, and that reading them is allowed.

In `skills/remediate/SKILL.md` `### 1. Load Input`, add one paragraph under the gap-based inputs list stating the listed SHIP verdict artifacts are read-only evidence, that `.pipeline/remediation.json` is the only write in gap-plan mode, and that a planner concluding a finding is resolved records it there instead of editing, deleting, or recreating the verdict.

Tests follow the write-tests skill. Task 1 adds one contract function to `test/test_skill_pipeline_contract.sh` using its existing `fail`/`pass` helpers. Task 2 adds one `it` block to `src/conductor/test/engine/remediate-skill-contract.test.ts` using its existing `section` helper. Both read the shipped skill files only; no process, git, LLM, or conductor runs.

## Preconditions and claim ledger

- Operator approved skill-only scope, technical track, Small tier, and both stories on 2026-10-02; the operator rejected engine machinery for this feature as low frequency and low impact.
- Verified: `src/conductor/src/engine/steps.ts` defines `test_suite` as a deterministic BUILD step, so no skill text governs it.
- Verified: `skills/pipeline/SKILL.md` carries the **Task status tracking** paragraph stating `.pipeline/task-status.json` is engine-owned, and a **Subagent context scoping** list stating the implementer receives the TDD skill but not the full plan.
- Verified: `skills/tdd/SKILL.md` has `### Suite-failure repair` under `## Purpose`.
- Verified: `skills/remediate/SKILL.md` `### 1. Load Input` lists `.pipeline/prd-audit.md` and `.pipeline/architecture-review-as-built.md` as gap-based inputs with no read-only statement.
- Verified: the code-stamp sidecar names come from `src/conductor/src/engine/artifacts.ts` and the as-built JSON from `src/conductor/src/engine/as-built-verdict-store.ts`.
- Verified: `test/test_skill_pipeline_contract.sh` defines `fail` and `pass` helpers and per-contract functions; `src/conductor/test/engine/remediate-skill-contract.test.ts` defines a `section` helper.
- Scope check: consumer-facing shipped skills; no new skill; provider-agnostic text. Event-spine: no event or report is added or changed.
- Verify-claims verdict: CLEAR. Every path and symbol above was read on the worktree base.

## Tasks

### Task 1: Declare SHIP verdict artifacts read-only in the BUILD skills
**Story:** 1
**Type:** happy-path
**Files:** skills/pipeline/SKILL.md, skills/tdd/SKILL.md, test/test_skill_pipeline_contract.sh
**Dependencies:** none

**Steps:**
1. Add a `ship_verdict_artifacts_read_only_contract_holds` function to the pipeline contract script and call it with the other contracts. It asserts that `skills/pipeline/SKILL.md` and `skills/tdd/SKILL.md` each contain all five verdict artifact paths, that each states the artifacts must never be written, deleted, or recreated, that the pipeline skill states only the validator's own dispatch produces a new verdict, that the pipeline skill tells the session to record proof through `conduct task done`, and that the pipeline skill states reading `.pipeline/remediation.json` and the cited verdict artifact is allowed.
2. Run the script and observe the new contract fail.
3. Add the pipeline paragraph, the implementer dispatch bullet, and the tdd subsection described in the Technical Approach.
4. Run the script and commit.

**Done when:**
1. `test/test_skill_pipeline_contract.sh` exits 0 and its new contract asserts all five verdict artifact paths appear in both `skills/pipeline/SKILL.md` and `skills/tdd/SKILL.md`.
2. The new contract asserts both skills state the verdict artifacts are never written, deleted, or recreated by a BUILD session. It also asserts both skills state the verdict artifacts are never renamed by a BUILD session.
3. The new contract asserts the pipeline skill states only the validator's own dispatch produces a new verdict and that proof is recorded through `conduct task done`.
4. The new contract asserts the pipeline skill states reading `.pipeline/remediation.json` and the cited verdict artifact remains allowed. It also asserts the tdd skill states the same reading remains allowed.
5. The pipeline skill's implementer dispatch requirements include a bullet requiring every dispatch prompt to carry the verdict read-only rule.

### Task 2: Mark verdict inputs read-only in the remediate skill
**Story:** 2
**Type:** negative-path
**Files:** skills/remediate/SKILL.md, src/conductor/test/engine/remediate-skill-contract.test.ts
**Dependencies:** none

**Steps:**
1. Add an `it` block asserting the remediate skill's `### 1. Load Input` text marks `.pipeline/prd-audit.md` and `.pipeline/architecture-review-as-built.md` read-only, names `.pipeline/remediation.json` as the only write in that mode, and forbids editing, deleting, or recreating a verdict artifact to record a resolved finding.
2. Run the test file through ai-conductor scoped-run and observe the new case fail.
3. Add the read-only paragraph described in the Technical Approach.
4. Re-run the test file through ai-conductor scoped-run and commit.

**Done when:**
1. The remediate skill-contract test passes and asserts the Load Input section marks both SHIP verdict input paths read-only.
2. The test asserts the Load Input section names `.pipeline/remediation.json` as the only write in gap-plan mode.
3. The test asserts the Load Input section forbids editing, deleting, or recreating a verdict artifact and directs a resolved finding to be recorded in `.pipeline/remediation.json`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a BUILD remediation retry whose prompt cites a SHIP verdict artifact as evidence, when the BUILD orchestrator follows the `pipeline` skill, then the skill tells it to read that artifact for the finding and never write, delete, rename, or recreate any of the five named verdict artifacts. | 1 | "The new contract asserts both skills state the verdict artifacts are never written, deleted, or recreated by a BUILD session." | diff-local |
| Story 1 happy: Given an implementer dispatched during BUILD, when it follows the `tdd` skill, then the skill names the same five verdict artifacts as read-only evidence it must not write, delete, rename, or recreate. | 1 | "`test/test_skill_pipeline_contract.sh` exits 0 and its new contract asserts all five verdict artifact paths appear in both `skills/pipeline/SKILL.md` and `skills/tdd/SKILL.md`." | diff-local |
| Story 1 negative: Given a BUILD session that believes it has fixed a SHIP finding, when it closes the remediation task, then the `pipeline` skill states that only the validator's own next dispatch produces a new verdict and that the session records its proof through `conduct task done` evidence instead of editing the verdict. | 1 | "The new contract asserts the pipeline skill states only the validator's own dispatch produces a new verdict and that proof is recorded through `conduct task done`." | diff-local |
| Story 1 negative: Given the read-only rule, when a BUILD session needs the finding's detail, then the `pipeline` and `tdd` skills still direct it to read `.pipeline/remediation.json` and the cited verdict artifact, so reading is not forbidden. | 1 | "The new contract asserts the pipeline skill states reading `.pipeline/remediation.json` and the cited verdict artifact remains allowed." | diff-local |
| Story 2 happy: Given the `remediate` skill loads gap-based inputs from `.pipeline/prd-audit.md` or `.pipeline/architecture-review-as-built.md`, when it lists those inputs, then it marks the SHIP verdict artifacts as read-only evidence and names `.pipeline/remediation.json` as its only write in that mode. | 2 | "The test asserts the Load Input section names `.pipeline/remediation.json` as the only write in gap-plan mode." | diff-local |
| Story 2 negative: Given a remediation planner that concludes a SHIP finding is already resolved, when it records that conclusion, then the `remediate` skill directs it to say so in `.pipeline/remediation.json` and forbids editing, deleting, or recreating the verdict artifact to change its verdict. | 2 | "The test asserts the Load Input section forbids editing, deleting, or recreating a verdict artifact and directs a resolved finding to be recorded in `.pipeline/remediation.json`." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local skill-text contracts. Task 1 owns the BUILD skill contract through `test/test_skill_pipeline_contract.sh`; Task 2 owns the remediate contract through `remediate-skill-contract.test.ts`. No runtime integration boundary changes, so no integration or aggregate test is added. No terminal validation task is added.

## Task Dependency Graph

Task 1 (independent)
Task 2 (independent)

Small tier: architecture and coherence artifacts are skipped. No ADR is created or amended.
