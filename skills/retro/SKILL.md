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
- **Harness:** `.pipeline/audit-trail/events.jsonl` is the primary source for gate history and
  rework cycles (gate verdicts, retries, kickbacks, HALT lifecycle) — read it, not
  `.pipeline/gates/` files. Also gather `.pipeline/task-status.json`, git log (reverts, amends),
  `.memory/gotchas/`, `.docs/conflicts/`.
  - If `.pipeline/audit-trail/events.jsonl` is missing or empty despite steps having executed
    this run, do NOT read that as "no friction occurred" — report INCOMPLETE for the
    gate/rework-history portion of the retro (the audit trail failed to capture it) instead of
    silently proceeding as if the run was clean.
  - Raw `.pipeline/events.jsonl` (not the audit-trail subdirectory) remains the source for
    retry-escalation history used in Part C (Context Efficiency Retro).
- **Application:** full feature diff (branch point to HEAD), test suite output, `.docs/stories/` acceptance criteria, tech-context if loaded

---

## Part A: Harness Retro

**Only report problems and improvements.** If a dimension has no issues, write "No issues." and move on.

### A1. Correctness
Report ONLY: bugs that escaped TDD, negative paths that were missed, edge cases found late.
For each escape: what was missed, which gate should have caught it, what story/test pattern
would prevent recurrence.

### A2. Gate Quality
Report ONLY: false positives (gates that blocked correct work — wasted rework) and false
negatives (problems that passed all gates). For each: which gate, what triggered/missed it,
specific calibration fix.

### A3. Autonomy
Report ONLY: preventable human interventions (skill gap, missing context, bad prompt).
For each: what specific skill/agent/memory change would prevent recurrence.
Do not list necessary interventions (design decisions, policy choices) — those are expected.

---

## Part B: Application Retro

**Only report defects, risks, and debt.** Do not describe what is correct or well-structured.

### B1. Architecture & Code Quality
Report ONLY: god classes, coupling violations, leaky abstractions, methods >15 lines or
>3 branches, copy-paste duplication, misleading names, swallowed exceptions, stack-specific
issues (N+1, missing indexes, unsafe migrations).

### B2. Test Quality
Report ONLY: missing coverage (acceptance criteria without tests, untested code paths),
fragile tests coupled to internals, assertions testing implementation instead of behavior.

### B3. Security, Performance & Debt
Report ONLY: auth gaps, unvalidated inputs, SQL injection risks, unbounded queries, missing
pagination, untracked TODOs, workarounds needing follow-up stories, vulnerable dependencies.

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

**Problems only. No praise.**

- If nothing is wrong in a section, write "No issues." — not a paragraph explaining why
  everything is fine. Never describe what worked correctly.
- State each finding ONCE. Reference by ID elsewhere: "See H-3."
- One line per finding. Every finding needs: what, where (file:line), severity, proposed fix.
- The retro exists to improve the harness and the code. Anything that doesn't propose a
  concrete change is wasted tokens.

**Finding IDs:** Number findings sequentially across the whole report.
- H-1, H-2, H-3... for harness findings
- A-1, A-2, A-3... for application findings
- C-1, C-2, C-3... for context efficiency findings

## Output: Retro Report

Save to `.docs/retros/YYYY-MM-DD-<feature-name>.md`:

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

**Application findings → New stories:** Create stories in `.docs/stories/` for debt and fixes; run `conflict-check`. These become tracked work, not lost "we should fix this" notes.

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
- [ ] Retro report saved to `.docs/retros/`
- [ ] At least one harness or application learning persisted to `.memory/` (decisions, patterns, or gotchas)
- [ ] `.memory/index.md` updated after write
- [ ] Trends compared against previous retros (if any exist)
