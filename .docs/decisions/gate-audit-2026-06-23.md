# Gate-Grade Audit — Gate-Driven Loop (Phase 0)

**Date:** 2026-06-23
**Scope:** Looped region (`build`, `manual_test`, `retro`, `finish`) + kickback targets
(`plan`, `stories`). Plan: `~/.claude/plans/what-is-a-feasible-enumerated-cookie.md`.

## Purpose

The gate-driven loop replaces the conductor's fixed linear walk with a selector that picks the
**earliest unsatisfied gate** from durable verdicts. That only works if each gate is **loop-grade**:

1. **Machine-checkable** — a verdict computable from files, no human reading output.
2. **Idempotent** — re-running a satisfied step is a no-op (the check still passes; nothing churns).
3. **Verdict-emitting** — writes `{satisfied, reason, checkedAt}` to `.pipeline/gates/<id>.json`.

This audit classifies every relevant gate **loop-ready / needs-hardening / inherently-human** and
specifies the concrete check + verdict each needs. It is the blueprint for Phase 2 (verdict layer)
and Phase 3 (selector).

## Where gates live today

- `engine/gates.ts::checkGate` — **prerequisite ordering only** (`def.prerequisites` all
  `stepSatisfied`). Not a content verdict; it answers "are upstream steps done?", not "is this step's
  output good?". Reused as the **dependency edges** of the gate graph, not as a verdict.
- `engine/artifacts.ts::checkStepCompletion` — the **real content verdict**. Runs a
  `CUSTOM_COMPLETION_PREDICATES[step]` if present, else falls back to **glob presence**
  (`STEP_ARTIFACT_GLOBS`). This is what the loop's verdict layer wraps.
- `engine/complete-verifier.ts::verifyCompleteState` — re-runs SHIP predicates against disk for a
  worktree claiming `complete`. **This is the deterministic re-check pattern the loop reuses** after
  each step (the loop owns objective verdicts; agent self-reports are not trusted).

## Classification

| Gate | Enforcement | Current check | Class | Verdict file |
|---|---|---|---|---|
| `build` | gating | predicate: no `HALT_MARKER` + every task in `task-status.json` `completed`/`skipped` | **loop-ready** | `.pipeline/gates/build.json` |
| `manual_test` | gating | predicate: `manual-test-results.md` exists, no `\| FAIL`, fresh-since-session | **loop-ready** | `.pipeline/gates/manual_test.json` |
| `retro` | advisory | predicate: fresh slug-matched `.docs/retros/*.md` | **loop-ready** (advisory; skip Small tier) | `.pipeline/gates/retro.json` |
| `finish` | gating | predicate: fresh `finish-choice` ∈ {pr,merge-local,keep,discard}; if `pr`, `state.pr_url` set | **loop-ready (attended)** / **needs-hardening (daemon)** | `.pipeline/gates/finish.json` |
| `plan` | gating | **glob presence only** (`.docs/plans/*.md` exists) | **needs-hardening** | `.pipeline/gates/plan.json` |
| `stories` | gating | **glob presence only** (`.docs/stories/**/*.md` exists) | **needs-hardening** | `.pipeline/gates/stories.json` |

## Per-gate detail

### build — loop-ready ✓
- **Check (reuse as-is):** `CUSTOM_COMPLETION_PREDICATES.build` — HALT marker absent AND all tasks
  `completed`/`skipped` in `.pipeline/task-status.json`. Emits a precise `reason` already.
- **Idempotent:** yes — re-check reads the same file; no side effects.
- **Verdict:** persist the existing `{done, reason}` as `{satisfied: done, reason, checkedAt}`.

### manual_test — loop-ready ✓
- **Check (reuse):** `CUSTOM_COMPLETION_PREDICATES.manual_test` — file present, no `FAIL` rows, fresh.
- **Kickback source:** a `FAIL` row is the canonical "bug → re-open build" signal (today's
  manual-test→tdd loop). In the gate loop, a FAIL leaves `build` work to redo; if the failure is a
  spec/plan defect, the step proposes a **kickback to plan** (evidence = the failing story).

### retro — loop-ready ✓ (advisory)
- **Check (reuse):** `CUSTOM_COMPLETION_PREDICATES.retro` — fresh slug-matched retro. Advisory and
  skippable for Small tier, so the selector treats an unsatisfied `retro` as non-blocking when
  config/tier disables it.

### finish — loop-ready (attended); needs-hardening (daemon)
- **Check (reuse):** `CUSTOM_COMPLETION_PREDICATES.finish` — fresh `finish-choice` + `pr_url` for `pr`.
- **Hardening for daemon:** the choice is interactive today. In unattended mode the daemon must
  **pre-set `finish-choice='pr'`** and the finish step must open the PR non-interactively and record
  `pr_url` — **never `merge-local`** (standing rule: never auto-merge). Attended mode is unchanged.

