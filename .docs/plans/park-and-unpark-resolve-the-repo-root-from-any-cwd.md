# Implementation Plan: park and unpark resolve the repo root from any cwd

Stem: park-and-unpark-resolve-the-repo-root-from-any-cwd
Track: technical
Tier: S
Source: jstoup111/ai-conductor#534

## Goal

Make `conduct daemon park <slug>` and `conduct daemon unpark <slug>` resolve the **main repo root**
from any cwd inside the project before scanning `.docs/plans/<slug>.md` and `.worktrees/<slug>`, so
the verbs succeed identically whether invoked from the repo root, a linked worktree, or a nested
subdirectory. When invoked outside any git repository, fail with a message that names the expected
usage (never the misleading "slug not found"), touching no state. Keep the not-found error for a
genuinely unknown slug, and make it name the resolved root so "wrong slug" is distinguishable from
"wrong cwd".

## Files

- `src/conductor/src/engine/daemon-park-cli.ts` — add `resolveMainRepoRoot(startCwd)`; have
  `validateSlug` / not-found messaging surface the resolved root. (Existing:
  `detectDaemonParkCommand`, `validateSlug`, `dispatchDaemonPark`.)
- `src/conductor/src/index.ts` — at the park/unpark dispatch (~line 405), resolve the root from
  `process.cwd()` first; on failure print the usage error and `process.exit(1)`; on success pass
  the resolved root as `cwd` to `dispatchDaemonPark`.
- `src/conductor/test/engine/daemon-park-cli.test.ts` — new cases for `resolveMainRepoRoot`
  (real temp git repo + `git worktree` + nested subdir; outside-repo failure) and the improved
  not-found message.
- `docs/runbooks/emergency-stop-a-running-feature.md` — new runbook (Story-2 documentation
  outcome): how to stop a running feature — `daemon park` + what to kill — working from inside the
  feature's own worktree.
- `CHANGELOG.md` — required `## [Unreleased]` → `### Fixed` entry (harness repo gate).

## Non-goals

- No change to the park-marker primitives (`park-marker.ts`) or the daemon/supervisor lifecycle —
  these verbs stay filesystem-direct and pre-boot.
- No change to `dispatchDaemonPark`'s signature: it keeps taking an explicit `cwd` (now the
  resolved root); tests continue to inject `cwd` directly, so existing cases are untouched.
- **No CHANGELOG Migration block.** Per CLAUDE.md the migration gate is for *breaking* changes to
  `bin/conduct CLI` (or settings/hook/symlink schema). This is strictly widening — every previously
  valid invocation still works, no flag/schema/wiring changes — so it is a non-breaking **PATCH**
  bugfix. A plain `### Fixed` entry is correct; a Migration block is not. (If the self-host release
  gate's path classifier still flags `bin/conduct CLI` from the `index.ts` edit, this is the
  internal-only case the adr-2026-07-06 waiver covers — but the change set here does not alter CLI
  argument grammar or exit-code contract for any prior-valid input, so a `### Fixed` note is
  expected to suffice; add the waiver only if the gate HALTs on the touched-surface classifier.)
- No VERSION bump beyond the frozen operator policy.

## Task Dependency Graph

```
Task 1 (resolveMainRepoRoot + not-found message)
   └─> Task 2 (wire into index.ts)
   └─> Task 3 (unit/integration tests)   [depends on Task 1]
Task 4 (runbook doc)                      [independent]
Task 5 (CHANGELOG + validate)             [depends on Tasks 1–4]
```

## Tasks

### Task 1 — Add `resolveMainRepoRoot` and thread the resolved root through not-found messaging

In `src/conductor/src/engine/daemon-park-cli.ts`:

- Add `export async function resolveMainRepoRoot(startCwd: string): Promise<{ root: string } | { error: string }>`.
  Implementation: run `git rev-parse --git-common-dir` with `cwd: startCwd` (via
  `node:child_process` `execFile`, promisified — matching the pre-boot "no heavy imports" style).
  Take the returned common dir, make it absolute (`isAbsolute(raw) ? raw : resolve(startCwd, raw)`,
  the `memory-store.ts` idiom), and return `{ root: dirname(absoluteCommonDir) }` — the parent of
  `<root>/.git`, which is identical for the main checkout and every linked worktree. On empty
  output or a thrown/failed git call (outside any repo), return
  `{ error: "not inside a conduct project — run 'daemon park <slug>' from the project root or any directory inside it" }`.
- Update the park not-found branch in `dispatchDaemonPark` so the message names the searched root,
  e.g. `error: slug '<slug>' not found under <cwd> (no .docs/plans/<slug>.md or .worktrees/<slug>)`
  — making "right slug, wrong cwd" impossible to confuse with "wrong slug" now that `cwd` is always
  the resolved main root.

Dependencies: none. Files: `daemon-park-cli.ts`.
Estimated: 6 min.

### Task 2 — Wire root resolution into the index.ts park/unpark dispatch

