# Story: Systematic Debugging Investigation

**Status:** DRAFT
**Epic:** EP-001 Conductor Core Engine
**Skill:** debugging/SKILL.md

As a developer encountering a bug, I want the debugging skill to enforce a four-phase
systematic investigation so that root causes are identified before fixes are attempted.

## Acceptance Criteria

### Happy Path
- Given a bug or test failure, when debugging runs, then it follows four phases: 1) Reproduce,
  2) Isolate, 3) Root cause, 4) Fix
- Given the reproduction phase, when the bug is confirmed, then the exact reproduction steps
  and error output are documented
- Given root cause is identified, when a fix is proposed, then it addresses the root cause
  — not a symptom or workaround
- Given the fix is applied, when verified, then the original reproduction steps no longer
  produce the bug AND no regressions are introduced

### Negative Paths
- Given the bug cannot be reproduced, when reproduction fails, then debugging reports
  "Cannot reproduce" with the steps attempted — it does not proceed to fix a phantom bug
- Given the fix introduces a regression, when the test suite runs, then the regression is
  caught and the fix is revised
- Given multiple potential root causes exist, when investigating, then each candidate is
  evaluated with evidence before the fix targets one

### Done When
- [ ] Four-phase investigation enforced: reproduce, isolate, root cause, fix
- [ ] No fixes without evidence of root cause
- [ ] Reproduction steps documented
- [ ] Fix verified against original reproduction
- [ ] Regressions detected via test suite
