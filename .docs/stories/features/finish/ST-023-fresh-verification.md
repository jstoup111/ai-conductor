# Story: Fresh Verification and Completion Options

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** finish/SKILL.md

As a developer, I want the finish skill to verify completion with fresh evidence and present
structured options so that I can confidently close out the feature.

## Acceptance Criteria

### Happy Path
- Given all prior steps are complete, when finish runs, then it runs the full test suite
  fresh (not cached), checks git status, and runs linters/type checkers
- Given all verification passes, when changes are reviewed, then the user sees a diff summary
  (`git diff --stat` and `git log --oneline`) with an option to view the full diff
- Given the review is complete, when options are presented, then the user chooses from:
  1) Merge locally, 2) Push & create PR, 3) Keep as-is, 4) Discard
- Given the user chooses Option 2 (Push & PR), when executed, then the `/pr` skill handles
  push and PR creation, and the PR URL is returned
- Given the user chooses Option 1 (Merge locally), when executed, then the feature branch
  is merged into the detected base branch (main/master/develop), tests run again post-merge,
  and the feature branch is deleted

### Negative Paths
- Given tests fail during fresh verification, when detected, then finish BLOCKS: "Build
  incomplete — [N] tests failing"
- Given uncommitted changes exist, when git status is checked, then finish BLOCKS:
  "uncommitted changes exist"
- Given story acceptance criteria are not all covered, when cross-referenced, then finish
  BLOCKS: "[criterion] is not implemented — go back to BUILD"
- Given DRAFT ADRs remain in `.docs/decisions/`, when ADR compliance is checked, then finish
  BLOCKS: "DRAFT ADRs remain unapproved"
- Given implementation contradicts an APPROVED ADR, when detected, then finish BLOCKS until
  the ADR is superseded or the code is changed
- Given the user chooses Option 4 (Discard), when selected, then explicit confirmation is
  required: "Are you sure? This deletes all work on this branch."
- Given the user chooses Discard but then declines confirmation, when cancelled, then the
  options menu is re-displayed

### Done When
- [ ] Test suite runs fresh (not cached results)
- [ ] Git status verified clean
- [ ] Linters/type checkers run if present
- [ ] All story acceptance criteria cross-referenced
- [ ] Changes shown to user before options (diff summary + optional full diff)
- [ ] Four options presented; user choice executed
- [ ] Option 2 delegates to /pr skill
- [ ] Option 4 requires explicit confirmation
- [ ] Option 1 runs post-merge tests and deletes feature branch
- [ ] ADR compliance verified (no DRAFT ADRs, no contradictions)
- [ ] Base branch auto-detected (main/master/develop)
- [ ] Worktree cleanup handled after chosen option
