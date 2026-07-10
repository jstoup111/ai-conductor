# Implementation Plan: Deterministic Build Evidence Attribution (#433)

**Date:** 2026-07-09
**Design:** .docs/decisions/adr-2026-07-09-deterministic-evidence-attribution-enforcement.md (APPROVED)
**Stories:** .docs/stories/deterministic-evidence-attribution.md (Status: Accepted)
**Conflict check:** Clean as of 2026-07-09 (.docs/conflicts/deterministic-evidence-attribution.md)
**Tier:** M (.docs/complexity/deterministic-evidence-attribution.md)

## Summary

Moves `Task:` trailer attribution from prompt discipline to machinery: an engine-owned
`conduct-ts task start|done` CLI, two pure-bash git hooks written into each build worktree at
provisioning, and a pipeline-SKILL step-0 contract change. 19 tasks.

## Technical Approach

- **Hook scripts as engine-embedded assets.** The two hook scripts live as template-literal
  string constants in a new `src/conductor/src/engine/git-hook-assets.ts` (single source; a test
  writes them to a temp dir and runs `bash -n`). They ship inside the bundled dist — no
  `publish-engine.mjs` change, no loose asset files to go stale, no reference into the harness
  checkout after provisioning (ADR: "assets of the installed engine package"). `prepareWorktree`
  writes them executable to `<worktree>/.pipeline/git-hooks/` and wires
  `git config extensions.worktreeConfig true` + `git config --worktree core.hooksPath <abs>`,
  fail-open with a logged skip on any failure.
