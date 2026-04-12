---
harness-version: 2026-04-07
---

# Harness Behavioral Rules

These rules apply to all projects using the james-stoup-agents harness.
Claude MUST read and follow this file at the start of every session.

## Optimization Targets (Priority Order)

1. 100% correct feature functionality
2. Correct code & gating (no bad code passes gates)
3. Minimal user intervention during implementation

## SDLC Phase Flow

Skills chain via artifacts in `.docs/`. No skill orchestrates another internally.

```
UNDERSTAND → DECIDE → BUILD → ✓checkpoint → SHIP(manual-test) → ✓checkpoint → SHIP(retro, finish)
```

| Phase | Skills | Artifacts |
|-------|--------|-----------|
| ALL | **conduct** (orchestrator) | Status dashboard, gate enforcement, checkpoints |
| UNDERSTAND | bootstrap, memory, assess | CLAUDE.md, .memory/, .docs/decisions/technical-assessment-*.md |
| DECIDE | brainstorm → stories → conflict-check → plan → architecture-diagram → architecture-review | .docs/specs/, .docs/stories/, .docs/conflicts/, .docs/plans/, .docs/architecture/ |
| BUILD | writing-system-tests → tdd/pipeline, debugging, code-review | Acceptance specs, code, unit tests, .pipeline/ |
| CHECKPOINT | User validation after build | Harness pause — continue, go back, or quit |
| SHIP | manual-test, retro, finish/pr | .docs/retros/ |
| CHECKPOINT | User validation after manual-test | Harness pause — continue, go back, or quit |

**Checkpoints** are harness-level pauses (no Claude session). The user reviews output and
chooses to continue, navigate back to a prior step, or quit. Navigating back marks the target
step as `pending` and all downstream steps as `stale` (⚠), then re-runs from the target forward.
Checkpoints are skipped in auto mode.

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
- `worktree-manager.md` — Manages git worktrees for feature isolation and parallel execution
- `cto-security.md` — Security auditor: auth, input validation, OWASP top 10
- `cto-data-integrity.md` — Data integrity: transactions, event sourcing, race conditions
- `cto-dependencies.md` — Dependency auditor: outdated packages, CVEs, license compliance
- `cto-architecture.md` — Architecture coherence: decisions vs implementation, coupling
- `cto-duplication.md` — Code duplication: boilerplate, copy-paste, blast radius
- `cto-testing.md` — Test strategy: coverage gaps, layer balance, assertion quality
- `cto-infrastructure.md` — Infrastructure: DB pooling, caching, background jobs, prod parity
- `cto-observability.md` — Observability: error handling, logging, monitoring, debugging context
- `cto-devex.md` — Developer experience: onboarding, CI/CD, local dev, documentation
- `cto-orchestrator.md` — CTO synthesizer: reads all 9 specialist reports, prioritizes findings

## Model Selection

Use the cheapest model that can do the job. Opus for reasoning-heavy work, Sonnet for
standard implementation, Haiku for mechanical checks.

