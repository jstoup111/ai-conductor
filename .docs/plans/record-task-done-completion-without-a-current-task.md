# Implementation Plan: Record task done completion without a current-task stamp

**Date:** 2026-09-28
**Stories:** .docs/stories/record-task-done-completion-without-a-current-task.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; scoped intent conforms to adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation (the stamp is non-authoritative telemetry) and adr-2026-08-22-done-when-evidence-at-task-close (Done when evidence is the close boundary; tasks without the block keep the prior rule).

## Summary

Two bounded tasks deliver #2809. Task 1 makes the stampless branch of runTaskDone apply the same close contract as the stamped branch. Task 2 proves the behavior through the `conduct task` CLI entry and syncs the contract text that currently tells hosts a stampless close is a no-op. Stamp writers, repair-obligation semantics, trailer resolution, and the remainder of #1252 are out of scope.

## Technical Approach

In `src/conductor/src/engine/task-cli.ts` runTaskDone, keep the stamp read and the stamped branch unchanged, including the different-stamp refusal. Rewrite only the catch branch taken when the stamp cannot be read, in this order:

1. Keep the openRepairForTask lookup and its `unavailable` refusal exactly as today.
2. When a plan-gap request is present, return runTaskPlanGap, as the stamped branch does. A plan-gap request is never treated as a close.
3. When the repair lookup is `none` and the task row in task-status.json already reads `completed` or `skipped`, return 0 without writing. Use a small private helper that reads and parses task-status.json and returns false on any read, parse, or shape failure, so a missing or malformed file falls through to the existing writer and its existing refusals or legacy result.
4. Otherwise call completeTaskDoneWhen, as the open-repair path already does. A `refused` result prints its message and returns 1; `legacy` and `completed` return 0.

A `legacy` result (no resolvable plan, or a task without a Done when block) still writes nothing and exits 0; adr-2026-08-22 decision 2 keeps those tasks on the prior rule, and the stamped legacy path also writes no row. Rewrite the catch-branch comment to state the new contract and cite the two ADRs. Update the `conduct task done` guide string so it says the engine records the evidence and clears the current-task stamp when one is present.

No change to completeTaskDoneWhen, openRepairForTask, runTaskPlanGap, runTaskStart, or the argv parser. No new event or log channel; the existing stderr refusals are reused.

Tests follow the existing runTaskDone fixtures in `src/conductor/test/engine/task-cli.test.ts`: real temporary `.pipeline` and plan files under `mkdtemp`, no Git, no network, no LLM. The existing "is a no-op when stamp file does not exist" case encodes the defect (a Done when task with a pending row and no evidence exiting 0); rewrite it to assert the missing-evidence refusal. Keep the existing reopened-task, malformed-state, and mismatch cases unchanged as regression coverage.

## Preconditions and claim ledger

- Operator delegation: Small scope, technical track, record-completion approach, and both stories approved on 2026-09-28 (delegated); the approach is settled by the two ADRs named in the header.
- Verified: runTaskDone in task-cli.ts returns 0 at line 259 for a stampless task whose repair lookup is `none`, without writing task-status.json.
- Verified: the stamped branch of runTaskDone refuses a different stamp at line 269, routes a plan-gap request to runTaskPlanGap (defined at line 301), then calls completeTaskDoneWhen.
- Verified: completeTaskDoneWhen in task-progress.ts (line 284) returns legacy at lines 309 and 332, refuses missing evidence naming the check, sets status completed with doneWhen records, and has no already-completed short-circuit.
- Verified: dispatchTaskCommand and detectTaskCommand in task-cli.ts parse `--done-when` and `--plan-gap`; the existing plan-gap test in task-cli.test.ts drives them end to end.
- Verified: skills/pipeline/SKILL.md lines 70, 96, and 132 and docs/reference/cli.md line 738 describe the stampless close as an exit-0 no-op.
- Scope check: consumer-facing engine command and shipped skill text; no skill addition; provider-agnostic. No bin/conduct, hook, settings, or symlink surface changes, so no migration block. Event-spine: no new channel.
- Verify-claims verdict: CLEAR. No pending product or scope assumption.

## Tasks

### Task 1: Apply the Done when close contract when the stamp is absent
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/task-cli.ts, src/conductor/test/engine/task-cli.test.ts
**Dependencies:** none

**Steps:**
1. In task-cli.test.ts, add RED runTaskDone cases with no stamp and no repair: a pending Done when task with full evidence; the same task without evidence; a plan-gap request; a task in a plan with no Done when block; a completed row and a skipped row closed without evidence. Rewrite the existing "is a no-op when stamp file does not exist" case to expect the missing-evidence refusal with an unchanged file.
2. Establish RED, then rewrite the stampless catch branch of runTaskDone in the order given in Technical Approach, adding the private terminal-row helper.
3. Update the catch-branch comment and the `conduct task done` guide string to the new contract.
4. Run the file's tests through ai-conductor scoped-run and commit.

