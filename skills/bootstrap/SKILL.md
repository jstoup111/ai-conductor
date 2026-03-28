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

## Practices

### 1. Detect Project Type

Scan the project root for these indicators (check in order, stop at first match per category):

**Language/Framework:**
- `Gemfile` with `rails` → Ruby on Rails
- `Gemfile` without `rails` → Ruby
- `package.json` with `next` → Next.js
- `package.json` with `express` → Express/Node
- `package.json` with `react` (no next) → React SPA
- `pyproject.toml` or `requirements.txt` with `django` → Django
- `pyproject.toml` or `requirements.txt` with `fastapi` → FastAPI
- `pyproject.toml` or `requirements.txt` → Python
- `Cargo.toml` → Rust
- `go.mod` → Go

**Database:**
- `database.yml` with `postgresql` or `Gemfile` with `pg` → PostgreSQL
- `database.yml` with `mysql` or `Gemfile` with `mysql2` → MySQL
- `database.yml` with `sqlite` → SQLite

**Test Framework:**
- `.rspec` or `spec/` directory → RSpec
- `test/` with `_test.rb` files → Minitest
- `jest.config.*` or `package.json` with `jest` → Jest
- `vitest.config.*` → Vitest
- `pytest.ini` or `conftest.py` → pytest

**Frontend (check even if backend framework detected — project may be full-stack):**
- `app/views/` with `.erb`/`.haml`/`.slim` → Rails views (server-rendered)
- `app/javascript/` or `app/frontend/` → Rails with JS frontend
- `package.json` with `react`/`vue`/`svelte`/`angular` → SPA or component library
- `app/assets/stylesheets/` or `tailwind.config.*` → CSS/styling layer
- None of the above → API-only (no frontend)

### 2. Load Tech-Context

Based on detected stack, check for matching tech-context in the harness:

```
detected: Rails + PostgreSQL → load tech-context/rails-postgres/
detected: Node + TypeScript  → load tech-context/node-ts/ (if exists)
detected: no match           → proceed without tech-context (graceful degradation)
```

If tech-context is loaded, note it in the generated CLAUDE.md so other skills know to reference it.

### 3. Set Up Project Directories

Create these directories if they don't exist:

```
.memory/
  decisions/
  patterns/
  gotchas/
  context/
  index.md          # Empty index to start

.pipeline/           # Only if pipeline skill will be used
  audit-trail/

docs/
  specs/
  stories/
  conflicts/
  plans/
  decisions/
  retros/
```

### 4. Generate Project CLAUDE.md

Generate a `CLAUDE.md` in the target project that:
- References the harness skills by path
- Notes the detected tech stack and loaded tech-context
- Lists the recommended skills based on project type
- Includes project-specific conventions discovered during detection

Use `templates/CLAUDE.md.template` as the base.

### 5. Frontend Styleguide (Projects with Frontend Only)

If frontend detection found views, components, or a CSS layer, set up a UI/UX styleguide:

1. Create `docs/decisions/styleguide.md` with:

```markdown
# UI/UX Styleguide

**Date:** YYYY-MM-DD
**Status:** Draft | Accepted

## Design Tokens
- **Colors:** primary, secondary, error, warning, success, neutral scale
- **Typography:** font families, size scale, weight scale, line heights
- **Spacing:** spacing scale (4px base recommended)
- **Breakpoints:** mobile, tablet, desktop thresholds

## Component Conventions
- Component naming convention (PascalCase, kebab-case)
- File structure (one component per file, co-located styles/tests)
- State management approach (local, context, store)

## Accessibility Standards
- WCAG 2.1 AA minimum
- All interactive elements keyboard accessible
- All images have alt text
- Color contrast ratios met
- Form inputs have labels

## Patterns
- Loading states (skeleton, spinner, or placeholder)
- Error states (inline, toast, page-level)
- Empty states (illustration + CTA)
- Responsive behavior (mobile-first vs desktop-first)
```

2. Present to user for review and customization
3. The styleguide feeds into stories — UI stories reference design tokens and accessibility
4. Skip for API-only projects

### 6. Recommend Skills

Based on project type, recommend which skills to activate:

**All projects:** memory, brainstorm, stories, conflict-check, plan, tdd, debugging, code-review, finish, retro

**Projects with complex multi-feature scope:** + pipeline

**Projects with existing stories/specs:** Skip brainstorm, start with stories or conflict-check

### 6. Smoke Test

After setup, verify the project actually works:

**For Rails projects:**
- `bundle exec rails db:migrate:status` — confirms database connection
- `bundle exec rspec` (or `bundle exec rails test`) — confirms test framework runs
- `bundle exec rails routes` — confirms app loads without errors

**For Node projects:**
- `npm test` or `npx jest --passWithNoTests` — confirms test framework
- `npm run build` (if build script exists) — confirms compilation

**For Python projects:**
- `pytest --collect-only` — confirms test framework discovers tests
- `python -c "import <main_module>"` — confirms imports resolve

Report failures before proceeding. A broken project foundation wastes all downstream effort.

### 7. MCP Integration Setup

Walk through connecting the project to external tools via MCP servers:

**GitHub (recommended for all projects with a git remote):**
1. Check if a git remote exists (`git remote -v`)
2. If yes, offer to configure the GitHub MCP server in `.claude/settings.json`
3. This enables: creating issues, PRs, reading PR comments, managing releases — all from within Claude Code
4. Configuration:
   ```json
   {
     "mcpServers": {
       "github": {
         "command": "gh",
         "args": ["copilot", "mcp"],
         "env": {}
       }
     }
   }
   ```

**Issue tracker (optional):**
- If the user mentions Linear, Jira, or another tracker, offer to configure the appropriate MCP server
- This enables: creating stories/tickets from `docs/stories/`, linking commits to issues, tracking progress
- Ask the user which tracker they use and help configure it

**Skip if:** The user declines or no git remote exists. MCP setup is optional but recommended.

### 8. Report

Present to the user:
- Detected project type and tech stack
- Loaded tech-context (or note that none matched)
- Created directories
- Smoke test results (pass/fail)
- MCP integrations configured (or skipped)
- Recommended workflow

## Verification

- [ ] Project type correctly detected from file indicators
- [ ] Tech-context loaded if matching stack found
- [ ] .memory/ directory created with index.md
- [ ] docs/ subdirectories created
- [ ] CLAUDE.md generated with correct references
- [ ] Smoke test passed (DB connects, tests run, app loads)
- [ ] MCP integration offered (GitHub, issue tracker)
- [ ] Recommendations presented to user
