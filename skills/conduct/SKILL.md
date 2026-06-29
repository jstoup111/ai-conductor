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
Step 3:  /explore               → DECIDE (context, approaches, + decide product/technical TRACK)
Step 4:  Complexity Assessment   → DECIDE (classify S/M/L, determines which steps run)
Step 5:  Worktree setup          → DECIDE (create feature branch + worktree — all subsequent commits are isolated)
Step 6:  /prd                   → DECIDE (product-only PRD; PRODUCT track only — skipped on technical)
Step 7:  /architecture-diagram  → DECIDE (generate/update current-state diagrams; skipped for Small)
Step 7b: /architecture-review    → DECIDE (skipped for Small, lightweight for Medium — produces ADRs; precedes stories)
Step 8:  /stories               → DECIDE (from PRD FRs on product; technical stories on technical)
Step 9:  /conflict-check        → DECIDE (skipped for Small; root-routes kickback → prd|architecture|stories)
Step 10: /plan                  → DECIDE (technical implementation plan, grounded in the architecture + stories)
Step 11: /writing-system-tests  → BUILD (skipped for Small)
Step 12: /pipeline or /tdd      → BUILD (pipeline evaluator satisfies code-review gate)
       ── CHECKPOINT ──         → User reviews build output, can go back or continue
Step 13: /manual-test           → SHIP (validate stories, bug loop via /tdd — auto-skip for non-endpoint features)
       ── CHECKPOINT ──         → User reviews test results, can go back or continue
