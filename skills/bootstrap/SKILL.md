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

Check the project directory to determine mode:

| Indicator | Mode |
|-----------|------|
| Empty directory or no project files (no Gemfile, package.json, etc.) | **New** — scaffold the project first |
| Project files exist but no harness artifacts (.memory/, docs/) | **Fresh** — full harness setup |
| `.memory/` or `docs/` exist but some are missing | **Partial** — fill gaps only |
| All harness artifacts exist | **Re-bootstrap** — update detection, re-run smoke test |

Also check for existing project maturity:

| Indicator | Meaning |
|-----------|---------|
| `git log` has 50+ commits | Mature project — significant existing code to analyze |
| `app/models/` or `src/` has 5+ files | Substantial codebase — needs inventory |
| `spec/` or `test/` has existing tests | Test coverage exists — assess before adding more |
| `CLAUDE.md` already exists (not harness-generated) | User has custom instructions — **preserve, don't overwrite** |

### 1b. Scaffold New Project (New Mode Only)

If the directory is empty or has no project files, ask the user what to create:

1. **Ask for framework** — or infer from context (e.g., if the user said "Rails API" in their prompt)
2. **Scaffold the project:**

| Framework | Command |
|-----------|---------|
| Rails API | `rails new . --api --database=postgresql --skip-bundle` |
| Rails full-stack | `rails new . --database=postgresql --skip-bundle` |
| Next.js | `npx create-next-app@latest . --typescript` |
| Express | `npm init -y` + install express |
| FastAPI | `mkdir -p app && touch app/__init__.py app/main.py` |

3. **Install dependencies:** `bundle install`, `npm install`, etc.
4. **Add test framework** if not included:
   - Rails: add `rspec-rails`, `factory_bot_rails`, `shoulda-matchers` to Gemfile, run `rails generate rspec:install`
   - Node: add jest or vitest
   - Python: add pytest
5. **Configure database** for Docker if docker-compose.yml exists or user mentions Docker:
   - **Detect port conflicts BEFORE writing docker-compose.yml:**
     ```bash
     # Check which ports are in use
     docker ps --format '{{.Ports}}' 2>/dev/null | grep -oE '[0-9]+->5432'
     ss -tlnp 2>/dev/null | grep -oE ':[0-9]+' | sort -u
     ```
   - Pick the next available port starting from 5432 (try 5432, 5433, 5434...)
   - Create `docker-compose.yml` with the available port
   - Update `database.yml` (or equivalent) with matching connection settings
   - Start the container and create databases
6. **Set up .gitignore BEFORE first commit:**
   - Ensure these are in `.gitignore` before any `git add`:
     ```
     /vendor/bundle
     /node_modules
     /tmp
     /log
     /.bundle
     ```
   - This prevents committing thousands of vendor files then removing them
7. **Initialize git** if not already a repo: `git init && git add -A && git commit -m "Initial project scaffold"`

After scaffolding, continue to Step 2 (detect project type) — the scaffold will now be detected.

### 2. Detect Project Type

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

### 3. Load Tech-Context

Based on detected stack, check for matching tech-context in the harness:

```
detected: Rails + PostgreSQL → load tech-context/rails-postgres/
detected: Node + TypeScript  → load tech-context/node-ts/ (if exists)
detected: no match           → proceed without tech-context (graceful degradation)
```

If tech-context is loaded, note it in the generated CLAUDE.md so other skills know to reference it.

### 3b. Generate .claudeignore

Create a `.claudeignore` file to keep irrelevant files out of Claude's context window. This
reduces token usage and prevents Claude from reading generated/vendor files.

Generate based on detected stack:

**All projects:**
```
# Dependencies
node_modules/
vendor/bundle/
.bundle/

# Build artifacts
tmp/
log/
coverage/
.cache/

# Docker/system
.docker/
*.pid
*.sock

# IDE
.idea/
.vscode/
*.swp
*.swo

# Assets (binary)
public/assets/
public/packs/
app/assets/images/
*.png
*.jpg
*.gif
*.ico
*.woff
*.woff2
*.ttf
*.eot
```

**Rails additions:**
```
db/schema.rb        # Generated — read migrations instead
storage/
```

**Node additions:**
```
dist/
build/
.next/
.nuxt/
```

If `.claudeignore` already exists, do NOT overwrite — the user may have customized it.

### 4. Analyze Existing Code (Existing Projects Only)

**Skip this step for fresh projects.**

For projects with existing code, build an inventory before setting up the harness:

**Codebase scan:**
- List all models/entities (e.g., `app/models/*.rb`, `src/models/`)
- List all controllers/routes/endpoints
- List all service objects, jobs, or other business logic files
- Count total source files and test files

