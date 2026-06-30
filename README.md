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
# Optional: build the TypeScript conductor bundle if you want to try conduct-ts
(cd src/conductor && npm install && npm run build)
./bin/install
```

This symlinks all 20 skills into `~/.claude/skills/` and installs the conductor CLI(s) to
`~/.local/bin/`. See [Choosing a Conductor](#choosing-a-conductor) below — both binaries
coexist, `conduct` is the default, `conduct-ts` is opt-in and only symlinked if you've
built the dist bundle.

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
/bootstrap → /brainstorm → /stories → /conflict-check → /plan → /architecture-diagram
→ /architecture-review → /writing-system-tests → /pipeline → /manual-test
→ /prd-audit → /architecture-review --as-built → /retro → /finish
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

# Manual oversight — REPL mode for conversational steps (brainstorm, stories, plan, architecture_review, manual_test)
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

The daemon consumes existing specs — it never authors them — and only picks up
**eligible** features: a feature is eligible when its stories are approved
(`Status: Accepted`, not DRAFT) and its plan declares a task dependency tree
(`## Task Dependency Graph` or per-task `**Dependencies:**` lines), and it hasn't
already shipped. Ineligible features are skipped with a logged reason. A feature
that can't converge is left in its worktree (`.pipeline/HALT`) for you; the pool
keeps going.

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
dashboard** (HALTED / IN-PROGRESS / ELIGIBLE / PROCESSED) to both your terminal and
`daemon.log`. Each row shows the bits you triage on — complexity tier, the step a
feature reached, and the PR link once one is open (shipped features list their PR too).
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
survives. Management requires `tmux` on the host; the daemon still builds with no tmux
present (management is purely additive).

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
  → runs the FULL DECIDE phase for real, in canonical order: brainstorm → complexity →
    stories → conflict-check → architecture-diagram → architecture-review → plan
    (tier-aware: Small skips conflict-check + architecture); the assessed tier is
    recorded at .docs/complexity/<slug>.md and consumed by the target's daemon
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
| **Install**                  | Always symlinked by `bin/install`             | Symlinked only when `src/conductor/dist/` has been built         |
| **Build step**               | None                                          | `cd src/conductor && npm install && npm run build`               |
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
  brainstorm:
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

# ── User-level conductor state (lives in ~/.ai-conductor/config.yml) ─────────
conductor:
  update_channel: tagged       # "tagged" | "main"
  auto_check: true             # Check for updates on startup
```

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
| DECIDE | `/brainstorm` → `/stories` → `/conflict-check` → `/plan` → `/architecture-diagram` → `/architecture-review` | Design → stories → conflicts → tasks → diagrams → architecture gate |
| BUILD | `/writing-system-tests` → `/pipeline` or `/tdd`, `/code-review`, `/debugging` | Acceptance specs → TDD → evaluator gates |
| SHIP | `/manual-test` → `/prd-audit` → `/architecture-review --as-built` → `/retro` → `/finish`, `/pr` | curl/browser validation → PRD compliance audit → as-built architecture sweep → dual retrospective → verification → pull request |

### Skills (22 total)

| Skill | Enforcement | Model | Purpose |
|-------|-------------|-------|---------|
| `/bootstrap` | Advisory | sonnet | Detect/scaffold project, .claudeignore, smoke test, MCP setup |
| `/memory` | Gating | haiku | Recall/persist decisions, patterns, gotchas across sessions |
| `/assess` | Gating | haiku | Dispatch 9 CTO specialists for codebase health assessment |
| `/brainstorm` | Advisory | opus | Explore requirements, scope check, API contract, design doc |
| `/stories` | Gating | sonnet | User stories with mandatory negative paths (10 categories) |
| `/conflict-check` | Gating | opus | Detect contradictions (5 types), resolutions create ADRs |
| `/plan` | Gating | sonnet | 2-5 min tasks, dependency graph, scope sanity check |
| `/architecture-diagram` | Gating | sonnet | C4 architecture diagrams in Mermaid, maintained across SDLC |
| `/architecture-review` | Gating | opus | Feasibility, alignment, domain integrity, risk register. BLOCKED = human required. SHIP `--as-built` mode (sonnet): shipped code vs APPROVED ADRs |
| `/writing-system-tests` | Gating | sonnet | Failing acceptance specs (integration for API, system for full-stack) |
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
│   ├── brainstorm/
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
│   ├── specs/               # Design docs from /brainstorm
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
