---
title: Quickstart
nav_order: 2
---

# Quickstart

Install the harness, register a project, and run one feature through the SDLC pipeline. For
operators setting up `conduct-ts` for the first time.

## Prerequisites

`bin/install` checks **none** of these before it starts. It fails late, partially, or silently if
one is missing, so install them first.

| Requirement | Needed for | Verify |
| --- | --- | --- |
| `git` | cloning the harness; every worktree operation | `git --version` |
| `gh`, authenticated | opening spec and implementation PRs | `gh auth status` |
| `tmux` | `conduct-ts daemon start/stop/restart/connect/debug` | `tmux -V` |
| `python3` | writing permissions and hooks into `~/.claude/settings.json` | `python3 --version` |
| PyYAML | writing the markdown-viewer and mermaid-renderer config | `python3 -c "import yaml"` |
| Node >= 20.5.0 (repo pins 20.19.2) | building and running the engine | `node --version` |
| `npm` | `npm ci` + `npm run build` for the engine | `npm --version` |
| `claude` and/or `codex` | executing steps — at least one is required | `claude --version` / `codex --version` |

Node is pinned to `20.19.2` in `.tool-versions` and `src/conductor/.tool-versions`. Install it
with `asdf install nodejs 20.19.2` or any equivalent version manager. `bin/conduct-ts` exports
`ASDF_NODEJS_VERSION` from that pin **only when `asdf` is on `PATH`** — without asdf, whatever
`node` resolves first runs the engine.

Pick your host now: `claude`, `codex`, or both. See
[multiprovider](guides/multiprovider.md) for what each one changes.

## Clone the harness

```bash
git clone https://github.com/jstoup111/ai-conductor.git
cd ai-conductor
```