| Skill/Agent | Recommended Model | Why |
|---|---|---|
| brainstorm | opus | Design decisions, trade-off analysis require deep reasoning |
| stories | sonnet | Pattern-following from design doc, structured output |
| conflict-check | sonnet (S/M), opus (L) | Pairwise comparison is manageable for Sonnet with ≤15 stories; Large needs Opus for subtle contradictions |
| plan | sonnet | Structured task breakdown from stories |
| architecture-diagram | sonnet | Structured output generation from codebase scan — pattern-following |
| architecture-review | opus | Feasibility, alignment, domain integrity — deep architectural reasoning |
| writing-system-tests | sonnet | Generating specs from acceptance criteria — templated work |
| tdd (RED phase) | sonnet | Writing one test at a time — focused, constrained |
| tdd (GREEN phase) | sonnet | Writing minimal implementation — constrained scope |
| domain-reviewer | sonnet (<50-line diff), opus (≥50-line diff) | Right-sized by diff size: Sonnet for focused small diffs, Opus for large changes needing cross-boundary judgment |
| evaluator | sonnet (value objects, pure functions, config, infra) / opus (concurrency, state mutation, security, auth, finance) | Right-sized by batch content |
| code-review | opus | Multi-dimensional analysis (spec, quality, domain) |
| debugging | opus | Root cause analysis requires reasoning chains |
| simplify | sonnet | Pattern matching for duplication and complexity — structured checklist work |
| pipeline | haiku | State tracking, dispatch orchestration — purely mechanical |
| finish | haiku | Mechanical checks — run tests, check git status, verify coverage |
| manual-test | sonnet | Structured validation against stories — pattern-following |
| retro | sonnet | Structured analysis from concrete data; Part C (context efficiency) is checklist-based |
| pr | sonnet | Diff analysis and structured PR body — templated output |
| bootstrap | sonnet | Detection and scaffolding — largely mechanical |
| assess | haiku | Dispatches specialists then synthesizes — orchestration is mechanical |
| conduct | haiku | Artifact checking and status reporting — mechanical |
| memory | haiku | Read/write files, update index — mechanical |
| worktree-manager | haiku | Git operations — mechanical branch/worktree management |
| cto-security | opus | Deep security analysis requires reasoning about attack vectors |
| cto-data-integrity | opus | Transaction and race condition analysis requires deep reasoning |
| cto-dependencies | sonnet | Checklist-based package and license scanning |
| cto-architecture | opus | Cross-module coherence and coupling analysis requires deep reasoning |
| cto-duplication | sonnet | Pattern matching across modules — structured checklist work |
| cto-testing | sonnet | Coverage gap analysis and test quality review — structured |
| cto-infrastructure | sonnet | Infrastructure config review — checklist-based |
| cto-observability | sonnet | Error handling and logging pattern review — checklist-based |
| cto-devex | sonnet | Documentation and tooling review — checklist-based |
| cto-orchestrator | opus | Cross-referencing 9 reports and prioritizing requires deep reasoning |

When dispatching subagents via the Agent tool, set the `model` parameter to match:
```
Agent(subagent_type="general-purpose", model="sonnet", prompt="RED phase: write test...")
Agent(subagent_type="general-purpose", model="opus", prompt="Evaluate this code...")
```

## Communication Protocol

Output discipline varies by SDLC phase. During BUILD, every token that isn't code, test output,
or a status line is waste.

### BUILD Phase (tdd, pipeline, debugging, writing-system-tests, code-review)

**Rules for the orchestrator (the session running /pipeline or /tdd):**
- Do NOT narrate what you are about to do. Just do it.
- Do NOT explain why a test failed before fixing it. Fix it, then report the status.
- Do NOT summarize completed steps. The audit trail and progress.log handle that.
- Do NOT introduce subagent dispatches. Dispatch silently.
- Between TDD phases, output ONLY the status line (PASS/FAIL + reason). No commentary.

**Rules for subagents (generator, domain-reviewer, evaluator):**
- Follow your output format exactly. No preamble, no sign-off.
- Test output: include ONLY the failure message and assertion diff, not the full test run.
  Truncate after the first relevant failure unless multiple unrelated failures exist.

**Acceptable BUILD output:**
- Status lines: `Task 3/12: PASS`, `DOMAIN: APPROVED`, `RED: FAIL (missing factory)`
- Error context needed for the next action
- Questions that genuinely block progress (NEEDS_CONTEXT)

**Not acceptable:**
- "I'll now dispatch the generator agent to write a failing test..."
- "The test failed because the User model doesn't have a name field yet. Let me..."
- "Great, the test passes. Let me run the full suite to make sure..."
- "Here's a summary of what we accomplished in this batch..."

### UNDERSTAND/DECIDE Phase (brainstorm, stories, plan, architecture-review)

No output restrictions. Exploration, questions, and detailed explanations are expected.

### SHIP Phase (retro, finish, pr, manual-test)

