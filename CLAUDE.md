# James Stoup Agents — Custom Development Harness

A personal suite of skills and agent personas for AI-assisted software development.
Built on Claude Code as the execution engine — no custom runtime, pure Markdown.

## Behavioral Rules

All behavioral rules for projects using this harness — SDLC phases, model selection,
communication protocol, enforcement levels, and conventions — are defined in:

**[HARNESS.md](HARNESS.md)**

Claude MUST read and follow HARNESS.md at the start of every session.

## Harness Architecture

- **Skills** (`skills/`) — Each has a `SKILL.md` with YAML frontmatter. One skill, one responsibility.
- **Agents** (`agents/`) — Prompt templates defining *who* does the work.
- **Tech-Context** (`tech-context/`) — Stack-specific knowledge loaded by bootstrap.
- **Templates** (`templates/`) — Project scaffolding including `CLAUDE.md.template`.

## HARNESS.md Flow

HARNESS.md is the single source of truth for behavioral rules consumed by projects using this harness.

- All behavioral changes (communication protocol, model selection, conventions) go in HARNESS.md
- This CLAUDE.md describes the harness repo itself; HARNESS.md describes rules for projects
- `check_harness_config()` in `bin/conduct` auto-detects missing HARNESS.md references in
  project CLAUDE.md files and prompts the user to upgrade
- When the harness is pulled, HARNESS.md updates propagate to all projects automatically
