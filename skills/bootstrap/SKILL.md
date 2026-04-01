---
name: bootstrap
description: "Use when starting a new project, onboarding to an existing project, or setting up the harness for the first time. Detects project type, tech stack, and generates project-specific configuration."
enforcement: advisory
phase: understand
standalone: true
requires: []
---

## Purpose

Detects the target project's type, tech stack, and structure, then generates a project-specific
CLAUDE.md that references the harness skills. Sets up project directories for pipeline state,
memory, and documentation artifacts.

Works for both **new projects** (empty or freshly scaffolded) and **existing projects** (with
code, tests, and history already in place).

## Practices

### 1. Determine Bootstrap Mode

| Indicator | Mode |
|-----------|------|
| Empty directory or no project files | **New** — scaffold first (Step 1b) |
| Project files exist but no harness artifacts | **Fresh** — full harness setup |
| `.memory/` or `.docs/` exist but some missing | **Partial** — fill gaps only |
| All harness artifacts exist | **Re-bootstrap** — update detection, re-run smoke test |

Also check maturity: 50+ commits = mature, 5+ model files = substantial, existing specs = assess
coverage, existing CLAUDE.md = **preserve, don't overwrite**.

### 1b. Scaffold New Project (New Mode Only)

1. Ask for or infer framework from user prompt
2. Scaffold: `rails new . --api --database=postgresql --skip-bundle` (or equivalent)
3. Install dependencies, add test framework if missing (rspec-rails, jest, pytest)
4. Configure database — detect port conflicts before writing docker-compose.yml
5. Set up .gitignore before first commit (vendor/bundle, node_modules, tmp, log)
6. Initialize git if not already a repo

**Worktree Compatibility:** All infrastructure must be namespaced for parallel worktrees:
- Database name via `ENV['WORKTREE_DB_SUFFIX']` or directory name
- Redis namespace per worktree
- Ports via `ENV['PORT']` with overridable defaults
- Temp/cache dirs project-local

### 2. Detect Project Type

Scan project root for indicators (first match per category):

**Language/Framework:** Gemfile+rails→Rails, package.json+next→Next.js,
package.json+express→Express, pyproject.toml+django→Django, Cargo.toml→Rust, go.mod→Go

**Database:** database.yml+postgresql→PostgreSQL, +mysql→MySQL, +sqlite→SQLite

