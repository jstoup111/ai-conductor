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

**Harness data:**
- `.pipeline/audit-trail/` — gate pass/fail history, rework cycles, task timings
- `.pipeline/task-status.json` — completion stats
- Git log for the feature branch — commit frequency, reverts, amend count
- `.memory/gotchas/` — issues encountered during this feature
- `docs/conflicts/` — conflicts detected and resolved
- Code review findings from audit trail — recurring themes

**Application data:**
- The code diff for the entire feature (from branch point to HEAD)
- Test suite output (coverage, pass/fail counts, timing)
- Stories from `docs/stories/` — the acceptance criteria we targeted
- Tech-context if loaded — stack-specific review criteria

---

## Part A: Harness Retro

Analyze three dimensions, aligned with the optimization targets:

### A1. Correctness (Is the feature 100% functional?)

- Did any bugs escape the TDD cycle to manual testing or user discovery?
- Were negative path stories comprehensive enough? Any failure modes missed?
- Did TDD test coverage catch all edge cases, or were some found late?
- Gap analysis: what additional story/test patterns would have caught escapes?

**Output:** List of escaped bugs with root cause analysis. Recommended new negative path
categories for the `stories` skill.

### A2. Gate Quality (Does gating catch real problems?)

- Gate pass/fail ratio per stage — are gates too lenient or too strict?
- **False positives:** Gates that blocked correct work (wasted rework cycles)
  - Which gate? What triggered it? Was the trigger miscalibrated?
- **False negatives:** Problems that passed all gates but were caught later
  - Which gate should have caught it? What criteria were missing?
- Domain reviewer effectiveness: did vetoes prevent real issues or create churn?
- Evaluator calibration: did the evaluator find issues the generator missed?

**Output:** Specific calibration adjustments for evaluator and domain reviewer prompts.

### A3. Autonomy (How much user intervention was needed?)

- Count of human interventions during pipeline execution
- For each intervention, classify:
  - **Necessary:** Genuine ambiguity, policy decision, design choice — these SHOULD require a human
  - **Preventable:** Skill gap, missing context, bad prompt — these should be eliminated
- For preventable interventions: what specific skill/agent/memory change would prevent recurrence?

**Output:** Count and classification of interventions. Specific change proposals to reduce
preventable interventions.

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

### B4. Security & Performance

- OWASP top 10 scan of new code paths
- Auth/authz: new endpoints properly protected?
- Input validation: boundaries correctly defended?
- Performance: N+1 queries, missing pagination, unbounded queries?

### B5. Technical Debt

- TODOs introduced — are they tracked or will they be forgotten?
- Workarounds — "for now" code that needs a follow-up story?
- Dependency health — new dependencies with known vulnerabilities?

---

## Output: Retro Report

Save to `docs/retros/YYYY-MM-DD-<feature-name>.md`:

```markdown
## Retro: [Feature Name]

**Date:** YYYY-MM-DD
**Autonomy level:** conservative | standard | full
**Pipeline stats:** X tasks, Y rework cycles, Z human interventions

---

## Part A: Harness

### Correctness
- Bugs escaped: [count, description, root cause]
- Story gaps: [negative paths that should have been written]
- New story patterns recommended: [list]

### Gate Quality
- False positives: [count — gates that blocked correct work]
- False negatives: [count — problems that escaped gates]
- Evaluator calibration: [too lenient / too strict / well-calibrated, with specifics]
- Domain reviewer: [veto accuracy, unnecessary vetoes]

### Autonomy
- Total interventions: [count]
- Necessary: [count — genuine decisions]
- Preventable: [count — with root cause per intervention]

### Harness Changes Proposed
- [ ] [Specific change to skill/agent/hook with rationale]
- [ ] [Specific change with rationale]

---

## Part B: Application

### Architecture Health
- [Findings with file:line references]

### Code Quality
- [Findings — stack-specific if tech-context loaded]

### Test Quality
- [Coverage gaps, fragile tests, missing negative paths]

### Security & Performance
- [Findings with severity: critical / important / minor]

### Technical Debt
- [TODOs, workarounds, follow-up stories needed]

### Application Changes Proposed
- [ ] [Specific fix/refactor — becomes a new story]
- [ ] [Specific fix/refactor — becomes a new story]
```

---

## Feedback Loops

After writing the retro report, take these actions:

### Harness findings → Harness improvements
- Persist learnings to `.memory/` (gotchas, patterns, decisions)
- Propose concrete skill/agent prompt modifications (as diffs the user can approve)
- Update evaluator calibration notes in `agents/evaluator.md` if needed
- Add newly discovered negative path categories to `skills/stories/SKILL.md`

### Application findings → New stories
- Create new stories in `docs/stories/` for technical debt and fixes
- Run `conflict-check` on the new stories
- These become tracked work for the next development cycle — not lost "we should fix this" notes

### Trend Tracking

If this is not the first retro, compare against previous retro reports:
- Is the intervention count trending down? (Good — harness is learning)
- Are the same gate failures recurring? (Bad — calibration needs adjustment)
- Are the same application issues appearing? (Bad — tech-context needs updating)

Note trends in the retro report.

## Verification

- [ ] Both Part A and Part B completed (neither skipped)
- [ ] Harness analysis covers correctness, gate quality, and autonomy
- [ ] Application analysis covers architecture, code quality, tests, security, debt
- [ ] All findings include specific file:line references or concrete examples
- [ ] Proposed changes are specific (not vague "improve X")
- [ ] Harness changes are actionable diffs/modifications
- [ ] Application changes are written as new stories
- [ ] Retro report saved to `docs/retros/`
- [ ] Learnings persisted to `.memory/`
- [ ] Trends compared against previous retros (if any exist)
