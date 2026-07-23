# Choosing a Conductor

Relocated from README.md — see [README.md](../README.md) for the project front door.

## Choosing a Conductor

Two conductor binaries ship together. Both drive the same 16-step SDLC pipeline and read
the same `.pipeline/` state, so you can switch between them per-invocation. `conduct`
remains the default; `conduct-ts` is the in-progress rewrite — stable enough to use
day-to-day, but the surface is still changing.

|                              | `conduct` (bash, stable)                      | `conduct-ts` (TypeScript, opt-in)                                |
|------------------------------|-----------------------------------------------|------------------------------------------------------------------|
| **Status**                   | Reference implementation                      | Active rewrite — feature parity ongoing                          |
| **Install**                  | Always symlinked by `bin/install`             | Built + symlinked by `bin/install` when Node >= 20.5 is active   |
| **Build step**               | None                                          | `bin/install` runs `npm install && npm run build` in src/conductor/ |
| **CLI flags**                | Full surface (`--auto`, `--interactive`, …)   | Same flags, fully wired                                          |
| **Dashboard**                | Terminal status log                           | Event-driven renderer with live-region updates and tail pane     |
| **Completion gates**         | Artifact grep                                 | Typed events + structured gate-runner                            |
| **Auto-heal**                | None                                          | Reconciles stale `task-status.json` against git log before retry |
| **Pluggable UI**             | No                                            | Yes — UI is a subscriber behind the engine                       |
| **Test coverage**            | `test/test_conduct_worktree.sh`               | 673 vitest tests across engine/execution/UI/integration          |
| **Pinned Node**              | N/A                                           | Reads `src/conductor/.tool-versions` via asdf                    |

**Default:** use `conduct`. Everything in this README's examples works.

**Try `conduct-ts`** when you want the richer dashboard or auto-heal, or if you're helping
test the rewrite. Drop-in replace the binary name in any command; if a flag isn't
supported yet, commander will tell you.

### Command syntax and unknown-command guard

Both conductors validate command-line arguments strictly. Unknown options and bare single-word
commands are now rejected loudly with helpful error messages instead of silently launching the
pipeline. This prevents accidental typos and makes the CLI more discoverable:

- **Feature descriptions must be quoted multi-word strings:** `conduct "add user login"` (correct) 
  vs `conduct auth` (rejected — bare word).
- **Unknown options fail early:** `conduct --frobnicate` now prints "Unknown option: --frobnicate" 
  and suggests `--help` instead of silently treating it as a feature description.
- **Conduct-TS forwarded verbs are documented:** Verbs like `daemon`, `render-diagrams`, 
  `engineer`, etc. are forwarded to conduct-ts if it's available on PATH. Run `conduct --help` 
  to see the full list.
- **`engineer` subcommand help and unknown-flag rejection:** every `conduct-ts engineer
  <subcommand> --help`/`-h` prints usage with zero side effects (no registry read, no
  worktree/ledger mutation, no `gh` call) instead of executing the subcommand, and an
  unrecognized flag on any `engineer` subcommand is now rejected (exit 1) instead of being
  silently ignored. See `src/conductor/README.md` for the full subcommand reference.

For details, see [Unknown-Command Guard](https://github.com/anthropics/ai-conductor#unknown-command-guard).

Both binaries read `~/.ai-conductor/config.yml` (user-level) and the project's
`.ai-conductor/config.yml` if present. Legacy `~/.claude/ai-conductor.config.json` is
read as a fallback for installs that predate the YAML migration.

See `src/conductor/README.md` for the three-layer architecture (Engine / Execution / UI)
behind `conduct-ts`.
