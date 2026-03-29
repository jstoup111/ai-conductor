---
name: retro
description: "Use after finishing a feature or at any natural milestone. Dual retrospective analyzing both the harness workflow (tool) and the application code produced (product). Generates concrete improvement proposals."
enforcement: advisory
phase: ship
standalone: true
requires: []
---

## Purpose

Two-part analysis after each feature: how did the harness perform (Part A), and how healthy is
the code we produced (Part B). Both parts always run together. Findings feed back into memory,
skill improvements, evaluator calibration, and new stories.

## Practices

### Data Collection

Before analysis, gather:
- **Harness:** `.pipeline/audit-trail/` (gate history, rework cycles), `.pipeline/task-status.json`, git log (reverts, amends), `.memory/gotchas/`, `docs/conflicts/`
- **Application:** full feature diff (branch point to HEAD), test suite output, `docs/stories/` acceptance criteria, tech-context if loaded

---

## Part A: Harness Retro

Analyze three dimensions, aligned with the optimization targets:

### A1. Correctness (Is the feature 100% functional?)

- Did any bugs escape the TDD cycle to manual testing or user discovery?
- Were negative path stories comprehensive enough? Any failure modes missed?
- Did TDD test coverage catch all edge cases, or were some found late?
- Gap analysis: what additional story/test patterns would have caught escapes?

### A2. Gate Quality (Does gating catch real problems?)

- Gate pass/fail ratio per stage — are gates too lenient or too strict?
- **False positives:** Gates that blocked correct work (wasted rework cycles)
  - Which gate? What triggered it? Was the trigger miscalibrated?
- **False negatives:** Problems that passed all gates but were caught later
  - Which gate should have caught it? What criteria were missing?
- Domain reviewer effectiveness: did vetoes prevent real issues or create churn?
- Evaluator calibration: did the evaluator find issues the generator missed?

### A3. Autonomy (How much user intervention was needed?)

- Count of human interventions during pipeline execution
- For each intervention, classify:
  - **Necessary:** Genuine ambiguity, policy decision, design choice — these SHOULD require a human
  - **Preventable:** Skill gap, missing context, bad prompt — these should be eliminated
- For preventable interventions: what specific skill/agent/memory change would prevent recurrence?

---

## Part B: Application Retro

Analyze the code we actually produced:

### B1. Architecture Health

- **Coupling:** Are new modules appropriately decoupled? Any god classes introduced?
- **Cohesion:** Does each class/module have a single clear purpose?
- **Dependency direction:** Do dependencies flow toward stable abstractions?
- **Domain boundaries:** Are they respected? Any leaky abstractions?

### B2. Code Quality

- **Complexity:** Methods/functions that are too long or deeply nested?
- **Duplication:** Copy-paste patterns that should be extracted?
- **Naming:** Intention-revealing names? Any misleading names?
- **Error handling:** Consistent patterns? Swallowed exceptions?
- **Stack-specific** (if tech-context loaded):
  - Rails: N+1 queries, missing indexes, unsafe migrations, missing validations
  - PostgreSQL: missing constraints, transaction safety, index coverage

### B3. Test Quality

- **Coverage:** Are all acceptance criteria covered by tests?
- **Assertion quality:** Testing behavior or implementation details?
- **Fragility:** Tests coupled to internal structure that break on refactor?
- **Negative paths:** All documented negative scenarios actually tested?
- **Missing tests:** Code paths with no test coverage?

### B4. Security, Performance & Debt

- OWASP top 10 scan: auth/authz on new endpoints, input validation at boundaries
- Performance: N+1 queries, missing pagination, unbounded queries
- TODOs introduced — tracked or will they be forgotten?
- Workarounds — "for now" code that needs a follow-up story?
- Dependency health — new dependencies with known vulnerabilities?

---

## Part C: Context Efficiency Retro

Review token/context consumption for this feature cycle and identify optimization opportunities.

**Analyze:**
- Which skills or subagent dispatches consumed the most context? (Count dispatches, estimate scope)
- Were there redundant file reads, unnecessary explorations, or overly broad subagent prompts?
- Did any skill load tech-context or memory that wasn't actually referenced in its output?
- Were complexity tiers correctly applied? (Would a different tier have been appropriate?)
- Did the evaluator/domain reviewer dispatches feel proportionate to the feature's complexity?

**Propose:**
- Specific SKILL.md changes that would reduce context without degrading output
- Subagent prompt refinements (more focused context, fewer files)
- Steps that could be skipped or batched for this feature's complexity tier
- Model downgrades that would have been safe (e.g., Opus → Sonnet for a specific phase)

**Output:** 2-3 concrete, actionable findings with finding IDs (C-1, C-2, C-3).

---

## Writing Rules

**Be concise. No repetition.**

- State each finding ONCE. If a finding is relevant to multiple sections, state it in the most
  relevant section and reference it by ID elsewhere: "See H-3" or "See A-2."
- Use bullet points, not paragraphs. One line per finding.
- Every finding needs: what, where (file:line), severity, and proposed fix.
- Do NOT restate what worked correctly. Only mention working things in a one-line summary.
  Focus the report on what needs to change.
- If nothing is wrong in a section, write "No issues." — not a paragraph explaining why
  everything is fine.

**Finding IDs:** Number findings sequentially across the whole report.
- H-1, H-2, H-3... for harness findings
- A-1, A-2, A-3... for application findings
- C-1, C-2, C-3... for context efficiency findings

## Output: Retro Report

Save to `docs/retros/YYYY-MM-DD-<feature-name>.md`:

```markdown
# Retro: [Feature Name]
**Date:** YYYY-MM-DD | **Stats:** N tasks, M rework cycles, K interventions, N tests passing

## Part A: Harness
- **H-1:** [what, where, severity, fix]

**Proposed changes:**
- [ ] H-1: [specific change]

## Part B: Application
- **A-1:** [what, file:line, severity, fix]

**Proposed changes:**
- [ ] A-1: [specific change → new story]

## Part C: Context Efficiency
### Context Efficiency
- **C-1:** [what, where, impact, proposed change]

**Proposed changes:**
- [ ] C-1: [specific SKILL.md change, prompt refinement, or model downgrade]

## Trends
[One line per trend vs. prior retros.]
```

---

## Feedback Loops

After writing the retro report, take these actions:

**Harness findings → Harness improvements:** Persist learnings to `.memory/` (gotchas, patterns, decisions). Propose skill/agent prompt modifications as diffs; update `agents/evaluator.md` calibration and `skills/stories/SKILL.md` negative path categories as needed.

**Application findings → New stories:** Create stories in `docs/stories/` for debt and fixes; run `conflict-check`. These become tracked work, not lost "we should fix this" notes.

**Trend tracking:** Compare against prior retros — intervention count down (good), same gate failures recurring (calibration needed), same application issues recurring (tech-context needs updating). Note trends in the report.

## Verification

- [ ] Both Part A and Part B completed (neither skipped)
- [ ] Part C context efficiency analyzed with at least 1 finding
- [ ] Harness analysis covers correctness, gate quality, and autonomy
- [ ] Application analysis covers architecture, code quality, tests, security, debt
- [ ] All findings include specific file:line references or concrete examples
- [ ] Proposed changes are specific (not vague "improve X")
- [ ] Harness changes are actionable diffs/modifications
- [ ] Application changes are written as new stories
- [ ] Retro report saved to `docs/retros/`
- [ ] Learnings persisted to `.memory/`
- [ ] Trends compared against previous retros (if any exist)
