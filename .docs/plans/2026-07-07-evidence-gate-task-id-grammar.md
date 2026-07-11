# Implementation Plan: Evidence-Gate Task-Id Grammar Unification (#417)

**Date:** 2026-07-07
**Design:** .docs/decisions/adr-2026-07-07-task-trailer-id-alias.md (APPROVED); review: .docs/decisions/architecture-review-2026-07-07-evidence-gate-task-id-grammar.md
**Stories:** .docs/stories/2026-07-07-evidence-gate-task-id-grammar.md (Accepted)
**Conflict check:** Clean as of 2026-07-07

## Summary

Unify the Task-trailer id grammar so daemon builds can satisfy the evidence gate: an
ambiguity-guarded `task-<id>` ≡ `<id>` alias in `deriveCompletion`, one id grammar and
COMMIT trailer discipline in the tdd/pipeline skill contracts, and an operator-gated
recovery runbook for the two parked features. 12 tasks.

## Technical Approach

- **One helper, two predicates.** Add `taskTrailerMatches(trailerValues, taskId, planIds)`
  to `src/conductor/src/engine/autoheal.ts`: returns true on exact `taskId` match, or on
  `task-${taskId}` when `planIds` does not contain `task-${taskId}` (ambiguity guard).
  Both `commits.find` predicates in `deriveCompletionInternal` (the Evidence-commit
  scan and the plain-trailer scan) call it — no duplicated grammar logic (review
  condition 2). `planIds` is derived once per run from `parsePlanTaskPaths` keys
  already in scope. Exact match keeps precedence trivially (the helper checks it
  first); all downstream behavior (empty-commit rejection, dangling-SHA validation,
  path corroboration, sidecar stamp forms) is untouched by construction because the
  helper only widens *which commit is found*, not what happens after.
- **Skill contracts converge on the bare plan id.** `skills/tdd/SKILL.md` COMMIT gate
  item 7 gains the id-source rule + `task-N` ban + subject⇒trailer discipline; the
  "Commit-less Completions" section is rewritten from report-trailers to the engine's
  empty-commit form. `skills/pipeline/SKILL.md` steps 2/5 state the bare plan id and
  the progress-log example drops `task-N` ids.
- **Recovery is documentation, not code.** `docs/runbooks/evidence-backfill-recovery.md`
  carries the per-feature procedure (alias resolves prefixed trailers; each remaining
  task gets an operator-verified `--allow-empty` commit with `Task: <id>` +
  `Evidence: satisfied-by <sha>`; refusal rules for unverifiable work and unreachable
  SHAs).
- **Sequencing:** helper + tests first (engine core), then skill edits (validated by
  the integrity suite), then runbook + CHANGELOG. Tests live in
  `src/conductor/test/engine/autoheal.test.ts` alongside the existing derive suite.

## Prerequisites

- None. Engine-owned task-status (H1–H9) is already on main; no migrations, no config.

## Tasks

### Task 1: Alias helper with ambiguity guard (RED)
**Story:** Story 1 — happy paths 1–3, negative "alias never invents ids"
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/autoheal.test.ts` for a new
   exported `taskTrailerMatches(trailerValues: string[], taskId: string, planIds: Set<string>)`:
   exact match true; `['task-7']` vs id `7` with planIds `{7}` true; `['task-7']` vs id
   `7` with planIds `{7, 'task-7'}` false; `['task-42']` vs id `42` absent from planIds
   never consulted for foreign ids (helper is per-task; no invention possible); bare
   `['7']` vs id `7` true regardless of planIds.
2. Verify RED.
3. Implement the helper in `src/conductor/src/engine/autoheal.ts` (exact first, then
   guarded alias).
4. Verify GREEN.
5. Commit: "feat(autoheal): taskTrailerMatches helper with ambiguity-guarded task-N alias"

**Files likely touched:**
- `src/conductor/src/engine/autoheal.ts` — new exported helper
- `src/conductor/test/engine/autoheal.test.ts` — unit tests

**Dependencies:** none

### Task 2: Wire helper into the plain-trailer predicate
**Story:** Story 1 — happy path 1 (non-empty aliased commit completes with sidecar stamp)
**Type:** happy-path

**Steps:**
1. Write failing integration test (temp git repo fixture, plan `### Task 7:` with a
   backticked path, commit touching that path with trailer `Task: task-7`): derive
   completes task `7`, `evidencedBy` = SHA, sidecar form `trailer`.
2. Verify RED.
3. Replace the exact-match `taskTrailers.includes(taskId)` in the plain-trailer
   `commits.find` with `taskTrailerMatches(taskTrailers, taskId, planIds)`.
4. Verify GREEN.
5. Commit: "feat(autoheal): plain-trailer predicate accepts guarded task-N alias"