**Done when:**
1. The stampless full-evidence runTaskDone test observes exit 0 and a task-status row reading completed with one doneWhen record per declared check.
2. The stampless missing-evidence runTaskDone test observes exit 1, stderr naming the missing check, and a byte-identical task-status.json.
3. The stampless plan-gap runTaskDone test observes exit 1, HALT.class reading plan-gap, and the task row not reading completed.
4. The stampless no-Done-when-block test and the completed-row and skipped-row re-close tests each observe exit 0 with a byte-identical task-status.json.
5. The existing mismatch-guard tests still observe exit 1 naming both ids with the sibling stamp and task-status.json unchanged.

### Task 2: Prove the stampless close through the CLI entry and sync the contract text
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/test/engine/task-cli.test.ts, skills/pipeline/SKILL.md, docs/reference/cli.md
**Dependencies:** 1

**Steps:**
1. Add an integration case that parses `conduct task done 7 --done-when 1=<evidence>` with detectTaskCommand and runs dispatchTaskCommand against a temporary project with no stamp, asserting the recorded completion. Add a second case through the same entry for a completed row with no evidence, asserting exit 0 and an unchanged file.
2. In skills/pipeline/SKILL.md, replace the hook-less-host paragraph and the step 0 and step 6 statements that a stampless `task done` is a silent no-op: a stampless close now records Done when evidence or refuses naming the missing check; keep the instruction to confirm the row reads completed.
3. In docs/reference/cli.md, replace the sentence saying an absent stamp exits 0 and that done never modifies task-status.json with the evidence-recording contract, the idempotent re-close, and the unchanged mismatch refusal.
4. Run the file's tests through ai-conductor scoped-run and commit.

**Done when:**
1. The CLI integration test drives detectTaskCommand and dispatchTaskCommand with a done-when argument and no stamp and observes exit 0 with the row reading completed and carrying the supplied evidence.
2. The CLI integration re-close test observes exit 0 and a byte-identical task-status.json for a completed row closed with no evidence and no stamp.
3. skills/pipeline/SKILL.md contains no statement that a stampless `task done` exits 0 without recording or is a silent no-op.
4. docs/reference/cli.md no longer states that an absent stamp exits 0 or that done never modifies task-status.json.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a pending task whose active plan declares a Done when block, no current-task stamp, and no open repair, when `conduct task done` runs with evidence for every declared check, then each check's evidence is recorded on the task row, the row reads completed, and the command exits 0. | 1, 2 | "The CLI integration test drives detectTaskCommand and dispatchTaskCommand with a done-when argument and no stamp and observes exit 0 with the row reading completed and carrying the supplied evidence." | diff-local |
| Story 1 negative: Given the same stampless pending task, when `conduct task done` runs without evidence for a declared check, then it exits non-zero naming the missing check and task-status.json is unchanged. | 1 | "The stampless missing-evidence runTaskDone test observes exit 1, stderr naming the missing check, and a byte-identical task-status.json." | diff-local |
| Story 1 negative: Given a stampless pending task whose Done when check cannot be met, when `conduct task done` runs with a plan-gap request, then the classified plan-gap halt is written and the task row is not marked completed. | 1 | "The stampless plan-gap runTaskDone test observes exit 1, HALT.class reading plan-gap, and the task row not reading completed." | diff-local |
| Story 1 negative: Given a stampless pending task whose plan declares no Done when block, when `conduct task done` runs, then it exits 0 and task-status.json is unchanged under the legacy close rule. | 1 | "The stampless no-Done-when-block test and the completed-row and skipped-row re-close tests each observe exit 0 with a byte-identical task-status.json." | diff-local |
| Story 2 happy: Given a task row that already reads completed or skipped and no current-task stamp, when `conduct task done` runs without evidence, then it exits 0 and task-status.json is byte-identical. | 1, 2 | "The stampless no-Done-when-block test and the completed-row and skipped-row re-close tests each observe exit 0 with a byte-identical task-status.json." | diff-local |
| Story 2 negative: Given the current-task stamp names a different task, when `conduct task done` runs for this task, then it exits non-zero naming both ids, the stamp file is unchanged, and task-status.json is unchanged. | 1 | "The existing mismatch-guard tests still observe exit 1 naming both ids with the sibling stamp and task-status.json unchanged." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against temporary-directory fixtures. Task 1 owns the runTaskDone unit-level behavior for every criterion, including the retained mismatch guard. Task 2 owns the CLI entry integration (argv parsing through dispatchTaskCommand to the task-status write) for the recording and re-close paths, and the contract-text sync. Existing reopened-task, malformed-state, and plan-gap tests remain as regression coverage. No aggregate or external-service test is added, and no terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2

Small tier: architecture and coherence artifacts are skipped. No new ADR or amendment is required because the change implements existing decisions of adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation and adr-2026-08-22-done-when-evidence-at-task-close.