**Test coverage assessment:**
- Run the test suite — record pass/fail/pending counts
- For each source file, check if a corresponding spec/test file exists
- Identify files with NO test coverage — these become candidates for stories

**Architecture snapshot:**
- Read `config/routes.rb` (or equivalent) for the full API/page surface
- Check for patterns: service objects, concerns, middleware, background jobs
- Note the authentication/authorization approach
- Check for existing documentation in README, docs/, wiki

**Existing plans and task tracking:**
- Check for in-flight work: open PRs (`gh pr list`), open issues (`gh issue list`), TODO comments in code
- Check for project boards, milestones, or roadmap docs
- Note any external trackers mentioned in README or config (Linear, Jira, etc.)
- These feed into story generation — in-flight work becomes draft stories

**Git history scan:**
- `git log --oneline -20` — understand recent activity
- `git shortlog -sn --no-merges` — who works on this project
- Check for open branches that indicate in-progress work

Present the inventory to the user as a summary:

```
Existing Project Inventory:
- Models: 12 (User, Order, Product, ...)
- Controllers: 8 (API endpoints: 34 total)
- Test files: 45 (coverage: 78% of source files have specs)
- Files WITHOUT specs: app/models/product.rb, app/services/pricing_service.rb, ...
- Recent activity: 15 commits in last 30 days
- Auth: Devise with JWT
- Background jobs: Sidekiq (3 job classes)
- Open PRs: 2, Open issues: 7
```

### 4b. Draft As-Built Stories (Existing Projects Only)

**Bootstrap creates DRAFTS. The `/stories` skill validates them.**

From the inventory, generate draft stories for what already exists. These go into
`docs/stories/` with a `Status: DRAFT` marker so `/stories` knows to review them.

**How to draft:**
- One story file per major feature area (auth, CRUD per resource, background jobs, etc.)
- Each story gets a happy path derived from existing routes/tests
- Negative paths are left as `TODO` placeholders — `/stories` fills these in
- Untested files are flagged: "No spec exists for this file — negative paths unknown"

```markdown
## Story: User Registration [AS-BUILT]
**Status:** DRAFT — needs /stories review

As a visitor, I want to register an account so that I can access the system.

### Acceptance Criteria

#### Happy Path
- Given valid email and password, when POST /users, then 201 with user object

#### Negative Paths
- TODO: invalid input scenarios (bootstrap detected no spec coverage)
- TODO: duplicate email handling

### Coverage Notes
- Request spec exists: spec/requests/users_spec.rb (3 examples)
- Model spec exists: spec/models/user_spec.rb (5 examples)
- Missing: no negative path tests for duplicate email
```

**For in-flight work (open issues/PRs):**
- Create draft stories with `[PLANNED]` marker instead of `[AS-BUILT]`
- Reference the issue/PR number
- These are placeholders — the user confirms and `/stories` validates

**Key principle:** Bootstrap does not validate stories. It creates drafts that capture what
exists. The normal SDLC flow handles quality:

```
/bootstrap → drafts as-built + planned stories (DRAFT status)
     ↓
/stories → reviews drafts, adds negative paths, fills TODOs, marks as accepted
     ↓
/conflict-check → verifies as-built stories don't conflict with new work
     ↓
/plan, /tdd, etc. — normal flow from here
```

This keeps bootstrap fast and composable. The heavy validation work stays in the skills
designed for it.

### 5. Set Up Project Directories

Create these directories if they don't exist (idempotent — safe to re-run):

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

### 6. Generate or Update CLAUDE.md

**Fresh project:** Generate `CLAUDE.md` from `templates/CLAUDE.md.template`.

**Existing project with no CLAUDE.md:** Same as fresh — generate from template.

**Existing project with CLAUDE.md:**
1. Read the existing CLAUDE.md
2. **Do NOT overwrite it.** The user's custom instructions are authoritative.
3. Instead, **append** a harness section at the end:

```markdown

## Harness (james-stoup-agents)

<!-- Generated by /bootstrap — edit freely, re-bootstrap won't overwrite above this line -->

- **Tech Stack:** {{FRAMEWORK}} + {{DATABASE}}
- **Tech-Context:** {{TECH_CONTEXT_PATH}}
- **Skills:** /conduct → /bootstrap → /brainstorm → /stories → /conflict-check → /plan → /tdd → /finish → /retro
- **Memory:** .memory/ (decisions, patterns, gotchas, context)
- **Docs:** docs/ (specs, stories, conflicts, plans, retros)
```

On re-bootstrap: only update the section below the `<!-- Generated by /bootstrap -->` marker.
Everything above the marker is preserved.

