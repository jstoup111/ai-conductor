# Implementation Plan: tmux-leak-guard fail-closed hardening (#437)

**Date:** 2026-07-10
**Design:** technical track — no PRD; decision record `.memory/decisions/tmux-leak-guard-fail-closed-approach.md`
**Stories:** `.docs/stories/tmux-leak-guard-fails-open-transient-snapshot-fail.md`
**Conflict check:** skipped per Tier S (`.docs/complexity/tmux-leak-guard-fails-open-transient-snapshot-fail.md`)

## Summary

Close the fail-open path in the #377 tmux-leak-guard: a failed suite-start snapshot must
disable reaping (report-only), and every kill must be corroborated by a tmpdir-rooted pane
cwd. 11 tasks: seam + classification, two-signal reap rework, global-setup wiring, contract
docs, changelog.

## Technical Approach

- **Injectable runner seam.** `src/conductor/test/tmux-leak-guard.ts`'s private `tmux()`
  wrapper gains stderr capture and a distinct spawn-error marker, exposed through an optional
  `TmuxRunner` parameter (`(args) => { code, stdout, stderr, spawnError }`) defaulting to the
  real `spawnSync` path. All exported functions accept the optional runner so failure modes
  are unit-testable without real tmux. The existing real-tmux integration test remains the
  real-binary smoke (injected-runner tests alone are insufficient — repo precedent).
- **Snapshot result type.** New `snapshotDaemonSessions(runner?)` returns
  `{ sessions: string[], failed: boolean }`. Classification: spawn error ⇒ `failed: true`;
  exit 0 ⇒ success; exit non-zero with stderr matching the known benign "no tmux server"
  patterns (`/no server running/` or `/error connecting to .*No such file or directory/`)
  ⇒ genuine empty (`failed: false`) so the guard still reaps leaks in fresh environments;
  any other non-zero exit ⇒ `failed: true`. Unrecognized wording therefore degrades to
  report-only — the safe direction. (`listDaemonSessions()` stays as a thin
  success-sessions accessor for existing callers/tests.)
- **Two-signal reap.** `reapLeakedDaemonSessions(snapshot, runner?)` returns
  `{ killed: string[], indeterminate: string[] }`. A session is killed ONLY when (a) the
  baseline snapshot succeeded, (b) the session is absent from it, and (c) its active pane
  cwd resolved successfully AND is under `os.tmpdir()` (lexical, separator-aware prefix or
  exact match — no realpath on the cwd, since deleted fixture dirs must still corroborate).
  Any signal missing ⇒ the session goes to `indeterminate` (reported, never killed). A
  failed baseline lists best-effort and returns everything visible as indeterminate; a
  failed teardown-time listing returns empty (nothing visible ⇒ nothing to do — inherently
  no-kill). tmux-absent environments stay silent no-ops end to end.
