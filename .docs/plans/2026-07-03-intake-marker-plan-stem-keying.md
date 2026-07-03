# Implementation Plan: intake-marker plan-stem keying (fix ai-conductor#207)

**Date:** 2026-07-03
**Design:** technical track — no PRD; intent captured in `.docs/track/2026-07-03-intake-marker-plan-stem-keying.md`
**Stories:** `.docs/stories/2026-07-03-intake-marker-plan-stem-keying.md`
**Conflict check:** skipped (Tier S)

## Summary

Converge the interactive `engineer land` intake-marker write onto the daemon's plan-stem
key via a shared `planStem()` helper. 10 tasks.

## Technical Approach

The daemon keys every per-spec read by `basename(<plans file>, '.md')`
(`daemon-backlog.ts:366`); the conduct path already writes markers by that stem
(`conductor.ts:1608`); autonomous authoring is self-consistent. Only `landSpec`
(`src/engine/engineer/land-spec.ts`) keys the marker by `slugify(idea)` (line ~282,
write at ~291). Crucially, `landSpec` has already resolved `planFile` (via
`findNewestFile(plansDir)`, ~line 195) and thrown if it's missing — so the fix is to
derive the marker slug from that plan file instead of the idea text.

- New exported helper `planStem(planFilePath: string): string` in `src/engine/artifacts.ts`
  (already imported by both writer and reader modules; if import direction is awkward,
  a tiny new `src/engine/plan-stem.ts` is acceptable — helper location is the only
  discretionary point).
- `land-spec.ts` passes `planStem(planFile)` to `writeIntakeMarker`. `slugify(idea)`
  remains for branch/worktree naming and the returned `slug` field (display/ledger) —
  only the marker filename changes.
- `conductor.ts` (~1608) and `daemon-backlog.ts` (~366) replace their inline
  `basename(file, '.md')` with the shared helper — pure refactor, no behavior change.
