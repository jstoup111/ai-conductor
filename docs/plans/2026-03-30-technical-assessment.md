# Implementation Plan: Technical Assessment (/assess)

**Design:** `docs/specs/2026-03-30-technical-assessment.md`
**Branch:** `feature/technical-assessment`

## Tasks

### Task 1: Create specialist agent files (Batch 1)

Write 3 agent persona files following the existing pattern (Role, Context Expectations, Behavior, Output Format, What You Are NOT):

- `agents/cto-security.md` — Auth coverage, input validation, SQL injection, XSS, CSRF, secrets, rate limiting, OWASP top 10. Model: Opus. Output: findings per category with file:line, severity, verdict.
- `agents/cto-data-integrity.md` — Transaction boundaries, event sourcing correctness, race conditions, migration safety, backup/recovery. Model: Opus. Output: findings per category.
- `agents/cto-dependencies.md` — Outdated packages, CVEs, framework EOL, license compliance, upgrade blockers. Model: Sonnet. Output: dependency table with status/risk.

**Context Expectations pattern for all specialists:**
- Receive: codebase file listing, relevant source files for their area, tech-context if loaded
- Do NOT: fix issues, read unrelated files, produce stories
- Output to: `.pipeline/assessment/<agent-name>.md`

### Task 2: Create specialist agent files (Batch 2)

- `agents/cto-architecture.md` — Implementation vs decisions, cross-module consistency, domain boundaries, undocumented patterns, coupling. Model: Opus.
- `agents/cto-duplication.md` — Boilerplate across modules, 3+ occurrences, similar-but-different implementations, blast radius. Model: Sonnet.
- `agents/cto-testing.md` — Coverage gaps (files without tests), layer balance, assertion quality, fragile tests, missing negative paths. Model: Sonnet.

### Task 3: Create specialist agent files (Batch 3)

- `agents/cto-infrastructure.md` — DB pooling, caching, background jobs, production parity, secrets. Model: Sonnet.
- `agents/cto-observability.md` — Error handling patterns, logging, monitoring, debugging context. Model: Sonnet.
- `agents/cto-devex.md` — README accuracy, CI/CD health, local dev setup, documentation, debugging tooling. Model: Sonnet.

### Task 4: Create CTO orchestrator agent

`agents/cto-orchestrator.md` — Model: Opus.

**Context:** Reads all 9 specialist reports from `.pipeline/assessment/`.

**Behavior:**
1. Read all 9 reports
2. Cross-reference: findings that appear in 2+ reports become "systemic patterns"
3. Prioritize: critical (blocks deploy/causes data loss) > systemic > important > low
4. Write executive summary (3-5 sentences)
5. Write prioritized roadmap (ordered, with reasoning)
6. Identify quick wins (low effort, high impact)

**Output:** `docs/decisions/technical-assessment-YYYY-MM-DD.md`

### Task 5: Create /assess SKILL.md

`skills/assess/SKILL.md`

**Frontmatter:** name: assess, enforcement: gating, phase: understand, standalone: true

**Practices:**
1. Determine scope — full assessment or `--area <name>` for single specialist
2. Create `.pipeline/assessment/` directory
3. Dispatch specialists in 3 batches of 3 (parallel within batch, sequential between batches)
4. Each specialist writes to `.pipeline/assessment/<name>.md`
5. After all 9 complete, dispatch CTO orchestrator
6. CTO writes final report to `docs/decisions/technical-assessment-YYYY-MM-DD.md`
7. Present findings to user with review_artifacts
8. Verdict: HEALTHY | NEEDS_WORK | CRITICAL

**Verification checklist** for the skill.

### Task 6: Wire into conduct

`bin/conduct`:

- Add `run_assess` function — dispatches the /assess skill
- Add to step registry between bootstrap and brainstorm (for existing projects)
- Skip for new projects (nothing to assess)
- Skip if already done (check for recent assessment report)
- Add to status display arrays

`skills/conduct/SKILL.md`:
- Add Step 2.5: `/assess` after bootstrap, before brainstorm
- Note: skipped for new projects, optional on-demand

### Task 7: Update CLAUDE.md

- Add 10 agents to agent personas list
- Add model assignments to model selection table
- Note `/assess` in skill invocation section

### Task 8: Update bootstrap — remove extracted assessment logic

`bin/conduct` — `run_bootstrap()`:
- Sub-step 3 (stories) stays but reads assessment report if available
- Sub-step 4 (ADRs) stays but defers to assessment's architecture findings if available
- Remove any inventory analysis that duplicates what specialists now cover

`skills/bootstrap/SKILL.md`:
- Step 4 (inventory) becomes lighter — structural scan only, deep analysis moves to /assess
- Steps 4b, 4c stay but reference assessment report as input when available

### Task 9: Create assessment report template

`templates/technical-assessment.md.template` — structure for the CTO orchestrator's output:

```
# Technical Assessment: [Project Name]
**Date:** YYYY-MM-DD
**Assessed by:** 9 specialist agents + CTO synthesis

## Executive Summary
[3-5 sentences]

## Critical Findings
[Blocks deploy or causes data loss]

## Systemic Patterns
[Issues spanning 2+ specialist areas]

## Prioritized Roadmap
1. [Highest priority — why]
2. [Next — why]

## Quick Wins
- [Low effort, high impact]

## Specialist Reports
- Security: .pipeline/assessment/cto-security.md
- Data Integrity: .pipeline/assessment/cto-data-integrity.md
- [etc.]
```

## Dependencies

Tasks 1-3 are independent (parallel).
Task 4 depends on understanding the output format from 1-3.
Task 5 depends on 4 (references orchestrator).
Task 6 depends on 5 (wires skill into conduct).
Task 7 depends on 1-4 (lists agents).
Task 8 depends on 5 (references skill).
Task 9 is independent.

**Parallelizable:** Tasks 1, 2, 3, 9 can all run simultaneously.

## Verification

1. All 10 agent files exist in `agents/` with consistent persona pattern
2. `skills/assess/SKILL.md` exists with frontmatter and all practices
3. `bin/conduct` includes assess step, syntax validates (`bash -n`)
4. `conduct --step assess` runs without error in an existing project
5. Assessment report generated in `docs/decisions/`
6. CLAUDE.md model table includes all 10 new agents
