Track: technical

Rationale: A CLI arg-parsing bug in the `conduct-ts engineer` subcommand dispatcher —
no user-facing product surface, no PRD. `--help`/`-h` on an engineer subcommand
(`claim`, `land`, `handoff`, `worktree`, `poll`, `forget`, `resolve`,
`migrate-issue-deps`) is silently ignored by `detectEngineerCommand`
(`src/conductor/src/engine/engineer-cli.ts:128-252`) and the subcommand's mutating
kind is dispatched anyway — observed 2026-07-11 when `engineer claim --help` actually
claimed (and consumed) intake entry #280, requiring manual ledger/inbox repair. The
codebase already has the correct fix pattern in production for a sibling command:
`daemon --help` is special-cased in `src/conductor/src/index.ts:378-388` specifically
*because* `detectDaemonCommand` has this exact failure mode ("otherwise `--help` is
treated as an unknown flag and LAUNCHES a daemon run instead of showing help — a real
footgun"). `engineer` never got the equivalent guard. Acceptance is verified by
`detectEngineerCommand`/`dispatchEngineer` unit tests asserting zero mutation on
`--help`/`-h` and by the generated `conduct-ts --help` reference text — not by any
end-user requirement. No PRD.
