# AI Conductor

A custom development harness for Claude Code and Codex. Markdown skills and agent personas that enforce a
disciplined SDLC — design docs, user stories with mandatory negative paths, conflict detection, TDD with
domain review and evaluator-gated code review — plus an autonomous build daemon that
takes a merged spec to an open pull request without supervision.

There is no custom skill runtime. Claude Code powers the conductor automation, and Codex uses the same
Markdown skills directly.

## Requirements

- [Claude Code](https://docs.claude.com/en/docs/claude-code) v2.0+ and/or [Codex](https://github.com/openai/codex)
- Git, and [GitHub CLI](https://cli.github.com/) 2.73.0 or later, authenticated (`gh auth login`)
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
ai-conductor register
claude                      # then run /bootstrap in the session
```

For the preferred autonomous path, author a spec, merge its PR, then start the daemon. The daemon
builds each merged spec in an isolated worktree, retains logs, and opens an implementation PR:

```bash
ai-conductor compose --idea "add a CSV export"
# Review and merge the spec PR, then:
ai-conductor daemon start
```

For a supervised foreground run, use interactive inline mode:

```bash
ai-conductor inline --interactive "add a CSV export"
```

`ai-conductor inline --auto` is deprecated; use the daemon for unattended work. The `inline` token is
required for foreground runs — the bare form `ai-conductor "<feature>"` is rejected.

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

## How to work with it

Read this before your second feature. The full guide is [Working effectively](docs/guides/working-effectively.md);
this is the part people skip and then ask about.

**You own design. The daemon owns execution.** Your judgement enters at exactly two points, and both
are document reviews, not live steering:

1. **Compose the spec** (`ai-conductor compose`). Explore, stories, ADRs, plan. This is where your
   design sense matters. Spend your attention here.
2. **Merge the spec PR.** That says "build exactly this".
3. The daemon builds it in a worktree, grades the result against your plan and ADRs, and opens a PR.
4. **Review the implementation PR** like a colleague's.

Between 2 and 4 the daemon does the cheap part: code, tests, review fixes, rebase, PR prose. Delegating
that is what frees your head for the next design problem while this one builds.

**The ADRs are the asset.** Every ADR is a durable architectural decision with its reasoning attached,
committed to the repo and read by machinery: the composer plans the next feature against them, and the
as-built review kicks back any build that violates one. Design knowledge that used to live in a few
people's heads becomes written and enforced, so each feature makes the next one cheaper to align.
Keeping those artifacts truthful is the highest-leverage thing you do here.

**Keep the queue full. That is the whole speed story.** From this repository's own telemetry:

| Measure | Value |
|---|---|
| One daemon run, pickup to settle | median 35 min, three-quarters under an hour |
| Cost per shipped feature | median $8, three-quarters under $27 |
| Features shipped in August 2026 | 134 (best days: 10 to 13 PRs merged) |

A feature that builds in an hour but waits eight hours for you to merge the spec and eight more to
merge the PR is a 17-hour cycle with one hour of machine time. Queue six specs on Monday and you get
six PRs by Tuesday; work them one at a time and the same six take the week. So: compose specs in
batches, merge in batches, review in batches, and bundle related changes as stories inside one spec.
Split only when the pieces are independent enough to build in parallel.

**Do not steer a running build.** Every gate grades the code against the plan you merged, so an edit
that arrives mid-build shows up as drift, a false stall, or a discarded review lap. There are three
windows where your hands on the code are welcome:

- **Parked.** `ai-conductor daemon park <slug>`, edit, commit, `unpark`. Stay inside what the plan
  already says; anything the plan never mentioned will be kicked back as scope drift.
- **After the PR is ready for review.** Ordinary PR from here, with one caution: a review commit that
  changes structure without touching the stories or ADRs leaves them describing a system that no longer
  exists, and the next feature plans against that stale record.
- **After a `needs-human` halt.** The halt record says what it could not resolve.

**Refactors go through DECIDE.** If the implementation came back with the wrong shape, either the plan
was wrong or the architectural constraints were unclear. Both are spec problems. Run the refactor as
its own compose loop so the ADRs are amended and every later build inherits the corrected structure.

**Where the feedback is.** Once or twice a day: `ai-conductor daemon status` and `gh pr list --state open`.
Act on a spec PR, a PR flipping to ready-for-review, or a `needs-human` halt. Logs, cost lines, and
review kickback laps are tuning telemetry, not your signal.

**It got stuck.** Run `/daemon-triage` from a Claude Code or Codex session in the project. It gathers
the evidence and routes you to the right [runbook](docs/runbooks/index.md).

[FAQ](docs/guides/faq.md) has the short answers to everything above.

## Documentation

[Browse the hosted documentation](https://jstoup111.github.io/ai-conductor/)

**Start here**

- [Quickstart](docs/quickstart.md) — prerequisites, install, and your first working run

**Guides** — task-oriented procedures

- **[Working effectively](docs/guides/working-effectively.md) — read this first.** The delegation model, why the ADRs compound, why a full queue is the whole speed story, when you can touch code mid-build, and what to do when it sticks
- [FAQ](docs/guides/faq.md) — short answers to the questions engineers ask in their first weeks
- [Your first feature](docs/guides/first-feature.md) — idea → spec PR → build → implementation PR
- [The composer loop](docs/guides/engineer-loop.md) — the interactive idea→spec flow, including claim-time recovery of stale claims after the configurable 24-hour `stale_claim_window_hours` window and the `compose unclaim` / `compose requeue --stale [--older-than <dur>]` maintenance commands
- [Running the daemon](docs/guides/running-the-daemon.md) — start, park, observe, recover
- [Intake](docs/guides/intake.md) — filing issues that seed the DECIDE phase
- [Multiprovider](docs/guides/multiprovider.md) — Claude Code and Codex, and the fallback ladder
- [Self-hosting](docs/guides/self-hosting.md) — running the harness on this repository

**Reference** — exact interfaces

- [CLI](docs/reference/cli.md) — every `ai-conductor` command, subcommand, and flag
- [Configuration](docs/reference/configuration.md) — every `.ai-conductor/config.yml` key
- [Settings and hooks](docs/reference/settings-and-hooks.md) — `settings.json` and host event hooks
- [Environment variables](docs/reference/environment.md)
- [Steps](docs/reference/steps.md) — the step vocabulary `--from` accepts
- [Skills](docs/reference/skills.md) — the full skill catalog
- [Artifacts](docs/reference/artifacts.md) — the `.docs/` and `.pipeline/` trees
- [Models](docs/reference/models.md) — model and effort resolution

**Explanation** — how and why the system is shaped this way

- [Architecture](docs/explanation/architecture.md) — engine, daemon, composer loop, operator
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

## Contributing and support

Start with [Contributing](docs/contributing/code-organization.md), and run the validation suite before every
commit:

```bash
bash test/test_harness_integrity.sh
```

All work happens on a feature branch; never commit directly to `main`. File bugs, ideas, and observations as
[GitHub issues](https://github.com/jstoup111/ai-conductor/issues) — see [Intake](docs/guides/intake.md) for
the structure that turns an issue into buildable work.

## License

Unless otherwise noted, the code, skills, templates, and documentation in this repository are
licensed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE) for attribution
information.
