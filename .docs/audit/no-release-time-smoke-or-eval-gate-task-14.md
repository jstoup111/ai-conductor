# Task 14 advisory smoke evidence

Date: 2026-08-06

## Environment

- Node v20.19.2; npm 10.8.2; Git 2.53.0.
- `CLAUDE_CODE_OAUTH_TOKEN` and `CODEX_API_KEY` were absent.
- The sandbox permits the worktree checkout but rejects writes to the main
  repository's shared Git refs directory.

## Initial advisory execution

Command, from `src/conductor`:

```bash
npm run smoke
```

Outcomes for the previously unrun files:

- `test/smoke/finish-record.smoke.test.ts` failed: the malformed
  `finish-record --choice pr` child exited 1 but lost its documented usage
  text when its stderr was a pipe. The production entry point now writes that
  guide synchronously before returning the nonzero exit code.
- `test/smoke/publish-interrupted.smoke.test.ts` failed before `bin/setup`:
  `git worktree add -b ...` could not create
  `/home/james-stoup/code/ai-conductor/.git/refs/heads/...lock` because the
  sandbox mounted the shared refs directory read-only. This is an environment
  limitation, not a test or `bin/setup` defect.
- `test/smoke/surgical-finish-retry.smoke.test.ts` passed (2 assertions).

The initial tier also encountered unrelated environment-only toolchain
failures (`gh` spawn EPERM and tmux session creation) and skipped credentialed
files because no Claude OAuth token was available.

## Final clean advisory execution

After repairing `finish-record`, the exact command was:

```bash
SMOKE_FORCE_SKIP='file:test/backlog-priority.smoke.test.ts,file:test/engine/daemon-tmux.smoke.test.ts,file:test/execution/codex-provider.smoke.test.ts,file:test/smoke/publish-interrupted.smoke.test.ts' npm run smoke
```

The force skips are limited to the observed sandbox/toolchain limitations:
GitHub spawn permission, tmux session creation, unavailable Codex toolchain,
and the read-only shared-ref lock required by `publish-interrupted`.

The rerun completed successfully. `finish-record` passed 2 assertions and
`surgical-finish-retry` passed 2 assertions; `publish-interrupted` was
ledgered skipped with the explicit operator override. Credentialed files were
ledgered skipped for the absent `CLAUDE_CODE_OAUTH_TOKEN`.
