# Architecture Review: CLI help disagrees with behavior (#1012)
**Date:** 2026-10-14
**Stories reviewed:** none yet (pre-stories, technical track; input is the explore decision and track scope)
**Mode:** Lightweight (Tier M) — Sections 2 and 4
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack compatibility:** No new packages. Commander 15.0.0 already supports hidden commands
  (`lib/command.js:172`). Verified.
- **Prerequisites:** None. No migrations, config keys, or external setup.
- **Integration surface:** Four files in one module (`src/conductor/src/index.ts`, `cli.ts`,
  `engine/engineer-cli.ts`, `engine/daemon-command.ts`), plus help-text tests.
- **Data implications:** None.
- **Performance risk:** The help router adds one argv scan before the intercept chain. Negligible.
- **Worktree isolation:** No shared resources.

## Alignment

- **Local pattern basis — per-command help from commander.** The `config --help` branch in
  `index.ts` `dispatchCliCommand` (search `command.name() === 'config'`) already answers a subcommand's help by
  finding the declared command in `createProgram().commands` and printing its
  `helpInformation()`. Preserve that trait: help text comes from the commander declaration, never
  from a hand-written string. Allowed variation: one generic router over the registry instead of a
  per-command branch, and nested paths such as `memory setup`.
- **Placement constraint.** Intercepts start well before the `config` branch (`detectRenderCommand`
  is the first detector call, inside `dispatchNonDispatchingCliCommand`; `detectRegistryCommand` precedes `config`). The router
  must run before the first detector, or `register --help` keeps executing.
- **Existing help owners.** `renderDaemonHelp` (daemon) renders the whole daemon subtree and keeps its branch; `config` help is
  already commander-backed and is absorbed by the router. `compose`/`engineer` (`SUBCOMMAND_HELP` in
  `engineer-cli.ts`) and `halt-issues` render their own help and keep it. `update` passes its arguments verbatim to `bin/update`, which renders its own usage, so it keeps passing `--help` through.
- **Full-help renderers.** `renderFullHelp` walks `cmd.commands` without checking visibility, so
  hidden commands would print full sections. ADR Decision 5 covers this.
- **Governing ADRs.** `adr-2026-07-04-park-unpark-cli-verbs` requires the park verbs to appear in
  `conduct --help` via `renderFullHelp`; this design keeps that. No approved ADR governs the CLI
  catalog relationship, so a new ADR is drafted.
- **Security boundaries:** No new inputs beyond flags already parsed. No effect on GitHub or
  credential boundaries.

## Wiring Surface

- **Help router:** called from `index.ts` `dispatchCliCommand` before the first `detect«Name»Command` call.
- **Pre-dispatch registry export:** consumed by the help router in production and by the coverage
  test.
- **Shared default constants:** consumed by the `cli.ts` option declarations and by
  `daemon-command.ts` runtime fallbacks (`intFlag(argv, '--idle-poll', …)`).
- **New commander declarations (visible and hidden):** registered in `createProgram()`; rendered by
  the existing `renderCanonicalFullHelp` path.
- **Corrected `SUBCOMMAND_HELP.land` / `.handoff` text:** served by the existing compose help path
  in `engineer-cli.ts`.

Advisory overlap scan over these four paths: no overlap, no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A literal `--help` argument value is swallowed by the router | Technical | Low | Medium | ADR assumption A2; router only fires for declared command paths |
| Existing help snapshot tests break on new visible commands | Technical | High | Low | Update snapshots in the same task as the declarations |
| Visible/hidden classification of the 13 commands is wrong | Knowledge | Medium | Low | Stories fix the classification explicitly; `shipped-record` and `kpi` must be visible |

## ADRs Created

- `adr-2026-10-14-commander-program-is-the-cli-catalog` (APPROVED by operator 2026-10-14)

## Conditions

1. The help router runs before the first intercept detector, at the start of `dispatchCliCommand` ahead of `dispatchNonDispatchingCliCommand`.
2. The false comment above the top-level help branch in `index.ts` is corrected.
3. Help-output tests updated in the same task that changes declarations.