- **`conduct-ts task` CLI** (`src/conductor/src/engine/task-cli.ts`) mirrors the
  `derive-feedback-cli.ts` pattern: `detectTaskCommand(argv)` + `runTaskCommand(...)` dispatched
  from `src/conductor/src/index.ts`, listed in `src/conductor/src/cli.ts` help. `start <id>`
  validates against the seeded rows in `.pipeline/task-status.json`, flips the row to
  `in_progress` via temp+rename (same discipline as `task-evidence.ts`), writes
  `.pipeline/current-task`; `done <id>` clears the stamp (mismatch-guarded, double-clear no-op)
  and never touches completion status (gate authority preserved, #302).
- **Hook logic** (bash + `node -e` stdlib JSON only): `prepare-commit-msg` appends
  `Task: <id>` via `git interpret-trailers --in-place` when no trailer exists — id from
  `current-task`, else the unique `in_progress` row; abstains on ambiguity, amend
  (`$2 = commit`), rebase in progress (`test -d "$(git rev-parse --git-path rebase-merge)"` /
  `rebase-apply` — `test -d`, never the bare printout), or corrupt JSON. `commit-msg` rejects
  unknown/`task-N` trailer ids (naming the valid set) and empty commits lacking a resolvable
  `Evidence: satisfied-by <sha>`; warns (exit 0) on multi-task bundling and subject-vs-trailer
  mismatch; chains to `$GIT_COMMON_DIR/hooks/<name>` (chained non-zero fails the commit).
- **Sequencing:** assets → CLI → seed-clear → provisioning wiring → end-to-end integration tests
  in a real scratch git repo (worktree + hooks live) → SKILL + docs. Integration tests use the
  repo's vitest (`rtk proxy npx vitest run` in `src/conductor`); every commit here passes
  `test/test_harness_integrity.sh` first.
- **Release surfaces:** `conduct-ts task` is additive (MINOR). The release-gate classifier will
  flag `hook wiring`; the wiring is engine-set per-worktree with zero consumer action, so the PR
  carries either a real migration block (if `settings.json`/hook wiring semantics change — they
  do not) or an internal-only waiver per adr-2026-07-06-migration-gate-waiver, decided from the
  actual `base...HEAD` diff at finish time (Task 19 records the decision in CHANGELOG.md).

## Prerequisites

None beyond a checked-out worktree with `src/conductor` node_modules installed (each worktree
needs its own `npm install` in `src/conductor` — known RTK/vitest note).

## Tasks

### Task 1: Embed hook scripts as engine assets with syntax proof
**Story:** Story 4 & 5 (hook existence); Story 6 Done When ("ship as assets of the engine package")
**Type:** infrastructure

**Steps:**
1. Write failing test: `git-hook-assets.test.ts` — exports `PREPARE_COMMIT_MSG_HOOK` and
   `COMMIT_MSG_HOOK` non-empty strings starting `#!/bin/bash`; writing each to a temp file and
   running `bash -n` exits 0; neither string contains `src/conductor/dist` nor `conduct-ts`
   (no engine-dist/CLI invocation — #403 class, Story 4 Done When).
2. Verify test fails (RED)
3. Implement: `git-hook-assets.ts` exporting the two full hook scripts as template literals
   (logic per Technical Approach; chaining stub included, real behavior tested in Tasks 12–17).
4. Verify test passes (GREEN)
5. Commit: "feat: embed prepare-commit-msg/commit-msg hook scripts as engine assets"

**Files:**
- src/conductor/src/engine/git-hook-assets.ts
- src/conductor/test/engine/git-hook-assets.test.ts

**Dependencies:** none

### Task 2: `task` CLI detection and guide output
**Story:** Story 1/2 (CLI surface exists)
**Type:** infrastructure

**Steps:**
1. Write failing test: `task-cli.test.ts` — `detectTaskCommand(['node','conduct','task','start','7'])`
   → `{kind:'start', id:'7'}`; `done 7` → `{kind:'done', id:'7'}`; bare `task` / unknown verb /
   missing id → `{kind:'guide'}`; non-`task` argv → null.
2. Verify RED
3. Implement `detectTaskCommand` + guide text (usage lines, mirrors derive-feedback-cli shape).
4. Verify GREEN
5. Commit: "feat: detect conduct-ts task subcommand argv"

**Files:**
- src/conductor/src/engine/task-cli.ts
- src/conductor/test/engine/task-cli.test.ts

**Dependencies:** none

### Task 3: `task start` happy path — in_progress flip + current-task stamp
**Story:** Story 1 happy paths
**Type:** happy-path

**Steps:**
1. Write failing test: seeded `task-status.json` (rows 1..12 pending) in a temp project root;
   `runTaskStart(root,'7')` → exit code 0 semantics, row 7 `in_progress`, other rows untouched,
   `.pipeline/current-task` content exactly `7`; second call with `8` overwrites stamp to `8`.
2. Verify RED
3. Implement: read+validate id against rows, atomic temp+rename write, stamp file.
4. Verify GREEN
5. Commit: "feat: task start marks in_progress and stamps current-task"

**Files:**
- src/conductor/src/engine/task-cli.ts
- src/conductor/test/engine/task-cli.test.ts

**Dependencies:** 2

### Task 4: `task start` negative paths — unknown id, missing file, corrupt JSON
**Story:** Story 1 negative paths 1–3
**Type:** negative-path

**Steps:**
1. Write failing tests: unknown id `99` → non-zero, stderr lists valid ids, `task-status.json`
   byte-identical, no `current-task` written; absent `task-status.json` → non-zero naming the
   missing file, nothing written; corrupt JSON → non-zero, corrupt file NOT overwritten/truncated,
   no stamp.
2. Verify RED
3. Implement the three guard paths with instructive stderr.
4. Verify GREEN
5. Commit: "test+fix: task start rejects unknown id, missing and corrupt seed file"

**Files:** same as Task 3

**Dependencies:** 3

### Task 5: `task start` atomicity under concurrent writers
**Story:** Story 1 negative path 4 (racing invocations → valid JSON, one full write wins)
**Type:** negative-path

**Steps:**
1. Write failing test: fire N concurrent `runTaskStart` calls (distinct ids) via Promise.all;
   afterwards `task-status.json` parses as valid JSON and equals one invocation's complete
   output (never torn) — same pattern as the task-evidence.ts concurrent-writes test.
2. Verify RED (or prove GREEN if temp+rename from Task 3 already satisfies; then strengthen the
   assertion to unique-temp-file naming and keep the test as the regression lock)
3. Implement/adjust: unique temp file per writer in the same directory + `rename(2)`.
4. Verify GREEN
5. Commit: "test: task start survives concurrent invocations without torn writes"

**Files:** same as Task 3

**Dependencies:** 3

### Task 6: `task done` — clear, mismatch guard, double-clear no-op, no completion stamping
**Story:** Story 2 (all paths)
**Type:** happy-path

**Steps:**
1. Write failing tests: after `start 7`, `done 7` removes `current-task`, exits 0, row 7 still
   `in_progress` (never `completed`); `done 7` while stamp is `8` → non-zero, stamp intact,
   error names both ids; `done 7` with no stamp → exit 0 no-op.
2. Verify RED
3. Implement `runTaskDone` accordingly.
4. Verify GREEN
5. Commit: "feat: task done clears current-task with mismatch guard"

**Files:** same as Task 3

**Dependencies:** 3

### Task 7: Wire `task` subcommand into the CLI entrypoint
**Story:** Story 1/2 (CLI reachable as `conduct-ts task ...`)
**Type:** infrastructure

**Steps:**
1. Write failing test: index dispatch test (same seam as detectDeriveFeedbackCommand wiring)
   routes `task start|done` argv to the runner before feature-description fallback; `cli.ts`
   help output lists the `task` subcommand.
2. Verify RED
3. Implement: import + dispatch in `index.ts`, help entry in `cli.ts`.
4. Verify GREEN
5. Commit: "feat: dispatch conduct-ts task start/done from CLI entrypoint"

**Files:**
- src/conductor/src/index.ts
- src/conductor/src/cli.ts
- src/conductor/test/engine/task-cli.test.ts

**Dependencies:** 3, 6

### Task 8: Build-entry stale-stamp clear in task seeding
**Story:** Story 3 (all paths)
**Type:** happy-path

**Steps:**
1. Write failing tests in `task-seed.test.ts`: stale `.pipeline/current-task` exists →
   `seedTaskStatus` removes it before returning; absent file → seeding unchanged, no file
   created; removal failure (mock rm rejection) → logged warning, seeding still succeeds.
2. Verify RED
3. Implement the clear inside `seedTaskStatus` (fail-open, `console.warn` on rm failure).
4. Verify GREEN
5. Commit: "feat: clear stale current-task at build-entry seeding"

**Files:**
- src/conductor/src/engine/task-seed.ts
- src/conductor/test/engine/task-seed.test.ts

**Dependencies:** none (parallel with CLI tasks)

### Task 9: `prepareWorktree` writes hook files into the worktree
**Story:** Story 6 happy path 1 (hooks exist executable under `.pipeline/git-hooks/`)
**Type:** happy-path

**Steps:**
1. Write failing test in `worktree-prepare.test.ts`: after `prepareWorktree(wt)` on a scratch
   git worktree, `.pipeline/git-hooks/prepare-commit-msg` and `.../commit-msg` exist, are
   executable (mode & 0o111), and byte-equal the embedded assets.
2. Verify RED
3. Implement `writeGitHooks(worktreePath)` called from `prepareWorktree` (before `bin/setup`,
   so hooks exist even if setup later fails).
4. Verify GREEN
5. Commit: "feat: prepareWorktree writes attribution git hooks into the worktree"

**Files:**
- src/conductor/src/engine/worktree-prepare.ts
- src/conductor/test/engine/worktree-prepare.test.ts

**Dependencies:** 1

### Task 10: Worktree-scoped hooksPath wiring with primary-checkout isolation
**Story:** Story 6 happy paths 1–2
**Type:** happy-path

**Steps:**
1. Write failing test: after `prepareWorktree(wt)` on a real repo+worktree,
   `git -C wt config extensions.worktreeConfig` = true and `git -C wt config core.hooksPath`
   = absolute `.pipeline/git-hooks` path; `git -C mainCheckout config core.hooksPath` unset;
   existing namespace/`bin/setup` behavior asserted unchanged (existing tests stay green).
2. Verify RED
3. Implement the two `git config` calls via execa in `writeGitHooks`/`wireGitHooks`.
4. Verify GREEN
5. Commit: "feat: wire worktree-scoped core.hooksPath at provisioning"

**Files:** same as Task 9

**Dependencies:** 9

### Task 11: Fail-open wiring — old git, config failure, write failure
**Story:** Story 6 negative paths 1–3
**Type:** negative-path

**Steps:**
1. Write failing tests: `git config --worktree` failing (simulate via injected exec that
   rejects) → provisioning resolves successfully, log sink received a skip line naming the
   reason, no partial config left enabled; hook-write failure (unwritable dir) → same fail-open
   + logged skip; `bin/setup` contract untouched in both.
2. Verify RED
3. Implement try/catch around wiring with the logged skip (daemon log sink param already
   threaded through `prepareWorktree`).
4. Verify GREEN
5. Commit: "feat: hook wiring is fail-open with a logged skip"

**Files:** same as Task 9

**Dependencies:** 10

### Task 12: Integration — auto-stamp happy paths (current-task, pre-trailered, fallback)
**Story:** Story 4 happy paths
**Type:** happy-path

**Steps:**
1. Write failing integration test `git-hooks-attribution.test.ts`: scratch repo + worktree wired
   by `prepareWorktree`; seeded status + `current-task` `7`; untrailered commit gains `Task: 7`
   trailer (via `git log --format`); message already carrying `Task: 9` is unchanged; with
   `current-task` absent and exactly one row `in_progress`, that id is stamped.
2. Verify RED
3. Implement/fix hook script details in `git-hook-assets.ts` until green.
4. Verify GREEN
5. Commit: "test: auto-stamp stamps current task and respects existing trailers"

**Files:**
- src/conductor/test/integration/git-hooks-attribution.test.ts
- src/conductor/src/engine/git-hook-assets.ts

**Dependencies:** 9, 10 (uses wired worktree); 3 (stamp writer)

### Task 13: Integration — auto-stamp abstain paths
**Story:** Story 4 negative paths (ambiguous, rebase, amend, corrupt JSON)
**Type:** negative-path

**Steps:**
1. Write failing tests: zero and two `in_progress` rows with no `current-task` → commit lands
   untrailered; `git commit --amend` does not (re)stamp; during an in-progress rebase
   (`rebase-merge` dir present) replayed commit is not restamped; corrupt `task-status.json` →
   hook abstains, commit lands, exit 0.
2. Verify RED
3. Implement abstain guards in the hook script.
4. Verify GREEN
5. Commit: "test: auto-stamp abstains on ambiguity, amend, rebase, corrupt state"

**Files:** same as Task 12

**Dependencies:** 12

### Task 14: Integration — commit-msg reject/accept core
**Story:** Story 5 happy paths + negative paths 1–3, 5
**Type:** negative-path

**Steps:**
1. Write failing tests: `Task: 7` + non-empty diff lands; `Task: 99` and `Task: task-7`
   rejected non-zero with valid-id set in stderr; empty commit with bare `Task: 7` rejected
   showing the `Evidence: satisfied-by <sha>` form; empty commit with resolvable satisfied-by
   sha lands; `satisfied-by deadbeef` (nonexistent) rejected; untrailered non-empty commit
   passes.
2. Verify RED
3. Implement validation logic in the commit-msg script (id set via node stdlib JSON read;
   sha check via `git cat-file -e <sha>^{commit}`).
4. Verify GREEN
5. Commit: "test: commit-msg rejects unknown ids and bare-trailer empty commits"

**Files:** same as Task 12

**Dependencies:** 12

### Task 15: Integration — advisory warnings (bundling, subject-vs-trailer mismatch)
**Story:** Story 5 negative paths 4 & 6 (warn-only; conflict-check resolution 2026-07-09)
**Type:** negative-path

**Steps:**
1. Write failing tests: staged diff spanning files of two plan tasks (plan-task file mapping
   provided via seeded rows' `files` when present — otherwise heuristic on `Files:` sidecar;
   keep the check best-effort) → stderr WARNING, exit 0; subject "fix Task 5 edge" with trailer
   `Task: 7` → mismatch WARNING, exit 0; both commits land.
2. Verify RED
3. Implement the two warn branches (never non-zero).
4. Verify GREEN
5. Commit: "test: commit-msg warns without blocking on bundling and subject mismatch"

**Files:** same as Task 12

**Dependencies:** 14

### Task 16: Integration — chaining to the repo's own hooks
**Story:** Story 6 happy path 3
**Type:** happy-path

**Steps:**
1. Write failing tests: a `$GIT_COMMON_DIR/hooks/commit-msg` marker script runs after ours with
   the same args (marker file written); a chained hook exiting 1 fails the commit; absent or
   non-executable common hook → no error.
2. Verify RED
3. Implement chaining epilogue in both hook scripts.
4. Verify GREEN
5. Commit: "feat: attribution hooks chain to the repository's own hooks"

**Files:** same as Task 12

**Dependencies:** 12

### Task 17: No-dist-dependency regression lock
**Story:** Story 4 Done When (grep proof), ADR #403-class clause
**Type:** negative-path

**Steps:**
1. Write failing test (extend `git-hook-assets.test.ts`): assert neither hook string references
   `dist/`, `conduct`, `npm`, or `npx` — the scripts may invoke only `git`, `node -e`, and
   POSIX tools (allowlist grep).
2. Verify RED (if any reference slipped in during 12–16) or lock GREEN
3. Adjust scripts if needed.
4. Verify GREEN
5. Commit: "test: hooks are engine-dist-free (403-class regression lock)"

**Files:**
- src/conductor/test/engine/git-hook-assets.test.ts
- src/conductor/src/engine/git-hook-assets.ts

**Dependencies:** 16 (final hook contents)

### Task 18: Pipeline SKILL step 0 delegates to the CLI
**Story:** Story 7 (all paths)
**Type:** infrastructure

**Steps:**
1. Edit `skills/pipeline/SKILL.md` step 0 (and the task-status references at lines ~47/59/311):
   instruct `conduct-ts task start <id>` before dispatch, `conduct-ts task done <id>` after the
   task's commit lands; remove hand-edit instructions for the in-flight flip; document the
   self-announcing failure mode (forgotten start → forward-progress check trips); keep the
   crash-recovery guidance (set back to pending) consistent with the CLI.
2. Run `test/test_harness_integrity.sh` — must pass.
3. Commit: "docs(skill): pipeline step 0 uses conduct-ts task start/done"

**Files:**
- skills/pipeline/SKILL.md

**Dependencies:** 7

### Task 19: Docs + CHANGELOG + migration/waiver decision
**Story:** Story 7 Done When (docs rule); plan Release-surfaces note
**Type:** infrastructure

**Steps:**
1. Document `conduct-ts task start|done` in `README.md` and `src/conductor/README.md`
   (subcommand reference + the hook-wiring behavior of daemon worktrees, incl. fail-open and
   chaining).
2. Add CHANGELOG `[Unreleased]` entries (Added: task CLI, attribution hooks; Changed: pipeline
   SKILL step 0). Decide migration-vs-waiver from the actual diff: wiring is engine-internal
   per-worktree with no consumer action and no `settings.json`/existing-hook semantic change →
   expected outcome is a waiver file `.docs/release-waivers/deterministic-evidence-attribution.md`
   with `Waives: hook wiring` and rationale; if the diff turns out to touch a canonical surface
   behaviorally, write a real `## Migration` block instead.
3. Run `test/test_harness_integrity.sh`.
4. Commit: "docs: task CLI + attribution hooks; changelog + release-surface decision"

**Files:**
- README.md
- src/conductor/README.md
- CHANGELOG.md
- .docs/release-waivers/deterministic-evidence-attribution.md

**Dependencies:** 18

## Task Dependency Graph

```
1 ──────────────► 9 ──► 10 ──► 11
2 ──► 3 ──► 4                └───────────┐
      │ └──► 5                           │
      │ └──► 6 ──► 7 ──► 18 ──► 19       │
      └──────────────► 12 ◄──────────────┘
                       ├──► 13
                       ├──► 14 ──► 15
                       └──► 16 ──► 17
8 (independent)
```

## Integration Points

- After Task 7: `conduct-ts task start/done` usable end-to-end in any seeded worktree.
- After Task 11: provisioning wires hooks in real worktrees (fail-open verified).
- After Task 16: full commit-time enforcement demonstrable in a scratch repo — the #433
  Case 1/2 reproductions can be replayed and observed fixed.

## Coverage Mapping

| Story criterion | Task(s) |
|---|---|
| S1 happy (flip + stamp, overwrite) | 3 |
| S1 neg (unknown id / missing / corrupt / race) | 4, 5 |
| S2 all (clear, no-completion, mismatch, double-clear) | 6 |
| S3 all (stale clear, absent, rm failure) | 8 |
| S4 happy (stamp, pre-trailered, fallback) | 12 |
| S4 neg (ambiguous, rebase, amend, corrupt) | 13 |
| S4 Done When (no-dist grep) | 17 |
| S5 happy + reject paths | 14 |
| S5 warn paths (bundling, subject mismatch) | 15 |
| S5 "no new failure mode" (untrailered passes) | 14 |
| S6 happy (files, config, isolation, chaining) | 9, 10, 16 |
| S6 neg (fail-open old git / copy failure / setup contract) | 11 |
| S6 Done When (engine-package assets) | 1 |
| S7 all (SKILL contract, integrity, docs) | 18, 19 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
