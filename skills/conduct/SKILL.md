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

### Session Model

**One Claude session per feature/worktree.** All steps — design through retro — share the same
session. The session ID is stored in `.pipeline/conduct-session-id`.

- **Design phase** (bootstrap → plan): Context grows moderately. All artifacts persist to disk.
- **Build phase** (pipeline): The conductor drives the task loop. Claude orchestrates each task
  by dispatching subagents. Subagent context is isolated and discarded — only a ~2-3 line summary
  returns to the orchestrator per task. No context compaction needed.
- **Ship phase** (finish → retro): Lightweight steps, context stays bounded.

Interactive steps reuse the feature session via `--resume`. No fresh sessions are created
mid-feature. This prevents redundant cold starts that waste API calls and hit rate limits.

## The Flow

```
Step 1:  /bootstrap             → UNDERSTAND
Step 2:  /memory                → UNDERSTAND
Step 2.5: /assess               → UNDERSTAND (existing projects only — skipped for new)
Step 3:  /brainstorm            → DECIDE
Step 4:  Complexity Assessment   → DECIDE (classify S/M/L, determines which steps run)
Step 5:  Worktree setup          → DECIDE (create feature branch + worktree — all subsequent commits are isolated)
Step 6:  /stories               → DECIDE
Step 7:  /conflict-check        → DECIDE (skipped for Small)
Step 8:  /plan                  → DECIDE
Step 8b: /architecture-diagram  → DECIDE (update proposed-state diagrams for plan)
Step 9:  /architecture-review    → DECIDE (skipped for Small, lightweight for Medium — consumes diagrams)
Step 10: /writing-system-tests  → BUILD (skipped for Small)
Step 11: /pipeline or /tdd      → BUILD (pipeline evaluator satisfies code-review gate)
Step 12: /manual-test           → SHIP (validate stories, bug loop via /tdd — auto-skip for non-endpoint features)
Step 13: /retro                 → SHIP
Step 14: /finish                → SHIP (verify, push, create PR)
```

## Practices

### 1. Assess Current State

**Do not assume module structure or codebase layout.** Conduct should describe WHAT to explore,
not assert what exists. Verify structure during exploration (brainstorm/bootstrap). Prompts that
assume specific module counts or technology choices before exploration lead to wrong premises
and wasted rework.

Check for these artifacts in order. The **first missing artifact** determines the current step.

| Step | Check | How to Verify |
|------|-------|---------------|
| 1. bootstrap | Project CLAUDE.md exists AND `.memory/` directory exists AND `.docs/` subdirectories exist | Glob for `CLAUDE.md` in project root, check `.memory/index.md`, check `.docs/specs/` exists |
| 2. memory | `.memory/index.md` has been read this session | Memory recall happens automatically — if bootstrap is done, mark this as done |
| 2.5. assess | Assessment report exists OR skipped (new project) | Glob `.docs/decisions/technical-assessment-*.md` or check state is "skipped" |
| 3. brainstorm | At least one file exists in `.docs/specs/` | Glob `.docs/specs/*.md` |
| 4. complexity | Complexity tier set in `.pipeline/conduct-state.json` | Check `complexity_tier` key exists and is S, M, or L |
| 5. worktree | Feature worktree created | Check `.pipeline/conduct-state.json` worktree state is "done" or "skipped" |
| 6. stories | At least one **accepted** story exists in `.docs/stories/` (not just DRAFT) | Glob `.docs/stories/*.md` — if all stories contain `Status: DRAFT`, this step is pending |
| 7. conflict-check | Conflict report exists in `.docs/conflicts/` OR skipped (Small tier) | Glob `.docs/conflicts/*.md` or check state is "skipped" |
| 8. plan | At least one file exists in `.docs/plans/` | Glob `.docs/plans/*.md` |
| 8b. diagrams | Proposed-state diagrams exist | Check `.docs/architecture/*-proposed.md` exist, or check state is "skipped" |
| 9. architecture-review | Review exists in `.docs/decisions/` OR skipped (Small tier) | Glob `.docs/decisions/architecture-review-*.md` or check state is "skipped" |
| 10. writing-system-tests | Acceptance specs exist OR skipped (Small tier) | Glob `spec/integration/*_spec.rb` or `spec/system/*_spec.rb`, or check state is "skipped" |
| 11. build | Implementation tasks completed with passing tests | Check `.pipeline/task-status.json` or test suite passes. Pipeline evaluator satisfies code-review gate. |
| 12. manual-test | Manual test results exist with no FAILs, OR auto-skipped (non-endpoint feature) | Glob `.docs/manual-test-results.md` — if file contains FAIL rows, step is pending. **Auto-skip:** If no stories reference HTTP endpoints, API routes, or user-facing UI, skip `/manual-test` and log reason. For internal components (services, background jobs, mailers, CI config), suggest Rails console or script-based smoke test instead. |
| 13. retro | Retro report exists in `.docs/retros/` | Glob `.docs/retros/*.md` |
| 14. finish | PR created or branch pushed | Check `pr_url` in state or step is "done" |