- No reader-side fallback: legacy idea-slug markers stay un-owned by design (healed
  manually per the #206/#248 pattern).

Sequencing: helper first (infrastructure), then RED→GREEN on the land write, then the
negative pins, then the reader-side refactor, then end-to-end integration, then docs.

## Prerequisites

- `npm install` inside `src/conductor` for this worktree (per-worktree node_modules).
- Run tests with `rtk proxy npx vitest run <file>` (RTK swallows vitest output otherwise).

## Tasks

### Task 1: `planStem()` helper + unit test
**Story:** Story 2 (happy + interior-dot negative)
**Type:** infrastructure

**Steps:**
1. Write failing test: `planStem('/x/.docs/plans/phase-9.3b-intake.md') === 'phase-9.3b-intake'`, `planStem('a/2026-07-03-foo.md') === '2026-07-03-foo'` (only trailing `.md` stripped).
2. Verify RED.
3. Implement `export function planStem(planFilePath: string): string` = `basename(planFilePath, '.md')` in `src/engine/artifacts.ts`.
4. Verify GREEN.
5. Commit: "feat(engine): planStem() — single plan-stem derivation for intake-marker keying"

**Files likely touched:**
- `src/engine/artifacts.ts` — add helper
- `test/engine/artifacts.test.ts` — unit tests (create describe block if absent)

**Dependencies:** none

### Task 2: RED — land keys marker by plan stem (source-ref variant)
**Story:** Story 1, happy path #1
**Type:** happy-path

**Steps:**
1. In `test/engine/engineer/land-spec.test.ts`, add a case: worktree with plan `.docs/plans/2026-07-03-some-feature.md`, idea text whose `slugify(idea)` ≠ that stem, `--source-ref owner/repo#1`. Assert committed marker path is `.docs/intake/2026-07-03-some-feature.md`, contains `Source-Ref:` + `Owner:`, and `.docs/intake/<slugify(idea)>.md` does NOT exist.
2. Verify RED (marker currently lands under the idea slug).

**Files likely touched:**
- `test/engine/engineer/land-spec.test.ts`

**Dependencies:** Task 1

### Task 3: GREEN — land-spec uses `planStem(planFile)`
**Story:** Story 1, happy path #1
**Type:** happy-path

**Steps:**
1. In `land-spec.ts`, pass `planStem(planFile)` to `writeIntakeMarker` (planFile is non-null past the C2 gate). Keep `slugify(idea)` for the returned `slug`/branch semantics.
2. Verify Task 2 test passes; run the full land-spec suite.
3. Commit: "fix(engineer): land keys intake marker by plan stem, not idea slug (#207)"

**Files likely touched:**
- `src/engine/engineer/land-spec.ts` — marker slug derivation

**Dependencies:** Task 2

### Task 4: no-source-ref variant still owner-stamps under plan stem
**Story:** Story 1, happy path #2
**Type:** happy-path

**Steps:**
1. Write test: land with `sourceRef: undefined` (chat/CLI idea) → marker at `.docs/intake/<plan-stem>.md` with `Owner:` line, no `Source-Ref:` line.
2. Verify GREEN (should pass after Task 3; if RED, fix within Task 3's change).
3. Commit with Task 5 or standalone.

**Files likely touched:**
- `test/engine/engineer/land-spec.test.ts`

**Dependencies:** Task 3

### Task 5: retry preserves pre-existing Source-Ref under the new key
**Story:** Story 1, happy path #3
**Type:** happy-path

**Steps:**
1. Write test: pre-seed `.docs/intake/<plan-stem>.md` with `Source-Ref: owner/repo#9`; run land with a different/absent sourceRef; assert `Source-Ref: owner/repo#9` survives (existing `writeIntakeMarker` preservation now exercised under the plan-stem key).
2. Verify GREEN.
3. Commit: "test(engineer): land retry preserves Source-Ref under plan-stem marker"

**Files likely touched:**
- `test/engine/engineer/land-spec.test.ts`

**Dependencies:** Task 3

### Task 6: NEGATIVE — no plan file → loud failure, no marker under any name
**Story:** Story 1, negative #1
**Type:** negative-path

**Steps:**
1. Write test: worktree with stories but no `.docs/plans/*.md` → `landSpec` rejects (error names the missing plan) AND `.docs/intake/` gained no file (pins that the marker write stays AFTER the C2 artifact gate — no idea-slug fallback path exists).
2. Verify GREEN (ordering already holds; the test pins it).
3. Commit: "test(engineer): land without plan writes no intake marker"

**Files likely touched:**
- `test/engine/engineer/land-spec.test.ts`

**Dependencies:** Task 3

### Task 7: NEGATIVE — multi-plan worktree keys to the resolved plan
**Story:** Story 1, negative #2
**Type:** negative-path

**Steps:**
1. Write test: worktree containing an older `.docs/plans/other-idea.md` (backdated mtime) plus this idea's newer plan; land → marker exists only at `.docs/intake/<this-plan-stem>.md`; `other-idea` gains no marker.
2. Verify GREEN.
3. Commit: "test(engineer): multi-plan worktree — marker keys to the land-resolved plan"

**Files likely touched:**
- `test/engine/engineer/land-spec.test.ts`

**Dependencies:** Task 3

### Task 8: adopt `planStem()` at both reader/writer sites (refactor)
**Story:** Story 2, happy path + Done When grep clause
**Type:** refactor

**Steps:**
1. Replace inline `basename(planFile, '.md')` at `conductor.ts` (~1608) and `basename(file, '.md')` backlog-slug derivation at `daemon-backlog.ts` (~366) with `planStem()` imports.
2. Run `test/engine/conductor-owner-stamp.test.ts` + `test/engine/daemon-backlog.test.ts` — zero behavior change expected.
3. Grep: no remaining inline `.md`-strip derivations at the three contract sites.
4. Commit: "refactor(engine): conductor + daemon-backlog derive marker keys via planStem()"

**Files likely touched:**
- `src/engine/conductor.ts`, `src/engine/daemon-backlog.ts`

**Dependencies:** Task 1 (parallel with Tasks 2–7)

### Task 9: integration — discovery resolves owner + sourceRef; legacy mismatch stays un-owned
**Story:** Story 3, happy path + negative
**Type:** happy-path + negative-path (two test cases, one task)

**Steps:**
1. Write test in `test/engine/daemon-backlog.test.ts` (or the intake acceptance suite): commit a land-shaped spec set where plan stem ≠ idea slug with marker under the plan stem → `discoverBacklog` item has owner stamp resolved (not skipped un-owned) and `sourceRef` populated.
2. Write sibling case: marker committed ONLY under a mismatched idea slug → spec reads un-owned with the existing skip reason, `sourceRef` undefined (pins no-fallback scope).
3. Verify both GREEN.
4. Commit: "test(daemon): land-authored spec resolves owner + sourceRef at discovery; legacy mismatch unchanged"

**Files likely touched:**
- `test/engine/daemon-backlog.test.ts`

**Dependencies:** Task 3, Task 8

### Task 10: CHANGELOG + docs
**Story:** all (harness repo release gate)
**Type:** infrastructure

**Steps:**
1. Add `CHANGELOG.md` `[Unreleased]` → Fixed: "engineer land keys the intake marker by the plan stem (was idea slug), so owner-gate and issue auto-close resolve land-authored specs (#207)". No Migration block (no schema/CLI/hook change; existing mis-keyed markers are already renamed on main).
2. Touch `src/conductor/README.md` only if it documents the marker filename (grep; likely no change).
3. Run `test/test_harness_integrity.sh`.
4. Commit: "docs: changelog for intake-marker plan-stem fix"

**Files likely touched:**
- `CHANGELOG.md`

**Dependencies:** Tasks 1–9

## Task Dependency Graph

```
Task 1 ──► Task 2 ──► Task 3 ──► Task 4
   │                    ├──────► Task 5
   │                    ├──────► Task 6
   │                    ├──────► Task 7
   └──► Task 8 ────────►└──────► Task 9 ──► Task 10
```

## Integration Points

- After Task 3: a real `engineer land` run in a scratch repo writes the marker under the plan stem (manually verifiable).
- After Task 9: full loop — land-authored spec passes owner-gate and carries Source-Ref at daemon discovery.

## Coverage Mapping

| Acceptance criterion | Task(s) |
|---|---|
| S1 happy: marker at plan stem w/ Source-Ref + Owner, no idea-slug file | 2, 3 |
| S1 happy: no source-ref → Owner-stamped plan-stem marker | 4 |
| S1 happy: retry preserves existing Source-Ref | 5 |
| S1 neg: no plan → loud fail, no marker | 6 |
| S1 neg: multi-plan → keys to resolved plan | 7 |
| S2 happy: single shared helper at all three sites | 1, 8 |
| S2 neg: interior-dot filename identical everywhere | 1 |
| S3 happy: discovery resolves owner + sourceRef | 9 |
| S3 neg: legacy idea-slug marker stays un-owned (no fallback) | 9 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
