# Implementation Plan: Full-replay rebase intent validation

**Date:** 2026-08-01
**Track:** Technical
**Complexity:** Medium
**Design:** `.docs/decisions/adr-2026-08-01-rebase-full-replay-intent-validation.md`
**Stories:** `.docs/stories/rebase-full-replay-intent-validation.md`
**Conflict check:** Clean as of 2026-08-01

## Summary

Strengthen the shared judgment-based rebase skill so it validates source intent, the complete staged replay, and the resulting replay commit, while preserving legitimate coordinated cross-file edits and returning actionable ambiguity evidence through the existing HALT path. Six scoped TDD tasks cover the semantic contract, provider delivery, and terminal evidence without calling a real third party.

## Technical Approach

Keep conflict resolution in the existing semantic `rebase` skill and leave deterministic engine guards unchanged. The skill will snapshot each replay commit identity before editing, inspect its parent/source diff and upstream context, review the complete staged diff before `rebase --continue`, allow cross-file adaptations only when they are explainable from source intent plus upstream change, and inspect the resulting replay commit before advancing. The existing provider-aware runner will reinforce—but not duplicate or weaken—the canonical contract and will continue returning the final structured JSON result. Tests read the canonical skill and drive fake-provider/internal engine seams; real local Git is used only where paused-rebase/HALT semantics are the behavior under test.

## Prerequisites

- APPROVED ADR `adr-2026-08-01-rebase-full-replay-intent-validation`.
- Accepted technical stories and clean conflict report.
- Existing `DefaultStepRunner.resolveRebaseConflict`, `resolveRebaseConflicts`, and `writeHalt` seams remain the integration boundary.
- No real Claude, Codex, GitHub, registry, or network call is permitted in ordinary tests.

## Tasks

### Task 1: Require source-intent and upstream-context discovery

**Story:** Story 1 happy path and clean-index negative path
**Type:** happy-path

**Steps:**
1. Write failing acceptance assertions that the canonical rebase skill requires capturing the replay commit before edits, inspecting its parent/source diff, reading upstream context, and refusing to infer correctness from conflict-marker removal alone.
2. Run the single acceptance file and verify RED on the current conflict-hunk-only contract.
3. Expand the skill's inspection phase with concrete local-Git evidence commands and an explicit evidence ledger for the current replay commit.
4. Re-run the single file and verify GREEN.
5. Commit with message: `feat(rebase): require replay intent discovery`

**Files:**
- `src/conductor/test/acceptance/rebase-full-replay-intent-validation.acceptance.test.ts` — canonical skill-contract assertions
- `skills/rebase/SKILL.md` — source, parent, and upstream intent discovery protocol

**Wired-into:** `src/conductor/src/engine/step-runners.ts#DefaultStepRunner.resolveRebaseConflict`

**Dependencies:** none

### Task 2: Validate the complete staged replay and preserve coordinated edits

**Story:** Story 1 staged-diff criteria; Story 3 happy and negative paths
**Type:** happy-path

**Steps:**
1. Add failing contract cases requiring review of the entire staged diff and explicitly permitting justified edits outside the directly conflicted hunk/file.
2. Add the paired negative assertion that unexplained cross-file edits must stop resolution, while file allowlists, hunk-only restrictions, whole-patch equality, and deterministic resolvers are forbidden as the acceptance boundary.
3. Run the acceptance file and verify RED.
4. Add the pre-continue attribution checklist and cross-file explanation rule to the canonical skill.
5. Re-run the acceptance file and verify GREEN; commit with message: `feat(rebase): validate complete staged replay`

**Files:**
- `src/conductor/test/acceptance/rebase-full-replay-intent-validation.acceptance.test.ts` — staged-diff and cross-file contract cases
- `skills/rebase/SKILL.md` — full staged replay validation and permitted adaptation rules

**Wired-into:** same as Task 1

**Dependencies:** Task 1

### Task 3: Validate the resulting replay commit before advancing

**Story:** Story 1 post-continue happy and negative paths
**Type:** negative-path

**Steps:**
1. Add a failing contract case requiring the skill to retain the pre-continue replay identity, inspect the newly created replay commit after continue, and refuse `resolved: true` when the result cannot be reconciled with the validated intent.
2. Verify RED against the current skill.
3. Add the post-continue review loop, including behavior for a subsequent conflicted commit and for a final commit that completes the rebase.
4. Verify GREEN and commit with message: `feat(rebase): inspect each completed replay commit`

**Files:**
- `src/conductor/test/acceptance/rebase-full-replay-intent-validation.acceptance.test.ts` — post-continue contract assertions
- `skills/rebase/SKILL.md` — resulting-commit validation loop

**Wired-into:** same as Task 1

**Dependencies:** Task 2

### Task 4: Emit actionable ambiguity evidence and short-circuit

**Story:** Story 2 resolver evidence and early-stop criteria
**Type:** negative-path