### 2. Report Status

Present a clear status dashboard:

```
## SDLC Progress: [Feature Name]

| Phase | Step | Status | Artifact |
|-------|------|--------|----------|
| UNDERSTAND | bootstrap | ✅ Done | CLAUDE.md, .memory/, .docs/ |
| UNDERSTAND | memory | ✅ Done | .memory/index.md |
| DECIDE | brainstorm | ✅ Done | .docs/specs/2026-03-28-task-board.md |
| DECIDE | stories | ✅ Done | .docs/stories/task-board.md |
| DECIDE | conflict-check | ⏳ NEXT | — |
| DECIDE | plan | ⬚ Pending | — |
| BUILD | tdd/pipeline | ⬚ Pending | — |
| BUILD | code-review | ⬚ Pending | — |
| SHIP | manual-test | ⬚ Pending | — |
| SHIP | retro | ⬚ Pending | — |
| SHIP | finish/pr | ⬚ Pending | — |

### Next Step
Run `/conflict-check` to check stories for contradictions before planning.
```

### 2.5 Complexity Assessment (after brainstorm, before stories)

After the design doc is approved, classify the feature's complexity tier:

| Signal | Small | Medium | Large |
|---|---|---|---|
| Models/tables | 1-3 | 4-7 | 8+ |
| External integrations | 0 | 1-2 | 3+ |
| Auth/authz | None/basic | Role-based | Multi-tenant/OAuth |
| State machines | None | 1 simple | Complex/multiple |
| Estimated stories | 1-5 | 6-15 | 16+ |

Majority of signals determines the tier. Ties break toward the higher tier. **The user can
override.** Present it as: "Complexity: SMALL (3 models, no deps). Override? [S/M/L/accept]"

Store the tier in `.pipeline/conduct-state.json` as `"complexity_tier": "S"` (or M/L).

**Tier-specific step behavior:**

| Step | Small | Medium | Large |
|---|---|---|---|
| conflict-check | **Skip** | Run | Run |
| architecture-diagram | **Skip** | Run | Run |
| architecture-review | **Skip** | Lightweight (feasibility + alignment only) | Full |
| writing-system-tests | **Skip** (request specs in TDD suffice) | Run | Run |
| pipeline | **Skip** (use direct /tdd) | Run | Run |
| code-review | **Skip** (domain review in TDD suffices) | Run | Run |

**Small flow:** brainstorm → stories → plan → direct /tdd → finish → retro

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

**When pipeline reports task failure:** Verify by running tests before escalating or
re-dispatching. JSON state can become stale — the actual test suite is the source of truth.

### 4. Handle Edge Cases

**Re-entry:** If the user runs `/conduct` mid-flow (e.g., after completing brainstorm), pick up from the current state. Don't restart.

**Skipping steps:** If the user wants to skip a step (e.g., skip brainstorm because they already know what to build), allow it ONLY for advisory-enforcement steps. Gating steps cannot be skipped.

| Step | Can Skip? | Reason |
|------|-----------|--------|
| bootstrap | No (gating) | Other skills need CLAUDE.md and directory structure |
| memory | Yes (advisory) | Fresh project may have no memory |
| assess | Yes (advisory) | Skipped for new projects; optional on-demand for existing |
| brainstorm | Yes (advisory) | User may already have a clear design |
| stories | No (gating) | Negative paths are mandatory for TDD |
| conflict-check | Tier-dependent | Skip for Small, required for Medium/Large |
| plan | No (gating) | Tasks needed for build phase |
| architecture-diagram | Tier-dependent | Skip for Small, required for Medium/Large |
| writing-system-tests | Tier-dependent | Skip for Small (request specs in TDD suffice), required for Medium/Large |
| build | No (structural) | This is the implementation |
| code-review | Tier-dependent | Skip for Small (domain review suffices), required for Medium/Large |
| finish | No (gating) | Fresh verification required |
| retro | Yes (advisory) | Recommended but not blocking |

If the user asks to skip a gating step, say: "[Step] is a gating step — it cannot be skipped because [reason]."

### 5. Conflict-Check Clean Pass

When conflict-check finds NO conflicts, create a marker file so the conductor knows it ran:

```
.docs/conflicts/YYYY-MM-DD-clean-check.md
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
- Design: .docs/specs/...
- Stories: .docs/stories/...
- Conflicts: .docs/conflicts/...
- Plan: .docs/plans/...
- Architecture: .docs/architecture/...
- Retro: .docs/retros/...

Harness test complete. Review the retro for improvement findings.
```

## Verification

- [ ] Correctly identifies current step from artifact state
- [ ] Status dashboard shows all 15 steps with correct status
- [ ] Gate enforcement blocks progression when quality gates not met
- [ ] Skippable vs non-skippable steps correctly enforced
- [ ] Re-entry works (picks up from current state, doesn't restart)
- [ ] Clean conflict-check creates marker file
- [ ] Completion message shown when all steps done
