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

| Indicator | Mode (`bootstrap_mode` value) |
|-----------|------|
| Empty directory or no project files | `new` — scaffold first (Step 1b) |
| Project files exist but no harness artifacts | `fresh` — full harness setup |
| `.memory/` or `.docs/` exist but some missing | `partial` — fill gaps only |
| All harness artifacts exist | `re-bootstrap` — update detection, re-run smoke test |

Also check maturity: 50+ commits = mature, 5+ model files = substantial, existing specs = assess
coverage, existing CLAUDE.md = **preserve, don't overwrite**.

**Persist the detected mode** into `.pipeline/conduct-state.json` under the key
`bootstrap_mode` with one of the four string values above (`new`, `fresh`, `partial`,
`re-bootstrap`). This MUST happen before any downstream step dispatches, because the
conductor uses the value to skip steps that have no material to act on — notably
`assess`, which is skipped when mode is `new` (no codebase yet = nothing for the 9
specialists to evaluate). If the value is missing or unrecognized, the conductor
defaults to running every step, so a missing write silently loses the optimization but
never breaks the flow.

### 1b. Scaffold New Project (New Mode Only)

1. Ask for or infer framework from user prompt
2. Scaffold: `rails new . --api --database=postgresql --skip-bundle` (or equivalent)
3. Install dependencies, add test framework if missing (rspec-rails, jest, pytest)
4. Configure database — detect port conflicts before writing docker-compose.yml
5. Set up .gitignore before first commit (vendor/bundle, node_modules, tmp, log)
6. Initialize git if not already a repo: `git init -b main` (force the default
   branch to `main` even on older git that defaults to `master`). The seed
   commit, remote wiring, and first push are handled later in Step 10a — after
   the smoke test — so the initial commit captures a working scaffold.

**Worktree Compatibility:** All infrastructure must support parallel worktrees sharing
a single set of Docker services. See Step 1c for the `.env` boundary pattern that enforces this.

### 1c. Generate Infrastructure Boundary Files

Infrastructure splits into two layers:
- **Shared:** Docker services (database, Redis, message queue) run ONCE regardless of worktree count
- **Worktree-specific:** Database name, Redis namespace, app port differ per worktree

**Generate these files:**

1. **`.env.example`** — from `templates/env.example.template`. Committed to version control. Shows
   all required env vars with placeholder values. Replace `{{DB_ENGINE}}`, `{{DB_DEFAULT_PORT}}`,
   `{{APP_DEFAULT_PORT}}`, and `{{FRAMEWORK_ENV_VAR}}` based on stack detection from Step 2.
2. **`.env`** — copy `.env.example` with real default values filled in. Gitignored. This is the
   working env file developers use locally.
3. **`.env.local`** — from `templates/env.local.template`. Gitignored. Contains worktree-specific
   overrides: `WORKTREE_DB_SUFFIX`, `REDIS_NAMESPACE`, `PORT`. For the main worktree, use `_main`
   suffix. For feature worktrees, derive from branch slug.

If `.env`, `.env.example`, or `.env.local` already exists, do NOT overwrite.

**Add to `.gitignore`** (idempotent):
- `.env`
- `.env.local`
- `.env.local.*`
- `.env.*.local`

**Boot sequence:**
```
# 1. Start shared infrastructure (once)
docker compose up -d

# 2. .env.local is pre-generated with worktree-specific values (automatic)

# 3. Start the app (reads .env then .env.local overrides)
{{DEV_COMMAND}}
```

**Stack-specific variable mapping:**

| Stack | DB Engine Var | Default DB Port | Default App Port | Framework Env Var |
|-------|-------------|-----------------|-----------------|-------------------|
| Rails+PostgreSQL | `POSTGRES` | 5432 | 3000 | `RAILS_ENV` |
| Rails+MySQL | `MYSQL` | 3306 | 3000 | `RAILS_ENV` |
| Node/Express | `POSTGRES` | 5432 | 3000 | `NODE_ENV` |
| Django | `POSTGRES` | 5432 | 8000 | `DJANGO_SETTINGS_MODULE` |
| Phoenix | `POSTGRES` | 5432 | 4000 | `MIX_ENV` |

**Verification:** App boots successfully reading `.env` + `.env.local`. A second worktree
with different `.env.local` values can run simultaneously without port or namespace conflicts.

