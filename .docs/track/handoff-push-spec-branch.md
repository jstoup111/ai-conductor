# Track: engineer handoff pushes the spec branch before `gh pr create`

Track: technical

## Why technical

This is a defect fix in an internal CLI primitive (`conduct-ts engineer handoff` →
`openSpecPr`). There are no user-facing product requirements, no new product
surface, and no PRD-worthy behavior to specify — the acceptance criteria are
purely mechanical (a branch must be pushed to `origin` before a PR is opened, and
the no-remote fallback must fire only for genuinely remote-less repos). Acceptance
criteria therefore live in the stories, not a PRD.

## Context (verified against `main`)

`openSpecPr` (`src/conductor/src/engine/engineer/handoff.ts`) invokes
`runner(['pr', 'create', '--head', <branch>, '--fill'], { cwd: worktree })` but
never pushes `<branch>` to `origin` first. On a brand-new `spec/<slug>` branch
(the normal case) the head ref does not exist on the remote, so `gh pr create`
fails with:

```
pull request create failed: GraphQL: Head sha can't be blank, Base sha can't be blank,
No commits between main and spec/<slug>, Head ref must be a branch (createPullRequest)
```

The CLI's `handoff` catch (`engineer-cli.ts`) treats this as a hard failure and
emits `{ "kind": "local-commit" }`, keeping the worktree. The spec PR is never
opened; the operator must manually `git push -u origin spec/<slug>` and re-run.

Confirmed live: idea `rate-limit-wait-sh-depends-on-pipeline-conduct-log` — after a
manual push, the identical handoff opened PR #330.

## Approaches considered

1. **Inject a git-push step into `openSpecPr` before the gh call (chosen).**
   Add an injectable git runner to `HandoffDeps`; push `-u origin <branch>` from
   the worktree cwd before `gh pr create`. Move authoritative no-remote detection
   to the push step so the local-commit fallback fires only when the repo is
   genuinely remote-less — not merely because the branch was never pushed.
   Keeps all I/O injected (tests stay subprocess-free), touches one primitive.

2. **Push in the CLI layer before calling `openSpecPr`.** Rejected: splits the
   push/PR sequence across two modules, leaves `openSpecPr` still able to fail on
   an unpushed branch when called from any other site, and duplicates the
   no-remote classification.

3. **Add `--push` behavior via `gh pr create`'s auto-push.** Rejected: `gh` only
   offers interactive push prompts, unavailable in the non-interactive
   `--fill` path; not reliable for automation.

Decision: **Approach 1.**