Clone to a normal directory. A checkout whose physical path contains `/.worktrees/` is refused by
the installer — see [Refusing to install from a build worktree](#refusing-to-install-from-a-build-worktree).

## Install

```bash
./bin/install
```

On a TTY with no `--providers` flag, the installer prompts for four things: the built-in host
(Claude / Codex / both), the update channel, a markdown viewer, and a mermaid renderer. Pass the
selection up front to skip the first prompt:

```bash
./bin/install --providers=claude,codex
```

`--providers` gates only the install-time readiness report. Both skill catalogs
(`~/.claude/skills` and `~/.agents/skills`) are written regardless of the value, and the flag never
writes a host into any config. It is also absent from `./bin/install --help`.

You should see `Installation complete.` followed by a quick-start banner.

## Put `~/.local/bin` on PATH

The installer symlinks `conduct-ts` into `~/.local/bin` but **never edits your shell profile**. If
that directory is not already on `PATH` it prints:

```text
  ⚠ ~/.local/bin is NOT on PATH
  → Add to your shell profile: export PATH="$HOME/.local/bin:$PATH"
```

Add it yourself, then reload your shell:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Verify the install

```bash
./bin/install --check
conduct-ts --help
```

`--check` mutates nothing. Its exit code is the signal:

| Exit code | Meaning |
| --- | --- |
| `0` | All checks passed. Prints `All checks passed.` |
| `1` | Drift: missing, stale, or duplicated skill links, or a failed host-CLI or bin-symlink check. Prints a per-category count and `Run ./bin/install to fix.` |
| `2` | Everything else is clean but `conduct-ts build-auth-status` failed |

Exit `2` returns before the summary line, so a build-auth-only failure prints no closing message —
read the `build-auth-status:` line in the body instead. The engine treats both `0` and `2` as
passing; any other code blocks `conduct-ts daemon start` on a stale install.

## Register a project

The target must already be a git repository.

```bash
cd /path/to/your-project
conduct-ts register
```

You should see `Registered <name> (<absolute-path>).` The record lands in
`~/.ai-conductor/registry.json` with `status: registered`; nothing is written into the project.

To scaffold a new repository instead, `conduct-ts create <name>` runs `git init` and writes a
skeleton `CLAUDE.md`, a `.gitignore`, and a project-safe `.ai-conductor/config.yml` before
registering it. Both commands are detailed in
[reference/cli.md](reference/cli.md).

## Bootstrap the project

`register` writes no project artifacts. `create` writes the minimal scaffold described above.
`bootstrap` detects the stack and generates the remaining project instruction files, `.docs/`
tree, and memory store. It is a skill, not a CLI command, so run it inside a host session:

```bash
claude
```

Then, in-session:

```text
/bootstrap
```

Under Codex the same skill is invoked as `$bootstrap`. You should end with `CLAUDE.md` (and/or
`AGENTS.md`) referencing the harness, plus a populated `.docs/` directory.

For an existing Git repository, `bootstrap` runs the idempotent `conduct-ts config init` primitive.
You can also run that command directly before bootstrap. It creates
`.ai-conductor/config.yml` from the project-safe template and preserves an existing file
byte-for-byte. See [reference/configuration.md](reference/configuration.md).

## Run your first feature

```bash
conduct-ts inline "add a CSV export to the reporting page"
```

The `inline` subcommand is **mandatory**. A bare invocation is rejected:

```text
conduct: the inline SDLC pipeline now runs under the `inline` subcommand.
  Run:        conduct inline "<feature description>"
  State ops:  conduct inline --status | --resume | --report | --diagnose | …
  All commands: conduct --help
```

The run creates `.pipeline/`, writes `.claude/settings.json` if absent, and streams a dashboard as
it walks the steps. It checkpoints for your approval at gate boundaries; `--auto` runs unattended
and `--interactive` opens a REPL at every conversational step (the two are mutually exclusive).
Flags are enumerated in [reference/cli.md](reference/cli.md).

For the full idea → spec PR → daemon build → implementation PR path, continue to
[first feature](guides/first-feature.md).

## First-run blockers

Each of these is a real guard in the code, with the text it emits.

### Missing engine bundle

The engine is gitignored, so a fresh clone has no `dist` until `bin/install` (or `npm run build`)
runs.

```text
conduct-ts: missing <harness>/src/conductor/dist/index.js
conduct-ts: run 'npm run build' in src/conductor/
```

A half-finished publish leaves a dangling symlink instead:

```text
conduct-ts: dist symlink is broken (<harness>/src/conductor/dist)
conduct-ts: run 'npm run build' to rebuild, or republish the engine, to fix it
```

Both exit `1`. Fix by re-running `./bin/install`, or `npm run build` inside `src/conductor/`. Never
run `tsup` directly — the publish guard refuses it.

### Wrong Node version

The installer skips the engine build rather than failing:

```text
  ⚠ Node >=20.5 not active (repo pins 20.19.2 via .tool-versions) — skipping conduct-ts build
```

and later:

```text
  ⚠ conduct-ts bundle not found and Node >=20.5 is not active (the repo pins 20.19.2 via
    .tool-versions). Install it (e.g. 'asdf install nodejs 20.19.2'), then re-run bin/install.
```

The install "succeeds" and `conduct-ts` is simply never symlinked. Install Node 20.19.2 and re-run
`./bin/install`.

### Missing `gh` authentication

Nothing checks `gh` at install time. It surfaces when a spec is landed:

```text
Cannot land spec: identity unresolved. Resolve one of:
  1. Set spec_owner in ~/.ai-conductor/config.yml
  2. Authenticate via: gh auth login
```

Exit `1`. Run `gh auth login`, or set `spec_owner` in the user config. The daemon's backlog scan
fails closed on the same identity — an unidentified daemon builds nothing and logs
`daemon identity unresolved: … building NOTHING (fail-closed)`. See
[running the daemon](guides/running-the-daemon.md).

### Refusing to install from a build worktree

`bin/install` matches its own resolved physical path against `*/.worktrees/*`:

```text
  ✗ Refusing to install from a build worktree.

  Resolved harness root: <physical_root>

  Installing from a worktree would repoint your global bins, skills, and
  settings.json hooks at a directory that is deleted when the build ships.

  Fix: run bin/install from the main checkout, or pass --allow-worktree-root
  if you really mean to install from this worktree.
```

Exit `1`. The guard applies to the default and `--update` modes only; `--check`, `--uninstall`, and
`--help` are unaffected. Install from the main checkout.

### Missing PyYAML

`python3` absence is reported (`python3 not found — skipping permissions configuration`), but
PyYAML is never probed. The markdown-viewer and mermaid-renderer writers `import yaml`
unconditionally, so a missing module produces a raw Python traceback that the installer's
`|| warn` wrapper swallows — the install reports success and `~/.ai-conductor/config.yml` gets no
viewer or renderer block. Install it (`python3 -m pip install PyYAML`) and re-run `./bin/install`.
`./bin/install --check` then reports the configured viewer and renderer.

### Missing tmux

The daemon builds without tmux but cannot be hosted by it:

```text
tmux is not installed or not found on PATH. Please install tmux to use daemon hosting.
```

Install tmux before `conduct-ts daemon start`. Recovery for a daemon that started and then broke is
in [runbooks/daemon-recovery.md](runbooks/daemon-recovery.md).

## Updates

The installer records an update channel — `tagged` (default) or `main` — in
`~/.claude/ai-conductor.config.json`. `conduct-ts` spawns `bin/update --auto` on startup and
swallows every failure. Update by hand at any time:

```bash
cd /path/to/ai-conductor
git pull && ./bin/install
```

> **Known limitation.** The default `tagged` channel can never fire for a cloned adopter. Version
> detection falls back to the `VERSION` file when `HEAD` is not on an exact tag, and CI bumps
> `VERSION` to the next patch immediately *after* tagging — so `VERSION` is structurally always
> ahead of the newest tag and the comparison never reports an update. On the default channel you
> get no automatic updates. Pull manually, or switch with `bin/update --set-channel main`.
> Tracked in [#1005](https://github.com/jstoup111/ai-conductor/issues/1005).

## Removing the harness

```bash
./bin/install --uninstall
```

> **Known limitation.** `--uninstall` removes only the harness-owned skill symlinks, the
> `HARNESS.md` links, and `~/.local/bin/conduct`. It leaves `~/.local/bin/conduct-ts`, the 18
> permission entries and 10 hook commands written into `~/.claude/settings.json`, all of
> `~/.ai-conductor/`, and `~/.claude/ai-conductor.config.json`. If you then delete the checkout,
> those hooks point at a directory that no longer exists and every Claude Code session in every
> project runs them. Remove `~/.local/bin/conduct-ts` and strip the harness entries from
> `~/.claude/settings.json` by hand — see
> [reference/settings-and-hooks.md](reference/settings-and-hooks.md).
> Tracked in [#1004](https://github.com/jstoup111/ai-conductor/issues/1004).
