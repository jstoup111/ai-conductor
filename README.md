# James Stoup Agents

A custom development harness for Claude Code. Pure Markdown skills and agent personas that enforce
a disciplined SDLC: design docs, user stories with mandatory negative paths, conflict detection,
TDD with domain review, evaluator-gated code review, and dual retrospectives.

No custom runtime. Claude Code is the execution engine.

## Requirements

- [Claude Code](https://docs.anthropic.com/en/.docs/claude-code) v2.0+
- Git
- A project to work on (Rails+PostgreSQL has full tech-context support; other stacks work with generic skills)
- Optional: [`uv`](https://docs.astral.sh/uv/) — enables the opt-in [Serena](https://github.com/oraios/serena) semantic-code MCP integration (see Install)

## Install

```bash
git clone git@github.com:jstoup111/ai-conductor.git
cd ai-conductor
./bin/install
```

This symlinks all 20 skills into `~/.claude/skills/` and installs the conductor CLI(s) to
`~/.local/bin/`. `./bin/install` also builds the TypeScript conductor bundle for you —
it runs `npm install && npm run build` in `src/conductor/` (in both first-run and
`--update` mode) and symlinks `conduct-ts` once the bundle exists. The build needs
Node >= 20.5 (the repo pins 20.19.2 via `.tool-versions`); if Node is too old or `npm`
is missing, the build is skipped with a warning and `conduct` still installs. See
[Choosing a Conductor](#choosing-a-conductor) below — both binaries coexist, `conduct`
is the default, `conduct-ts` is opt-in.

**Optional: Serena semantic code toolkit.** When [`uv`](https://docs.astral.sh/uv/) is
present, `./bin/install` offers an opt-in install of [Serena](https://github.com/oraios/serena)
(an LSP-backed semantic code-retrieval/editing toolkit). Once installed, `/bootstrap`
auto-registers it as a user-scope MCP server so it's available across your projects. Decline
the prompt (or install later with `uv tool install -p 3.13 serena-agent`) to skip it.

**Mermaid renderer.** `./bin/install` also offers a renderer for the architecture diagrams
and ADRs the harness generates, so you review them as visuals (not raw Mermaid) at the
approval gates. Pick a preset — `html` (default: a self-contained mermaid.js page opened in
your default browser; no native dependencies, works anywhere), `mmdc-png`/`mmdc-svg` (static
images via [`@mermaid-js/mermaid-cli`](https://github.com/mermaid-js/mermaid-cli)), or `none`.
The choice is stored as `mermaid_renderer` in `~/.ai-conductor/config.yml` and reused on every
run; under `conduct-ts` diagrams render automatically when an artifact is presented for
approval, or run `conduct render-diagrams <file.md>...` on demand. The opener is detected per
platform (macOS `open`, Linux `xdg-open`, WSL `wslview`/`explorer.exe`). With no renderer
configured, diagrams fall back to raw Markdown — never a blocker.

The `mmdc-*` presets need Chromium. On WSL, in containers, or when running as root — where
Chromium's setuid sandbox can't initialize — the renderer automatically launches with
`--no-sandbox` (and an explicit Chrome `executablePath` when a system Chrome is found). To take
full control of how Chromium launches, drop a Puppeteer config at `~/.ai-conductor/puppeteer.json`
(e.g. `{ "executablePath": "/usr/bin/google-chrome", "args": ["--no-sandbox"] }`); when present it
overrides the auto-detection.

Verify:

```bash
./bin/install --check
```

Update (after pulling new changes):

```bash
git pull
./bin/install
```

Uninstall:

```bash
./bin/install --uninstall
```

## Quick Start

### Interactive (recommended for first use)

```bash
cd your-project/
claude
```

Then in the Claude Code session:

```
/conduct
```

The conductor checks artifact state, tells you what to run next, and blocks when gates aren't met.
It walks you through all 18 steps:

```
/bootstrap → /explore (track) → /prd (product track) → /architecture-diagram
→ /architecture-review → /stories → /conflict-check → /plan
→ /writing-system-tests → /pipeline → /manual-test
→ /prd-audit (product track) → /architecture-review --as-built → /retro → /finish
```

### Automated

```bash
cd your-project/

# The inline pipeline runs under the `inline` subcommand (foreground; the
# counterpart to the background `daemon`).

# Fully automated — walk away and come back
conduct inline --auto "URL shortener with click tracking"

# Default — auto with interactive recovery on failure
conduct inline "Add user authentication"

# Manual oversight — REPL mode for conversational steps (explore, prd, stories, plan, architecture_review, manual_test)
conduct inline --interactive "Payment processing"
```

```bash
conduct --status          # Check progress (shows all 16 steps)
conduct --resume          # Pick up where you left off
conduct --step stories    # Run one step only
conduct --from plan       # Start from a specific step
conduct --reset           # Clear session state and start fresh
```

Daemon mode (`conduct-ts` only) — drive many pre-specced features unattended, each in its
own worktree, opening a PR on finish:

```bash
# Drain the backlog once: every eligible feature, then exit
conduct-ts daemon

# Cap at 10 features this pass
conduct-ts daemon --max-items 10

# Continuous: keep polling for new features, bounded by ceilings
conduct-ts daemon --continuous --max-runtime 3600 --max-cost 2000000
```

Daemon flags: `--continuous` (idle-poll instead of draining once),
`--max-items <n>`, `--max-cost <tokens>`, `--max-runtime <seconds>`,
`--idle-poll <seconds>`, `--max-idle-polls <n>`. Ceilings stop *starting* new
features; in-flight work always drains. The daemon runs **serially** (one feature
at a time) so the live session shows exactly the feature building — `--concurrency`
above 1 is clamped to 1 with a logged note (real concurrency is out of scope; see
`.docs/plans/2026-06-29-daemon-tmux-supervisor.md`).

### Priority scheduling for issue-labeled backlog items

When a GitHub issue is labeled with priority metadata, the daemon orders eligible
features by priority band **after** passing the eligibility gate. This enables
human-driven build prioritization without changing the gate logic.

**Priority bands (highest to lowest):**
- `priority: high` — highest priority (no-issue status escalated)
- `priority: medium` — standard priority
- `priority: low` — lower priority
- Unlabeled (no priority label) — fallback chronological order

**Label vocabulary:**
The daemon reads GitHub issue labels via the REST API on each daemon scan.
Label names are exact matches: `priority: high`, `priority: medium`, `priority: low`.
If an issue has multiple priority labels, the highest-priority one wins.
Mixed or malformed labels are ignored (safe-fail).

**Refresh behavior:**
Labels are fetched fresh on each daemon scan (no caching across runs).
Within a single scan, results are cached (one network fetch per issue).
On reader failure (GitHub API outage, auth error), the daemon gracefully
degrades to chronological ordering and logs a single warning per outage.
When GitHub recovers and the next scan succeeds, the warning resets.

**Dashboard visibility:**
In the startup inherited-state dashboard, ELIGIBLE items now show a `[band]`
suffix indicating their priority band (e.g., `feature-name [high]`).
When in fallback mode (reader failure), a `[fallback]` marker appears on
all ELIGIBLE items, signaling that ordering is chronological.

**Interaction with other gates:**
Priority ordering is applied **post-gate**, after eligibility checks.
It never overrides the eligibility gate, park markers, deduplication,
owner gating, or dependency resolution — those gates remain unchanged.
A feature ineligible for any reason stays out of ELIGIBLE regardless
of its priority band.

The daemon consumes existing specs — it never authors them — and only picks up
**eligible** features: a feature is eligible when its stories are approved
(`Status: Accepted`, not DRAFT) and its plan declares a task dependency tree
(`## Task Dependency Graph` or per-task `**Dependencies:**` lines), and it hasn't
already shipped. Ineligible features are skipped with a logged reason. A feature
that can't converge is left in its worktree (`.pipeline/HALT`) for you; the pool
keeps going.

A blocking SHIP gate tries to self-heal before it halts: the conductor dispatches the
`/remediate` planner over the gate's gap artifact — a blocking prd-audit
(`.pipeline/prd-audit.md`), a failed finish verification (`.pipeline/test-failures.md`), or a
BLOCKED as-built architecture review (`.pipeline/architecture-review-as-built.md`) — and routes
each fixable gap back to the right step with concrete tasks, reserving the HALT for gaps that
genuinely need a human decision (architectural clarity or product scope).

On any irrecoverable daemon HALT that stranded committed work — a build/gating-step failure, a
prd-audit gap needing human DECIDE, the kickback/stuck-gate caps, or an unexpected error (rebase
conflicts excluded) — when the branch has at least one commit, the daemon pushes it and opens a
**draft PR** labeled `needs-remediation` with a comment explaining the HALT reason — best-effort
and non-blocking. PRs from successfully-shipped features
are enrolled in a watch registry (`.daemon/mergeable-watch.jsonl`); a label sweep (on startup,
after each feature, and each idle poll tick) keeps the `mergeable` label truthfully in sync with
CI and conflict state, so you can filter the PR list by merge-readiness. Both labels are
daemon-only; interactive runs are unchanged.

On startup, before any dispatch, the daemon prints a grouped **inherited-state
dashboard** (HALTED / IN-PROGRESS / **WAITING** / ELIGIBLE / PROCESSED) to both your
terminal and `daemon.log`. Each row shows the bits you triage on — complexity tier, the step a
feature reached, and the PR link once one is open (shipped features list their PR too).
**WAITING** lists build-ready specs held back by an unresolved GitHub issue dependency (a
`Source-Ref:` marker linked via GitHub's issue-dependencies API): the gate resolves each spec's
blocker chain and holds it out of ELIGIBLE until every blocker closes, distinguishing "blocked
by another open issue," "blocked by a dependency cycle," and "indeterminate" (a `gh` API error
or unparseable marker — fails closed, never dispatched). The engineer's intake claim similarly
skips blocked ideas and claims the oldest **unblocked** one, reporting a distinct "all-blocked"
outcome (never confused with an empty queue) when every pending idea is stuck. A one-time
`conduct-ts engineer migrate-issue-deps [--confirm]` command migrates repos whose issues
describe dependencies as prose into real GitHub issue-dependency links so the gate can see them.
See [`src/conductor/README.md`](src/conductor/README.md#dependency-ordered-intake-and-dispatch)
for details.
It also tracks the base-branch tip SHA (`.daemon/last-base-sha`): when
the base branch **actually advances** — live, or while the daemon was down — it
**re-kicks every halted feature** (aborting any paused rebase, preserving the reason
to `.pipeline/HALT.cleared`, clearing `.pipeline/HALT`) so parked work retries
automatically on the event most likely to unblock it, resuming **rebase-first** so the
advanced base is integrated before the failed gate re-checks. A plain restart with no
advance leaves every marker intact. See
[`src/conductor/README.md`](src/conductor/README.md#halt-reconciliation-startup-dashboard--main-advance-re-kick-adr-013).

The daemon is hosted as a **foreground process inside a per-repo tmux session**
(`cc-daemon-<slug>`), so you can attach to a *running* daemon on demand — in full color
— and restart or debug it without hunting for a pid. Its output is still teed to an
append-only **`.daemon/daemon.log`** (size-capped, rotated once) so the full narrative
survives. Each persisted line is prefixed with an ISO-8601 UTC timestamp so activity
read back via `daemon logs` can be correlated in time (the live console stays
uncluttered). Management requires `tmux` on the host; the daemon still builds with no
tmux present (management is purely additive).

```bash
conduct-ts daemon start      # start the daemon in a tmux session (idempotent — no duplicate)
conduct-ts daemon connect    # attach READ-ONLY to watch live, in color (Ctrl-b d to detach)
conduct-ts daemon debug      # attach read/write — Ctrl-c to pause the loop and inspect
conduct-ts daemon restart    # fresh inner process, same session
conduct-ts daemon stop       # stop the daemon, release the lock
```

Two read-only observability commands surface state without attaching:

```bash
# Liveness of every registered repo's daemon (running / stale / stopped, session up/down) + last activity
conduct-ts daemon status

# View or tail a repo's daemon log (default: current dir)
conduct-ts daemon logs
conduct-ts daemon logs --follow            # tail -f
conduct-ts daemon logs --repo /path/to/repo
conduct-ts daemon logs --all               # every registered repo
```

The management/observability verbs (`start`/`stop`/`restart`/`connect`/`debug`/`status`/
`logs`) are dispatched before the bare `conduct-ts daemon` run, so they're never mistaken
for a launch — and `conduct daemon <verb>` (the bash wrapper) now forwards to `conduct-ts`
instead of starting a feature build named after the verb.

**Operator park.** Prevent a worktree from being re-kicked or re-dispatched without stopping the
daemon:

```bash
conduct daemon park <slug>    # Parks the worktree; will not re-kick or dispatch until unparked
conduct daemon unpark <slug>  # Resumes normal re-kick and dispatch
```

The park state is stored in `.daemon/parked/<slug>`, validated against a known plan
(`.docs/plans/<slug>.md`) or worktree (`.worktrees/<slug>`) before writing. **Operator-parked is
not the same as HALTed:** a HALT (`.pipeline/HALT`) is written by the pipeline itself and cleared
automatically by re-kick; an operator-park is placed by a human and survives both — clearing a
HALT does not unpark a slug. Unlike a HALT, an operator-parked worktree preserves its REKICK
sentinel and resumes re-dispatch right where it left off once unparked. The status dashboard's
PARKED group takes absolute precedence over every other group (HALTED, ELIGIBLE, etc.) — a parked
slug always shows there and nowhere else. See
[`src/conductor/README.md`](src/conductor/README.md#operator-park--unpark) for details.

**Auto-restart on stale engine (self-host only).** In self-host mode, before starting each feature
(and at idle) the daemon rebuilds its engine from the fast-forwarded source (content-addressed —
a no-op when unchanged, an atomic `dist` flip otherwise) and checks whether the running engine has
gone stale. When it has and no tasks are in-flight, the daemon writes a `.daemon/RESTART_PENDING`
marker and exits cleanly, allowing an external respawn transport to relaunch with fresh code so the
next feature builds on it. Firing at the dispatch boundary — not only when the backlog drains —
ensures freshly-merged specs are never built on stale engine code (the rebuild is required because
build artifacts are untracked, so a merge alone never moves `dist`). It never interrupts an
in-flight build. Enable with `auto_restart_on_stale_engine: true` in your project config; ignored
in non-self-host environments and disabled in once-mode runs. Requires PR #215 respawn transport
for deployment.

On failure, conduct sends a desktop notification and drops into an interactive Claude session
to fix the issue. After you `/quit`, it rechecks artifacts and continues automatically.

Engineer mode (`conduct-ts` only) — an **agent-hosted, human-gated** loop that turns a free-form
idea into a routed, lesson-informed **spec PR**. It never builds and never merges (a merged spec PR
is the only idea→build handoff). As of Phase 9.3 there is no Node REPL and no spawned `claude` — the
host agent drives routing and the real DECIDE skills in-chat over deterministic TypeScript primitives:

```text
add a CSV export to the reporting tool
  → intake parses the idea into an Envelope (empty text is rejected, not dropped)
  → routes it across your registered projects (conduct register / create)
  → asks you to confirm:  confirm | decline | redirect <project> | create <path>
  → pulls relevant prior lessons from the engineer store into the spec
  → runs the FULL DECIDE phase for real, in canonical order: explore (track) → complexity →
    prd (product track) → architecture-diagram → architecture-review → stories →
    conflict-check → plan (tier-aware: Small skips conflict-check + architecture); the
    assessed tier is recorded at .docs/complexity/<slug>.md and consumed by the target's daemon
    (artifacts under .docs/ only; never a stub/DRAFT story or DRAFT ADR, never a spawned claude)
  → opens a spec PR, then ensure-running brings up the target's daemon
```

Every write is gated on your confirmation (decline = zero writes); authoring is **cross-repo
isolated** (repo A never touches sibling repo B; a stale target path fails fast) and multi-repo
**fan-out** authors each confirmed target independently. A no-remote target still commits the spec on
a branch (PR step is a non-fatal skip). Registry/store locations come from `$AI_CONDUCTOR_REGISTRY` /
`$AI_CONDUCTOR_ENGINEER_DIR`. See `src/conductor/README.md` for the full flow and the pidfile-lock
daemon liveness model (`ensureRunning`, one-per-repo `O_EXCL` mutex, stale-pid reclaim).

Handles API rate limits by waiting for reset and auto-retrying.

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
| **CLI flags**                | Full surface (`--auto`, `--interactive`, …)   | Same flags **except `--interactive`** is not yet wired           |
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

For details, see [Unknown-Command Guard](https://github.com/anthropics/ai-conductor#unknown-command-guard).

Both binaries read `~/.ai-conductor/config.yml` (user-level) and the project's
`.ai-conductor/config.yml` if present. Legacy `~/.claude/ai-conductor.config.json` is
read as a fallback for installs that predate the YAML migration.

See `src/conductor/README.md` for the three-layer architecture (Engine / Execution / UI)
behind `conduct-ts`.

## Configuration

The harness reads two config files, merged in order (project overrides user):

| File | Scope | Purpose |
|------|-------|---------|
| `~/.ai-conductor/config.yml` | User-level | Personal defaults, update channel, markdown viewer, mermaid renderer |
| `.ai-conductor/config.yml` | Project-level | Per-project model/effort tuning, custom steps, plugin selection |

Both files are optional. The conductor works with zero config.

### Full reference

```yaml
# .ai-conductor/config.yml

harness_version: ">=0.99.0"   # Minimum harness version this config requires

# ── Global defaults ───────────────────────────────────────────────────────────
defaults:
  model: sonnet                 # "haiku" | "sonnet" | "opus" or full model ID
  effort: medium                # "low" | "medium" | "high" | "xhigh" | "max"
  max_retries: 3                # Retry budget before recovery-menu escalation

# ── Phase-level defaults (override global) ───────────────────────────────────
phases:
  BUILD:
    model: opus
    effort: high
  SHIP:
    model: sonnet

# ── Per-step overrides ────────────────────────────────────────────────────────
steps:
  # Override a built-in step
  prd:
    model: opus
    effort: max
    max_retries: 1

  # Disable a built-in step (gating/structural steps cannot be disabled)
  assess:
    disable: true

  # Override the skill file for a step
  tdd:
    skill: .claude/skills/my-custom-tdd/SKILL.md

  # Add a custom step after an existing one
  my-security-scan:
    after: writing-system-tests
    skill: .claude/skills/security-scan/SKILL.md
    enforcement: advisory
    hooks:
      before: scripts/setup-scan.sh
      after: scripts/teardown-scan.sh

  # A custom step inserted among the gate-loop steps (build…finish) joins the
  # gate-driven loop automatically (inherits its `after` target's membership).
  verify-deploy:
    after: manual_test          # SHIP loop step → verify-deploy is in the loop
    skill: .claude/skills/verify-deploy/SKILL.md
    enforcement: gating
    # gate: true                # force loop membership (or `false` to opt out)
    # kickback_target: true     # let a downstream step re-open this gate

  # Tier-specific overrides (applied when complexity_tier matches)
  build:
    by_tier:
      L:
        model: opus
        effort: high
        max_retries: 5
      S:
        model: haiku
        max_retries: 2

# ── Model availability fallback ladder ────────────────────────────────────────
# When a configured/pinned model is detected unavailable, the daemon automatically
# retries the next model in this list instead of failing the step. Omit to use the
# default; set to `[]` to disable fallback entirely.
model_fallback_ladder: ["fable", "opus", "sonnet"]   # default shown

# ── Complexity tier ───────────────────────────────────────────────────────────
complexity:
  default_tier: M              # "S" | "M" | "L" — used when /assess hasn't run yet

# ── Plugin selection (conduct-ts only) ───────────────────────────────────────
llm_provider: claude           # Which registered LLM provider to use (default: "claude")
ui_renderer: terminal          # Which registered UI renderer to use (default: "terminal")
memory_provider: local         # Which memory provider to use (default: "local" — shared canonical store)

# ── Assess staleness thresholds ──────────────────────────────────────────────
assess:
  stale_after_days: 90         # Re-prompt if last assessment is older than this
  stale_after_commits: 500     # Re-prompt if this many commits since last assessment

# ── Acceptance-spec locations (extends the built-in defaults; never replaces) ─
# Where this repo's RED acceptance/system specs live, so the acceptance_specs
# completion gate doesn't false-halt. The built-ins cover Rails (spec/…), Node
# (test/, __tests__/, *.test.{js,ts,jsx,tsx}) and backend/ layouts at the repo
# root. Declare extra globs for anything they don't anticipate — most often a
# MONOREPO whose specs sit one package deep. A leading `*/` matches any
# immediate subdirectory (node_modules and dot-dirs are skipped), so you don't
# have to name each package; literal prefixes (api/spec/**) work too.
acceptance_spec_globs:
  - "*/spec/**"                 # e.g. api/spec/integration/…, api/spec/jobs/…
  - "*/__tests__/**"            # e.g. frontend/__tests__/screens/Foo.test.tsx

# ── Markdown viewer (for artifact review + changelog rendering) ───────────────
markdown_viewer:
  preset: glow                 # Built-in presets: glow, bat, mdcat, less, cat
  # Or configure manually:
  # command: glow
  # args: ["{file}"]
  # mode: inline               # "inline" | "blocking" | "external"

# ── Harness self-host guardrails (conduct-ts only; applies ONLY to a self-build ─
#    of the james-stoup-agents harness repo — no effect on any other repo) ──────
# Absent block = the safe default: auto-detect the harness self-build and run all
# guardrails. See "Harness self-host guardrails" below. (Active for self-builds:
# the daemon loop relinks + sandboxes the build and runs the finish gates.)
harness_self_host:
  activation: auto             # "auto" (path-detect) | "force_on" | "force_off"
  # Per-gate toggles — omit to leave ENABLED (a partial block never disables a gate):
  # skill_relink_preflight: true
  # sandbox_build_env: true
  # version_approval_gate: true
  # release_artifact_gate: true
  # Declared version freeze (#261) — the operator's standing "current version, no
  # bump" approval. While it matches the repo VERSION, the approval gate records
  # .pipeline/version-approval itself instead of halting every self-build; any
  # other VERSION still halts (a freeze never approves an actual bump).
  # version_freeze: "0.99.19"

# ── User-level conductor state (lives in ~/.ai-conductor/config.yml) ─────────
conductor:
  update_channel: tagged       # "tagged" | "main"
  auto_check: true             # Check for updates on startup
```

### Model fallback ladder (`conduct-ts` only)

Skills and daemon steps are pinned to a preferred model (e.g. Fable for `rebase`,
`remediate`, `debugging` — see [Model Selection](HARNESS.md#model-selection)). If that
model is ever detected unavailable, the daemon no longer fails the step — it walks the
`model_fallback_ladder` and retries with the next model down until one succeeds.

- **Config key:** `model_fallback_ladder` — an optional top-level array of model names
  in `.ai-conductor/config.yml`.
- **Default:** `["fable", "opus", "sonnet"]`.
- **Disabling:** set `model_fallback_ladder: []` to turn off fallback (an unavailable
  model then fails the step as before).
- **Matching:** exact-string match against the configured/pinned model name.
- **Restart semantics:** "known unavailable" models are cached per-process only.
  Restarting the daemon clears the cache, so the next run retries from the top of the
  ladder in case the model has recovered.
- **Override:** the `--model` CLI flag and `steps.<step>.model` config still take
  precedence as an explicit override — but the override is itself checked for
  availability, and falls back down the ladder if it's unavailable too.
- **Logging:** every downgrade is written to the conductor logs as
  `Downgraded from <configured> to <fallback>: <reason>` — check there if a step ran on
  an unexpected model.

### Operator identity & owner gate (multi-operator, `conduct-ts` only)

When two or more operators run daemons on **separate machines against the same repo**, each
daemon must build **only its own** specs — no duplication, no silent stalls. That partition
is keyed on an **operator identity** (`spec_owner`).

**Identity is machine-scoped — set it in your USER config, never the project config.**

```yaml
# ~/.ai-conductor/config.yml   (per machine — NOT committed)
spec_owner: your-github-login
```

- **Resolution chain:** user-config `spec_owner` → `gh` login → unresolved. An explicit
  `spec_owner` always wins over the ambient `gh` login (deterministic).
- **Anti-leak (hard guard):** `spec_owner` committed into a **project** `.ai-conductor/config.yml`
  is a config-load **rejection** — it would leak your identity to everyone who pulls the repo.
  The error names the file and the fix (move it to `~/.ai-conductor/config.yml`).
- **Fail-closed:** a daemon that can resolve **no** identity (no user-config `spec_owner`
  and no `gh` login) builds **nothing** and logs a loud, once-per-pass notice — it never
  falls back to building every operator's work.
- **Un-owned specs are surfaced, never silently skipped:** a merged spec with no `Owner:`
  marker is skipped with a distinct, deduped line telling you to add an `Owner:` marker on
  the default branch (or grandfather it via `owner_gate_cutover`).

**Grandfather cutover — a per-repo policy that MUST NOT be set on the harness self-host repo.**

```yaml
# <repo>/.ai-conductor/config.yml   (committed — per-repo policy)
owner_gate_cutover: 2026-06-30T00:00:00Z   # build un-owned specs merged BEFORE this instant
```

`owner_gate_cutover` grandfathers pre-existing **un-owned** specs so a repo with an unbuilt
backlog can adopt the owner gate without stranding that work. **Do not set it on the
james-stoup-agents self-host repo:** every plan there is already built and merged, so the
grandfather window would make the daemon rebuild all of them. Leave it unset on the harness.

### OpenTelemetry observability (`conduct-ts` only)

The TypeScript conductor can export run/step traces and metrics to any OTel-compatible
backend (Jaeger, Grafana Tempo, Honeycomb, etc.) or to a local JSONL file. Add an `otel:`
block to your project config to opt in:

```yaml
# OTLP HTTP (default port 4318 — Jaeger, Grafana Tempo, Honeycomb, …):
otel:
  exporter: otlp
  endpoint: http://localhost:4318

# gRPC transport (port 4317):
otel:
  exporter: otlp
  endpoint: http://localhost:4317
  protocol: grpc

# File — writes OTLP-JSON newline-delimited to .pipeline/otel.jsonl:
otel:
  exporter: file
```

**Default-off.** Absent `otel:` block → zero overhead. Coexists with `events.jsonl` and
`--report`; event-emission sites are not modified.

**What you get:**
- One `conductor.run` trace per run, with one child span per step.
- `conductor.step.duration` histogram, `conductor.step.retries` counter, and
  `conductor.step.tokens` counter (only when token usage is present).
- Resource attributes: `conductor.run.id`, `conductor.feature`, `conductor.project`,
  `service.name=ai-conductor` on every span.
- Incomplete spans (interrupted run) are force-closed ERROR with `conductor.incomplete=true`.
- SIGINT/SIGTERM flush within the configured `exportTimeoutMillis` (default 5 s).

See `src/conductor/README.md → OpenTelemetry exporter` for the full implementation
reference.

### Sandbox auth-expiry park-and-poll

When the daemon builds a feature in a headless (sandbox/self-hosted) environment, the operator's
Claude API credentials may expire mid-build. The daemon detects auth failures and expired credentials
via two entry points:

1. **Pre-flight expiry check** — before provisioning a sandbox build, checks the operator's credentials
   file (`~/.claude/.credentials.json`) for an expired `claudeAiOauth.expiresAt` timestamp. Expired
   credentials immediately trigger a **park-and-poll** wait.
2. **Step-level auth failure** — if a step fails with "Not logged in" or "Invalid API key" output,
   the daemon treats it as an auth failure and enters the park-and-poll wait (see below).

**Park-and-poll behavior:**
When auth is blocked (expired or failed), instead of failing the feature immediately, the daemon
**parks** the feature and waits for the operator to refresh their credentials:
- Watches the operator's credentials file for an **mtime change** (indicating a refresh)
- When the file changes AND the credentials are no longer expired, **resumes** the feature
- Re-copies the refreshed credentials into the sandbox and retries the step with **budget intact**
  (parking consumes zero retries)
- Timeout (configurable, default **60 minutes**): if credentials are not refreshed within the window,
  HALTs with a reason naming the credentials path and observed expiry time

**Configuration:**
```yaml
# .ai-conductor/config.yml (project level)
auth_park_timeout_minutes: 60      # default: 60 minutes; 0 or negative = opt-out (HALT immediately)
```

**Opt-out:** Set `auth_park_timeout_minutes: 0` or a negative value to disable park-and-poll.
On auth failure or expiry, the feature HALTs immediately instead of waiting.

**HALT reason:** When the park window times out, the HALT reason includes:
- The credentials file path that was watched
- The observed `expiresAt` timestamp (or "unparseable" if unreadable)

**Remediation:** Standard HALT remediation applies (no new process):
1. Operator refreshes credentials (login via `claude login`)
2. Standard HALT recovery: clear `.pipeline/HALT`, observe `.pipeline/HALT.cleared` marker,
   and re-queue the feature via the base-SHA advance re-kick logic (see ADR-013) or manual dispatch.

See `src/conductor/README.md` → "Sandbox auth-expiry park-and-poll" for implementation details.

### Harness self-host guardrails (`conduct-ts` only)

The harness is the one repo the daemon can't build the way it builds every other repo — a self-build
edits the very skills/hooks it is executing, on a machine whose concurrent Claude sessions all read
the global `~/.claude/skills`. To make the `james-stoup-agents` harness repo safe to daemon-register,
a **self-host mode** (configured by the `harness_self_host` block above) activates a guardrail bundle
**only** for a harness self-build — every other repo's path is unchanged (the only added cost is one
detector boolean):

- **`SelfHostDetector`** — recognizes a self-build by comparing the build repo's realpath to the
  harness root (identity is by path, never repo name). `activation: force_on|force_off` overrides it;
  the detector is a swappable interface, the replacement point for a future platform identity.
- **`SkillRelinkPreflight`** — relinks harness skills (`bin/install --update`) before dispatch so a
  self-build that adds or renames a skill never HALTs on "no parseable result" from a stale symlink.
- **`SandboxBuildEnv`** — runs the self-build against a **throwaway `CLAUDE_CONFIG_DIR`** whose
  `skills/` + `hooks/` link into the build worktree, so it exercises its *own edited harness* without
  ever mutating the global `~/.claude` the operator's live sessions read. It also **copies** the
  operator's `.credentials.json` (so the headless build authenticates) and a `settings.json` whose
  harness-checkout hook paths are **retargeted to the worktree** (so the build fires its *own* edited
  hooks). Copies — never symlinks — so no sandbox link resolves to a global-config target. Fails
  closed if a worktree link target is missing; torn down on pass, fail, or crash.
- **`VersionApprovalGate` + `ReleaseArtifactGate`** — HALT-based, fail-closed finish gates:
  VERSION-bump approval, `test/test_harness_integrity.sh`, a non-empty CHANGELOG `[Unreleased]`, and a
  `## Migration` block for breaking changes. In the daemon's unattended `auto` mode there is no prompt,
  so any gate that can't self-satisfy writes `.pipeline/HALT` and the PR is not opened.

**The daemon never merges** (ADR-005/ADR-010): every self-build ends at a HALT for the operator to
re-install, `/verify`, and merge. Config is safe-by-default — an absent or partial `harness_self_host`
block auto-detects with all gates on.

**How it activates in the loop.** The daemon classifies self-host **once** at startup (against the
main repo root, honoring the `activation` override) and threads a single `selfHost` flag to each
build. For a self-build only: skills are relinked before the first `build`; the `build` step runs with
`process.env.CLAUDE_CONFIG_DIR` scoped to the sandbox **for the duration of that step and restored
afterward** (nothing bleeds into `finish`); and the VERSION + release gates run **before** the
`finish` step opens the PR — a failing gate writes `.pipeline/HALT` so the PR never opens. Every part
is gated behind that one flag, so any other repo's build path is byte-for-byte unchanged.

> **Status:** active for self-builds. The guardrail bundle (`src/conductor/src/engine/self-host/`) is
> wired into the daemon loop; the harness can be daemon-registered with self-host mode on. See
> `src/conductor/README.md → Harness self-host guardrails` for the module + wiring reference.

### Plugins (`conduct-ts` only)

The TypeScript conductor supports a plugin system for swapping the LLM provider or UI renderer
without modifying source code. Plugins are discovered from two directories at startup:

| Directory | Scope |
|-----------|-------|
| `~/.ai-conductor/plugins/<name>/` | Global — available to all projects |
| `.ai-conductor/plugins/<name>/` | Project-local — overrides global for same kind+name |

**Writing a plugin manifest (`plugin.yml`):**

```yaml
kind: llm_provider             # llm_provider | ui_renderer | step | hook | visualizer
name: my-provider              # lowercase letters, digits, hyphens only — no path chars
entrypoint: ./index.js         # relative to the plugin directory
harness_version: ">=0.99.4"   # semver range — conductor rejects incompatible plugins
capabilities:                  # optional freeform metadata
  streaming: false
  recording: true
```

**Example: install a custom LLM provider**

```bash
# Create the plugin directory
mkdir -p ~/.ai-conductor/plugins/my-provider

# Write the manifest
cat > ~/.ai-conductor/plugins/my-provider/plugin.yml <<EOF
kind: llm_provider
name: my-provider
entrypoint: ./index.js
harness_version: ">=0.99.4"
EOF

# Write the entrypoint (must export invoke() and invokeInteractive())
cat > ~/.ai-conductor/plugins/my-provider/index.js <<EOF
export default {
  async invoke(options) {
    // options: { prompt, model, effort, sessionId, projectRoot }
    return { success: true, output: "...", exitCode: 0 };
  },
  async invokeInteractive(options) {
    // called for conversational (REPL) steps
  },
};
EOF

# Select it in your project config
echo "llm_provider: my-provider" >> .ai-conductor/config.yml
```

**Built-in plugins (always available, no install needed):**

| Kind | Name | Description |
|------|------|-------------|
| `llm_provider` | `claude` | Default — invokes Claude CLI via `execa` |
| `ui_renderer` | `terminal` | Default — ink-based live dashboard |
| `memory_provider` | `local` | Default — shared canonical store at `~/.ai-conductor/memory/<key>/harness/` symlinked as `.memory/`; recall is agent-driven (no harness-side search) |

**Plugin load rules:**

- Manifest validation errors (invalid kind, bad name format) → plugin skipped with a warning; other plugins still load.
- Version incompatibility (`harness_version` range excludes current version) → startup aborted with `PluginVersionError`.
- Missing entrypoint file → startup aborted with `PluginLoadError` naming the missing path.
- Project-local plugin with the same `kind:name` as a global plugin → project-local wins; a debug log line records the shadowing.

## How It Works

### SDLC Flow

```
UNDERSTAND → DECIDE → BUILD → SHIP
```

| Phase | Skills | What Happens |
|-------|--------|-------------|
| UNDERSTAND | `/bootstrap`, `/memory`, `/assess` | Detect/scaffold project, load tech-context, recall prior decisions, codebase health assessment |
| DECIDE | `/explore` (track) → `/prd` (product) → `/architecture-diagram` → `/architecture-review` → `/stories` → `/conflict-check` → `/plan` | Explore + track → product-only PRD → architecture (ADRs) → stories → conflicts → tasks |
| BUILD | `/writing-system-tests` → `/pipeline` or `/tdd`, `/code-review`, `/debugging` | Acceptance specs → TDD → evaluator gates |
| SHIP | `/manual-test` → `/prd-audit` → `/architecture-review --as-built` → `/retro` → `/finish`, `/pr` | curl/browser validation → PRD compliance audit → as-built architecture sweep → dual retrospective → verification → pull request |

### Skills (22 total)

| Skill | Enforcement | Model | Purpose |
|-------|-------------|-------|---------|
| `/bootstrap` | Advisory | sonnet | Detect/scaffold project, .claudeignore, smoke test, MCP setup |
| `/memory` | Gating | haiku | Recall/persist decisions, patterns, gotchas across sessions |
| `/assess` | Gating | haiku | Dispatch 9 CTO specialists for codebase health assessment |
| `/explore` | Advisory | sonnet | Context + approaches + decide product/technical track (no design doc) |
| `/prd` | Gating | opus | Product-only PRD with FRs (product track only); scope check, API contract |
| `/stories` | Gating | sonnet | User stories with mandatory negative paths (10 categories) |
| `/conflict-check` | Gating | opus | Detect contradictions (5 types), resolutions create ADRs |
| `/plan` | Gating | sonnet | 2-5 min tasks, dependency graph, scope sanity check |
| `/architecture-diagram` | Gating | sonnet | C4 architecture diagrams in Mermaid, maintained across SDLC |
| `/architecture-review` | Gating | opus | Feasibility, alignment, domain integrity, risk register. BLOCKED = human required. SHIP `--as-built` mode (sonnet): shipped code vs APPROVED ADRs |
| `/writing-system-tests` | Gating | sonnet | Failing acceptance specs (HTTP-level for headless/API, E2E/UI for full-stack), in the project's own test framework. Product-track: emits per-FR coverage table `.pipeline/fr-coverage.md`; gate refuses to complete while any FR is unresolved |
| `/tdd` | Structural | sonnet | RED → DOMAIN → GREEN → DOMAIN → COMMIT with subagent isolation |
| `/simplify` | Gating | sonnet | Deduplication + complexity reduction at batch boundaries |
| `/pipeline` | Structural | sonnet | Multi-task orchestration, quality gates, rework budgets, progress log |
| `/code-review` | Gating | opus | Evaluator: spec compliance (+ OVER-BUILT) → quality → domain |
| `/debugging` | Gating | opus | 4-phase investigation before any fix |
| `/finish` | Gating | haiku | Fresh verification, story coverage, merge/PR options |
| `/manual-test` | Gating | sonnet | Validate stories via curl/browser, bug loop through /tdd |
| `/prd-audit` | Gating | opus | Audit shipped impl vs PRD FRs; per-FR verdict + gap-class; kicks back to BUILD or DECIDE |
| `/rebase` | Advisory | opus | Operator-invokable conflict resolver; also dispatched by the daemon's gated rebase-resolution loop (up to `rebase_resolution_attempts` attempts before HALT, daemon-only) |
| `/retro` | Advisory | opus | Dual analysis: harness + application, trend tracking |
| `/conduct` | Gating | haiku | SDLC orchestrator: 17-step flow with gate enforcement |

### Agent Personas

Skills define *what* to do. Agents define *who* does it with what context.

| Agent | Role | Key Trait |
|-------|------|-----------|
| Generator | Writes tests and code | Context-isolated: RED sees only tests, GREEN sees only source |
| Evaluator | Reviews with skepticism | Fresh context, no shared state with generator |
| Domain Reviewer | Checks domain integrity | Veto authority — can reject and send back |
| Planner | Expands requirements | Surfaces edge cases the user didn't consider |
| Worktree Manager | Git worktree lifecycle | Feature isolation via create/merge/cleanup/status |
| CTO Security | Auth & input validation | OWASP top 10, attack vector analysis |
| CTO Data Integrity | Transactions & race conditions | Event sourcing, data safety |
| CTO Dependencies | Package & license auditing | CVEs, outdated packages, license compliance |
| CTO Architecture | Coherence & coupling | Decisions vs implementation alignment |
| CTO Duplication | Code duplication detection | Boilerplate, copy-paste, blast radius |
| CTO Testing | Test strategy review | Coverage gaps, layer balance, assertion quality |
| CTO Infrastructure | Infra config review | DB pooling, caching, background jobs, prod parity |
| CTO Observability | Logging & monitoring | Error handling, debugging context |
| CTO DevEx | Developer experience | Onboarding, CI/CD, local dev, documentation |
| CTO Orchestrator | Synthesizes 9 specialist reports | Cross-references and prioritizes findings |

### Enforcement Levels

| Level | Mechanism | Example |
|-------|-----------|---------|
| Advisory | Instructions only | Brainstorm: "ask one question at a time" |
| Gating | Evidence required | Stories: no story accepted without concrete negative paths |
| Structural | Subagent isolation | TDD: RED agent can't see source files |
| Mechanical | Git hooks (opt-in) | Pre-commit: block commits outside COMMIT phase |

### Tech-Context

Stack-specific knowledge in `tech-context/`. Currently supported:

| Stack | Context Files |
|-------|--------------|
| Rails + PostgreSQL | `tdd.md` (RSpec, factories), `stories.md` (N+1, migrations, enums), `review.md` (security, performance), `debugging.md` (tools, gotchas) |

Tech-context is additive — it supplements skills, never overrides them. Projects without matching
tech-context use generic skill behavior.

## TypeScript Conductor (`src/conductor/`)

The TypeScript rewrite behind `conduct-ts`. Three-layer architecture —
Engine / Execution / UI — with typed events, pluggable UI renderers, and
dedicated test coverage (950+ tests). See the feature comparison in
[Choosing a Conductor](#choosing-a-conductor); implementation notes below.

- **`bin/conduct-ts`** is a thin shell wrapper around `src/conductor/dist/index.js`.
- **Engine** owns state machine, gates, completion checks, auto-heal logic.
- **Execution** invokes Claude via `execa` with session + rate-limit handling.
- **UI** is a pluggable subscriber: the default terminal renderer is event-driven.
- **Auto-heal**: before a build-gate retry, the engine cross-checks
  `.pipeline/task-status.json` against git log and flips pending tasks to completed
  when there's unambiguous evidence of a prior-run commit. Audit trail under
  `.pipeline/audit-trail/autoheal-*.json`.
- **Bootstrap-mode skip**: when bootstrap detects a `new`-mode project (empty directory
  before scaffolding), the conductor skips `assess` rather than dispatching 9 specialists
  against a blank codebase.
- **Gate-driven loop**: the SHIP-phase tail (`build → manual_test → retro → rebase → finish`)
  is driven by a *selector* over machine-checkable **gate verdicts** rather than a fixed
  order. A downstream step can **kick back** to `plan`/`stories` (re-open an upstream gate);
  the loop converges to `.pipeline/DONE` or stops at `.pipeline/HALT`. Opt-in via
  `verifyArtifacts`; with `freshContextPerStep`, each tail step runs on fresh context.
- **Rebase-on-latest before finish**: an engine-native `rebase` gate (no Claude dispatch)
  rebases the worktree branch onto the **discovered** origin default branch (fetched; falls
  back to the local base — no hardcoded `main`) before the PR is opened, so it's never built
  on a stale base. Its verdict is *branch already current with base*, so a no-op goes straight
  to finish. A clean rebase that changed **code/test paths** kicks back to `build` to
  re-verify; a **CHANGELOG-only** `[Unreleased]` conflict is auto-resolved (both features'
  entries kept, each once); any other / mixed conflict triggers the **gated resolution loop**
  — the daemon dispatches the `/rebase` skill up to `rebase_resolution_attempts` times
  (config key, default 3; set to 0 to disable) before HALTing. A resolution is accepted only
  when the branch is genuinely current with the base (FR-8) and no feature commits were
  dropped (FR-9); a code-changing resolution kicks back to `build`/`manual_test` as normal.
  If the loop is exhausted, the engine writes `.pipeline/HALT`, leaves the rebase **paused**,
  and opens no PR. The gated resolution loop is daemon-only; the `/rebase` skill is also
  manually invokable by an operator. Resume: resolve → `git rebase --continue` →
  `rm .pipeline/HALT` → re-queue.
- **Daemon mode** (`conduct-ts daemon`): drains a backlog of features that already have
  stories **and** plans, running each in its own worktree (parallel via `--concurrency N`,
  bounded by `--max-items`), and opening a PR on finish. Per-feature failures are isolated;
  the pool keeps going.
- **Content-aware shipped-work dedup** (`.docs/shipped/<stem>.md`, #204, #205): the daemon's
  backlog discovery and its main-advance re-kick sweep both dedup against a **committed**
  record — `slug`, `spec_hash`, `pr`, `shipped` frontmatter committed **on the implementation
  PR branch** by the finish flow (`conduct-ts shipped-record --slug <stem> --pr <url|local>`,
  run by `/finish` before the branch's final push), so the human merge lands the code and the
  shipped-fact atomically — not just the local `.daemon/processed/` ledger. That ledger is
  now a **cache**, repaired opportunistically from shipped records; it is no longer required
  for correctness. A fresh clone or a wiped `.daemon/` directory therefore never re-dispatches
  or re-kicks a spec whose implementation already merged, and a renamed-but-unchanged spec is
  still caught by content-hash match. See
  [`src/conductor/README.md`](src/conductor/README.md) for the full dedup contract.
- **Engineer memory store** (daemon only): on each feature completion the daemon emits a
  structured learning signal + a narrative to a cross-project store at
  `~/.ai-conductor/engineer/` (override with `$AI_CONDUCTOR_ENGINEER_DIR`). `signals.jsonl` holds
  one append-only JSON line per feature-run (outcome, kickbacks, halts, retry hotspots,
  token spend, per-step durations); `narratives/<project>/<feature>-<runId>.md` holds the
  full retro (`done`) or a short halt note (`halted`). To keep daemon-built repos clean, the
  in-loop `retro` step is **skipped under the daemon** and its narrative is redirected to the
  store; manual `/conduct` runs still write `.docs/retros/` unchanged. Emission is
  best-effort and append-safe — a store failure never breaks a ship.
- **Custom config steps run**: the conductor drives the resolved registry
  (`buildStepRegistry`), so custom steps from `.ai-conductor/config.yml` are dispatched and
  participate in the loop.
- **Project registry + creation** (`conduct register` / `conduct create`): a single-writer
  registry module owns `~/.ai-conductor/registry.json` (override with `$AI_CONDUCTOR_REGISTRY`)
  with atomic temp+rename writes, realpath-canonicalized dedup, credential redaction of remote
  URLs, and status provenance (a `created` project is never downgraded to `registered`).
  `conduct register [path]` records an existing git repo (name=basename, absolute path, redacted
  origin remote); `conduct create <name> [--remote <url>]` scaffolds a fresh project (git init +
  skeleton CLAUDE.md referencing HARNESS.md + `.gitignore` ignoring `.pipeline/`, `.daemon/`,
  `.worktrees/`, `.serena/`; `--remote` is add-only, no push) and refuses to clobber a non-empty
  target.
  Both are **non-interactive** (run to completion and exit). `/bootstrap` auto-registers the
  project via `conduct register .` after onboarding (idempotent).
- **Pinned Node**: `conduct-ts` reads `src/conductor/.tool-versions` and exports
  `ASDF_NODEJS_VERSION` so the bundle runs on its required Node even when your shell's
  default is older.

See [`src/conductor/README.md`](src/conductor/README.md) for the gate-loop and daemon
internals (verdicts, selector, kickback, worker pool).

Build and install:

```bash
cd src/conductor
npm install
npm run build
cd ../..
./bin/install  # creates ~/.local/bin/conduct-ts symlink
```

## Project Structure

```
ai-conductor/
├── bin/
│   ├── install              # Install/update/uninstall harness
│   ├── conduct              # Stable bash SDLC runner
│   ├── conduct-ts           # TypeScript conductor wrapper (requires built dist/)
│   └── migrate              # Changelog-driven migration runner
├── src/conductor/           # TypeScript conductor (tsup bundle, vitest tests)
│   ├── src/engine/          # State machine, gates, completion, auto-heal
│   ├── src/execution/       # Claude provider, subprocess, rate limiting
│   ├── src/ui/              # Pluggable UI subscribers (terminal, live-region)
│   ├── src/types/           # State + event type definitions
│   ├── test/                # vitest suites (engine, execution, ui, integration)
│   └── dist/                # Built bundle — created by `npm run build`
├── skills/                  # One directory per skill, each with SKILL.md
│   ├── architecture-diagram/
│   ├── architecture-review/
│   ├── assess/
│   ├── bootstrap/
│   ├── explore/
│   ├── prd/
│   ├── code-review/
│   ├── conduct/
│   ├── conflict-check/
│   ├── debugging/
│   ├── finish/
│   ├── manual-test/
│   ├── memory/
│   ├── pipeline/
│   ├── plan/
│   ├── pr/
│   ├── retro/
│   ├── simplify/
│   ├── stories/
│   ├── tdd/
│   │   └── references/      # Detailed RED, GREEN, drill-down, domain-review guidance
│   └── writing-system-tests/
├── agents/                  # Agent persona prompts
│   ├── generator.md
│   ├── evaluator.md
│   ├── domain-reviewer.md
│   ├── planner.md
│   ├── worktree-manager.md
│   ├── cto-security.md
│   ├── cto-data-integrity.md
│   ├── cto-dependencies.md
│   ├── cto-architecture.md
│   ├── cto-duplication.md
│   ├── cto-testing.md
│   ├── cto-infrastructure.md
│   ├── cto-observability.md
│   ├── cto-devex.md
│   └── cto-orchestrator.md
├── tech-context/            # Stack-specific knowledge
│   ├── FORMAT.md            # Contract for adding new stacks
│   └── rails-postgres/
├── templates/               # Templates for generated files
│   ├── CLAUDE.md.template
│   ├── AGENTS.md.template
│   ├── adr.md.template
│   ├── architecture-diagram.md.template
│   ├── api-response-contract.md.template
│   ├── claudeignore.template
│   ├── design-doc.md.template
│   ├── pull_request_template.md
│   ├── styleguide.md.template
│   └── technical-assessment.md.template
├── hooks/
│   ├── pre-commit-tdd-gate.sh          # Optional git hook for TDD phase enforcement
│   └── claude/                          # Claude Code session hooks
│       ├── block-destructive-git.sh
│       ├── diagram-coverage-check.sh
│       ├── lint-after-edit.sh
│       ├── post-commit-pipeline-sync.sh
│       ├── rate-limit-wait.sh
│       ├── session-start-context.sh
│       ├── spec-coverage-check.sh
│       ├── stop-memory-reminder.sh
│       ├── tdd-commit-gate.sh
│       └── worktree-check.sh
├── .docs/decisions/          # Harness ADRs
└── CLAUDE.md                # Harness internal docs (loaded by Claude Code)
```

## What Your Project Gets

After running `/bootstrap` on a project, it creates:

```
your-project/
├── .claude/
│   └── settings.json        # Project-scoped Read/Edit/Write permissions +
│                            # pre-PR lint hook (PreToolUse on gh pr create)
├── .memory/                 # Cross-session knowledge
│   ├── decisions/
│   ├── patterns/
│   ├── gotchas/
│   └── context/
├── .pipeline/               # Pipeline state (if using /pipeline)
│   ├── task-status.json
│   ├── summary.json         # Written at final-task completion; retro reads this
│   └── audit-trail/
│       ├── batch-N/         # Evaluator verdicts (review.json per batch)
│       └── autoheal-*.json  # Conductor auto-heal records (TS conductor only)
├── .docs/
│   ├── specs/               # Design docs from /prd
│   ├── stories/             # User stories from /stories
│   ├── conflicts/           # Conflict reports from /conflict-check
│   ├── plans/               # Implementation plans from /plan
│   ├── decisions/           # ADRs (API contract, styleguide, etc.)
│   ├── architecture/        # C4 diagrams from /architecture-diagram
│   │   ├── system-context.md
│   │   ├── containers.md
│   │   ├── components.md
│   │   ├── sequences/
│   │   └── erd.md
│   └── retros/              # Retrospective reports from /retro
├── .github/
│   └── pull_request_template.md  # Changelog + Migration scaffolding
└── CLAUDE.md                # Project-specific harness config
```

Bootstrap detects your stack (Node+TS, Rails+Rubocop, Python+ruff/mypy, Rust+clippy,
Go+vet) and writes the lint command into `.claude/settings.json` as a `PreToolUse(Bash)`
hook with `if: "Bash(gh pr create*)"`. Linting becomes fully deterministic machinery —
TDD, pipeline, and code-review skills never invoke the linter themselves. Non-zero
exit from the lint command blocks the PR; users edit the command in place.

## Adding Tech-Context for New Stacks

See `tech-context/FORMAT.md` for the contract. Each stack gets a directory with up to 4 files:

```
tech-context/<framework>-<database>/
├── tdd.md        # Test framework, factories, assertions, patterns
├── stories.md    # Stack-specific negative path categories
├── review.md     # Security checklist, performance checklist, antipatterns
└── debugging.md  # Tools, log locations, common gotchas
```

## Key Design Principles

1. **One skill, one responsibility** — Skills have singular focus
2. **Artifacts are the interface** — Skills communicate via files in `.docs/`, not internal orchestration
3. **Negative paths are mandatory** — Every story must have concrete failure scenarios
4. **Evaluator sees fresh context** — No shared state with the generator prevents confirmation bias
5. **Dry business logic, not dry code** — Extract shared behavior, not shared shape
6. **Anything approved twice should be automated** — Pre-approve routine operations
7. **Refactoring happens at batch boundaries** — GREEN phase stays minimal
8. **Every file gets a spec** — Unit specs + request specs, both required
9. **Memory persists across sessions** — Decisions, patterns, gotchas don't get re-discovered
10. **Self-improving** — Retro findings feed back into harness improvements
