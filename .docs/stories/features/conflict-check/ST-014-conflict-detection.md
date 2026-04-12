# Story: Conflict Detection Between Stories

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** conflict-check/SKILL.md

As a developer, I want the conflict-check skill to detect contradictions, overlaps, and
resource contention between stories so that I don't build conflicting features.

## Acceptance Criteria

### Happy Path
- Given multiple stories exist in `.docs/stories/`, when conflict-check runs, then it
  analyzes all stories for contradictions, overlaps, state conflicts, and resource contention
- Given no conflicts are found, when the check completes, then a clean-pass marker file is
  created at `.docs/conflicts/YYYY-MM-DD-clean-check.md` listing the stories checked
- Given blocking conflicts are found, when the report is written, then it classifies each
  conflict as blocking or degrading with specific references to the conflicting criteria

### Negative Paths
- Given blocking conflicts remain unresolved, when the conductor checks the gate, then it
  BLOCKS progression to the plan step
- Given only degrading (non-blocking) conflicts exist, when the conductor checks the gate,
  then it warns but allows progression
- Given no stories exist in `.docs/stories/`, when conflict-check runs, then it reports an
  error: "No stories to check"

### Done When
- [ ] All stories in .docs/stories/ are cross-checked for conflicts
- [ ] Clean pass creates marker file distinguishing "passed" from "never run"
- [ ] Blocking conflicts are classified and block progression
- [ ] Degrading conflicts warn but allow progression
- [ ] Conflict report saved to .docs/conflicts/