### 7. Bootstrap Memory from Existing Code (Existing Projects Only)

**Skip for fresh projects.**

Seed `.memory/` with knowledge extracted from the existing codebase:

**decisions/** — Scan for architectural patterns and record them:
- Authentication approach (Devise, JWT, custom)
- API format (REST, GraphQL, RPC)
- Background job framework (Sidekiq, Solid Queue, Celery)
- Database patterns (soft deletes, UUIDs vs integers, multi-tenancy)

**patterns/** — Identify recurring code patterns:
- Service object conventions (naming, interface)
- Controller patterns (before_actions, response format)
- Test patterns (shared contexts, factory conventions)

**gotchas/** — Check git history for reverts, hotfixes, or repeated changes to the same file:
- `git log --all --oneline --grep="fix" --grep="revert" --grep="hotfix" | head -10`
- Files changed more than 5 times in last 30 days (potential trouble spots)

**context/** — Domain knowledge from existing code:
- Business entities and their relationships (from models)
- Key domain terms (from model/method names)

Write each finding to the appropriate `.memory/` subdirectory and update `.memory/index.md`.

Present what was captured: "Bootstrapped memory with N decisions, M patterns, K gotchas."

### 8. Frontend Styleguide (Projects with Frontend Only)

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

2. **Existing projects:** If a styleguide or design system already exists (check for
   `styleguide.md`, `STYLE_GUIDE.md`, design tokens file, Storybook config), read it instead
   of generating a new one. Reference the existing styleguide in the harness docs.
3. Present to user for review and customization
4. Skip for API-only projects

### 9. Recommend Next Steps

Based on project type and mode, recommend a specific path. Use `/conduct` to enforce it.

**Fresh projects:**
```
/conduct → /brainstorm → /stories → /conflict-check → /plan → /pipeline → /finish → /retro
```

**Existing projects — first-time harness setup:**
Bootstrap created DRAFT as-built stories. The next step validates them:
```
/stories (review drafts, add negative paths) → /conflict-check → then normal flow for new work
```

**Existing projects — adding a new feature:**
As-built stories already exist. Write new feature stories alongside them:
```
/brainstorm (new feature) → /stories (new + review drafts) → /conflict-check (new vs as-built) → /plan → /pipeline
```

**Existing projects — improving test coverage:**
As-built stories identify untested files. Use them directly:
```
/stories (fill TODO negative paths) → /plan (tasks for missing specs) → /tdd → /finish → /retro
```

**Existing projects — onboarding (understanding the code):**
Bootstrap + memory is enough. Read the inventory and memory entries.
```
/conduct --status (see what's set up)
```

### 10. Smoke Test

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

### 11. MCP Integration Setup

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

**Browser automation (full-stack projects only):**
- If frontend detection found views or components, offer to configure Chrome/Puppeteer MCP
- This enables: `/manual-test` to automate browser testing, take screenshots, interact with UI
- Configuration:
  ```json
  {
    "mcpServers": {
      "puppeteer": {
        "command": "npx",
        "args": ["-y", "@anthropic-ai/puppeteer-mcp"],
        "env": {}
      }
    }
  }
  ```
- For API-only projects, skip this — `curl` is sufficient for manual testing

**Skip if:** The user declines or no git remote exists. MCP setup is optional but recommended.

### 12. Report

Present to the user:

**Fresh project:**
- Detected project type and tech stack
- Loaded tech-context (or note that none matched)
- Created directories
- Smoke test results (pass/fail)
- MCP integrations configured (or skipped)
- Recommended workflow: start with `/brainstorm` or `/conduct`

**Existing project:**
- Detected project type and tech stack
- Loaded tech-context
- Codebase inventory summary (models, controllers, test coverage)
- Files without test coverage (candidates for stories)
- Memory bootstrapped (N decisions, M patterns, K gotchas)
- CLAUDE.md updated (appended, not overwritten)
- Smoke test results
- MCP integrations
- Recommended starting point based on user's goal

## Verification

- [ ] Bootstrap mode correctly determined (fresh, partial, re-bootstrap)
- [ ] Project type correctly detected from file indicators
- [ ] Tech-context loaded if matching stack found
- [ ] Existing code analyzed (if existing project)
- [ ] .memory/ directory created with index.md
- [ ] .memory/ seeded from existing code (if existing project)
- [ ] docs/ subdirectories created
- [ ] CLAUDE.md generated (fresh) or appended to (existing) — never overwritten
- [ ] Frontend styleguide created or existing one referenced
- [ ] Smoke test passed (DB connects, tests run, app loads)
- [ ] MCP integration offered (GitHub, issue tracker)
- [ ] Report presented with appropriate recommendations for project mode