**Files likely touched:**
- `src/conductor/src/engine/autoheal.ts` — predicate swap in `deriveCompletionInternal`
- `src/conductor/test/engine/autoheal.test.ts` — integration case

**Dependencies:** 1

### Task 3: Wire helper into the Evidence-commit predicate
**Story:** Story 1 — happy path 2 (empty aliased commit with satisfied-by completes)
**Type:** happy-path

**Steps:**
1. Write failing test: empty commit with `Task: task-13` + `Evidence: satisfied-by
   <reachable sha>` completes plan id `13` with form `evidence:satisfied-by`.
2. Verify RED.
3. Swap the Evidence-commit `commits.find` exact match for the helper.
4. Verify GREEN.
5. Commit: "feat(autoheal): evidence-commit predicate accepts guarded task-N alias"

**Files likely touched:**
- `src/conductor/src/engine/autoheal.ts` — second predicate swap
- `src/conductor/test/engine/autoheal.test.ts` — evidence-form case

**Dependencies:** 1

### Task 4: Ambiguity-guard integration test (literal task-N plan id)
**Story:** Story 1 — negative path 1 (no cross-match, no double-credit)
**Type:** negative-path

**Steps:**
1. Write test: plan declaring `### Task 7:` AND `### Task task-7:`; one commit with
   trailer `Task: task-7` touching task-7's declared path. Assert: plan id `task-7`
   completes; plan id `7` stays incomplete.
2. Verify it passes against Tasks 2–3 implementation (if RED, the guard is wrong — fix
   in the helper only).
3. Commit: "test(autoheal): alias suppressed when plan declares literal task-N id"

**Files likely touched:**
- `src/conductor/test/engine/autoheal.test.ts` — adversarial case

**Dependencies:** 2, 3

### Task 5: Unchanged-rejection regression tests (empty, dangling, path-miss)
**Story:** Story 1 — negative paths 2–4
**Type:** negative-path

**Steps:**
1. Write tests (aliased spelling throughout): empty commit `Task: task-9` without
   `Evidence:` → incomplete + existing audit entry; empty commit `Task: task-4` +
   `Evidence: satisfied-by deadbeef` (unreachable) → incomplete + dangling audit entry;
   commit `Task: task-6` touching none of task 6's declared paths → incomplete +
   path-corroboration audit entry.
2. Verify all pass with no production change (RED here means the alias loosened a
   rejection — fix the wiring, never the assertions).
3. Commit: "test(autoheal): alias inherits empty/dangling/path-corroboration rejections"

**Files likely touched:**
- `src/conductor/test/engine/autoheal.test.ts` — three regression cases

**Dependencies:** 2, 3

### Task 6: Parked-shape fixture test (16-of-19 resolution)
**Story:** Story 1 — Done When 3
**Type:** negative-path

**Steps:**
1. Write test building a 19-task plan fixture where commits carry `Task: task-{1..4,
   6..8,11..19}` trailers (the audit-trail shape) and tasks 5, 9, 10 have no trailer on
   any commit. Assert derive resolves exactly the 16 and leaves `5`, `9`, `10`
   incomplete.
2. Verify GREEN (documents the recovery boundary the runbook cites).
3. Commit: "test(autoheal): parked-feature shape resolves 16/19 via alias"

**Files likely touched:**
- `src/conductor/test/engine/autoheal.test.ts` — fixture case

**Dependencies:** 2, 3

### Task 7: tdd SKILL.md — id source rule + task-N ban + subject⇒trailer discipline
**Story:** Story 2 — happy path 1, negative path 1
**Type:** infrastructure

**Steps:**
1. Edit `skills/tdd/SKILL.md` COMMIT hard-gate item 7: state the trailer id IS the plan
   header id (`### Task 7:` → `Task: 7`), explicitly forbid the `task-N` spelling, and
   add the discipline item: a commit whose subject references a task id without the
   matching `Task:` trailer FAILS the checklist (amend before proceeding). Keep the
   `Task: 42` example.
2. Run `test/test_harness_integrity.sh` — must exit 0.
3. Commit: "fix(skills): tdd COMMIT gate — plan-id trailer grammar + subject⇒trailer discipline"

**Files likely touched:**
- `skills/tdd/SKILL.md` — COMMIT gate wording

**Dependencies:** none

### Task 8: tdd SKILL.md — Evidence section rewritten to the empty-commit form
**Story:** Story 2 — happy path 2, negative path 2
**Type:** infrastructure

**Steps:**
1. Rewrite the "Commit-less Completions: Evidence Trailers" section: forms are emitted
   as `git commit --allow-empty` carrying `Task: <id>` plus `Evidence: satisfied-by
   <sha>` / `Evidence: skipped <reason>`; delete every instruction to put Evidence:
   forms in a task report; state the engine reads commits only.
