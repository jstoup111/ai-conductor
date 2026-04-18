# Design: Phase 2 — Language Evaluation for Conductor Rewrite

**Date:** 2026-04-12
**Status:** Approved

## Problem

The conductor (`bin/conduct`) is a 3100-line bash script that manages JSON via Python
shell-outs, has no module system, no type checking, no test framework, and terminal rendering
tangled with state machine logic. Phase 1 defined 36 feature stories specifying all harness
behavior. Phase 2 must choose the language for the rewrite that best serves the long-term
architecture: pluggable UI, YAML config, event-driven engine, LLM provider abstraction.

## Solution

**TypeScript** for the conductor rewrite.

### Why TypeScript

1. **Type safety compounds.** The conductor has a complex config schema, state machine with
   14+ steps and transitions, and skill resolution logic. TypeScript catches schema drift,
   invalid state transitions, and config errors at compile time. As the harness grows (new
   skills, config options, UI frontends), the type system prevents regressions.

2. **Pluggable UI via ink.** `ink` is React for the terminal — components, state, rendering.
   The same component model transfers directly to a web frontend. This is the shortest path
   to the pluggable UI vision (EP-004). Python's `rich` is terminal-only.

3. **Event-driven is native.** Node's EventEmitter is the foundation for the engine/UI
   separation. The engine emits typed events, UI subscribers consume them. No framework
   needed.

4. **Claude Code ecosystem alignment.** Claude Code is TypeScript. MCP servers are TypeScript.
   IDE extensions will be TypeScript. Sharing a language reduces integration friction.

5. **npm distribution when needed.** `npx conduct` works out of the box. No virtualenv, no
   pip, no build from source. Keeps the current git-clone model but the path to package
   distribution is trivial.

### Why Not Python

- Python is currently a hidden dependency (bash shells out to `python3` for JSON). Moving
  to TypeScript eliminates this dependency rather than cementing it.
- `rich` is terminal-only — the pluggable UI layer would need a separate abstraction.
- Python packaging (pip, venv, pyproject.toml) is fragile for CLI distribution.
- Type checking via mypy is opt-in and often incomplete.

### Why Not Rust

- The conductor is glue code — reads config, manages state, shells out to CLIs. Rust's
  strengths (performance, memory safety) don't apply.
- Borrow checker friction on state machine code slows iteration.
- Compile step for every change during active development.
- Subprocess management is less ergonomic than TypeScript.

### Technical Stack

| Concern | Library | Reason |
|---------|---------|--------|
| Runtime | Node.js 20+ | LTS, stable, widely installed |
| Language | TypeScript 5.x | Strict mode, satisfies constraint |
| Config parsing | `js-yaml` | Mature, well-maintained YAML parser |
| Terminal UI | `ink` | React component model for CLI, transfers to web |
| Events | `EventEmitter` (Node built-in) | Engine/UI decoupling, typed events |
| Subprocess | `execa` | Modern subprocess library, better than `child_process` |
| Testing | `vitest` | Fast, TypeScript-native, compatible with Node |
| State management | Native JSON + typed interfaces | No ORM, just typed file I/O |
| CLI framework | `commander` or `yargs` | Flag parsing, subcommands, help text |
| Build | `tsup` or `esbuild` | Fast bundling, single output file possible |

### Project Structure

```
src/
  engine/
    conductor.ts          # State machine, step registry, main loop
    config.ts             # YAML config loading, validation, schema types
    state.ts              # conduct-state.json read/write
    skills.ts             # Skill resolution (project > harness default)
    gates.ts              # Gate enforcement between steps
    recovery.ts           # Retry, interactive fix, skip, go back, quit
  execution/
    llm-provider.ts       # LLM provider interface
    claude-provider.ts    # Claude CLI implementation
    subprocess.ts         # Typed subprocess wrapper
    session.ts            # Session management (create, resume, rate limit)
  ui/
    events.ts             # Typed event definitions
    terminal/
      dashboard.tsx       # ink component: status dashboard
      checkpoint.tsx      # ink component: c/b/q prompt
      recovery.tsx        # ink component: r/i/b/s/q menu
      navigation.tsx      # ink component: numbered step menu
    subscriber.ts         # UI subscriber interface
  types/
    config.ts             # Config schema types
    state.ts              # State file types
    steps.ts              # Step definitions, phases, enforcement levels
    events.ts             # Event payload types
  index.ts                # CLI entry point
test/
  engine/                 # Unit tests for state machine, config, gates
  execution/              # Tests with mocked subprocesses
  ui/                     # ink component tests
  integration/            # End-to-end tests
```

### Migration from Bash

1. New conductor lives alongside `bin/conduct` during development
2. Both read/write the same `conduct-state.json` format (backward compatible)
3. `bin/install` updated to offer old (bash) or new (TypeScript) conductor
4. When all 36 stories pass against the TypeScript conductor, bash version is deprecated
5. One release with both, next release removes bash

## Scope

### In Scope
- Language decision (TypeScript) with rationale
- Technical stack selection (libraries, tools)
- Project structure design
- Migration strategy from bash to TypeScript
- Testing strategy

### Out of Scope
- Implementing the conductor (Phase 3)
- Implementing skill overrides (Phase 4)
- Implementing non-terminal UI frontends (Phase 5)
- Specific ink component designs (Phase 3 concern)

## Key Decisions

1. **TypeScript over Python and Rust.** Type safety, ink's pluggable UI model, and ecosystem
   alignment with Claude Code outweigh Python's subprocess ergonomics and Rust's single-binary
   distribution.

2. **ink for terminal UI.** React component model enables pluggable frontends — the same
   mental model works for terminal and web. Terminal-only libraries (rich, blessed) don't
   provide this path.

3. **execa over node:child_process.** Modern API, better error handling, cleaner stream
   management. Addresses the subprocess ergonomics concern.

4. **vitest for testing.** TypeScript-native, fast, compatible with Node. `jest` is heavier
   and slower for this use case.

5. **Side-by-side migration.** Both conductors coexist during transition. Same state file
   format. No big-bang cutover.

## Resolved Questions

1. **Node version requirement:** Node 20+ (current LTS). This is not an additional dependency
   for most developers — Node is more widely installed than Python 3.10+.

2. **Build output:** Single bundled JS file via `tsup` for distribution simplicity. Source
   TypeScript for development.

3. **Backward compatibility:** The TypeScript conductor reads/writes the same
   `conduct-state.json` format. A feature started with the bash conductor can be resumed
   with the TypeScript conductor and vice versa.
