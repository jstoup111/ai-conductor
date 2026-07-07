**Status:** Accepted

# Stories: re-enable bin/setup worktree smoke via worktree-local invocation (#334)

Track: technical (no PRD — acceptance criteria live here). Tier: S.
Source: jstoup111/ai-conductor#334, operator-selected Option C (see
`.memory/decisions/2026-07-06-reenable-bin-setup-worktree-smoke.md`).
Scope guard: the ONLY file that changes is
`src/conductor/test/engine/publish-interrupted.test.ts`. No changes to
`bin/setup`, `src/conductor/src/engine/worktree-prepare.ts`, or
`src/conductor/scripts/publish-engine.mjs` — Options A/B were explicitly
rejected/deferred by the operator.

## Story: the smoke runs the worktree's own bin/setup and is re-enabled

**Requirement:** #334 acceptance criteria (Option C reading)

As a harness maintainer, I want the `bin/setup worktree compatibility` smoke
re-enabled and pointed at the temp worktree's own `bin/setup` so that CI
actually verifies a worktree ends up with a working `src/conductor/dist`
symlink without the primary checkout being touched.

### Acceptance Criteria

#### Happy Path
- Given the smoke at `src/conductor/test/engine/publish-interrupted.test.ts`
  ("creates a worktree-local dist/ symlink without touching the primary
  checkout"), when the suite runs, then the smoke executes as `it` (no
  `it.skip` and no unconditional `ctx.skip()` on the current repo state) with
  an explicit per-test timeout of 600_000 ms.
- Given the smoke has created its temp git worktree, when it invokes setup,
  then it executes the **worktree's own** script (`join(worktreeDir, 'bin',
  'setup')`) with `cwd: worktreeDir` and env `CI: 'true'` — not the primary
  checkout's `BIN_SETUP`.
- Given the worktree's `bin/setup` completes successfully, when the smoke
  asserts, then `<worktreeDir>/src/conductor/dist` is a symlink and
  `<worktreeDir>/src/conductor/dist/index.js` exists.
- Given the primary checkout's `src/conductor/dist` symlink existed before the
  smoke ran, when the smoke finishes, then the primary symlink's `lstat`
  `mtimeMs` is unchanged (byte-for-byte untouched primary).
- Given the stale "SKIPPED pending #334" comment block, when the change lands,
  then the comment is rewritten to describe the actual semantics: the smoke
  runs the worktree's own `bin/setup` (so `$0` resolves inside the worktree)
  and pays a real `npm install` + versioned build there by design (#334
  Option C).

#### Negative Paths
- Given the worktree's `bin/setup` exits non-zero (e.g. `npm install` fails),
  when the smoke awaits the `execa` call, then the promise rejects and the
  test FAILS with the setup error (it does not hang until the timeout and does
  not report a false pass), and the `finally` block still removes the temp
  worktree (`git worktree remove --force`), deletes the smoke branch
  (`git branch -D`), and `rm -rf`s the temp dir.
- Given `bin/setup` is somehow absent from the created worktree (repo state
  where it is not tracked), when the smoke starts, then it skips (or fails)
  explicitly at the existence guard rather than throwing an unhandled ENOENT
  from `execa`.

### Done When
- [ ] `rtk proxy npx vitest run test/engine/publish-interrupted.test.ts` (from
      `src/conductor`, with its own `node_modules` installed) reports the
      smoke as **passed** — not skipped — alongside the two existing
      interrupted-publish tests.
- [ ] `git grep -n "it.skip" -- src/conductor/test/engine/publish-interrupted.test.ts`
      returns no matches.
- [ ] The smoke's `execa` invocation target is `join(worktreeDir, 'bin', 'setup')`
      and carries `{ cwd: worktreeDir, env: { ...process.env, CI: 'true' } }`.
- [ ] The `it(...)` carries an explicit `timeout` option of 600_000 ms.
- [ ] The primary checkout's `src/conductor/dist` symlink mtime assertion is
      still present and passes (assertions at publish-interrupted.test.ts:203-208
      retained).
- [ ] The full conductor suite (`rtk proxy npx vitest run` in `src/conductor`)
      is green with the smoke enabled.
- [ ] Diff touches only `src/conductor/test/engine/publish-interrupted.test.ts`
      (plus CHANGELOG per repo rules).
