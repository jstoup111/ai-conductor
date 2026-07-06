# Implementation plan: engineer handoff pushes the spec branch before `gh pr create`

Source issue: jstoup111/ai-conductor#331
Track: technical · Tier: S

## Summary

`openSpecPr` (`src/conductor/src/engine/engineer/handoff.ts`) must push the spec
branch to `origin` before invoking `gh pr create`, and classify a genuine
no-remote condition at the **push** step so the local-commit fallback fires only
for remote-less repos — not for a branch that was simply never pushed. All I/O
stays injected so tests remain subprocess-free.

## Design

- Add an injectable **git runner** to `HandoffDeps` (reuse the existing
  `CommandRunner` shape): `gitRunner?: CommandRunner`. It runs `git` with a given
  argv in a cwd, mirroring the existing `runner` (which wraps `gh`).
- In `openSpecPr`, **before** the `gh pr create` call:
  1. Invoke `gitRunner(['push', '-u', 'origin', branch], { cwd })`.
  2. If it throws and the message matches a no-remote pattern → record the
     authored key and return `{ kind: 'pr-skipped', reason: 'no remote: …' }`
     **without** calling `gh` (Story 2a).
  3. If it throws for any other reason → re-throw (Story 3a).
  4. If it succeeds → proceed to `gh pr create` (Story 1).
- Extend `NO_REMOTE_PATTERNS` with git-push no-remote phrasings:
  `'origin' does not appear to be a git repository`, `No configured push destination`,
  `No such remote`, `does not appear to be a git repository`.
- Keep the existing gh-side no-remote catch as a defensive secondary (harmless;
  in practice a missing remote is now caught at push).
- **Back-compat:** `gitRunner` is optional. When absent (legacy callers/tests that
  only pass `runner`), skip the push step and preserve today's behavior, so no
  existing call site breaks. The CLI always supplies it.
- Wire the real git runner in `engineer-cli.ts`'s `handoff` case:
  `gitRunner: async (args, opts) => { await execFile('git', args, { cwd: opts?.cwd ?? worktree }); return { stdout: '', stderr: '' }; }`
  (import `execFile`/`promisify` if not already present in that module).

## Tasks

1. **Add `gitRunner` to `HandoffDeps`.** In `handoff.ts`, add an optional
   `gitRunner?: CommandRunner` field with a doc comment describing the push step
   and its cwd = worktree. (~2 min)

2. **Extend `NO_REMOTE_PATTERNS`.** Add the git-push no-remote regexes listed in
   Design so `isNoRemoteError` recognizes a push against a missing `origin`. (~2 min)

3. **Insert the push step in `openSpecPr`.** Before the `gh pr create` try-block:
   if `deps.gitRunner` is present, call it with `['push','-u','origin',branch]`
   and cwd; wrap in try/catch:
   - no-remote → `recordAuthoredKey` + `return { kind:'pr-skipped', reason }` (no gh call);
   - other error → rethrow;
   - success → fall through to the existing gh create path. (~5 min)

4. **Wire the real git runner in the CLI.** In `engineer-cli.ts` `handoff` case,
   pass `gitRunner` alongside `runner` to `openSpecPr`, running `git` via
   `execFile` with cwd = worktree. Confirm `execFile`/`promisify` imports. (~4 min)

5. **RED — happy-path ordering test.** In `test/engine/engineer/handoff.test.ts`,
   add a fake `gitRunner` that records calls. Assert: on a fresh branch the git
   runner is called with `push … origin <branch>` **before** the gh runner's
   `pr create`, cwd = worktree, and the result is `pr-opened`. (Story 1a) (~5 min)

6. **RED — no-remote fallback at push.** Add a test where `gitRunner` rejects with
   a no-remote message. Assert `openSpecPr` returns `pr-skipped`, the gh runner is
   **never** called, and the authored key is still recorded. (Story 2a) (~5 min)

7. **RED — non-no-remote push failure rethrows.** Add a test where `gitRunner`
   rejects with an auth/non-fast-forward message. Assert `openSpecPr` throws and
   the gh runner is never called. (Story 3a) (~4 min)

8. **RED — no-merge invariant across both runners.** Extend the existing no-merge
   assertion so neither the git runner nor the gh runner is ever called with
   `merge`. (Story 3b) (~3 min)

9. **GREEN + refactor.** Run `rtk proxy npx vitest run` in `src/conductor` (each
   worktree needs its own `npm install`). Make tasks 5–8 pass; keep diffs minimal. (~5 min)

10. **Docs + changelog.** Add a `CHANGELOG.md` `[Unreleased] → Fixed` entry
    ("engineer handoff now pushes the spec branch before `gh pr create`, so the
    first handoff opens the PR without a manual push; local-commit fallback now
    fires only for genuinely remote-less repos"). Update `src/conductor/README.md`
    / `README.md` handoff description if it claims a manual push is needed. This is
    a bug fix → **PATCH** semver (VERSION is frozen per repo policy; no bump). (~4 min)

## Verification

- [ ] On a fresh `spec/<slug>` with an `origin`, one handoff opens the PR (no manual push).
- [ ] Git runner pushes before the gh create call; cwd = worktree in both.
- [ ] Remote-less repo → `pr-skipped`/local-commit, gh never invoked, work preserved.
- [ ] Non-no-remote push failure rethrows (keep-on-failure), not misreported as skip.
- [ ] Neither runner ever receives `merge`.
- [ ] Full `src/conductor` vitest suite green; harness integrity suite green.

## Out of scope

- The sibling `gh ENOENT` write-back defect (#290) — separate handoff shell-out bug.
- Any change to the daemon build loop or to `land`.