### 2. Detect Project Type

Scan project root for indicators (first match per category):

**Language/Framework:** Gemfile+rails→Rails, package.json+next→Next.js,
package.json+express→Express, pyproject.toml+django→Django, Cargo.toml→Rust, go.mod→Go

**Database:** database.yml+postgresql→PostgreSQL, +mysql→MySQL, +sqlite→SQLite

**Test Framework:** .rspec→RSpec, test/*_test.rb→Minitest, jest.config→Jest, pytest.ini→pytest

**Frontend:** app/views/→server-rendered, app/javascript/→JS frontend,
package.json+react/vue/svelte→SPA, none→API-only

**Process Manager:** Procfile.dev+overmind.yml→Overmind, Procfile.dev→Foreman/Overmind,
Procfile+foreman→Foreman, bin/dev→bin/dev script, none→bare commands.
Determines `{{DEV_COMMAND}}` in generated files: `overmind start`, `foreman start -f Procfile.dev`,
`bin/dev`, or stack default (`bin/rails server`, `npm start`, etc.).

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

### 3d. Generate Claude Code Settings

Generate `.claude/settings.json` in two parts: permissions (3d-i) and a pre-PR lint hook
(3d-ii). The file is project-scoped — per-user overrides belong in
`.claude/settings.local.json` (gitignored).

#### 3d-i. Permissions

Copy `templates/claude-settings.json.template` to `.claude/settings.json`. Replace
`{{PROJECT_ROOT}}` with the absolute path of the project root (the bootstrap working
directory, with leading slash stripped — the template already supplies the `//` prefix
required by Claude Code's permission path syntax). Create the `.claude/` directory if it
doesn't exist.

The generated file scopes Read/Edit/Write permission to the entire project tree (including
dotfiles under `.claude/`, `.pipeline/`, `.docs/`, `.memory/`, `.github/`, etc.) so that
downstream skills don't block on permission prompts when they touch harness artifacts.
Absolute paths mean the permissions travel with the project even when invoked from a
different CWD (e.g., inside a worktree).

If `.claude/settings.json` already exists, do NOT overwrite it — skip to 3d-ii and merge
the hook block only if the hook is missing.

#### 3d-ii. Pre-PR Lint Hook

Linting is deterministic — it should never consume model tokens. This step wires a
`PreToolUse` hook that runs the project's lint command before any `gh pr create`
invocation; a non-zero exit code blocks the PR until the user (or Claude) fixes the lint
failure. TDD, pipeline, and code-review skills do NOT invoke the linter themselves;
this hook is the single source of lint enforcement.

**Detect the lint command** from project signals (first match wins, but combine if
multiple apply — e.g. Node+TS gets both scripts):

| Signal | Lint Command |
|--------|--------------|
| `package.json` has `scripts.lint` | `npm run lint` |
| `tsconfig.json` exists | `npx tsc --noEmit` (AND above, joined with `&&`) |
| `biome.json` / `biome.jsonc` | `npx biome check .` |
| `.eslintrc*` without a `scripts.lint` entry | `npx eslint .` |
| `Gemfile` contains `rubocop` | `bundle exec rubocop` |
| `Gemfile` contains `sorbet-runtime` | `bundle exec srb tc` (AND rubocop if also present) |
| `pyproject.toml` lists `ruff` | `ruff check` |
| `pyproject.toml` lists `mypy` | `mypy .` (AND ruff if also present) |
| `Cargo.toml` | `cargo clippy --all-targets -- -D warnings` |
| `go.mod` | `go vet ./...` |

If multiple commands apply, chain them with `&&` — the hook fails fast on the first
non-zero exit. If nothing matches, ask the user: "What command lints/type-checks this
project? (leave blank to skip the pre-PR lint gate)". In auto mode, skip the hook when
detection fails rather than prompting.

**Write the hook** into `.claude/settings.json` (merge with the permissions from 3d-i —
do not overwrite):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "<detected or user-provided lint command>",
            "if": "Bash(gh pr create*)",
            "timeout": 300,
            "statusMessage": "Running pre-PR lint gate"
          }
        ]
      }
    ]
  }
}
```

The `if: "Bash(gh pr create*)"` filter means the hook only fires when Claude actually
tries to open a PR — every other `Bash` call is untouched, so the hook has zero runtime
cost during regular development.

**Idempotence:** If a `PreToolUse` hook with `if: "Bash(gh pr create*)"` already exists
in `.claude/settings.json`, do NOT add a duplicate. Re-running bootstrap should be safe;
users who want to change the lint command can edit the existing hook directly.

**User override at any time** — the hook lives in `.claude/settings.json` and is a
regular config value. Users may edit the command, bump the timeout, or remove the hook
entirely without re-running bootstrap.

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

**`.memory/` is set up by the harness, not by this skill.** `bin/conduct` calls
`conduct-ts memory setup <dir>` before any bootstrap sub-step runs. This creates a canonical
per-project store at `~/.ai-conductor/memory/<key>/harness/` and makes `.memory/` a symlink to
it (adr-2026-06-29-shared-memory-store-placement-and-durability). If `.memory/` already exists as a real directory (legacy), it is migrated via
copy-verify-swap before the symlink is created (adr-2026-06-29-safe-reversible-memory-migration). **Do NOT create or mkdir `.memory/`
yourself** — it will already be a symlink when this skill runs.

Create if missing (idempotent): `.pipeline/` (audit-trail/), `.worktrees/`, `.docs/` (specs/,
complexity/, stories/, conflicts/, architecture/, decisions/, plans/, retros/, intake/). These
are the full set of `.docs/` subdirectories the conductor and daemon read/write across the SDLC
— keep this list in parity with them.

Add to `.gitignore` (idempotent — don't duplicate):
- `.pipeline/` — runtime state, not source
- `.daemon/` — daemon pidfile + activity log (`daemon.log`), not source
- `.worktrees/` — git worktrees for parallel feature development
- `.env` — local environment (not committed; `.env.example` is the committed reference)
- `.env.local` — worktree-specific environment overrides

### 6. Generate or Update Agent Instructions

- **Fresh/no CLAUDE.md:** Generate from `templates/CLAUDE.md.template` (includes HARNESS.md reference)
- **Existing CLAUDE.md:** Verify it references `HARNESS.md`. If missing, append the reference block.
  Never overwrite user content. Behavioral rules live in HARNESS.md, not in the project CLAUDE.md.
- **Fresh/no AGENTS.md:** Generate from `templates/AGENTS.md.template`. This gives Codex the
  harness entry point while keeping the skills themselves user-scoped at `~/.codex/skills/`.
- **Existing AGENTS.md:** Verify it references `HARNESS.md`; append the Codex harness reference
  block if needed. Never overwrite user content.

### 7. Bootstrap Memory (Existing Projects Only)

Seed `.memory/` from existing code. Use detection from Steps 4 and 4c — don't re-scan.
- **decisions/** — architectural choices (from 4c ADRs)
- **patterns/** — service object conventions, controller patterns, test patterns
- **gotchas/** — reverts/hotfixes in git history, files changed 5+ times recently
- **context/** — domain entities and relationships from models

Update `.memory/index.md`. Report: "Bootstrapped memory with N decisions, M patterns, K gotchas."

### 7b. Generate Architecture Diagrams

Run `/architecture-diagram` to generate initial C4 diagrams from the codebase scan.
Use the inventory from Step 4 — don't re-scan.

Output: `.docs/architecture/` with system-context.md, containers.md, components.md, erd.md,
and up to 5 sequence diagrams for primary request flows.

For new/fresh projects, generate skeleton diagrams with placeholder components from
the scaffold output. These will be populated as the design develops.

Present diagrams to user for validation before proceeding.

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

### 10a. Initialize Git, Configure Remote & First Push

Applies to **new** and **fresh** projects. Skip for `partial`/`re-bootstrap` —
those already have history and a remote. Run AFTER the smoke test (Step 10) so the
seed commit captures a scaffold that actually boots.

1. **Repo + default branch.** Confirm the repo exists
   (`git rev-parse --is-inside-work-tree`); if not, `git init -b main`. Ensure the
   current branch is the default name (`main`, unless the operator's
   `init.defaultBranch` git config says otherwise) — on older git that started on
   `master`, rename with `git branch -m main`.

2. **Seed commit (only if there is no history yet).** If `git rev-parse HEAD`
   fails (no commits), stage everything honoring `.gitignore` and make ONE initial
   commit. Never amend, re-commit, or rewrite an existing history.
   ```bash
   git add -A
   git commit -m "chore: initial project scaffold (harness bootstrap)"
   ```
   If a commit already exists (a `fresh` project that came with history), skip the
   seed commit and keep its history intact.

3. **Remote (`origin`).** Check `git remote get-url origin`:
   - **Already set** — leave it untouched. Never rewrite a remote the user configured.
   - **Missing, and `gh` is authenticated** (`gh auth status` exits 0) — offer to
     create a GitHub repo and wire `origin` in one step. Confirm the repo name
     (default: the project directory name) and visibility (**private** by default):
     ```bash
     gh repo create <name> --private --source=. --remote=origin
     ```
     `--source=.` attaches `origin` to this repo without pushing yet.
   - **Missing, no `gh`** (or the user declines GitHub) — ask for a remote URL. If
     given: `git remote add origin <url>`. If the user has no remote yet, skip the
     remote and push, and note it — the repo is fully valid locally and a remote can
     be added later. Do not block bootstrap on this.
   - **Auto mode** — if `gh` is authenticated, create a **private** repo named after
     the directory without prompting; otherwise skip remote + push (never block).

4. **Push & set upstream** — only when an `origin` remote exists:
   ```bash
   git push -u origin main
   ```
   `-u` records the upstream so later `git push`/`git pull` and `gh pr create` work
   without extra flags. If the push is **rejected** because the remote already has
   commits (the user pointed `origin` at a non-empty repo), do NOT force — stop and
   surface it for the user to reconcile.

5. **Verify.** `git remote -v` lists `origin`,
   `git rev-parse --abbrev-ref --symbolic-full-name @{u}` resolves to `origin/main`,
   and `git status` is clean.

**Branch-policy note:** this seed commit on `main` is the one sanctioned
direct-to-`main` commit — a brand-new repo has no branch to PR into. From here on,
all harness work happens on feature branches/worktrees and merges via PR (HARNESS.md
branch policy). The pre-PR lint hook (Step 3d-ii) and a remote are now both in place,
so the very first feature can open a PR end-to-end.

### 10b. Auto-Register in the Project Registry

After onboarding completes, register this project in the harness project registry
(`~/.ai-conductor/registry.json`) so daemons and cross-project tooling can discover it.
Run the single-writer registry command — it is idempotent (canonical-path dedup) and
preserves status provenance (a project previously scaffolded by `conduct create` keeps its
`created` status rather than being downgraded to `registered`):

```bash
conduct register .
```

Honor `$AI_CONDUCTOR_REGISTRY` if set (tests and alternate installs point it elsewhere). A
non-zero exit means the registry write failed — surface it; do not silently continue. Re-running
bootstrap is safe: the same canonical path resolves to one record.

### 11. Recommend Next Steps

| Mode | Recommendation |
|------|---------------|
| Fresh | `/conduct → /explore → /prd → /stories → normal flow` |
| Existing (first harness setup) | `/stories (review drafts) → /conflict-check → normal flow` |
| Existing (new feature) | `/explore → /prd → /stories (new + review drafts) → normal flow` |
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
- [ ] `.claude/settings.json` created with project-scoped Read/Edit/Write permissions (if not already present)
- [ ] CLAUDE.md generated or appended — never overwritten
- [ ] `.env.example` generated with shared/worktree-specific boundary sections
- [ ] `.env` generated from `.env.example` with real defaults
- [ ] `.env.local` generated with worktree-specific overrides
- [ ] `.pipeline/`, `.daemon/`, `.worktrees/`, `.env`, and `.env.local` added to `.gitignore`
- [ ] Process manager detected (or noted as absent)
- [ ] Smoke test passed
- [ ] Git initialized on `main` with a seed commit (new/fresh projects)
- [ ] `origin` remote configured via `gh repo create` or a user-provided URL — or explicitly skipped with a note (new/fresh projects)
- [ ] First push set upstream to `origin/main` when a remote exists (new/fresh projects)
- [ ] Project auto-registered via `conduct register .` (idempotent; honors `$AI_CONDUCTOR_REGISTRY`)
- [ ] Architecture diagrams generated in `.docs/architecture/`
- [ ] MCP integration offered
