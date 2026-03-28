---
name: conduct
description: "Use to guide a feature through the full SDLC. Checks artifact state, determines current phase, tells you what to run next, and blocks progression when gates aren't met."
enforcement: gating
phase: all
standalone: true
requires: []
---

## Purpose

Walks a feature through the complete SDLC flow by checking artifact state and directing the user
to the correct next skill. Run `/conduct` at any point to see where you are and what to do next.

Does NOT run other skills internally — it assesses state and directs. The user invokes each skill.

## The Flow

```
Step 1: /bootstrap        → UNDERSTAND
Step 2: /memory            → UNDERSTAND
Step 3: /brainstorm        → DECIDE
Step 4: /stories           → DECIDE
Step 5: /conflict-check    → DECIDE
Step 6: /plan              → DECIDE
Step 7: /pipeline or /tdd  → BUILD
Step 8: /code-review       → BUILD (if not already run by pipeline)
Step 9: /finish            → SHIP
Step 10: /retro            → SHIP
```

## Practices

### 1. Assess Current State

Check for these artifacts in order. The **first missing artifact** determines the current step.

| Step | Check | How to Verify |
|------|-------|---------------|
| 1. bootstrap | Project CLAUDE.md exists AND `.memory/` directory exists AND `docs/` subdirectories exist | Glob for `CLAUDE.md` in project root, check `.memory/index.md`, check `docs/specs/` exists |
| 2. memory | `.memory/index.md` has been read this session | Memory recall happens automatically — if bootstrap is done, mark this as done |
| 3. brainstorm | At least one file exists in `docs/specs/` | Glob `docs/specs/*.md` |
| 4. stories | At least one file exists in `docs/stories/` | Glob `docs/stories/*.md` |
| 5. conflict-check | Conflict report exists in `docs/conflicts/` OR a clean-check marker exists | Glob `docs/conflicts/*.md` — if stories exist but no conflict report, this step is pending |
| 6. plan | At least one file exists in `docs/plans/` | Glob `docs/plans/*.md` |
| 7. build | Implementation tasks from the plan are completed with passing tests | Check `.pipeline/task-status.json` if pipeline used, OR check that test suite passes and commits exist beyond the plan |
| 8. code-review | Review verdict exists in `.pipeline/audit-trail/` OR code-review was run | Check audit trail or ask user |
| 9. finish | Fresh verification has been performed | Check `docs/retros/` does NOT yet exist but build is complete |
| 10. retro | Retro report exists in `docs/retros/` | Glob `docs/retros/*.md` |

### 2. Report Status

Present a clear status dashboard:

```
## SDLC Progress: [Feature Name]

| Phase | Step | Status | Artifact |
|-------|------|--------|----------|
| UNDERSTAND | bootstrap | ✅ Done | CLAUDE.md, .memory/, docs/ |
| UNDERSTAND | memory | ✅ Done | .memory/index.md |
| DECIDE | brainstorm | ✅ Done | docs/specs/2026-03-28-task-board.md |
| DECIDE | stories | ✅ Done | docs/stories/task-board.md |
| DECIDE | conflict-check | ⏳ NEXT | — |
| DECIDE | plan | ⬚ Pending | — |
| BUILD | tdd/pipeline | ⬚ Pending | — |
| BUILD | code-review | ⬚ Pending | — |
| SHIP | finish | ⬚ Pending | — |
| SHIP | retro | ⬚ Pending | — |

### Next Step
Run `/conflict-check` to check stories for contradictions before planning.
```

### 3. Gate Enforcement

Before suggesting the next step, verify that the previous step's **quality gates** were met:

**After stories (before suggesting conflict-check):**
- Open the stories file and verify EVERY story has at least one concrete negative path
- If any story has only happy paths or vague negative paths ("handle errors gracefully"), BLOCK
- Say: "Stories incomplete — [story name] is missing concrete negative paths. Run `/stories` again."

**After conflict-check (before suggesting plan):**
- Check the conflict report for any **blocking** conflicts still unresolved
- If blocking conflicts remain, BLOCK
- Say: "Blocking conflicts remain. Resolve them before running `/plan`."

**After plan (before suggesting build):**
- Open the plan and verify every acceptance criterion from stories maps to at least one task
- If coverage gaps exist, BLOCK
- Say: "Plan has coverage gaps — [criterion] has no corresponding task. Run `/plan` again."

**After build (before suggesting finish):**
- Run the test suite and verify it passes
- Check git status for uncommitted changes
- If tests fail or tree is dirty, BLOCK
- Say: "Build incomplete — [N] tests failing / uncommitted changes exist."

### 4. Handle Edge Cases

**Re-entry:** If the user runs `/conduct` mid-flow (e.g., after completing brainstorm), pick up from the current state. Don't restart.

**Skipping steps:** If the user wants to skip a step (e.g., skip brainstorm because they already know what to build), allow it ONLY for advisory-enforcement steps. Gating steps cannot be skipped.

| Step | Can Skip? | Reason |
|------|-----------|--------|
| bootstrap | No (gating) | Other skills need CLAUDE.md and directory structure |
| memory | Yes (advisory) | Fresh project may have no memory |
| brainstorm | Yes (advisory) | User may already have a clear design |
| stories | No (gating) | Negative paths are mandatory for TDD |
| conflict-check | No (gating) | Must verify zero blocking conflicts |
| plan | No (gating) | Tasks needed for build phase |
| build | No (structural) | This is the implementation |
| code-review | No (gating) | Quality gate before ship |
| finish | No (gating) | Fresh verification required |
| retro | Yes (advisory) | Recommended but not blocking |

If the user asks to skip a gating step, say: "[Step] is a gating step — it cannot be skipped because [reason]."

### 5. Conflict-Check Clean Pass

When conflict-check finds NO conflicts, create a marker file so the conductor knows it ran:

```
docs/conflicts/YYYY-MM-DD-clean-check.md
```

Contents:
```markdown
# Conflict Check: Clean Pass
**Date:** YYYY-MM-DD
**Stories checked:** [list of story files]
**Result:** No blocking or degrading conflicts found.
```

This distinguishes "conflict-check passed clean" from "conflict-check was never run."

### 6. Completion

When all steps show ✅ Done:

```
## SDLC Complete 🎉

All phases finished. Artifacts:
- Design: docs/specs/...
- Stories: docs/stories/...
- Conflicts: docs/conflicts/...
- Plan: docs/plans/...
- Retro: docs/retros/...

Harness test complete. Review the retro for improvement findings.
```

## Verification

- [ ] Correctly identifies current step from artifact state
- [ ] Status dashboard shows all 10 steps with correct status
- [ ] Gate enforcement blocks progression when quality gates not met
- [ ] Skippable vs non-skippable steps correctly enforced
- [ ] Re-entry works (picks up from current state, doesn't restart)
- [ ] Clean conflict-check creates marker file
- [ ] Completion message shown when all steps done
