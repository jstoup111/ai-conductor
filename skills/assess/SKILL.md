---
name: assess
description: "Use for codebase health assessment. Dispatches 9 specialist agents + CTO orchestrator to evaluate security, data integrity, dependencies, architecture, duplication, testing, infrastructure, observability, and developer experience."
enforcement: gating
phase: understand
standalone: true
requires: []
model: haiku
---

## Purpose

Performs a comprehensive technical assessment of a codebase using 9 specialist agents that each
deeply evaluate one dimension of code health, followed by a CTO orchestrator that synthesizes
findings into a prioritized report with opinionated recommendations.

**Invocation:**
- **Onboarding:** Runs as part of `/conduct` after bootstrap for existing projects
- **On-demand:** User invokes `/assess` anytime for a health check
- **Selective:** `/assess --area security` runs only the security specialist

## Practices

### 1. Determine Scope

Check invocation arguments:

| Argument | Behavior |
|----------|----------|
| _(none)_ | Full assessment — all 9 specialists + CTO synthesis |
| `--area <name>` | Single specialist only (security, data-integrity, dependencies, architecture, duplication, testing, infrastructure, observability, devex) |

### 2. Prepare Assessment Directory

Create `.pipeline/assessment/` if it doesn't exist. Clear any stale reports from previous runs.

### 3. Gather Shared Context

Before dispatching specialists, gather context they all need:

1. **Codebase file listing** — `find . -type f` filtered to source/config files (exclude vendor, node_modules, .git, tmp, log)
2. **Tech-context** — if loaded in session from `/bootstrap`, include it
3. **Existing decisions** — list files in `.docs/decisions/` so architecture specialist can cross-reference

### 4. Dispatch Specialists (3 Batches of 3)

Dispatch specialists in parallel within each batch, sequential between batches.
Each specialist is a subagent dispatched via the Agent tool using the corresponding agent persona.

**Batch 1** (parallel):

| Specialist | Agent File | Model | Output |
|-----------|-----------|-------|--------|
| Security Auditor | `agents/cto-security.md` | opus | `.pipeline/assessment/cto-security.md` |
| Data Integrity Reviewer | `agents/cto-data-integrity.md` | opus | `.pipeline/assessment/cto-data-integrity.md` |
| Dependency Auditor | `agents/cto-dependencies.md` | sonnet | `.pipeline/assessment/cto-dependencies.md` |

**Rate limit cooldown: sleep 30 seconds before dispatching Batch 2.**

**Batch 2** (parallel, after Batch 1 completes):

| Specialist | Agent File | Model | Output |
|-----------|-----------|-------|--------|
| Architecture Coherence | `agents/cto-architecture.md` | opus | `.pipeline/assessment/cto-architecture.md` |
| Code Duplication | `agents/cto-duplication.md` | sonnet | `.pipeline/assessment/cto-duplication.md` |
| Test Strategy | `agents/cto-testing.md` | sonnet | `.pipeline/assessment/cto-testing.md` |

**Rate limit cooldown: sleep 30 seconds before dispatching Batch 3.**

**Batch 3** (parallel, after Batch 2 completes):

| Specialist | Agent File | Model | Output |
|-----------|-----------|-------|--------|
| Infrastructure | `agents/cto-infrastructure.md` | sonnet | `.pipeline/assessment/cto-infrastructure.md` |
| Observability | `agents/cto-observability.md` | sonnet | `.pipeline/assessment/cto-observability.md` |
| Developer Experience | `agents/cto-devex.md` | sonnet | `.pipeline/assessment/cto-devex.md` |

**Subagent prompt template:**

```
You are the [Specialist Name]. Read your persona from agents/[agent-file].

Assess the codebase in [project directory]. Here is the file listing:
[file listing]

[Tech-context if available]

Write your findings to .pipeline/assessment/[agent-name].md following the output format
defined in your persona file. Be thorough — this is a deep assessment, not a surface scan.
```

**For `--area` mode:** Dispatch only the named specialist. Skip Steps 5-6 (no CTO synthesis
for single-area assessments). Present the specialist report directly.

### 5. Dispatch CTO Orchestrator

**Rate limit cooldown: sleep 30 seconds before dispatching the CTO orchestrator.**

After all 9 specialist reports are written, dispatch the CTO orchestrator:

```
You are the CTO Orchestrator. Read your persona from agents/cto-orchestrator.md.

Here are the 9 specialist reports:
[inline all 9 reports from .pipeline/assessment/]

Use the template from templates/technical-assessment.md.template.
Project name: [project name]
Date: [YYYY-MM-DD]

Write the final assessment report to .docs/decisions/technical-assessment-[YYYY-MM-DD].md.
```

Model: opus (cross-referencing 9 reports requires deep reasoning).

### 6. Present Findings

After the CTO orchestrator writes the final report:

1. Present the report to the user via `review_artifacts`
2. Highlight the **verdict** (HEALTHY / NEEDS_WORK / CRITICAL)
3. Highlight **critical findings** count and **quick wins** count
4. If CRITICAL: recommend running `/assess --area <name>` for deeper dives on problem areas

### 7. Record Assessment

Save assessment metadata to `.pipeline/conduct-state.json`:
```json
{
  "assess": "done",
  "assess_date": "YYYY-MM-DD",
  "assess_verdict": "HEALTHY|NEEDS_WORK|CRITICAL"
}
```

## Verdict Definitions

| Verdict | Criteria | Implication |
|---------|----------|-------------|
| **HEALTHY** | No critical findings. Systemic patterns are minor. | Proceed to feature work. |
| **NEEDS_WORK** | No critical findings, but systemic patterns need addressing. | Feature work can proceed with caution. Assessment feeds `/brainstorm`. |
| **CRITICAL** | Critical findings exist OR 3+ systemic patterns at important+ severity. | Address findings before feature work. Assessment findings become the backlog. |

## Verification

- [ ] `.pipeline/assessment/` directory created
- [ ] All 9 specialist reports written (or single report for `--area` mode)
- [ ] CTO orchestrator report written to `.docs/decisions/technical-assessment-YYYY-MM-DD.md`
- [ ] Report follows template structure from `templates/technical-assessment.md.template`
- [ ] Verdict is one of: HEALTHY, NEEDS_WORK, CRITICAL
- [ ] Assessment metadata saved to `.pipeline/conduct-state.json`
- [ ] Report presented to user for review