- **Teardown wiring.** `global-setup.ts` stores the snapshot object; at teardown it prints
  indeterminate sessions to stderr with a greppable warn prefix (does NOT fail the run) and
  throws — failing the run — only for actually-killed leaks (today's behavior).
- **Sequencing.** Seam first, then classification, then the corroboration helper, then the
  reap rework and its negative paths, then wiring, then contract docs + changelog.

## Prerequisites

- None beyond repo checkout; vitest runs from `src/conductor` (never the worktree root).
- Real-tmux tests keep their skip-when-unavailable guard and the
  `AI_CONDUCTOR_NO_REAL_EXEC` kill-switch discipline.

## Tasks

### Task 1: TmuxRunner seam with stderr + spawn-error capture
**Story:** TR-1 (Done When: snapshot API distinguishes failure) — enabling infrastructure
**Type:** infrastructure

**Steps:**
1. Write failing test: injected runner receives exact argv for `list-sessions -F '#{session_name}'`; wrapper result carries `stderr` and `spawnError` distinctly (a runner returning `spawnError: true` is distinguishable from `code: 1`).
2. Verify test fails (RED)
3. Implement: extend `tmux()` to capture stderr and return `spawnError` instead of collapsing `result.error` to `{code: 1}`; thread an optional `TmuxRunner` parameter through the exported functions with the real `spawnSync` wrapper as default.
4. Verify test passes (GREEN); existing real-tmux test still passes (real-binary smoke).
5. Commit with message: "test(tmux-leak-guard): injectable TmuxRunner seam with stderr/spawn-error capture (#437)"

**Files:**
- src/conductor/test/tmux-leak-guard.ts
- src/conductor/test/engine/tmux-leak-guard.test.ts

**Dependencies:** none

### Task 2: snapshotDaemonSessions — success and genuine-empty classification
**Story:** TR-1 happy path (successful snapshot ⇒ normal baseline; fresh env still reaps)
**Type:** happy-path

**Steps:**
1. Write failing test: exit 0 with two `cc-daemon-*` names ⇒ `{ sessions: [both], failed: false }`; exit 1 with stderr `no server running on /tmp/tmux-1000/default` ⇒ `{ sessions: [], failed: false }`; same for the older `error connecting to … (No such file or directory)` wording.
2. Verify test fails (RED)
3. Implement: add `snapshotDaemonSessions(runner?)` with the classification above; keep `listDaemonSessions()` delegating to it (returning `sessions`).
4. Verify test passes (GREEN)
5. Commit with message: "feat(tmux-leak-guard): snapshot distinguishes genuine-empty from failure (#437)"

**Files:** same as Task 1

**Dependencies:** Task 1

### Task 3: snapshot failure classification (fail-closed)
**Story:** TR-1 negative path (spawn error / unknown non-zero exit ⇒ failed baseline)
**Type:** negative-path

**Steps:**
1. Write failing test: runner with `spawnError: true` (EAGAIN/ENOMEM/ENOENT class) ⇒ `failed: true`; exit 1 with unrecognized stderr (e.g. `server exited unexpectedly`) ⇒ `failed: true`; sessions list empty in both.
2. Verify test fails (RED)
3. Implement: classification branches in `snapshotDaemonSessions`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(tmux-leak-guard): unknown snapshot errors classify as failed, never empty (#437)"

**Files:** same as Task 1

**Dependencies:** Task 2

### Task 4: tmpdir cwd corroboration helper
**Story:** TR-2 (kill requires pane cwd resolved AND under os.tmpdir())
**Type:** happy-path

**Steps:**
1. Write failing test: exported `isTmpdirRooted(cwd)` — `os.tmpdir()` itself ⇒ true; `join(os.tmpdir(), 'loop-test-abc')` ⇒ true; `/home/user/code/repo` ⇒ false; `(unknown)` ⇒ false; prefix trickery `${os.tmpdir()}-evil/x` ⇒ false (separator-aware).
2. Verify test fails (RED)
3. Implement: lexical `path.resolve` + exact-or-`tmpdir + sep` prefix check; no realpath on the candidate cwd (deleted fixture dirs must still match).
4. Verify test passes (GREEN)
5. Commit with message: "feat(tmux-leak-guard): separator-aware tmpdir-rooted cwd check (#437)"

**Files:** same as Task 1

**Dependencies:** none

### Task 5: two-signal reap — kill only baseline-ok + new + tmpdir-rooted
**Story:** TR-2 happy path (tmpdir leak after successful snapshot IS killed and reported)
**Type:** happy-path

**Steps:**
1. Write failing test: with injected runner — successful baseline `{A}`, live `{A, B}`, B's pane cwd under tmpdir ⇒ result `{ killed: [B …pane cwd…], indeterminate: [] }` and exactly one `kill-session` invocation targeting B.
2. Verify test fails (RED)
3. Implement: change `reapLeakedDaemonSessions` to accept the snapshot object (not a bare Set), evaluate pane cwd BEFORE any kill, and return `{ killed, indeterminate }`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(tmux-leak-guard): reap requires snapshot-ok + tmpdir-cwd corroboration (#437)"

**Files:** same as Task 1

**Dependencies:** Task 3, Task 4

### Task 6: failed baseline ⇒ zero kills, everything indeterminate
**Story:** TR-1 negative paths (failed snapshot + live daemon; failed snapshot + genuine leak)
**Type:** negative-path

**Steps:**
1. Write failing test: snapshot `{ failed: true }`, live sessions include a repo-cwd daemon AND a tmpdir-cwd leak ⇒ `killed: []`, ZERO `kill-session` invocations, both sessions in `indeterminate` with names.
2. Verify test fails (RED)
3. Implement: failed-baseline branch in the reap (best-effort list, report-only).
4. Verify test passes (GREEN)
5. Commit with message: "test(tmux-leak-guard): failed baseline never authorizes kills (#437)"

**Files:** same as Task 1

**Dependencies:** Task 5

### Task 7: teardown listing failure and tmux-absent are silent no-kills
**Story:** TR-1 negative paths (teardown list fails; tmux not installed anywhere)
**Type:** negative-path

**Steps:**
1. Write failing test: successful baseline but teardown-time listing fails ⇒ `{ killed: [], indeterminate: [] }`, no kill attempted; ENOENT-class runner at snapshot AND teardown ⇒ same empty result (silent no-op, no warning content to emit).
2. Verify test fails (RED)
3. Implement: teardown-listing-failure branch returning empty result.
4. Verify test passes (GREEN)
5. Commit with message: "test(tmux-leak-guard): listing failures degrade to silent no-kill (#437)"

**Files:** same as Task 1

**Dependencies:** Task 5

### Task 8: non-tmpdir and unresolvable pane cwds survive teardown
**Story:** TR-2 negative paths (repo-cwd session; display-message failure)
**Type:** negative-path

**Steps:**
1. Write failing test: successful baseline, new session with pane cwd `/home/user/code/repo` ⇒ not killed, listed in `indeterminate` with name + cwd; new session whose `display-message` fails (cwd unresolvable) ⇒ not killed, indeterminate.
2. Verify test fails (RED)
3. Implement: ensure the corroboration branch routes both cases to `indeterminate`.
4. Verify test passes (GREEN)
5. Commit with message: "test(tmux-leak-guard): uncorroborated sessions are reported, never killed (#437)"

**Files:** same as Task 1

**Dependencies:** Task 5

### Task 9: global-setup wiring — warn-only indeterminate, fail-run only on kills
**Story:** TR-1 + TR-2 (run does not fail for indeterminate; killed leaks still fail the run)
**Type:** happy-path

**Steps:**
1. Write failing test: exercise the teardown decision through the reap result shape — killed non-empty ⇒ error thrown naming sessions (message includes the existing "#377" pointer); killed empty + indeterminate non-empty ⇒ no throw, warning text produced naming sessions and the reason (snapshot failed / uncorroborated cwd).
2. Verify test fails (RED)
3. Implement: `global-setup.ts` stores the `snapshotDaemonSessions()` object at setup; teardown calls the new reap, `console.error`s the indeterminate warning, throws only when `killed.length > 0`.
4. Verify test passes (GREEN); run the full real-tmux test file from `src/conductor` — the existing leak test's behavior is unchanged (tmpdir leak killed + run fails).
5. Commit with message: "feat(tmux-leak-guard): teardown warns on indeterminate, fails run only for killed leaks (#437)"

**Files:**
- src/conductor/test/global-setup.ts
- src/conductor/test/tmux-leak-guard.ts
- src/conductor/test/engine/tmux-leak-guard.test.ts

**Dependencies:** Task 6, Task 7, Task 8

### Task 10: contract header + distinct greppable report prefixes
**Story:** TR-3 (documented two-signal contract; killed vs indeterminate textually distinct)
**Type:** refactor

**Steps:**
1. Write failing test: the killed-leak message and the indeterminate warning use distinct fixed prefixes (e.g. `tmux-leak-guard: killed leaked session` vs `tmux-leak-guard: NOT killed (fail-closed)`); assert neither prefix is a substring of the other's.
2. Verify test fails (RED)
3. Implement: set the prefixes at the reap/teardown message construction sites; rewrite the module header to state the two kill-authorizing signals, report-only degradation, and failed-snapshot-disables-reaping.
4. Verify test passes (GREEN)
5. Commit with message: "docs(tmux-leak-guard): two-signal fail-closed contract in header + distinct report prefixes (#437)"

**Files:** same as Task 9

**Dependencies:** Task 9

### Task 11: changelog + full regression pass
**Story:** all (repo release gate; existing behavior stays green)
**Type:** infrastructure

**Steps:**
1. Add `CHANGELOG.md` `[Unreleased]` → Fixed entry: tmux-leak-guard fails closed — a failed suite-start snapshot disables reaping and every kill requires a tmpdir-rooted pane cwd (#437). Internal test-infra change: no migration block needed (no CLI/hook/schema/symlink surface).
2. Run the guard's test file plus the full conductor suite from `src/conductor` (`rtk proxy npx vitest run`); all green.
3. Commit with message: "chore(changelog): tmux-leak-guard fail-closed hardening entry (#437)"

**Files:**
- CHANGELOG.md

**Dependencies:** Task 10

## Task Dependency Graph

```
Task 1 ─▶ Task 2 ─▶ Task 3 ─┐
                            ├─▶ Task 5 ─▶ Task 6 ─┐
Task 4 ─────────────────────┘          ├─ Task 7 ─┼─▶ Task 9 ─▶ Task 10 ─▶ Task 11
                                       └─ Task 8 ─┘
```
(Tasks 6, 7, 8 are independent of each other after Task 5.)

## Integration Points

- After Task 5: the two-signal kill decision is testable end-to-end with injected runners.
- After Task 9: the real vitest globalSetup path exercises the full snapshot→reap→report
  flow; the real-tmux integration test validates against a live tmux server.

## Coverage Mapping

| Story criterion | Task(s) |
|---|---|
| TR-1 happy: successful snapshot ⇒ normal reaping | 2, 5 |
| TR-1 happy: failed snapshot ⇒ no kills, warn, run passes | 3, 6, 9 |
| TR-1 neg: failed snapshot + genuine leak ⇒ not killed, reported | 6 |
| TR-1 neg: teardown listing fails ⇒ no kill, no false failure | 7 |
| TR-1 neg: tmux absent ⇒ silent no-op | 7 |
| TR-2 happy: tmpdir leak after good snapshot ⇒ killed + run fails | 5, 9 |
| TR-2 neg: non-tmpdir cwd ⇒ survives, indeterminate warning | 8, 9 |
| TR-2 neg: unresolvable cwd ⇒ survives | 8 |
| TR-3 happy: header documents two-signal contract | 10 |
| TR-3 neg: killed vs indeterminate wording distinct | 10 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
