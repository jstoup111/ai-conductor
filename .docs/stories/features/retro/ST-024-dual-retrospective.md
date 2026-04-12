# Story: Dual Retrospective

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** retro/SKILL.md

As a developer, I want the retro skill to analyze both the harness workflow and the
application code so that I get actionable improvement proposals for both the tool and
the product.

## Acceptance Criteria

### Happy Path
- Given the feature is shipped, when retro runs, then it produces two parts:
  Part A (Harness) analyzing correctness, gate quality, and autonomy friction;
  Part B (Application) analyzing architecture, code quality, test quality, security, tech debt
- Given the analysis is complete, when the retro is saved, then it goes to `.docs/retros/`
  with file:line references for specific findings
- Given improvement proposals are generated, when they are concrete, then each has a specific
  action, affected file/area, and severity

### Negative Paths
- Given no significant issues are found in either part, when the retro completes, then it
  still documents what went well — a retro is never "nothing to report"
- Given the retro identifies a harness bug, when the proposal is written, then it clearly
  distinguishes harness improvements from application improvements

### Done When
- [ ] Part A covers: harness correctness, gate quality, autonomy friction
- [ ] Part B covers: architecture, code quality, tests, security, tech debt
- [ ] Retro saved to .docs/retros/ with file:line references
- [ ] Improvement proposals are concrete with action, area, severity
- [ ] Skipped for Small tier