Structured output only. Follow the skill's output template. No free-form commentary.

## Tech-Context

Stack-specific knowledge lives in `tech-context/`. Bootstrap detects the project stack and loads
the matching context into the session. Skills reference tech-context when available, work without it.

**Load once, reference everywhere:** Tech-context files are read once during `/bootstrap` and
become part of the session context. Skills that need tech-context (stories, tdd, writing-system-tests,
code-review, debugging, retro) should reference the already-loaded context rather than re-reading
the files independently. This avoids redundant file reads across skill invocations.

## Enforcement Levels

Each skill declares its enforcement level honestly:
- **Advisory** — Instructions only
- **Gating** — Evidence required before proceeding
- **Structural** — Subagent isolation via Agent tool
- **Mechanical** — Claude Code hooks (optional, opt-in)

## Memory

Project-level memory lives in `.memory/` with categories: decisions, patterns, gotchas, context.
Every session starts with recall. Significant decisions are persisted during work.
Skills with Memory Checkpoint sections define when writes are expected — check skill verification lists.

## Push Policy

**Never push to a remote until confident the work is complete and passing.**
Run whatever verification the project requires (tests, lint, type-check, etc.) locally
before pushing. The `/finish` skill presents the user with completion options and delegates
to `/pr` when the user chooses Push & PR. The `/pr` skill enforces the pre-push gate.

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

## Explore Agent Partitioning

When launching multiple Explore agents, partition by **directory** (e.g., Agent 1: `app/` + `db/`,
Agent 2: `spec/` + `.docs/`) — never by topic. Topic-based partitioning causes 30-50% file read
overlap (observed in retros). Directory partitioning ensures each agent reads a disjoint set of files.

If exploration was already performed earlier in the session (e.g., during brainstorm), pass the
summary to subsequent agents (e.g., Plan) instead of re-exploring the same scope.

## Harness Updates

The harness version your project runs against is controlled by
`~/.claude/ai-conductor.config.json`:

```json
{
  "updateChannel": "tagged",
  "autoCheck": true,
  "currentVersion": "v0.3.0",
  "lastCheckedAt": "2026-04-11T00:00:00Z"
}
```

- **`updateChannel`** — `tagged` (default, stable semver releases) or `main`
  (bleeding edge, every merge to main).
- **`autoCheck`** — if `true`, every `/conduct` run checks for updates on the
  configured channel before running any pipeline step.
- **`currentVersion`** — the version of the harness your project is pinned to.
  On the tagged channel this is a `vX.Y.Z` tag; on main it's `main@<sha>`.

### Update flow

1. On every `conduct` invocation, `check_harness_update()` in `bin/conduct`
   fetches either the latest tag (`tagged`) or the remote branch (`main`).
2. If a newer version exists, the relevant `CHANGELOG.md` blocks are rendered
   with `glow` and the user is prompted before anything is applied. Updates
   never apply without explicit approval.
3. On approval, the harness is checked out at the new version and
   `bin/migrate` runs automatically. It:
   - Re-runs `bin/install --update` to refresh symlinks and re-merge
     `settings.json` entries.
   - Walks `CHANGELOG.md` entries between the old and new version for any
     `## Migration` bash blocks, displays them, and runs them on approval.
4. On success, `currentVersion` is written back to the config and `conduct`
   re-launches. On failure, the harness is rolled back to the previous ref and
   the user is notified.

### Changing channels

```
conduct --set-channel tagged   # follow stable semver tags
conduct --set-channel main     # follow main branch
conduct --update               # force an update check now
```

The `updateChannel` setting is per-user (lives in `~/.claude/`), so every
project using this harness inherits the same channel.

## Key Conventions

- One skill, one responsibility, one enforcement level
- Plans assume zero-context executor — all detail included
- Negative path stories are mandatory, not optional
- No implementation plan without clean conflict-check
- Retro runs on both harness AND application after every feature
- Tech-context is additive — never overrides generic skill behavior
