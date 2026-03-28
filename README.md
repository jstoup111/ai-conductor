# James Stoup Agents

A custom development harness for Claude Code. Pure Markdown skills and agent personas that enforce
a disciplined SDLC: design docs, user stories with mandatory negative paths, conflict detection,
TDD with domain review, evaluator-gated code review, and dual retrospectives.

No custom runtime. Claude Code is the execution engine.

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) v2.0+
- Git
- A project to work on (Rails+PostgreSQL has full tech-context support; other stacks work with generic skills)

## Install

```bash
git clone https://github.com/jamesstoup/james-stoup-agents.git
cd james-stoup-agents
./bin/install
```

This symlinks all 14 skills into `~/.claude/skills/` and puts the `conduct` script on your PATH
via `~/.local/bin/`.

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
It walks you through:

```
/bootstrap → /brainstorm → /stories → /conflict-check → /plan → /pipeline → /finish → /retro
```

### Automated

```bash
cd your-project/
conduct "Add user authentication with session tokens"
```

Runs the full SDLC with minimal intervention. Non-interactive steps use `claude -p`. The build
step drops to an interactive session for TDD oversight.

```bash
conduct --status          # Check progress
conduct --resume          # Pick up where you left off
conduct --step stories    # Run one step only
conduct --from plan       # Start from a specific step
```

## How It Works

### SDLC Flow

```
UNDERSTAND → DECIDE → BUILD → SHIP
```

| Phase | Skills | What Happens |
|-------|--------|-------------|
| UNDERSTAND | `/bootstrap`, `/memory` | Detect stack, scaffold dirs, load tech-context, recall prior decisions |
| DECIDE | `/brainstorm` → `/stories` → `/conflict-check` → `/plan` | Design doc → stories with negative paths → conflict detection → task breakdown |
| BUILD | `/tdd`, `/pipeline`, `/code-review`, `/debugging` | TDD cycles with domain review, evaluator gates, quality checks |
| SHIP | `/finish`, `/retro` | Fresh verification, merge/PR options, dual retrospective |

### Skills (14 total)

| Skill | Enforcement | Purpose |
|-------|-------------|---------|
| `/bootstrap` | Advisory | Detect project type, scaffold directories, smoke test, MCP setup |
| `/memory` | Gating | Recall/persist decisions, patterns, gotchas across sessions |
| `/brainstorm` | Advisory | Explore requirements, propose approaches, write design doc, scope check |
| `/stories` | Gating | Generate user stories with mandatory negative paths (10 categories) |
| `/conflict-check` | Gating | Detect contradictions between stories (5 conflict types) |
| `/plan` | Gating | Break stories into 2-5 minute tasks with dependency graph |
| `/tdd` | Structural | RED → DOMAIN → GREEN → DOMAIN → COMMIT with subagent isolation |
| `/pipeline` | Structural | Multi-task orchestration with quality gates and rework budgets |
| `/code-review` | Gating | Evaluator dispatch: spec compliance → code quality → domain integrity |
| `/debugging` | Gating | 4-phase investigation before any fix (no shotgun debugging) |
| `/finish` | Gating | Fresh verification, story coverage check, merge/PR options |
| `/retro` | Advisory | Dual analysis: harness performance + application code health |
| `/conduct` | Gating | SDLC orchestrator: status dashboard, gate enforcement, flow guidance |
| `/simplify` | Advisory | Review changed code for reuse, quality, and efficiency |

### Agent Personas

Skills define *what* to do. Agents define *who* does it with what context.

| Agent | Role | Key Trait |
|-------|------|-----------|
| Generator | Writes tests and code | Context-isolated: RED sees only tests, GREEN sees only source |
| Evaluator | Reviews with skepticism | Fresh context, no shared state with generator |
| Domain Reviewer | Checks domain integrity | Veto authority — can reject and send back |
| Planner | Expands requirements | Surfaces edge cases the user didn't consider |

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

## Project Structure

```
james-stoup-agents/
├── bin/
│   ├── install              # Install/update/uninstall harness
│   └── conduct              # Automated SDLC runner
├── skills/                  # One directory per skill, each with SKILL.md
│   ├── bootstrap/
│   ├── brainstorm/
│   ├── code-review/
│   ├── conduct/
│   ├── conflict-check/
│   ├── debugging/
│   ├── finish/
│   ├── memory/
│   ├── pipeline/
│   ├── plan/
│   ├── retro/
│   ├── stories/
│   └── tdd/
│       └── references/      # Detailed RED, GREEN, drill-down, domain-review guidance
├── agents/                  # Agent persona prompts
│   ├── generator.md
│   ├── evaluator.md
│   ├── domain-reviewer.md
│   └── planner.md
├── tech-context/            # Stack-specific knowledge
│   ├── FORMAT.md            # Contract for adding new stacks
│   └── rails-postgres/
├── templates/               # Templates for generated files
│   ├── CLAUDE.md.template
│   ├── AGENTS.md.template
│   └── api-response-contract.md.template
├── hooks/                   # Optional git hooks
│   └── pre-commit-tdd-gate.sh
├── docs/decisions/          # Harness ADRs
└── CLAUDE.md                # Harness internal docs (loaded by Claude Code)
```

## What Your Project Gets

After running `/bootstrap` on a project, it creates:

```
your-project/
├── .memory/                 # Cross-session knowledge
│   ├── decisions/
│   ├── patterns/
│   ├── gotchas/
│   └── context/
├── .pipeline/               # Pipeline state (if using /pipeline)
│   ├── task-status.json
│   └── audit-trail/
├── docs/
│   ├── specs/               # Design docs from /brainstorm
│   ├── stories/             # User stories from /stories
│   ├── conflicts/           # Conflict reports from /conflict-check
│   ├── plans/               # Implementation plans from /plan
│   ├── decisions/           # ADRs (API contract, styleguide, etc.)
│   └── retros/              # Retrospective reports from /retro
└── CLAUDE.md                # Project-specific harness config
```

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
2. **Artifacts are the interface** — Skills communicate via files in `docs/`, not internal orchestration
3. **Negative paths are mandatory** — Every story must have concrete failure scenarios
4. **Evaluator sees fresh context** — No shared state with the generator prevents confirmation bias
5. **Dry business logic, not dry code** — Extract shared behavior, not shared shape
6. **Anything approved twice should be automated** — Pre-approve routine operations
7. **Refactoring happens at batch boundaries** — GREEN phase stays minimal
8. **Every file gets a spec** — Unit specs + request specs, both required
9. **Memory persists across sessions** — Decisions, patterns, gotchas don't get re-discovered
10. **Self-improving** — Retro findings feed back into harness improvements