In `src/conductor/src/index.ts` (~line 405, the `detectDaemonParkCommand` block): after detecting
the command, call `resolveMainRepoRoot(process.cwd())`. If it returns `{ error }`, print the error
(to stderr) and `process.exit(1)` — the dispatch is never reached, so no state is touched. If it
returns `{ root }`, call `dispatchDaemonPark(daemonParkCmd, { cwd: root })` and `process.exit(code)`
as before. Add `resolveMainRepoRoot` to the existing import from `./engine/daemon-park-cli.js`.

Dependencies: Task 1. Files: `index.ts`.
Estimated: 4 min.

### Task 3 — Tests: resolution from root/worktree/subdir, outside-repo failure, improved message

In `src/conductor/test/engine/daemon-park-cli.test.ts`, add a `resolveMainRepoRoot` describe block
that builds a **real** temp git repo (`git init`, initial commit), creates a linked worktree with
`git worktree add`, and a nested subdirectory, then asserts:

- called from the main root, from the nested subdir, and from inside the linked worktree, it
  returns the **same** `root` (the main checkout's toplevel);
- called from a directory that is not a git repo (a bare `mkdtemp` outside any repo), it returns
  `{ error }` whose text names the expected usage and does NOT say "slug not found".

Also add a `dispatchDaemonPark` case asserting the not-found message for a genuinely unknown slug
names the searched root (distinguishable-from-wrong-cwd requirement). Keep all existing cases
(they inject `cwd` directly and remain valid).

Dependencies: Task 1. Files: `daemon-park-cli.test.ts`.
Estimated: 8 min.

### Task 4 — Emergency-stop runbook

Add `docs/runbooks/emergency-stop-a-running-feature.md`: when to use it (a live/finish session is
heading toward a bad push, or a runaway dispatch), and the exact steps to stop a running feature —
`conduct daemon park <slug>` (now cwd-independent, callable from inside the feature's own worktree),
how to confirm the marker (`.daemon/parked/<slug>`), and what process to kill (the feature's
session/tmux pane). Cross-reference #534 and the #520 false-ship episode as the motivating incident.

Dependencies: none. Files: `docs/runbooks/emergency-stop-a-running-feature.md`.
Estimated: 5 min.

### Task 5 — CHANGELOG entry and validate

Add under `## [Unreleased]` → `### Fixed` in `CHANGELOG.md`:
"daemon park/unpark now resolve the main repo root from any cwd (repo root, a linked worktree, or a
nested subdirectory) before scanning plans/worktrees, so an emergency-stop `daemon park <slug>` no
longer fails with a misleading 'slug not found' when run from inside the affected worktree; outside
any repo it now errors with the expected usage instead (ai-conductor#534)."

Then run the harness integrity suite and the conductor test suite (from `src/conductor`, correct
cwd per the vitest-cwd trap). Fix any failure before completing.

Dependencies: Tasks 1–4. Files: `CHANGELOG.md`.
Estimated: 5 min.

## Verification

- New unit/integration tests in `daemon-park-cli.test.ts` pass: `resolveMainRepoRoot` returns the
  same main root from the repo root, a nested subdir, and a linked worktree; returns a
  usage-naming `{ error }` outside any repo.
- Manual/real check: from a real linked worktree subdirectory, `conduct daemon park <slug>` for a
  slug whose `.worktrees/<slug>` exists in the main root exits 0 and writes
  `<main-root>/.daemon/parked/<slug>`; `unpark` from the same place removes it.
- Outside any git repo, `daemon park <slug>` exits non-zero, prints the usage error (not "slug not
  found"), and creates no marker anywhere.
- `cd src/conductor && npx vitest run test/engine/daemon-park-cli.test.ts` green;
  `test/test_harness_integrity.sh` passes; `CHANGELOG.md` has the `## [Unreleased]` Fixed entry.
- `docs/runbooks/emergency-stop-a-running-feature.md` exists and documents the park-based stop
  working from inside the feature's own worktree.

## Coverage Mapping

| Story / Scenario | Task(s) | Test / Evidence |
|---|---|---|
| Story 1 — park from root / subdir / worktree → same root, same result | 1, 2, 3 | `resolveMainRepoRoot` same-root assertions across three cwds; index.ts wiring passes resolved root to dispatch |
| Story 1 — unpark symmetrical | 1, 2, 3 | resolution is verb-agnostic (shared `resolveMainRepoRoot` in index.ts before both dispatch kinds); existing unpark dispatch cases + same-root assertions |
| Story 2 — outside any repo → usage error, exit≠0, no state touched | 1, 2, 3 | `resolveMainRepoRoot` returns `{ error }`; index.ts prints + exit 1 before dispatch; outside-repo test asserts message text |
| Story 2 — genuinely nonexistent slug distinguishable from wrong cwd | 1, 3 | improved not-found message names the searched root; unknown-slug dispatch test |
| Documentation outcome (Story 2 context) | 4 | `docs/runbooks/emergency-stop-a-running-feature.md` |
| Release gate | 5 | `CHANGELOG.md` `## [Unreleased]` Fixed entry; integrity suite green |
