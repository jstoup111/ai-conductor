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

## Validation Rules (This Repo)

**Every change to this harness repo MUST be validated before committing.** This is not optional.
Run the full validation suite and fix any failures before `git commit`.

### Validation Suite

Run `test/test_harness_integrity.sh` — it checks all of the following:

1. **Bash syntax** — All scripts in `bin/`, `hooks/claude/`, and `test/` pass `bash -n`.
2. **SKILL.md frontmatter** — Every `skills/*/SKILL.md` has YAML frontmatter with required
   fields: `name`, `description`, `enforcement`, `phase`.
3. **Agent references** — Every `agents/*.md` referenced in skills or HARNESS.md exists on disk.
4. **Cross-skill references** — Every `/skill-name` reference in SKILL.md files points to an
   existing `skills/` directory.
5. **HARNESS.md model table** — Every skill directory has an entry in the model selection table.
6. **Template references** — Every `templates/*.template` referenced in skills exists on disk.
7. **Section numbering** — No duplicate section numbers within a SKILL.md file.

### When to Validate

- **Before every commit** in this repo
- After editing any SKILL.md, agent, HARNESS.md, or bin/ script
- Claude MUST run validation automatically — do not ask, do not skip

### Failure Handling

If validation fails, fix the issue before committing. Do not commit with known validation
failures. If a check is failing due to a legitimate structural change (e.g., renaming a skill),
fix all references before committing.

## Branch Policy

All work MUST happen on a feature branch — never commit directly to main.
Create a branch before making changes, and open a PR to merge.

## Release & Update Gates

The harness uses a semver tagging system and an auto-update flow. Every change
to this repo must honor these gates:

1. **Changelog on every PR.** Every PR to `main` MUST add an entry under
   `## [Unreleased]` in `CHANGELOG.md` under one of: Added / Changed / Fixed /
   Removed. The `.github/pull_request_template.md` scaffolds the required
   sections. **CI enforces this** — `.github/workflows/release.yml` fails the
   release workflow post-merge if `[Unreleased]` is empty. This rule applies
   to the harness repo only. It does NOT change how Claude opens PRs in
   consumer projects that use the harness.

2. **Migration blocks for breaking changes.** Any PR that changes
   `settings.json` schema, hook wiring, skill symlink targets, or `bin/conduct`
   CLI MUST include a `## Migration` section in `CHANGELOG.md` with a runnable
   ```` ```bash migration ```` fenced block. `bin/migrate` will execute these
   blocks (after user approval) when consumers update past this version.

3. **Releases are cut by CI on merge to main.** `.github/workflows/release.yml`
   reads `VERSION`, tags `vX.Y.Z`, rewrites the `[Unreleased]` block under
   `## [X.Y.Z] - <today>`, bumps `VERSION` to the next patch, and publishes a
   GitHub Release. There is no manual release script. Version bumps beyond
   patch happen by editing `VERSION` directly in the PR so reviewers can see
   the semver decision.

4. **Semver rules:**
   - **MAJOR** — breaking change to skill contracts, `bin/conduct` CLI, or
     `settings.json` schema.
   - **MINOR** — new skill, new hook, new gate, additive HARNESS.md rule.
   - **PATCH** — bug fix, wording, non-behavioral cleanup.

   **Before creating a PR**, Claude MUST present the proposed VERSION bump to
   the user for approval. State the current VERSION, the proposed new VERSION,
   and the semver justification (which rule applies). Do not edit VERSION or
   create the PR until the user confirms.

5. **Integrity checks apply to release artifacts too.**
   `test/test_harness_integrity.sh` validates: `VERSION` is valid semver,
   `CHANGELOG.md` has a `## [Unreleased]` section, and every `vX.Y.Z` tag has
   a matching `## [X.Y.Z]` section in `CHANGELOG.md`.

## HARNESS.md Flow

HARNESS.md is the single source of truth for behavioral rules consumed by projects using this harness.

- All behavioral changes (communication protocol, model selection, conventions) go in HARNESS.md
- This CLAUDE.md describes the harness repo itself; HARNESS.md describes rules for projects
- `check_harness_config()` in `bin/conduct` auto-detects missing HARNESS.md references in
  project CLAUDE.md files and prompts the user to upgrade
- When the harness is pulled, HARNESS.md updates propagate to all projects automatically
