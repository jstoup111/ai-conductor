# Components and sequences: CLI help catalog matches dispatch

**Last updated:** 2026-10-14
**Scope:** To-be CLI entry surface for jstoup111/ai-conductor#1012. Feature:
`conduct-ts-help-disagrees-with-behavior-in-six-pla`. Covers `src/conductor/src/index.ts`
(`dispatchCliCommand()` and its pre-commander `detect*Command` intercept chain), `src/conductor/src/cli.ts`
(`createProgram()` and `renderCanonicalFullHelp()`), `src/engine/engineer-cli.ts`
(`SUBCOMMAND_HELP`), and `src/engine/daemon-command.ts` (daemon runtime flag fallbacks). The 42
intercept dispatch blocks themselves are unchanged (Approach A); only their `--help` behavior and
their declaration in commander change.

## Component diagram

```mermaid
graph TD
  argv["process.argv"] --> main["index.ts dispatchCliCommand()"]
  main --> chain["Pre-commander intercept chain (42 detect«Name»Command blocks, unchanged dispatch)"]
  chain -->|"matched, no --help"| handlers["Command handlers (registry, engineer, daemon, shipped-record, kpi, …)"]
  chain -->|"matched with --help or -h"| helpRoute["Subcommand help route (new)"]
  chain -->|"no match"| topHelp["Top-level --help / inline fallthrough"]
  helpRoute --> program["cli.ts createProgram() — single help catalog"]
  topHelp --> program
  list["PRE_DISPATCH_COMMANDS (new exported name list)"] -.-> chain
  program --> visible["Operator-facing commands (visible)"]
  program --> hidden["Engine-internal commands (commander hidden: true)"]
  defaults["Shared CLI default constants (new, e.g. idle-poll seconds)"] --> program
  defaults --> daemonCmd["daemon-command.ts runtime fallbacks"]
  engHelp["engineer-cli.ts SUBCOMMAND_HELP (land vs handoff text corrected)"] --> handlers
  coverage["Coverage test (new)"] -.->|"every name declared"| list
  coverage -.-> program
  defaultsTest["Defaults parity test (new)"] -.-> defaults
  defaultsTest -.-> program
```

## Sequence: subcommand --help

```mermaid
sequenceDiagram
  participant Op as Operator
  participant Main as index.ts dispatchCliCommand()
  participant Chain as Intercept chain
  participant Prog as cli.ts createProgram()
  participant H as Command handler
  Op->>Main: ai-conductor register --help
  Main->>Chain: detect«Name»Command(argv)
  alt argv carries --help or -h for a known command
    Chain->>Prog: find declared command by name
    Prog-->>Op: that command's own help text, exit 0
  else no help flag
    Chain->>H: dispatch unchanged
    H-->>Op: command output
  end
```

## Legend

- **Intercept chain:** the existing `detect«Name»Command(process.argv)` blocks in `dispatchCliCommand()` and `dispatchNonDispatchingCliCommand()` that run
  before commander parses; their dispatch logic is untouched.
- **PRE_DISPATCH_COMMANDS:** an exported list of the top-level names the chain intercepts; the
  coverage test fails when a name is not declared in `createProgram()` (visible or hidden).
- **Shared default constants:** one source for a flag's declared default and its runtime fallback,
  starting with `--idle-poll` (declared `'5'` in `cli.ts`, runtime `60` in `daemon-command.ts`).
- Dotted edges are test-time checks, not runtime calls.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-14 | Initial generation | Approach A for jstoup111/ai-conductor#1012 |
