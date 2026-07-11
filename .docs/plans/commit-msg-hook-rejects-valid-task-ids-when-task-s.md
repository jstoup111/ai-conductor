# Implementation Plan: commit-msg hook rejects valid Task ids when task-status.json ids are numeric (#501)

**Date:** 2026-07-11
**Track:** technical (no PRD) — see `.docs/track/commit-msg-hook-rejects-valid-task-ids-when-task-s.md`
**Stories:** `.docs/stories/commit-msg-hook-rejects-valid-task-ids-when-task-s.md` (Status: Accepted, TR-1..TR-4)
**Complexity:** Tier S (`.docs/complexity/commit-msg-hook-rejects-valid-task-ids-when-task-s.md`) — conflict-check and architecture artifacts skipped per tier
**Source:** jstoup111/ai-conductor#501 (bug, priority: critical)

## Summary

Fix the string/number task-id comparison mismatch that blocks legitimate commits: canonicalize
ids to strings at task-seed's write point and make the three strict read sites (generated
commit-msg hook, generated PRE dispatch hook, task-cli) type-insensitive, with the commit-msg
rejection naming the ids it did find. 6 tasks.

## Technical Approach

- `.pipeline/task-status.json` rows can carry numeric ids (preserved verbatim by
  `task-seed.ts`'s `{ ...task }` spread); trailer/argv ids are always strings, and three
  read sites compare strictly — every valid numeric id reads as not-found.
- **Read sites** each get a one-line `String(t.id)` normalization at the comparison:
  - `src/conductor/src/engine/git-hook-assets.ts` (~line 193): the embedded node check maps
    `t.id` raw — map via `String(t.id)` instead. Additionally, on a miss the node snippet
    must emit the ids it found so the bash rejection message can name them (change the
    snippet's output from bare `yes`/`no` to `yes` / `no <comma-joined ids>`, and include
    the list in the stderr message at ~line 201).
  - `src/conductor/src/engine/session-hook-assets.ts` (~line 109): `t.id === id` →
    `String(t.id) === id`. The valid-ids stderr listing (~111-115) already exists and
    renders numbers via `join` — keep.
  - `src/conductor/src/engine/task-cli.ts` (~line 121): `findIndex((t) => t.id === id)` →
    `String(t.id) === id`. The valid-ids error listing (~123) already exists — keep.
- **Write site**: `src/conductor/src/engine/task-seed.ts` (~line 173) preserves rows with
  their original id type. Canonicalize: `taskMap.set(String(task.id), { ...task, id: String(task.id) })`.
  Evidence-stamp lookups and plan-task upserts already key by the stringified map key, so
  identity does not fork; the numeric-ordering sort (~231-235) parses via `String()` and is
  unaffected. Any numeric-id file heals on its next seed.
- **Out of scope (already safe — do not touch):** `task-progress.ts#normalizeTasks`,
  `autoheal.ts` (normalizes at :255), the POST dispatch hook (string-to-string stamp
  comparison), `derive-feedback-cli.ts`/watchers (consume `normalizeTasks`).
- **Hook propagation:** the commit-msg and PRE-hook changes live in generated assets;
  `worktree-prepare.ts:303-307` (re)writes them on every worktree preparation, so build
  worktrees pick up the fix at their next dispatch. No install/migration step.
- **Release gate:** the self-host classifier flags `hook wiring` only for paths starting
  `hooks/` or containing a `/hooks/` segment (`release-gate.ts:202`). None of the touched
  files match → no `## Migration` block and no waiver needed. The CHANGELOG `[Unreleased]`
  `Fixed` entry (Task 6) satisfies the changelog gate.
- **Sequencing:** the three read-site fixes and the write-site fix are independent; the two
  commit-msg tasks share a site and are ordered. Each task is TDD (extend the existing test
  file, RED → GREEN). Run tests from `src/conductor` only
  (`cd src/conductor && rtk proxy npx vitest run <file>`), never the worktree root.

## Prerequisites

- `npm install` has been run in `src/conductor` for this worktree (vitest available).

## Tasks

### Task 1: commit-msg hook accepts Task trailers against numeric ids
**Story:** TR-1 (happy paths: numeric-id file accepts `Task: 1`; string-id file unchanged)
**Type:** happy-path

**Steps:**
1. Write failing test in `git-hook-assets.test.ts`: seed a repo fixture whose `.pipeline/task-status.json` has `tasks: [{id: 1}, {id: 2}]` (numeric), commit with trailer `Task: 1` while the build-step marker is present — assert the hook exits 0. Add the string-id twin (`{id: "1"}`) alongside, pinning both shapes.
2. Verify test fails (RED) — numeric case rejected with "not found".
3. Implement: in `COMMIT_MSG_HOOK` (git-hook-assets.ts ~193), map ids via `String(t.id)`.
4. Verify test passes (GREEN); string-shape and task-N-format tests still pass.
5. Commit: "fix: commit-msg hook validates Task trailers type-insensitively (#501)"

**Files:**
- `src/conductor/src/engine/git-hook-assets.ts` — String(t.id) in the embedded validation
- `src/conductor/test/engine/git-hook-assets.test.ts` — numeric-id + string-id acceptance cases

**Dependencies:** none

### Task 2: commit-msg rejection names the ids it did find
**Story:** TR-1 (negative paths: unknown id rejected with found-ids listing; task-N and corrupt-file behavior unchanged)
**Type:** negative-path

**Steps:**
1. Write failing test in `git-hook-assets.test.ts`: numeric-id file `[1, 2, 3]`, commit trailer `Task: 9` — assert exit 1 and stderr contains both `9` and the found ids `1, 2, 3`. Add assertions that a corrupt task-status.json keeps today's rejection behavior and `Task: task-3` still hits the naming-drift rejection.
2. Verify test fails (RED) — current message names no ids.
3. Implement: embedded node snippet emits `no <comma-joined ids>` on a miss (empty list allowed); bash includes the listing in the stderr rejection (e.g. `commit-msg: rejected — Task: 9 not found in task-status.json (found: 1, 2, 3)`).
4. Verify test passes (GREEN).
5. Commit: "fix: commit-msg rejection lists found task ids (#501)"

**Files:**
- `src/conductor/src/engine/git-hook-assets.ts` — rejection message carries found ids
- `src/conductor/test/engine/git-hook-assets.test.ts` — found-ids stderr + unchanged negative behaviors

**Dependencies:** 1

### Task 3: PRE dispatch hook finds task rows type-insensitively
**Story:** TR-2 (happy: numeric row found + stamped; negative: unknown id exits 2 listing valid ids)
**Type:** happy-path

**Steps:**
1. Write failing test in `session-hook-behavior.test.ts`: task-status.json with `tasks: [{id: 1, status: "pending"}]` (numeric), run the PRE hook for id `1` — assert `.pipeline/current-task` is stamped and the row goes `in_progress`. Add the string-id twin and the negative: numeric file `[1, 2]`, dispatch id `7` — exit 2, stderr lists `1, 2`.
2. Verify the numeric case fails (RED).
3. Implement: `session-hook-assets.ts` ~109 → `parsed.tasks.find((t) => t && String(t.id) === id)`.
4. Verify tests pass (GREEN). POST hook untouched.
5. Commit: "fix: PRE dispatch hook matches task ids type-insensitively (#501)"

**Files:**
- `src/conductor/src/engine/session-hook-assets.ts` — String(t.id) in PRE row lookup
- `src/conductor/test/engine/session-hook-behavior.test.ts` — numeric/string-id + unknown-id cases

**Dependencies:** none

### Task 4: task-cli finds task rows type-insensitively
**Story:** TR-3 (happy: numeric row found; negative: unknown id error lists valid ids from a numeric file)
**Type:** happy-path

**Steps:**
1. Write failing test in `task-cli.test.ts`: numeric-id task-status.json, invoke the CLI for id `1` — assert the row updates and the stamp is written. Add the negative: unknown id `9` against numeric `[1, 2]` — non-zero exit, error lists `1, 2`.
2. Verify the numeric case fails (RED).
3. Implement: `task-cli.ts` ~121 → `tasks.findIndex((t) => String(t.id) === id)`.
4. Verify tests pass (GREEN).
5. Commit: "fix: task-cli matches task ids type-insensitively (#501)"

**Files:**
- `src/conductor/src/engine/task-cli.ts` — String(t.id) in findIndex
- `src/conductor/test/engine/task-cli.test.ts` — numeric/string-id + unknown-id cases

**Dependencies:** none

### Task 5: task-seed canonicalizes ids to strings on every write
**Story:** TR-4 (happy: numeric file heals to string ids with statuses preserved; negative: evidence-backed completed row keeps identity, no duplicate rows)
**Type:** happy-path

**Steps:**
1. Write failing test in `task-seed.test.ts`: pre-existing task-status.json with `{id: 2, status: "in_progress"}` (numeric), seed against a plan containing task 2 — assert the written file has `id: "2"` (string) and status preserved. Add: numeric `completed` row backed by an evidence stamp seeds to a single string-id `completed` row (no duplicate under a second key).
2. Verify test fails (RED) — id stays numeric today.
3. Implement: `task-seed.ts` ~173 → `taskMap.set(String(task.id), { ...task, id: String(task.id) })`.
4. Verify tests pass (GREEN); existing seed tests unchanged.
5. Commit: "fix: task-seed canonicalizes task ids to strings (#501)"

**Files:**
- `src/conductor/src/engine/task-seed.ts` — id canonicalization for preserved rows
- `src/conductor/test/engine/task-seed.test.ts` — numeric-heal + identity/no-duplicate cases

**Dependencies:** none

### Task 6: full suite + CHANGELOG entry
**Story:** TR-1..TR-4 (repo gates: changelog on every PR; whole-surface regression check)
**Type:** infrastructure

**Steps:**
1. Run the full conductor suite: `cd src/conductor && rtk proxy npx vitest run` — all green.
2. Run `test/test_harness_integrity.sh` from the repo root — passes.
3. Add a `Fixed` entry under `## [Unreleased]` in `CHANGELOG.md`: commit-msg/PRE-hook/task-cli reject valid `Task: N` trailers when task-status.json ids are numeric; ids now compare type-insensitively, seed canonicalizes to strings, and the commit-msg rejection names the ids it found (#501). No `## Migration` block — no `hooks/` path is touched (release-gate classifier verified), and hook assets re-install on every worktree preparation.
4. Commit: "docs: CHANGELOG entry for #501 task-id type fix"

**Files:**
- `CHANGELOG.md` — [Unreleased] Fixed entry

**Dependencies:** 1, 2, 3, 4, 5

## Task Dependency Graph

```
1 ──▶ 2 ──┐
3 ────────┤
4 ────────┼──▶ 6
5 ────────┘
```

Tasks 1, 3, 4, 5 are independent roots; 2 follows 1 (same site); 6 gates on all.

## Integration Points

- After Task 2: a real worktree prepared by `worktree-prepare` gets the fixed commit-msg hook —
  a numeric-id task-status.json accepts `Task: N` end-to-end and rejections are diagnosable.
- After Task 5: seeding any legacy numeric-id file converges it to canonical string ids.

## Coverage

| Story criterion | Task(s) |
| --- | --- |
| TR-1 happy (numeric + string accept) | 1 |
| TR-1 negatives (unknown id + found-ids listing; task-N; corrupt file unchanged) | 2 |
| TR-2 happy (numeric + string row found/stamped) | 3 |
| TR-2 negative (unknown id lists valid ids) | 3 |
| TR-3 happy (numeric row found) | 4 |
| TR-3 negative (unknown id lists valid ids) | 4 |
| TR-4 happy (heal to strings, statuses preserved) | 5 |
| TR-4 negative (evidence-backed identity, no duplicates) | 5 |
| Repo gates (CHANGELOG, integrity, full suite) | 6 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
