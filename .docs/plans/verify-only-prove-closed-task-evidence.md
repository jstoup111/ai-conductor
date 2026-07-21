# Implementation Plan: Verify-Only (Prove-Closed) Task Evidence Closure (#677)

**Date:** 2026-07-17
**Design:** `.docs/decisions/adr-2026-07-17-verify-only-judged-closure.md` (APPROVED)
**Stories:** `.docs/stories/verify-only-prove-closed-task-evidence.md`
**Conflict check:** Clean as of 2026-07-17 (1 blocking conflict resolved by scoped amendment
of the #520/#581 inert-by-default invariant)
**Refs:** jstoup111/ai-conductor#677 (fixes); jstoup111/ai-conductor#678 (partial — removes the
re-dispatch trigger for the verify-only class; general #678 outcomes deferred to #678/PR #679)

## Summary

A prove-closed plan task legitimately produces no commit, so `deriveCompletion` records
`skipped: "no derived evidence"`, the gate never resolves it, `noEvidenceAttempts` burns to 3,
and an evaluator-APPROVED build auto-parks. Fix: a deterministic `**Verify-only:** yes` plan
marker; class-scoped arming of the existing judged attribution lane for marked residue tasks;
`Evidence: skipped` parity in the commit-msg hook; verify-only ids named in the park reason.
10 tasks.

## Technical Approach

- **Marker parse** in `parsePlanTaskPaths` (`src/conductor/src/engine/autoheal.ts`): recognize
  a `**Verify-only:** yes` line inside a task block (exact-match `yes`, case-insensitive;
  anything else = not verify-only, fail-closed). Expose `verifyOnly` on the parsed task data
  without changing any existing field or consumer behavior.
- **Class-scoped lane arming** on the gate-miss branch
  (`src/conductor/src/engine/conductor.ts:3030-3105`): compute
  `verifyOnlyResidue = residueIds ∩ {tasks marked verifyOnly}`. Dispatch condition becomes
  `(cutoverActive && residueIds.length > 0) || verifyOnlyResidue.length > 0` (plus the existing
  planPath/headSha/zero-work guards). When only the class-scoped predicate armed the lane,
  dispatch it with `residueIds = verifyOnlyResidue` (never widen judging to unmarked tasks).
  Everything downstream — verifier dispatch (`dispatchAttributionVerifier`), citation
  validation (existence + ancestry + residue-membership), `semantic-verified` stamp write,
  unsatisfied-reason retry hints, in-loop completion re-check — is reused unchanged from
  `runAttributionLane` (`src/conductor/src/engine/attribution-lane.ts:420`).
- **Hook parity** in `COMMIT_MSG_HOOK` (`src/conductor/src/engine/git-hook-assets.ts:88`):
  in both empty-commit branches, accept `Evidence: skipped <non-empty reason>` as an
  alternative to `Evidence: satisfied-by <resolvable sha>`. Bare empty commits and empty
  reasons stay rejected. Keep the deriver (`autoheal.ts:712-718`) as-is — it already accepts
  this form.
- **Park reason enrichment** (`src/conductor/src/engine/daemon-auto-park.ts:135-138` and the
  caller at `conductor.ts:3408-3429`): when parking for `no completion evidence after N
  attempts`, append ` — unresolved verify-only tasks: <ids>` when any unresolved task is
  marked verify-only. Mixed residue lists verify-only ids distinctly; ordinary unresolved
  tasks keep the generic reason prominent.
- **Skill contracts**: `skills/plan/SKILL.md` documents the marker + preferred empty-evidence-
  commit completion; `skills/tdd/SKILL.md` Commit-less Completions section cross-references
  the marker and both trailer forms. `judged-attribution-verdict-persistence.md` Story 4
  wording gains the verify-only carve-out (conflict resolution).
- **Sequencing:** parser first (everything reads the flag), then engine arming, then hook +
  park reason (independent), then skills/docs/CHANGELOG. Tests run from `src/conductor` with
  vitest in isolated temp repos (never from the worktree root); production spawns guarded by
  the vitest kill-switch env.

## Tasks

### Task 1: Parser — expose `verifyOnly` from `parsePlanTaskPaths`

**Verify-only:** no
**Dependencies:** none
**Files likely touched:** src/conductor/src/engine/autoheal.ts, src/conductor/test/engine/autoheal.test.ts

RED: parser tests — a task block with `**Verify-only:** yes` yields `verifyOnly: true`;
unmarked tasks yield false/absent; malformed values (`maybe`, empty) yield false (fail-closed);
existing fixtures parse byte-identically for all existing fields.
GREEN: extend the parsed-task structure returned by `parsePlanTaskPaths` with the flag.
Commit.

### Task 2: Marker grammar is inert for the existing corpus

**Verify-only:** no
**Dependencies:** Task 1
**Files likely touched:** src/conductor/test/engine/autoheal.test.ts

RED→GREEN: regression test sweeping representative existing plan fixtures (no markers)
asserting zero `verifyOnly: true` results and unchanged planTaskIds/paths output. Commit.

### Task 3: Gate-miss branch computes verify-only residue and arms the lane class-scoped

**Verify-only:** no
**Dependencies:** Task 1
**Files likely touched:** src/conductor/src/engine/conductor.ts, src/conductor/test/conductor.build-gate.test.ts

RED: with cutover dark, residue `["4"]` where task 4 is marked verify-only → lane dispatched
with residueIds `["4"]`; residue containing marked and unmarked ids → lane dispatched with
ONLY the marked subset when cutover is dark; no marked residue + dark cutover → lane not
dispatched (byte-identical today); cutover armed → existing full-residue dispatch unchanged.
GREEN: implement the `verifyOnlyResidue` predicate per Technical Approach. Commit.

### Task 4: Judged stamp resolves a verify-only task end-to-end

**Verify-only:** no
**Dependencies:** Task 3
**Files likely touched:** src/conductor/test/attribution-lane.integration.test.ts

RED→GREEN (integration, temp repo): plan with verify-only task 4, real commits for other
tasks, injected verifier verdict citing an existing ancestor sha → `semantic-verified` stamp
written to `.pipeline/task-evidence.json`, in-loop re-check flips the step to done, task row
flips, `noEvidenceAttempts` resets via progress detection, no auto-park. Commit.

### Task 5: Adversarial paths — forged citation and loud abstain

**Verify-only:** no
**Dependencies:** Task 3
**Files likely touched:** src/conductor/test/attribution-lane.integration.test.ts

RED→GREEN: nonexistent sha / non-ancestor sha / citation for a non-residue task → no stamp,
task unresolved (existing validation reused, asserted at this call site per negative-path
convention); verifier abstain → unsatisfied reason lands in the BUILD retry hint naming the
task, no stamp, budget increments as today. Commit.

### Task 6: commit-msg hook accepts `Evidence: skipped <reason>` on empty commits

**Verify-only:** no
**Dependencies:** none
**Files likely touched:** src/conductor/src/engine/git-hook-assets.ts, src/conductor/test/git-hook-assets.test.ts

RED: in a temp repo with the generated hook installed — empty commit with `Task:` +
`Evidence: skipped covered by task 2 (a2cde88)` accepted; bare empty commit rejected
(unchanged); `Evidence: skipped` with empty/whitespace reason rejected; unresolvable
`satisfied-by` sha rejected (unchanged).
GREEN: extend both empty-commit branches of `COMMIT_MSG_HOOK`. Commit.

### Task 7: Park reason names unresolved verify-only ids

**Verify-only:** no
**Dependencies:** Task 1
**Files likely touched:** src/conductor/src/engine/conductor.ts, src/conductor/src/engine/daemon-auto-park.ts, src/conductor/test/daemon-auto-park.test.ts

RED→GREEN: budget-exhausted park where unresolved = marked verify-only ids → reason contains
`unresolved verify-only tasks: 4`; mixed residue → generic reason retained with verify-only
ids listed distinctly; no marked tasks → reason byte-identical to today. Commit.

### Task 8: /plan and /tdd skill contracts document the marker

**Verify-only:** no
**Dependencies:** none
**Files likely touched:** skills/plan/SKILL.md, skills/tdd/SKILL.md

Add the `**Verify-only:** yes` marker rule + preferred empty-evidence-commit instruction to
the plan task template; cross-reference from the tdd Commit-less Completions section (both
trailer forms). Run `test/test_harness_integrity.sh`. Commit.

### Task 9: Amend #581 Story 4 wording with the verify-only carve-out

**Verify-only:** no
**Dependencies:** Task 3
**Files likely touched:** .docs/stories/judged-attribution-verdict-persistence.md

Per the conflict-check resolution: Story 4's "cutover absent → byte-identical" invariant gains
the explicit verify-only-marker carve-out so the story corpus carries no contradicted
invariant. Commit.

### Task 10: Docs + CHANGELOG

**Verify-only:** no
**Dependencies:** Task 3, Task 6, Task 7, Task 8
**Files likely touched:** CHANGELOG.md, README.md, src/conductor/README.md

CHANGELOG `[Unreleased]` → Fixed (#677 evidence stranding) + Added (verify-only marker, hook
`Evidence: skipped` form). README/conductor README: document the marker, the class-scoped
judge dispatch, and the enriched park reason. No `settings.json`/CLI/hook-wiring schema
change → no migration block (hook asset content change is regenerated per-install, not
wiring). Run `test/test_harness_integrity.sh` + full conductor vitest from `src/conductor`.
Commit.

## Task Dependency Graph

```
Task 1 ──> Task 2
Task 1 ──> Task 3 ──> Task 4
              │  \──> Task 5
              │  \──> Task 9
Task 1 ──> Task 7
Task 6 (independent)
Task 8 (independent)
Task 3,6,7,8 ──> Task 10
```

## Out of Scope

- General #678 outcomes: autonomous-session VERSION-prompt suppression and the universal
  "re-dispatched session on a completed build must not escalate into ship steps" guard —
  deferred to #678 / PR #679 (this plan removes the re-dispatch trigger only for the
  verify-only class, via in-loop judged closure).
- Global arming of `attribution_judge_cutover` (#520 rollout program decision).
- Progress-line display changes: the `0/N` premise was refuted (it is a row count,
  build-progress-watcher.ts:77-78); rows flipping via stamps fixes the symptom.
- VERSION stays 0.99.19 (frozen until 1.0).
