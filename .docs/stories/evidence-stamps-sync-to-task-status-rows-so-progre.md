**Status:** Accepted

# Stories: Evidence stamps sync to task-status rows so progress displays are honest (#526)

Technical track — acceptance criteria derive from the engine bug in
jstoup111/ai-conductor#526 (defect a: a correctly-derived `evidenceStamps` entry never synced
to `.pipeline/task-status.json`, so `in_progress` rows with real committed+stamped work stay
uncounted and the stall detector exhausts retries).

Ground truth from the issue: commit `687334d8` carries a clean `Task: 26` trailer;
`task-evidence.json` `evidenceStamps` records `"26": { sha, form: "trailer" }` correctly — yet
`task-status.json` still shows task 26 `in_progress`, never flipped to `completed`, because
`applyDerivedCompletion` only advances rows whose status is `pending`. The stall-detector and
progress readers count rows, not stamps, and lie.

Single source of truth: `evidenceStamps` is authoritative for row completion. A stamp existing
while its row disagrees must not survive one reconciliation pass.

## Story: A stamped in_progress row syncs to completed (RS-1)

As the conductor engine, I want any task with an `evidenceStamps` entry to have its
`task-status.json` row read `completed`, regardless of whether the row was `pending` or
`in_progress`, so that progress and stall readers (which count rows) tell the truth.

### Acceptance Criteria

#### Happy Path
- Given a `task-status.json` where task 26's row is `in_progress` and `evidenceStamps` contains
  a `"26"` entry, when the stamp→row reconciliation runs, then task 26's row status becomes
  `completed` and the file is persisted.
- Given a `pending` row with a matching stamp, when reconciliation runs, then its status becomes
  `completed` (existing pending-sync behavior preserved).
- Given the build gate cycle for a plan where all N tasks are stamped but several rows are still
  `in_progress`, when the gate evaluates, then after reconciliation all N rows read
  `completed`/`skipped` and a row-counting progress reader reports N/N (not the stalled count).

#### Negative Paths
- Given a row whose status is already `completed` or `skipped`, when reconciliation runs, then
  its status and `commit` field are left byte-unchanged (terminal rows are never rewritten).
- Given a plan task with NO `evidenceStamps` entry, when reconciliation runs, then its row is
  never advanced to `completed` (rows only advance on stamp presence — no stamp, no completion).

### Done When
- [ ] A stamped `in_progress` row is flipped to `completed` by the reconciliation pass.
- [ ] A no-stamp row is left non-terminal after reconciliation.
- [ ] A terminal (completed/skipped) row is untouched.

## Story: A stamp for an unknown row id does not invent a row and logs the mismatch (RS-2)

As the conductor engine, I want a stamp whose task id has no corresponding row to be reported,
not materialized, so that reconciliation never fabricates completion for a task the plan/status
file does not know about.

### Acceptance Criteria

#### Happy Path
- Given `evidenceStamps` containing an id (e.g. `"99"`) that has no row in `task-status.json`,
  when reconciliation runs, then no `"99"` row is created, every existing row is left as-is, and
  a single greppable mismatch warning naming the orphan id is logged.
- Given a mix of one matching stamp (`"7"`, row `in_progress`) and one orphan stamp (`"99"`),
  when reconciliation runs, then row 7 becomes `completed`, no row 99 is invented, and the
  orphan is logged — the orphan never blocks or aborts syncing the valid stamp.

#### Negative Paths
- Given a stamp whose id matches no row and a `task-status.json` that is missing/corrupt/has zero
  rows, when reconciliation runs, then it is a no-op (nothing written, no throw) and the orphan
  condition is logged best-effort — reconciliation never throws into its callers.

### Done When
- [ ] An orphan stamp id produces no new row and a distinct, greppable warning.
- [ ] A valid stamp in the same pass still syncs despite a co-present orphan.

## Story: Every stamp-write path reconciles rows (RS-3)

As the conductor engine, I want every path that writes an `evidenceStamps` entry
(`applyDerivedCompletion` for trailer/evidence derivation and `writeJudgedStamps` for the judged
attribution lane) to reconcile `task-status.json` in the same operation, so a stamp and its row
can never diverge past the write that created the stamp.

### Acceptance Criteria

#### Happy Path
- Given `applyDerivedCompletion` runs for a plan with an `in_progress` row whose stamp exists,
  when it completes, then that row reads `completed` on disk (not just `pending` rows).
- Given `writeJudgedStamps` records a `semantic-verified` stamp for a task whose row is
  `in_progress`, when it returns, then that task's row reads `completed` on disk.

#### Negative Paths
- Given `writeJudgedStamps` validates a task id that has no row in `task-status.json`, when it
  returns, then no row is invented and the mismatch is logged (RS-2 behavior holds at this call
  site too).
- Given `writeJudgedStamps` runs in a project with no `task-status.json` at all, when it returns,
  then stamps are still written to the sidecar and no error is raised (reconciliation degrades to
  a logged no-op).

### Done When
- [ ] `applyDerivedCompletion` advances stamped `in_progress` rows, not only `pending` rows.
- [ ] `writeJudgedStamps` reconciles rows after persisting stamps.
- [ ] Both call sites exhibit the RS-2 orphan/no-status-file safety.