**Test Framework:** .rspec→RSpec, test/*_test.rb→Minitest, jest.config→Jest, pytest.ini→pytest

**Frontend:** app/views/→server-rendered, app/javascript/→JS frontend,
package.json+react/vue/svelte→SPA, none→API-only

### 3. Load Tech-Context

Match detected stack to `tech-context/` (e.g., Rails+PostgreSQL → `tech-context/rails-postgres/`).
Note in CLAUDE.md so skills reference session-loaded context.

### 3b. Generate .claudeignore

Generate from `templates/claudeignore.template`. Remove stack-irrelevant sections (e.g., Rails
sections for Node projects). If `.claudeignore` already exists, do NOT overwrite.

### 3c. Generate PR Template

Copy `templates/pull_request_template.md` to `.github/pull_request_template.md`.
Create `.github/` directory if it doesn't exist. If a PR template already exists, do NOT overwrite.
The template contains `[feature_description]`, `[story_count]`, and `[branch]` placeholders
that `conduct` fills in when creating the PR after retro.

### 4. Analyze Existing Code (Existing Projects Only)

This step performs a **structural scan only** — file counts, directory layout, test framework detection. Deep analysis of security, architecture, testing strategy, dependencies, and code health has moved to `/assess`.

**Skip for new/fresh projects.** Build an inventory:

- **Codebase:** models, controllers, services, jobs — count source and test files
- **Test coverage:** run suite, identify files with NO specs
- **Architecture:** routes, patterns (service objects, concerns), auth approach, existing docs
- **In-flight work:** open PRs/issues (`gh pr list`, `gh issue list`), TODO comments
- **Git history:** `git log --oneline -20`, `git shortlog -sn --no-merges`

Present inventory summary to user before proceeding.

### 4b. Draft As-Built Stories (Existing Projects Only)

If a recent assessment report exists (`.docs/decisions/technical-assessment-*.md`), reference its findings as additional context for story drafting.

**Priority order for story sources:**
1. `.docs/plans/*.md` — if existing plans exist, derive stories from them first. Plans represent
   intended behavior more accurately than code inspection. Each plan phase becomes a story group.
2. `.pipeline/bootstrap-inventory.md` — supplement with test coverage gaps and untested files.
3. Code scan — last resort if neither plans nor inventory exist.

Generate DRAFT stories for what exists. One file per feature area (or per plan phase) with
happy paths from plan tasks or routes/tests. Negative paths left as `TODO` — `/stories` fills them in.

Mark as `Status: DRAFT` and `[AS-BUILT]`. In-flight work gets `[PLANNED]` marker with
issue/PR reference. Bootstrap does NOT validate stories — the normal flow handles that:
`/bootstrap → /stories (review drafts) → /conflict-check → normal flow`

### 4c. Document Existing Architectural Decisions (Existing Projects Only)

If a recent assessment report exists, defer to `/assess`'s architecture findings for deeper analysis. Bootstrap ADRs capture only what is observable in code — the assessment provides the judgment layer.

Surface implicit decisions as ADRs in `.docs/decisions/` using `templates/adr.md.template`.

**Detect:** framework+version, database, auth approach, API format, test framework,
background jobs, key architecture-shaping libraries.

**Rules:**
- Only document what's **observable in code** — don't invent rationale
- Use `Status: Observed` (inferred, not explicitly decided)
- One short ADR per decision. Don't duplicate existing ADRs.

### 5. Set Up Project Directories

Create if missing (idempotent): `.memory/` (decisions/, patterns/, gotchas/, context/,
index.md), `.pipeline/` (audit-trail/), `.worktrees/`, `.docs/` (specs/, stories/, conflicts/,
plans/, decisions/, retros/).

Add to `.gitignore` (idempotent — don't duplicate):
- `.pipeline/` — runtime state, not source
- `.worktrees/` — git worktrees for parallel feature development

### 6. Generate or Update CLAUDE.md

- **Fresh/no CLAUDE.md:** Generate from `templates/CLAUDE.md.template`
- **Existing CLAUDE.md:** Append harness section below `<!-- Generated by /bootstrap -->` marker.
  Never overwrite content above the marker. On re-bootstrap, update only the harness section.

### 7. Bootstrap Memory (Existing Projects Only)

Seed `.memory/` from existing code. Use detection from Steps 4 and 4c — don't re-scan.
- **decisions/** — architectural choices (from 4c ADRs)
- **patterns/** — service object conventions, controller patterns, test patterns
- **gotchas/** — reverts/hotfixes in git history, files changed 5+ times recently
- **context/** — domain entities and relationships from models

Update `.memory/index.md`. Report: "Bootstrapped memory with N decisions, M patterns, K gotchas."

### 8. Frontend Styleguide (Projects with Frontend Only)

If frontend detected, generate from `templates/styleguide.md.template` to
`.docs/decisions/styleguide.md`. If styleguide already exists, reference it instead.
Skip for API-only projects.

### 9. MCP Integration Setup

Offer MCP server configuration based on project:
- **GitHub:** if git remote exists, configure `gh copilot mcp` in settings
- **Issue tracker:** if user mentions Linear/Jira, help configure appropriate MCP
- **Browser automation (full-stack only):** configure `@modelcontextprotocol/server-puppeteer`
  for manual-test automation. Skip for API-only (curl suffices).

**For full-stack projects, GitHub and browser automation MCP are expected** — configure them
unless the user explicitly declines. For API-only projects, MCP is optional.

### 10. Smoke Test

Verify the project works: database connects, test framework runs, app loads without errors.
Report failures before proceeding — a broken foundation wastes all downstream effort.

### 11. Recommend Next Steps

| Mode | Recommendation |
|------|---------------|
| Fresh | `/conduct → /brainstorm → /stories → normal flow` |
| Existing (first harness setup) | `/stories (review drafts) → /conflict-check → normal flow` |
| Existing (new feature) | `/brainstorm → /stories (new + review drafts) → normal flow` |
| Existing (improve coverage) | `/stories (fill TODOs) → /plan → /tdd → /finish` |
| Existing (onboarding) | `/conduct --status` — read inventory and memory |

## Verification

- [ ] Bootstrap mode correctly determined
- [ ] Project type detected from file indicators
- [ ] Tech-context loaded if matching stack found
- [ ] Existing code analyzed with inventory presented (if existing project)
- [ ] As-built stories drafted (if existing project)
- [ ] Existing architectural decisions documented as ADRs (if existing project)
- [ ] .memory/ created and seeded (if existing project)
- [ ] .docs/ subdirectories created
- [ ] `.github/pull_request_template.md` created (if not already present)
- [ ] CLAUDE.md generated or appended — never overwritten
- [ ] Worktree-compatible infrastructure configuration
- [ ] Smoke test passed
- [ ] MCP integration offered