### plan — needs-hardening (kickback target)
- **Gap:** only checks a plan file *exists*. The loop needs: **every story is covered by ≥1 task.**
- **Real conventions found** (e.g. `.docs/plans/2026-05-01-wave-c-json-stdout-subscriber.md`):
  - Each task block (`### Task N:`) carries a `**Story:** <id> (happy path — …)` reference line.
  - The plan ends with a `## Coverage Check` table: `| Story | Criterion | Task(s) |`, plus an
    "All N criteria covered ✅" assertion.
  - Story IDs come in two shapes: multi-story files use `## Story 3.2-1:` headings; single-story
    feature files (`.docs/stories/features/**/ST-0NN-*.md`) are one story per file (ID = `ST-0NN`).
- **New predicate (`plan` verdict) — story-ID cross-reference (no fuzzy AC parsing):**
  1. Enumerate story IDs from the stories file(s): every `## Story <id>` heading, or the `ST-0NN`
     id for single-story files.
  2. Collect coverage references from the plan: all `**Story:** <id>` task lines **and** the IDs in
     the `## Coverage Check` table.
  3. `satisfied` iff every story's coverage is met at the chosen granularity; `reason` lists gaps.
  - **Strictness — DECIDED (review, 2026-06-23): per path-type.** Require each story's **happy path
    AND negative path** to each be covered by ≥1 task. Source of truth: the `(happy path …)` /
    `(negative path …)` qualifier on task `**Story:**` lines and the `## Coverage Check` table rows
    (e.g. `3.2-1 happy`, `3.2-1 negative`). **Fallback:** if a plan lacks path-type markers, degrade
    to story-level (any task citing the story covers it) rather than false-failing. This catches the
    common "negative path has no task" gap without per-bullet fragility.
- **Idempotent:** yes — pure read of stories+plan.
- **Inherently-human residue:** *whether the plan's approach is correct* is not machine-checkable —
  that's what **kickback** handles (build/manual-test propose `plan` invalidation with evidence;
  daemon HALTs for sign-off). The gate enforces **coverage**, not **correctness**.

### stories — needs-hardening (kickback target)
- **Gap:** only checks a story file *exists*. The loop needs: **each story has a happy AND a negative
  path, and no `DRAFT` status.**
- **Real conventions found** (e.g. `.docs/stories/wave-c-json-stdout-subscriber.md`,
  `.docs/stories/features/tdd/ST-019-red-green-cycle.md`):
  - `**Status:** Accepted | ACCEPTED` near the top (DRAFT would read `**Status:** DRAFT`).
  - Explicit `### Happy Path` and `### Negative Paths` headings (sometimes `####`), each with
    `Given … when … then …` bullets.
  - Multi-story files split on `## Story <id>:`; single-story files have one `## Acceptance Criteria`.
- **New predicate (`stories` verdict) — structural, not keyword-guessing:**
  1. Split into story blocks (`## Story …`) or treat the whole file as one story.
  2. Reject if `**Status:**` is `DRAFT`.
  3. For each block: require a Happy-Path heading with ≥1 Given/When/Then bullet **and** a
     Negative-Path(s) heading with ≥1 bullet.
  4. `satisfied` iff every block passes; `reason` names the offending file/story + what's missing.
- **Idempotent:** yes — pure read.
- **Inherently-human residue:** *whether the stories capture the right scope* — handled by kickback
  ("critical functionality left out" → invalidate `stories`), not the gate.

## Gate graph (dependency edges + kickback edges)

Derived from `def.prerequisites` (ordering) plus the kickback edges this project adds:

```
stories → plan → acceptance_specs → build → manual_test → retro → finish
                  ▲                   │           │
                  └─── kickback ──────┴───────────┘   (build/manual_test may invalidate plan)
   ▲                                  │
   └────────── kickback ──────────────┘               (missing functionality may invalidate stories)
```

- **Selector order** = topological order of the resolved-config step list (Phase 3 derives this from
  `resolved-config.ts`, NOT a hardcoded list, so YAML custom steps/skips/overrides still apply).
- **Kickback cap:** ≤2 invalidations per gate per feature (anti ping-pong); exceeding → HALT.

## Summary of work this unblocks

- **Reuse unchanged (Phase 2 just persists their result as a verdict):** `build`, `manual_test`,
  `retro`, `finish` predicates.
- **New predicates to write (Phase 2):** `plan` (AC→task coverage), `stories` (happy+negative, no
  DRAFT).
- **Daemon hardening (Phase 6):** `finish` non-interactive default `finish-choice='pr'`.
- **Principle:** gates enforce **structural completeness** (coverage, no-FAIL, no-DRAFT, tasks-done);
  **semantic correctness** stays with kickback + human sign-off. The loop never asks a gate to make a
  judgment call it can't compute.

## Review outcome (2026-06-23)

Audit reviewed against real artifacts (`.docs/stories/**`, `.docs/plans/**`). Findings confirmed the
conventions are structured enough for reliable predicates (no fuzzy NLP needed). One decision taken:
- **`plan` coverage granularity = per path-type** (happy + negative per story), with story-level
  fallback. See the `plan` section.
`stories` and the four reused predicates need no further decisions. Phase 2 may proceed to implement
`gate-verdicts.ts` + the `plan`/`stories` predicates exactly as specified here.

