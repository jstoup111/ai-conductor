# James Stoup Agents — Custom Development Harness

A personal suite of skills and agent personas for AI-assisted software development.
Built on Claude Code as the execution engine — no custom runtime, pure Markdown.

## Optimization Targets (Priority Order)

1. 100% correct feature functionality
2. Correct code & gating (no bad code passes gates)
3. Minimal user intervention during implementation

## SDLC Phase Flow

Skills chain via artifacts in `docs/`. No skill orchestrates another internally.

```
UNDERSTAND → DECIDE → BUILD → SHIP
```

| Phase | Skills | Artifacts |
|-------|--------|-----------|
| ALL | **conduct** (orchestrator) | Status dashboard, gate enforcement |
| UNDERSTAND | bootstrap, memory | CLAUDE.md, .memory/ |
| DECIDE | brainstorm → stories → conflict-check → plan | docs/specs/, docs/stories/, docs/conflicts/, docs/plans/ |
| BUILD | tdd, debugging, code-review, pipeline | Code, tests, .pipeline/ |
| SHIP | finish, retro | docs/retros/ |

## Skill Invocation

Skills are in `skills/`. Each has a `SKILL.md` with YAML frontmatter declaring enforcement level,
SDLC phase, and dependencies. Invoke via `/skill-name` or by referencing the skill file.

**Start here:** Two ways to run the flow:
- **Interactive:** Run `/conduct` inside Claude Code to be guided step-by-step
- **Automated:** Run `bin/conduct "feature description"` from your terminal for minimal intervention

## Agent Personas

Agent prompt templates are in `agents/`. Skills define *what* to do; agents define *who* does it.

- `generator.md` — Implements code via TDD
- `evaluator.md` — Reviews with calibrated skepticism (fresh context, no shared state with generator)
- `domain-reviewer.md` — Checks domain integrity, has veto authority
- `planner.md` — Expands requirements into specs

## Tech-Context

Stack-specific knowledge lives in `tech-context/`. Bootstrap detects the project stack and loads
the matching context. Skills reference tech-context when available, work without it.

## Enforcement Levels

Each skill declares its enforcement level honestly:
- **Advisory** — Instructions only
- **Gating** — Evidence required before proceeding
- **Structural** — Subagent isolation via Agent tool
- **Mechanical** — Claude Code hooks (optional, opt-in)

## Memory

Project-level memory lives in `.memory/` with categories: decisions, patterns, gotchas, context.
Every session starts with recall. Significant decisions are persisted during work.

## Autonomy Principle

**Anything approved more than once is a candidate for automation.**

Routine operations (reading/editing project files, running tests, running linters, launching
subagents) should be pre-approved in project settings. Only genuinely destructive or
external-facing actions warrant interactive approval:

| Pre-approve (routine) | Require approval (destructive/external) |
|---|---|
| File reads/edits within project | `git push`, `git reset --hard` |
| Running test suite | Deleting branches |
| Running linter | Posting to external services (PRs, issues) |
| Launching subagents | Database drops or destructive migrations |
| `git add`, `git commit` | Force push, rebase published commits |

When setting up a new project with `/bootstrap`, configure `allowedTools` in
`.claude/settings.json` to pre-approve routine operations.

## Key Conventions

- One skill, one responsibility, one enforcement level
- Plans assume zero-context executor — all detail included
- Negative path stories are mandatory, not optional
- No implementation plan without clean conflict-check
- Retro runs on both harness AND application after every feature
- Tech-context is additive — never overrides generic skill behavior