2. `grep -n 'task report' skills/tdd/SKILL.md` shows no Evidence-related hits; run
   `test/test_harness_integrity.sh`.
3. Commit: "fix(skills): tdd Evidence forms are no-op commits, not report lines"

**Files likely touched:**
- `skills/tdd/SKILL.md` — Evidence section

**Dependencies:** 7

### Task 9: pipeline SKILL.md — dispatch/COMMIT grammar + example fix
**Story:** Story 3 — all criteria
**Type:** infrastructure

**Steps:**
1. Edit `skills/pipeline/SKILL.md`: step 2 DISPATCH and step 5 COMMIT state the
   injected/verified trailer id is the bare PLAN header id with `task-N` called out as
   wrong (subagent amends the commit before PASS — never edits task-status.json);
   progress-log example ids become bare (`1 (User model), 2 (registration endpoint)`,
   `Next: 3 (authentication)`).
2. Verify `rtk proxy grep -E 'task-[0-9]' skills/pipeline/SKILL.md` returns nothing;
   run `test/test_harness_integrity.sh`.
3. Commit: "fix(skills): pipeline dispatch/verify use bare plan ids; example de-drifted"

**Files likely touched:**
- `skills/pipeline/SKILL.md` — steps 2/5 + progress-log example

**Dependencies:** none

### Task 10: Recovery runbook
**Story:** Story 4 — all criteria
**Type:** infrastructure

**Steps:**
1. Write `docs/runbooks/evidence-backfill-recovery.md`: per-feature procedure for
   `audit-trail-write-completeness-for-retro-under-fre` and
   `fix-400-stale-engine-respawn-in-place-stacks-daemo` — refresh worktree per rebase
   policy, run the gate to list unresolved tasks, verify work per task and identify the
   satisfying branch-local SHA, append `git commit --allow-empty -m "chore(evidence):
   backfill task <id>" -m "Task: <id>" -m "Evidence: satisfied-by <sha>"`, then
   `conduct daemon unpark <feature>`. Include expected unresolved sets (audit-trail 5,
   9, 10; fix-400 tasks 3, 13 + unattributed remainder) and both refusal rules
   (unverifiable work → kickback, never guess; unreachable SHA → gate rejects).
2. Verify the file renders and the commands are copy-pasteable (shellcheck-clean
   fenced blocks not required — commands only).
3. Commit: "docs(runbooks): operator-gated evidence backfill for parked features"

**Files likely touched:**
- `docs/runbooks/evidence-backfill-recovery.md` — new runbook

**Dependencies:** 6 (cites the resolution boundary the fixture pins)

### Task 11: CHANGELOG entry
**Story:** Story 5 — happy path 1
**Type:** infrastructure

**Steps:**
1. Add under `## [Unreleased]` → `### Fixed`: evidence-gate id-grammar drift (#417) —
   guarded `task-N` trailer alias in derive, one id grammar + trailer discipline in
   tdd/pipeline skills, recovery runbook link.
2. Run `test/test_harness_integrity.sh` (validates Unreleased section shape).
3. Commit: "docs(changelog): #417 evidence-gate id-grammar fix"

**Files likely touched:**
- `CHANGELOG.md` — Unreleased/Fixed entry

**Dependencies:** 10

### Task 12: Full-suite verification
**Story:** Story 5 — negative paths (suite green, integrity green)
**Type:** negative-path

**Steps:**
1. Run `rtk proxy npx vitest run` in `src/conductor` (worktree needs its own
   `npm install` if node_modules absent) — full suite green, zero regressions.
2. Run `test/test_harness_integrity.sh` — exit 0.
3. If either fails, fix within the failing task's scope; re-run.
4. Commit (only if fixes were needed): "fix: address suite/integrity findings for #417"

**Files likely touched:**
- (verification only; no planned edits)

**Dependencies:** 2, 3, 4, 5, 6, 7, 8, 9, 11

## Task Dependency Graph

```
1 ─┬─ 2 ─┬─ 4 ─────────────┐
   └─ 3 ─┼─ 5 ─────────────┤
         └─ 6 ── 10 ── 11 ─┤
7 ── 8 ────────────────────┼── 12
9 ──────────────────────────┘
```

## Integration Points

- After Task 3: the alias is live end-to-end in derive — a manual gate run against a
  prefixed-trailer fixture repo demonstrates resolution.
- After Task 9: skill contracts and engine agree; a fresh daemon build cannot re-drift.
- After Task 12: merge-ready; runbook execution on the two parked features follows the
  merge (operator action, outside this plan).

## Verification

- [ ] All happy path criteria covered by at least one task (S1→T1-3, S2→T7-8, S3→T9, S4→T10, S5→T11)
- [ ] All negative path criteria covered by at least one task (S1→T4-6, S2→T7-8 greps, S3→T9 grep, S4→T10 refusal rules, S5→T12)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