**Steps:**
1. Add failing acceptance assertions for the false-result reason schema: replay commit, file/region, competing intentions, missing decision, and explicit unavailable-context wording when a fact cannot be known.
2. Add a case rejecting vague confidence claims or continued execution after semantic ambiguity is found.
3. Verify RED.
4. Strengthen the skill's ambiguity gate and final JSON examples so the first cannot-resolve judgment stops the attempt without guessing or consuming later attempts.
5. Verify GREEN and commit with message: `feat(rebase): halt with replay ambiguity evidence`

**Files:**
- `src/conductor/test/acceptance/rebase-full-replay-intent-validation.acceptance.test.ts` — ambiguity and evidence contract assertions
- `skills/rebase/SKILL.md` — conservative HALT boundary and evidence format

**Wired-into:** same as Task 1

**Dependencies:** Task 3

### Task 5: Preserve the contract through provider-aware dispatch

**Story:** Story 3 provider-boundary criterion; Story 2 malformed-output criterion
**Type:** infrastructure

**Steps:**
1. Extend the fake-provider runner tests to assert the delivered system prompt requires the canonical full-replay contract, preserves the semantic rebase invocation for supported providers, and never treats malformed output as success.
2. Verify RED against the terse current system prompt.
3. Update `resolveRebaseConflict`'s system prompt to reinforce the canonical skill's intent-validation and ambiguity-HALT obligations without embedding a provider-specific workflow or replacing the skill.
4. Verify the runner file GREEN with the provider fake and confirm no interactive/real-provider method was called.
5. Commit with message: `feat(rebase): preserve replay safety at dispatch boundary`

**Files:**
- `src/conductor/src/engine/step-runners.ts` — provider-neutral system prompt reinforcement
- `src/conductor/test/engine/rebase-resolution-runner.test.ts` — fake-provider prompt/result coverage

**Wired-into:** `src/conductor/src/engine/conductor.ts#runRebaseStep, src/conductor/src/daemon-cli.ts#resolveConflict`

**Dependencies:** Task 4

### Task 6: Preserve specific resolver evidence in the HALT path

**Story:** Story 2 end-to-end reason propagation, active-rebase, and short-circuit criteria
**Type:** negative-path

**Steps:**
1. Add a real-local-Git, fake-resolver acceptance case that pauses a rebase, returns a specific ambiguity reason, drives the existing bounded resolver and HALT writer, and asserts the HALT contains the replay evidence verbatim.
2. Counter-assert that the resolver runs once despite a higher cap, the rebase remains safely unresolved/unsatisfied, and no generic reason replaces the semantic evidence.
3. Verify RED only if the current internal propagation loses evidence; otherwise record the existing behavior with a verify-only evidence commit rather than changing production code.
4. If RED exposes a scoped propagation defect, repair only the reason handoff in `resolveRebaseConflicts`/`writeHalt`, then verify GREEN.
5. Commit with message: `test(rebase): preserve ambiguity evidence through halt`

**Files:**
- `src/conductor/test/acceptance/rebase-full-replay-intent-validation.acceptance.test.ts` — internal end-to-end HALT evidence case
- `src/conductor/src/engine/rebase.ts` — only if the new RED case proves evidence is lost

**Wired-into:** `src/conductor/src/engine/conductor.ts#runRebaseStep, src/conductor/src/engine/daemon-rekick.ts#resumeRebaseFirst`

**Verify-only:** yes

**Dependencies:** Task 5

## Task Dependency Graph

```text
Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6
```

## Integration Points

- After Task 4: the canonical skill contract fully owns replay intent, complete staged-diff review, post-continue inspection, cross-file permission, and ambiguity evidence.
- After Task 5: every supported provider path receives the same semantic safety boundary through the existing one-shot adapter.
- After Task 6: a false semantic judgment is proven to reach the operator-visible HALT through the existing engine flow.

## Acceptance Coverage

- Story 1 source/parent/upstream inspection and clean-index negative → Task 1.
- Story 1 complete staged replay and unexplained change rejection → Task 2.
- Story 1 post-continue validation and false-success rejection → Task 3.
- Story 2 specific evidence, missing-context honesty, and immediate short-circuit → Tasks 4 and 6.
- Story 2 malformed output and active-rebase fail-safe → Tasks 5 and 6.
- Story 3 justified cross-file edits and forbidden mechanical restrictions → Task 2.
- Story 3 provider-neutral contract preservation → Task 5.

## Verification

- [ ] Every happy and negative acceptance criterion maps to a task.
- [ ] Every automated test uses fake provider/external boundaries; local Git only where Git semantics are under test.
- [ ] Tasks own scoped RED/GREEN evidence; there is no terminal catch-all validation task.
- [ ] Dependencies are explicit and acyclic.
- [ ] Every production surface carries a `Wired-into:` contract derived from architecture review.
- [ ] The plan introduces no mechanical resolver or edit-surface restriction.

