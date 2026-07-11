**Status:** Accepted

# Stories: commit-msg hook rejects valid Task ids when task-status.json ids are numeric (#501)

Track: technical — no PRD; stories derive from the technical intent (operator-approved
Approach A, `.memory/decisions/2026-07-11-501-task-id-type-mismatch-approach.md`).
Tier: S. Source: jstoup111/ai-conductor#501 (bug, priority: critical).

Context: `.pipeline/task-status.json` files exist in the wild with numeric task ids
(`tasks: [{id: 1, …}]`) as well as string ids. Trailer/argv ids are always strings, and
three read sites compare strictly — so every valid numeric id is rejected. Engine-side
TS readers (`task-progress.ts#normalizeTasks`, `autoheal.ts`) already normalize and are
out of scope, as is the POST dispatch hook (string-to-string stamp comparison).

## Story: Commit-msg hook validates Task trailers type-insensitively and names found ids on rejection

**Requirement:** TR-1 (issue outcomes 1 + 3, commit-msg surface — `git-hook-assets.ts`)

As a harness operator, I want the generated commit-msg hook to accept a `Task: N` trailer
whenever a task with that id exists in task-status.json regardless of the id's JSON type,
and to name the ids it did find when it rejects, so that legitimate commits are never
blocked by a type mismatch and any future mismatch is diagnosable from the error alone.

### Acceptance Criteria

#### Happy Path
- Given a worktree whose `.pipeline/task-status.json` carries numeric ids (`tasks: [{id: 1}, {id: 2}]`), when a commit message carries trailer `Task: 1`, then the generated commit-msg hook exits 0 and the commit proceeds.
- Given a `.pipeline/task-status.json` with string ids (`tasks: [{id: "1"}, {id: "2"}]`), when a commit message carries trailer `Task: 1`, then the hook exits 0 (existing behavior preserved — both shapes validate identically).

#### Negative Paths
- Given `.pipeline/task-status.json` with ids `[1, 2, 3]` (numeric), when a commit message carries trailer `Task: 9`, then the hook exits 1 and its stderr rejection message includes both the rejected id `9` and the list of ids it did find (`1, 2, 3`).
- Given any task-status.json, when a commit message carries trailer `Task: task-3`, then the hook exits 1 with the existing task-N naming-drift rejection (unchanged by this fix).
- Given a malformed (unparseable JSON) `.pipeline/task-status.json`, when a commit with trailer `Task: 1` is attempted, then the hook's existing degradation behavior is unchanged (the embedded node check yields "no" and the rejection fires) — the fix must not alter the #494 degradation rule for corrupt/missing files.

### Done When
- [ ] `git-hook-assets.ts` commit-msg validation compares `String(t.id)` against the trailer (or an equivalent type-insensitive comparison at that site).
- [ ] The rejection message for an unknown trailer id names the ids present in task-status.json (e.g. `commit-msg: rejected — Task: 9 not found in task-status.json (found: 1, 2, 3)`).
- [ ] `src/conductor/test/engine/git-hook-assets.test.ts` has cases pinning BOTH id shapes: numeric ids accept a matching trailer, string ids accept a matching trailer, and an unknown trailer is rejected with the found-ids listing asserted in stderr.
- [ ] Existing task-N-format rejection tests still pass unmodified.

## Story: PRE dispatch hook resolves the task row type-insensitively

**Requirement:** TR-2 (issue outcome 1, PRE-hook surface — `session-hook-assets.ts`)

As a harness operator, I want the generated PRE dispatch hook to find the task row for a
dispatched id whether the row's id is `1` or `"1"`, so that task dispatch stamping never
fails against a numeric-id task-status.json.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/task-status.json` with numeric ids (`tasks: [{id: 1, status: "pending"}]`), when the PRE dispatch hook runs for task id `1`, then it finds the row, stamps `.pipeline/current-task`, and marks the row `in_progress` (exit 0).
- Given the same file with string ids, when the PRE hook runs for id `1`, then behavior is identical (existing behavior preserved).

#### Negative Paths
- Given `.pipeline/task-status.json` with ids `[1, 2]` (numeric), when the PRE hook runs for unknown id `7`, then it exits 2 and stderr names the valid ids (`1, 2`) — the existing valid-ids listing keeps working for numeric rows (no `undefined`/empty listing).

### Done When
- [ ] `session-hook-assets.ts` PRE hook row lookup compares `String(t.id)` against the dispatched id.
- [ ] `src/conductor/test/engine/session-hook-behavior.test.ts` has cases pinning both id shapes for the PRE hook: numeric-id row found + stamped, string-id row found + stamped, unknown id rejected with valid ids listed.
- [ ] The POST dispatch hook is untouched (stamp content comparison is already string-to-string).

## Story: task-cli resolves task rows type-insensitively

**Requirement:** TR-3 (issue outcome 1, task-cli surface — `task-cli.ts`)

As a harness operator, I want `task-cli` start/done operations to locate the task row
whether its id is numeric or string, so that engine-invoked task lifecycle operations
never fail against a numeric-id task-status.json.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/task-status.json` with numeric ids, when task-cli is invoked for id `1`, then the row is found and the operation proceeds exactly as it does today for string ids (row updated, stamp written).

#### Negative Paths
- Given `.pipeline/task-status.json` with numeric ids `[1, 2]`, when task-cli is invoked for unknown id `9`, then it exits non-zero and the existing error still prints the valid ids it found (listing renders `1, 2`, not empty).

### Done When
- [ ] `task-cli.ts` row lookup (`findIndex`) compares `String(t.id)` against the argv id.
- [ ] `src/conductor/test/engine/task-cli.test.ts` has cases pinning both id shapes: numeric-id row found, string-id row found, unknown id error listing valid ids from a numeric-id file.

## Story: task-seed canonicalizes ids to strings on every write

**Requirement:** TR-4 (write-site canonicalization — `task-seed.ts`; issue outcome 2's "numeric shape exists in the wild" heals on next seed)

As a harness operator, I want every task-status.json written by the seed step to carry
string ids only — including rows preserved from a pre-existing numeric-id file — so that
the file converges to one canonical shape and downstream readers (including the warn-only
bundling check) never see mixed types.

### Acceptance Criteria

#### Happy Path
- Given a pre-existing `.pipeline/task-status.json` with numeric ids and statuses worth preserving (e.g. `{id: 2, status: "in_progress"}`), when the seed step runs against a plan containing those tasks, then the written file carries `id: "2"` (string) with the preserved status intact — id type is canonicalized, nothing else about the merge changes.
- Given no pre-existing file, when the seed step runs, then all written ids are strings (current behavior for plan-derived rows, now pinned).

#### Negative Paths
- Given a pre-existing row whose id is numeric and whose status is `completed` backed by an evidence stamp, when the seed runs, then the row is still recognized as the same task (no duplicate row created under a string key alongside the numeric original) and remains `completed` — canonicalization must not break evidence-stamp matching or fork task identity.

### Done When
- [ ] `task-seed.ts` serializes every task id as a string (preserved rows included) at the single write point.
- [ ] `src/conductor/test/engine/task-seed.test.ts` has a case seeding over a numeric-id file and asserting the output ids are strings with statuses preserved, and a case asserting no duplicate rows are created when a numeric-id row matches a plan task.
