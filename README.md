# AI Conductor

A custom development harness for Claude Code, Codex, and Cursor. Markdown skills and agent personas that
enforce a disciplined SDLC — design docs, user stories with mandatory negative paths, conflict detection,
TDD with domain review, evaluator-gated code review, and dual retrospectives — plus an autonomous build
daemon that takes a merged spec to an open pull request without supervision.

There is no custom skill runtime. Claude Code powers the conductor automation; Codex and Cursor use the
same Markdown skills directly.

## Requirements

- [Claude Code](https://docs.claude.com/en/docs/claude-code) v2.0+, [Codex](https://github.com/openai/codex),
  and/or [Cursor](https://cursor.com)
- Git, and [GitHub CLI](https://cli.github.com/) authenticated (`gh auth login`)
- Node 20.19.2 (the engine pins this via `asdf`), npm, tmux, and `python3` with PyYAML
- A project to work on — Rails + PostgreSQL has full tech-context support; other stacks work with the
  generic skills

## Install

```bash
git clone git@github.com:jstoup111/ai-conductor.git
cd ai-conductor
./bin/install
export PATH="$HOME/.local/bin:$PATH"   # the installer warns; it never edits your profile
./bin/install --check                  # 0 clean · 1 drift · 2 build-auth
```

The installer asks which built-in provider you plan to use — Claude, Codex, Cursor, or a combination
(non-interactively: `--providers claude,codex,cursor`). Regardless of the selection it symlinks every skill
and `HARNESS.md` into the user-scoped `~/.claude/skills/` and `~/.agents/skills/` directories and installs
the conductor CLI to `~/.local/bin/`. The installer never places harness skills in a project directory;
project-local skills are optional explicit overrides.

Selecting **Cursor** additionally wires the hook adapters from `hooks/cursor/` into `~/.cursor/hooks.json`,
giving Cursor sessions the same mechanical enforcement layer as Claude Code: destructive-git blocking, the
TDD commit gate, the docs-guard write fence, batch-boundary lint feedback, HARNESS.md session context, and
the memory checkpoint reminder. Cursor discovers the skills themselves from `~/.claude/skills` natively, so
no separate skill surface is needed — `/conduct` and the other skills work in the agent chat as-is.

Full walkthrough, prerequisites, and first-run blockers: **[Quickstart](docs/quickstart.md)**.

## Quick start

Register a project, bootstrap it, then drive a feature:

```bash
cd your-project/            # must already be a git repository
conduct-ts register
claude                      # then run /bootstrap in the session
```

Run the pipeline interactively, watching every step in a live Claude REPL:

```bash
conduct-ts inline --interactive "add a CSV export"
```

`inline` is required — the bare form `conduct-ts "<feature>"` is rejected.

Or let the daemon drain merged specs on its own, each in an isolated worktree, opening a pull request per
feature:

```bash
conduct-ts daemon start
```

The conductor automation runs on Claude Code and Codex. Select the host with the `llm_provider` config key;
an ordered array such as `[claude, codex]` acts as a fallback ladder. See
[Multiprovider](docs/guides/multiprovider.md). Cursor is an interactive client: it uses the same skills and
gets the same hook enforcement, but is not (yet) an execution provider for `conduct-ts`.

Runnable end-to-end walkthroughs live in [`examples/README.md`](examples/README.md).

## Why this exists

Agents drift over a long build. Prompt discipline decays, self-reports drift from reality, and a "done"
claim is worth exactly nothing without an artifact behind it. This harness is built on the opposite
assumption: progress is proven by files on disk, gates are deterministic where machinery can enforce them,
and an LLM is dispatched only where judgment is genuinely required. The daemon never merges — a human still
owns that call.

## Documentation

**Start here**

- [Quickstart](docs/quickstart.md) — prerequisites, install, and your first working run

**Guides** — task-oriented procedures

- [Your first feature](docs/guides/first-feature.md) — idea → spec PR → build → implementation PR
- [The engineer loop](docs/guides/engineer-loop.md) — the interactive idea→spec flow
- [Running the daemon](docs/guides/running-the-daemon.md) — start, park, observe, recover
- [Intake](docs/guides/intake.md) — filing issues that seed the DECIDE phase
- [Multiprovider](docs/guides/multiprovider.md) — Claude Code and Codex, and the fallback ladder
- [Self-hosting](docs/guides/self-hosting.md) — running the harness on this repository

**Reference** — exact interfaces

- [CLI](docs/reference/cli.md) — every `conduct-ts` command, subcommand, and flag
- [Configuration](docs/reference/configuration.md) — every `.ai-conductor/config.yml` key
- [Settings and hooks](docs/reference/settings-and-hooks.md) — `settings.json` and host event hooks
- [Environment variables](docs/reference/environment.md)
- [Steps](docs/reference/steps.md) — the step vocabulary `--from` accepts
- [Skills](docs/reference/skills.md) — the full skill catalog
- [Artifacts](docs/reference/artifacts.md) — the `.docs/` and `.pipeline/` trees
- [Models](docs/reference/models.md) — model and effort resolution

**Explanation** — how and why the system is shaped this way

- [Architecture](docs/explanation/architecture.md) — engine, daemon, engineer loop, operator
- [SDLC phases](docs/explanation/sdlc-phases.md) — the five phases, tiers, and tracks
- [Gates](docs/explanation/gates.md) — enforcement levels, fail-closed rules, waivers
- [Evidence model](docs/explanation/evidence-model.md) — why progress is proven, not asserted

**Runbooks** — when something breaks

- [Emergency-stop a running feature](docs/runbooks/emergency-stop-a-running-feature.md)
- [Stalled or stuck feature](docs/runbooks/stalled-or-stuck-feature.md)
- [Worktree and evidence recovery](docs/runbooks/worktree-and-evidence-recovery.md)
- [Daemon recovery](docs/runbooks/daemon-recovery.md)
- [Shipped-record reconciliation](docs/runbooks/shipped-record-reconciliation.md)

**Contributing** — modifying the harness itself

- [Code organization](docs/contributing/code-organization.md)
- [Testing](docs/contributing/testing.md)
- [Validation](docs/contributing/validation.md)
- [Releases](docs/contributing/releases.md)
- [Extending](docs/contributing/extending.md)

Behavioral rules for projects using this harness live in [HARNESS.md](HARNESS.md).

## Key design principles

1. **One skill, one responsibility** — skills have singular focus
2. **Artifacts are the interface** — skills communicate via files in `.docs/`, not internal orchestration
3. **Deterministic where possible, LLM only where necessary** — if machinery can enforce it, machinery does
4. **Negative paths are mandatory** — every story carries concrete failure scenarios
5. **Evaluator sees fresh context** — no shared state with the generator prevents confirmation bias
6. **Dry business logic, not dry code** — extract shared behavior, not shared shape
7. **Refactoring happens at batch boundaries** — the GREEN phase stays minimal
8. **Memory persists across sessions** — decisions, patterns, and gotchas are not re-discovered
9. **Self-improving** — retro findings feed back into harness improvements

## Contributing and support

Start with [Contributing](docs/contributing/code-organization.md), and run the validation suite before every
commit:

```bash
bash test/test_harness_integrity.sh
```

All work happens on a feature branch; never commit directly to `main`. File bugs, ideas, and observations as
[GitHub issues](https://github.com/jstoup111/ai-conductor/issues) — see [Intake](docs/guides/intake.md) for
the structure that turns an issue into buildable work.