Step 14: /prd-audit             → SHIP (PRODUCT track only — audit shipped impl vs PRD FRs; GATE; skipped on technical)
Step 15: /architecture-review --as-built → SHIP (shipped code vs APPROVED ADRs; GATE — BLOCKED on an ADR violation)
Step 16: /retro                 → SHIP
Step 17: /finish                → SHIP (verify, review changes, present options — delegates to /pr if user chooses Push & PR)
```

> **Order note:** architecture (diagram + review) precedes `plan` so the technical
> implementation plan is grounded in the agreed design. This is the canonical `conduct-ts`
> order. The legacy bash `bin/conduct` retains the prior plan→architecture order (its
> `architecture-review` gates on the plan); use `conduct-ts` for the PRD-driven flow.

## Practices

### 1. Assess Current State

Check for these artifacts in order. The **first missing artifact** determines the current step.

| Step | Check | How to Verify |
|------|-------|---------------|
| 1. bootstrap | Project CLAUDE.md exists AND `.memory/` directory exists AND `.docs/` subdirectories exist | Glob for `CLAUDE.md` in project root, check `.memory/index.md`, check `.docs/specs/` exists |
| 2. memory | `.memory/index.md` has been read this session | Memory recall happens automatically — if bootstrap is done, mark this as done |
| 2.5. assess | Assessment report exists OR skipped (new project) | Glob `.docs/decisions/technical-assessment-*.md` or check state is "skipped" |
| 3. explore | Track decided — `.docs/track/*.md` exists (or `state.track` set) | Glob `.docs/track/*.md` / check `state.track`. `explore` is advisory and always runs; it classifies the work product/technical. |
| 3b. prd | PRODUCT track: a spec exists in `.docs/specs/` (not SUPERSEDED). TECHNICAL track: skipped. | If `track == product`: glob `.docs/specs/*.md` (exclude `SUPERSEDED-`). If `track == technical`: step is skipped. |
| 4. complexity | Complexity tier set in `.pipeline/conduct-state.json` | Check `complexity_tier` key exists and is S, M, or L |
| 5. worktree | Feature worktree created | Check `.pipeline/conduct-state.json` worktree state is "done" or "skipped" |
| 6. stories | At least one **accepted** story exists in `.docs/stories/` (not just DRAFT) | Glob `.docs/stories/*.md` — if all stories contain `Status: DRAFT`, this step is pending |
| 7. conflict-check | Conflict report exists in `.docs/conflicts/` OR skipped (Small tier) | Glob `.docs/conflicts/*.md` or check state is "skipped" |
| 8. plan | At least one file exists in `.docs/plans/` | Glob `.docs/plans/*.md` |
| 8b. diagrams | Architecture diagrams exist | Check `.docs/architecture/*.md` exist, or check state is "skipped" |
| 9. architecture-review | Review exists in `.docs/decisions/` OR skipped (Small tier). **All ADRs must be APPROVED** (no DRAFT ADRs remaining). | Glob `.docs/decisions/architecture-review-*.md` or check state is "skipped". Grep `.docs/decisions/adr-*.md` for `Status: DRAFT` — if any DRAFT ADRs exist, this step is pending. |
| 10. writing-system-tests | Acceptance specs exist OR skipped (Small tier) | Glob `spec/integration/*_spec.rb` or `spec/system/*_spec.rb`, or check state is "skipped" |
| 11. build | Implementation tasks completed with passing tests | Check `.pipeline/task-status.json` or test suite passes. Pipeline evaluator satisfies code-review gate. |
| 12. manual-test | Manual test results exist with no FAILs, OR auto-skipped (non-endpoint feature) | Glob `.pipeline/manual-test-results.md` — if file contains FAIL rows, step is pending. **Auto-skip:** If no stories reference HTTP endpoints, API routes, or user-facing UI, skip `/manual-test` and log reason. For internal components (services, background jobs, mailers, CI config), suggest Rails console or script-based smoke test instead. |
| 13. prd-audit | Fresh PRD audit exists with every FR ALIGNED (or human-ACCEPTED) | Glob `.pipeline/prd-audit.md` — if any verdict-table row carries an `FR-N` id with `MISSING`/`PARTIAL`/`DIVERGED` and is not `ACCEPTED`, step is pending. |
| 14. architecture-review-as-built | Fresh as-built review exists with verdict not BLOCKED | Glob `.pipeline/architecture-review-as-built.md` — if the `Verdict:` line is `BLOCKED`, step is pending. |
| 15. retro | Retro report exists in `.docs/retros/` OR skipped (Small tier) | Glob `.docs/retros/*.md` or check state is "skipped" |
| 16. finish | User chose a completion option | Step is "done" in state (`pr_url` saved if Option 2 chosen) |

**Feature completion:** After all steps finish and PR is created, `feature_status` is set to
`"complete"` in `conduct-state.json`. Complete features are excluded from `--resume` menus.

**Worktree cleanup:** On `--resume` or `--cleanup`, conduct checks all worktrees for merged PRs.
If a PR is merged, it offers to: remove the worktree, delete the local branch, and mark complete.
This prevents stale worktrees from accumulating.

### 2. Report Status

Present a clear status dashboard:

```
## SDLC Progress: [Feature Name]

| Phase | Step | Status | Artifact |
|-------|------|--------|----------|
| UNDERSTAND | bootstrap | ✅ Done | CLAUDE.md, .memory/, .docs/ |
| UNDERSTAND | memory | ✅ Done | .memory/index.md |
| DECIDE | explore | ✅ Done | .docs/track/ |
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

**Status icons:**
- `✓` Done — step completed successfully
- `⚠` Stale — step was done but an upstream step was revisited; will re-run automatically
- `→` Skipped — intentionally skipped (tier-dependent)
- `✗` Failed — step failed after retries
- `▶` In progress — currently running
- `⬚` Pending — not yet started

### 2.1 User Validation Checkpoints

The conductor pauses at **harness-level checkpoints** after key steps: **build** and **manual-test**.
These are bash prompts — no Claude session is involved.

```
── Checkpoint: build complete ──
Review the status above and choose:
  c = continue to next step
  b = go back to a previous step
  q = quit (resume later with conduct --resume)
[c/b/q]:
```

Choosing `b` opens a navigation menu listing all completed prior steps. The user picks a step
to revisit. That step is set to `pending` and all downstream steps are marked `stale` (⚠).
The conductor then re-runs from the chosen step forward through all downstream steps.

Checkpoints are skipped in auto mode (`RUN_MODE=auto`) and non-interactive terminals.

### 2.2 Backward Navigation

Available at checkpoints and in the recovery menu (`b = go back`). Presents a numbered menu:

```
Go back to which step?
   1) explore              [done]    DECIDE
   2) stories              [done]    DECIDE
   3) plan                 [done]    DECIDE
   4) tdd/pipeline         [done]    BUILD
   0) Cancel
Choice [0-4]:
```

Only steps with state `done` or `stale` appear (no point navigating to pending/failed/skipped).
On selection, the target step is set to `pending` and all downstream steps become `stale`.
The loop index jumps to the target and re-runs forward from there.

**Stale state:** A stale step was previously completed but an upstream step has been revisited.
Stale steps still satisfy gate requirements (via `step_satisfied()`) but will re-run when the
loop reaches them. This preserves the record that work was done while ensuring it gets refreshed.

### 2.5 Complexity Assessment (after explore, before prd/architecture)

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
| retro | **Skip** | Run | Run |

**Small flow:** explore → [prd if product] → stories → plan → direct /tdd → finish (skip retro)

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

**After architecture-review (before suggesting writing-system-tests):**
- Check all ADR files in `.docs/decisions/adr-*.md` for `Status: DRAFT`
- If ANY DRAFT ADRs exist, BLOCK
- Say: "DRAFT ADRs remain unapproved — [list files]. All ADRs must be APPROVED before BUILD."
- Present DRAFT ADRs for review. Only APPROVED ADRs are binding on implementation.

**After build (before suggesting manual-test):**
- Run the test suite and verify it passes
- Check git status for uncommitted changes
- If tests fail or tree is dirty, BLOCK
- Say: "Build incomplete — [N] tests failing / uncommitted changes exist."

**After prd-audit (before suggesting architecture-review --as-built):**
- Open the audit report (`.pipeline/prd-audit.md`) and check the per-FR verdict table
- If any FR is non-ALIGNED and not human-ACCEPTED, BLOCK
- Route by gap-class: `impl-gap` → back to BUILD to close the gap; `intended-drift` → back to
  DECIDE to amend the PRD, then re-audit
- Say: "PRD audit blocked — [FR-N] is [verdict] ([gap-class]). Return to [BUILD/DECIDE] and re-run `/prd-audit`."
- **Daemon (auto) runs** route this automatically: an all-`impl-gap` audit self-heals back to
  BUILD (bounded, then HALTs if unresolved); any product/plan gap (`intended-drift` or an
  unclassifiable row) HALTs immediately for a human, since the DECIDE amendment can't be made
  autonomously. See `src/conductor/README.md` → "Daemon prd-audit routing".

**After architecture-review --as-built (before suggesting retro):**
- Open the as-built report (`.pipeline/architecture-review-as-built.md`)
- If the verdict is BLOCKED (shipped code violates an APPROVED ADR), BLOCK
- Say: "As-built review blocked — code violates [ADR-N]. Fix the code or supersede the ADR (human-approved), then re-run `/architecture-review --as-built`."

**When pipeline reports task failure:** Verify by running tests before escalating or
re-dispatching. JSON state can become stale — the actual test suite is the source of truth.

### 4. Handle Edge Cases

**Re-entry:** If the user runs `/conduct` mid-flow (e.g., after completing explore), pick up from the current state. Don't restart.

**Skipping steps:** If the user wants to skip a step (e.g., skip explore because they already know what to build), allow it ONLY for advisory-enforcement steps. Gating steps cannot be skipped.

| Step | Can Skip? | Reason |
|------|-----------|--------|
| bootstrap | No (gating) | Other skills need CLAUDE.md and directory structure |
| memory | Yes (advisory) | Fresh project may have no memory |
| assess | Yes (advisory) | Skipped for new projects; optional on-demand for existing |
| explore | Yes (advisory) | Always runs in practice (decides the track); lightweight when the user already knows what to build |
| prd | Track-dependent | Runs on the product track; skipped on the technical track (no product requirements) |
| stories | No (gating) | Negative paths are mandatory for TDD |
| conflict-check | Tier-dependent | Skip for Small, required for Medium/Large |
| plan | No (gating) | Tasks needed for build phase |
| architecture-diagram | Tier-dependent | Skip for Small, required for Medium/Large |
| writing-system-tests | Tier-dependent | Skip for Small (request specs in TDD suffice), required for Medium/Large |
| build | No (structural) | This is the implementation |
| code-review | Tier-dependent | Skip for Small (domain review suffices), required for Medium/Large |
| prd-audit | No (gating) | Shipped impl must be verified against the PRD's FRs before ship |
| architecture-review-as-built | No (gating) | Shipped code must be verified against APPROVED ADRs before ship |
| finish | No (gating) | Fresh verification required |
| retro | Tier-dependent | Skip for Small, recommended for Medium/Large |

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
- [ ] Status dashboard shows all 17 steps with correct status
- [ ] Gate enforcement blocks progression when quality gates not met
- [ ] Skippable vs non-skippable steps correctly enforced
- [ ] Re-entry works (picks up from current state, doesn't restart)
- [ ] Clean conflict-check creates marker file
- [ ] Completion message shown when all steps done
- [ ] Feature marked complete (`feature_status: complete`) after all steps finish
- [ ] `--resume` cleans up worktrees with merged PRs before showing menu
- [ ] `--cleanup` removes worktrees, deletes branches, marks features complete
- [ ] Resume menu and interactive prompts offer quit option
- [ ] Checkpoints pause after build and manual-test (interactive mode only)
- [ ] Backward navigation menu shows completed steps with labels and phases
- [ ] Navigating back marks target as pending, downstream as stale
- [ ] Stale steps re-run when the loop reaches them
- [ ] Stale steps satisfy gate checks (step_satisfied)
- [ ] Recovery menu includes `b = go back` option
- [ ] Checkpoints skipped in auto mode
