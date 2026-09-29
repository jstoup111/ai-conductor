**Status:** Accepted

# Stories: Record task done completion without a current-task stamp (#2809)

Track: technical

Tier: S

Approved by the operator on 2026-09-28 (delegated). The approved ADRs make the current-task stamp non-authoritative telemetry and make Done when evidence the close boundary, so a stampless close records completion under the same contract as a stamped close.

## Story 1: A stampless close records completion under the Done when contract

As a build orchestrator on a host that never wrote the current-task stamp, I want `conduct task done` to record the task's completion so that finished work is not left open behind a success exit.

### Acceptance Criteria

#### Happy Path

- Given a pending task whose active plan declares a Done when block, no current-task stamp, and no open repair, when `conduct task done` runs with evidence for every declared check, then each check's evidence is recorded on the task row, the row reads completed, and the command exits 0.

#### Negative Paths

- Given the same stampless pending task, when `conduct task done` runs without evidence for a declared check, then it exits non-zero naming the missing check and task-status.json is unchanged.
- Given a stampless pending task whose Done when check cannot be met, when `conduct task done` runs with a plan-gap request, then the classified plan-gap halt is written and the task row is not marked completed.
- Given a stampless pending task whose plan declares no Done when block, when `conduct task done` runs, then it exits 0 and task-status.json is unchanged under the legacy close rule.

### Done When

- [ ] A stampless close with full evidence leaves the row completed with one doneWhen record per declared check.
- [ ] A stampless close missing evidence exits 1 with the missing-check message and a byte-identical task-status.json.
- [ ] A stampless plan-gap request writes the plan-gap halt marker and leaves the row not completed.
- [ ] The command guide, the pipeline skill, and the CLI reference no longer describe a stampless close as an exit-0 no-op for a Done when task.

## Story 2: Idempotent re-close and sibling-stamp safety are preserved

As an operator re-running a recovery command, I want an already-closed task to stay a harmless exit 0 and a sibling's stamp to stay protected so that the fix adds no new failure or cross-task damage.

### Acceptance Criteria

#### Happy Path

- Given a task row that already reads completed or skipped and no current-task stamp, when `conduct task done` runs without evidence, then it exits 0 and task-status.json is byte-identical.

#### Negative Paths

- Given the current-task stamp names a different task, when `conduct task done` runs for this task, then it exits non-zero naming both ids, the stamp file is unchanged, and task-status.json is unchanged.

### Done When

- [ ] Stampless re-close of a completed row and of a skipped row each exit 0 with a byte-identical task-status.json.
- [ ] A close against a sibling's stamp exits 1, names both ids, and leaves the stamp and task-status.json unchanged.

## Negative-category review

Invalid input is covered by missing evidence and by a plan-gap request in place of a close. Data integrity is covered by asserting byte-identical task-status.json on every refusal and re-close and by the legacy no-block case staying unchanged. Concurrent access is covered by the sibling-stamp guard, which stays unchanged. Idempotency is covered by the already-completed and skipped re-close. Malformed present repair or engine state already refuses before this branch and is retained by existing tests. The command performs no network, queue, upload, deletion cascade, or multi-step transaction; those categories are inapplicable.
