# Retro: Daemon Owner-Gating for Autonomous Spec Builds
**Date:** 2026-06-30 | **Stats:** 19 plan tasks (built as 4 groups), 1 rework cycle, 1 (expected) human decision, 2530 tests passing

## Part A: Harness

- **H-1:** The Critical write-side wiring bug escaped ALL TDD gates — `landSpec` gained an
  `opts.ownerConfig`/`gh` seam and stamped correctly in unit tests, but its only real caller
  (`engineer-cli.ts` `case 'land'`) passed no opts, so no spec was ever stamped in production. All 4
  build groups reported green (2523 passing) with the write half dead. Caught only by the
  fresh-context code-review evaluator. Severity: **Critical (escaped)**. This is the recurring
  "orphaned primitive" pattern: a green suite tests a new primitive in isolation while the live
  caller still uses the old shape. Fix: `writing-system-tests`/`tdd` must require an end-to-end
  *caller-seam* test whenever a task adds a parameter to an existing function — assert the real
  entry point threads it (a test that fails if the wiring is reverted). See H-2.
- **H-2 (Gate Quality):** No false positives. One high-value **false-negative catch** — the Opus
  fresh-context evaluator found H-1 that four TDD subagents missed. Calibration is correct; the
  lesson is upstream (H-1), not evaluator tuning. Keep the mandatory fresh-context review for any
  feature that adds a parameter/seam to an existing call path.
- **H-3 (Autonomy):** No preventable interventions. The single human decision (null-cutover default
  = skip vs build) was a genuine product/security trade-off the PRD left ambiguous — expected, not
  a skill gap.

**Proposed changes:**
- [ ] H-1: Add to `skills/writing-system-tests/SKILL.md` (and the tdd domain-review checklist) a
  "caller-seam" rule — any new/extended function parameter needs a test through the real production
  entry point, not just the unit; the test must fail if the call site is reverted.

## Part B: Application

- **A-1:** `runAuthoring` (`src/conductor/src/engine/engineer/authoring.ts:518`) stamps a `null`
  owner — the autonomous authoring path records no owner. Currently confined to the test/scripted
  `runEngineerMode` harness (not the live CLI), so no production path ships unstamped. Severity:
  **Latent debt.** If the autonomous engineer loop is ever productionized, its specs will be
  un-owned and silently skipped post-cutover.
- **A-2:** The "owner-gate active but no cutover configured" warn-once
  (`src/conductor/src/engine/daemon-backlog.ts:266-274`) fires once per pass even when every
  eligible spec is owned-and-matching (nothing would actually skip). Severity: **Minor** (mildly
  noisy, accurate). Optional: only emit when the pass actually skipped ≥1 spec for
  `unowned-indeterminate`.
- **B-2 (Test Quality):** The missing coverage that let H-1 ship green was the absence of a
  land-spec CLI-seam test. Now closed by `test/engine/engineer/engineer-cli-land-owner.test.ts`
  (drives `dispatchEngineer` land → committed marker). No remaining acceptance criteria are
  untested.

**Proposed changes:**
- [ ] A-1: New story — "Autonomous authoring path stamps the resolved owner" — thread owner
  resolution into `runAuthoring`/`authoring.ts` before the autonomous engineer loop is
  productionized. Track; not blocking this ship.
- [ ] A-2: Optionally gate the no-cutover notice on an actual un-owned skip occurring in the pass.

## Part C: Context Efficiency

- **C-1:** Build ran as 4 sequential subagent groups (forced sequential to avoid `.git/index.lock`
  collisions on shared-worktree commits), then 1 fix + code-review + re-review + 3 parallel PRD
  auditors + 1 as-built ≈ 11 dispatches. Proportionate for a Medium auth-boundary feature; the
  parallel PRD auditors (read-only, scoped by FR-cluster) were the efficient choice over 14
  per-FR dispatches.
- **C-2:** Model use was well-targeted — Opus reserved for the two review passes + as-built (auth
  boundary justifies it); build/audit groups ran on the default tier. No downgrade opportunity
  missed; no upgrade needed.
- **C-3:** The sequential-commit constraint is the main wall-clock cost. For a future feature of
  this shape, `isolation: 'worktree'` per build group (or a Workflow with worktree isolation) would
  let independent modules commit in parallel — worth it only when groups are ≥4 and truly
  file-disjoint (as here). Not worth the setup cost below that threshold.

**Proposed changes:**
- [ ] C-3: When a plan has ≥4 file-disjoint build groups, note worktree-isolated parallel build as
  an option in `skills/pipeline/SKILL.md` (cost/benefit threshold guidance).

## Trends
- Third confirmed instance of the "orphaned primitive / unwired seam escapes green TDD" pattern
  (prior: Phase 9 negative-path gaps, injected-runner argv). The fresh-context evaluator caught it
  again — the durable fix is the H-1 caller-seam test rule, not more review.
