# Story: Code Review via Evaluator Agent

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** code-review/SKILL.md

As a developer, I want the code-review skill to dispatch an evaluator agent with fresh
context for calibrated, skeptical review so that code quality is verified independently.

## Acceptance Criteria

### Happy Path
- Given implementation is complete, when code-review runs, then it dispatches an evaluator
  agent using `agents/evaluator.md` persona with fresh context (no shared state with the
  generator)
- Given the evaluator receives the diff, when it reviews, then it checks: spec compliance,
  code quality, domain integrity, security, and test coverage
- Given the evaluator approves, when the verdict is recorded, then
  `.pipeline/audit-trail/code-review-satisfied.md` is written

### Negative Paths
- Given the evaluator returns REQUEST_CHANGES, when the verdict is recorded, then the
  specific changes are noted and the developer is directed to fix them
- Given the evaluator returns BLOCK, when the verdict is recorded, then the build cannot
  proceed to ship phase until the issues are resolved
- Given the evaluator's fresh context is too large (massive diff), when dispatched, then
  the diff is summarized or chunked rather than overflowing the context window

### Done When
- [ ] Evaluator dispatched with fresh context (no generator state)
- [ ] Review covers: spec compliance, quality, domain integrity, security, tests
- [ ] APPROVE writes code-review-satisfied.md
- [ ] REQUEST_CHANGES and BLOCK verdicts handled appropriately
- [ ] Skipped for Small tier (domain review in TDD suffices)
