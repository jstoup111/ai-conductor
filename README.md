# AI Conductor

A custom development harness for Claude Code and Codex. Markdown skills and agent personas that enforce a
disciplined SDLC — design docs, user stories with mandatory negative paths, conflict detection, TDD with
domain review, evaluator-gated code review, and dual retrospectives — plus an autonomous build daemon that
takes a merged spec to an open pull request without supervision.

There is no custom skill runtime. Claude Code powers the conductor automation, and Codex uses the same
Markdown skills directly.

## Requirements

- [Claude Code](https://docs.claude.com/en/docs/claude-code) v2.0+ and/or [Codex](https://github.com/openai/codex)
- Git, and [GitHub CLI](https://cli.github.com/) authenticated (`gh auth login`)
- Node.js 26.7.0 (minimum Node 26; the engine pins 26.7.0 via `asdf`), npm, tmux, and `python3` with PyYAML
- A project to work on — Rails + PostgreSQL has full tech-context support; other stacks work with the
  generic skills

## Install

```bash
git clone --branch stable --single-branch git@github.com:jstoup111/ai-conductor.git
cd ai-conductor
./bin/install
export PATH="$HOME/.local/bin:$PATH"   # the installer warns; it never edits your profile
./bin/install --check                  # 0 clean · 1 drift · 2 build-auth
```

`stable` advances only after release CI has published the matching semver tag and GitHub Release, so
the default install path never checks out in-flight work from `main`. Existing tag-pinned checkouts
remain pinned unless their owner explicitly changes channel or version.

To move an existing branch-based installation to this channel deliberately:

```bash
git fetch origin stable:refs/remotes/origin/stable
git switch --track origin/stable
bin/update --set-channel stable
bin/migrate
```

This symlinks every skill and `HARNESS.md` into the user-scoped `~/.claude/skills/` and `~/.agents/skills/`
directories and installs the conductor CLI to `~/.local/bin/`. The installer never places harness skills in
a project directory; project-local skills are optional explicit overrides. Most installed skills are
explicit-only, so discovery alone does not activate them in unrelated chats. Twelve verified
same-session dependencies remain model-invocable so composed harness workflows continue to work; see
[Skills](docs/reference/skills.md#invocation-policy).

Full walkthrough, prerequisites, and first-run blockers: **[Quickstart](docs/quickstart.md)**.

## Quick start

Register and bootstrap a project:

```bash
cd your-project/            # must already be a git repository
conduct-ts register
claude                      # then run /bootstrap in the session
```

For the preferred autonomous path, author a spec, merge its PR, then start the daemon. The daemon
builds each merged spec in an isolated worktree, retains logs, and opens an implementation PR:

```bash
conduct-ts engineer --idea "add a CSV export"
# Review and merge the spec PR, then:
conduct-ts daemon start
```

For a supervised foreground run, use interactive inline mode:

```bash
conduct-ts inline --interactive "add a CSV export"
```

`conduct-ts inline --auto` is deprecated; use the daemon for unattended work. The `inline` token is
required for foreground runs — the bare form `conduct-ts "<feature>"` is rejected.

The harness runs on Claude Code and Codex. Select the host with the `llm_provider` config key; an ordered
array such as `[claude, codex]` acts as a fallback ladder. See
[Multiprovider](docs/guides/multiprovider.md).

Runnable end-to-end walkthroughs live in [`examples/README.md`](examples/README.md).

## Why this exists

Agents drift over a long build. Prompt discipline decays, self-reports drift from reality, and a "done"
claim is worth exactly nothing without an artifact behind it. This harness is built on the opposite
assumption: progress is proven by files on disk, gates are deterministic where machinery can enforce them,
and an LLM is dispatched only where judgment is genuinely required. The daemon never merges — a human still
owns that call.

## Documentation

[Browse the hosted documentation](https://jstoup111.github.io/ai-conductor/)

**Start here**

- [Quickstart](docs/quickstart.md) — prerequisites, install, and your first working run

**Guides** — task-oriented procedures

- [Your first feature](docs/guides/first-feature.md) — idea → spec PR → build → implementation PR
- [The engineer loop](docs/guides/engineer-loop.md) — the interactive idea→spec flow, including claim-time recovery of stale claims after the configurable 24-hour `stale_claim_window_hours` window and the `engineer unclaim` / `engineer requeue --stale [--older-than <dur>]` maintenance commands
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
- [Corrupt intake ledger or stuck ledger lease](docs/runbooks/corrupt-intake-ledger.md)
- [Daemon recovery](docs/runbooks/daemon-recovery.md)
- [Shipped-record reconciliation](docs/runbooks/shipped-record-reconciliation.md)
- [Protected-artifact plan deadlock](docs/runbooks/protected-artifact-plan-deadlock.md)

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
3. **Machinery by default, judgement where needed** — machinery enforces what it can; inherently judgement-shaped questions get an LLM judgement, not a rigid mechanical proxy
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
