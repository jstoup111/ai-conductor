# Implementation Plan: finish force-with-lease after sanctioned rebase

**Date:** 2026-07-03
**Design:** none (technical track, Tier S — no PRD; decision record at
`.memory/decisions/finish-force-with-lease-after-sanctioned-rebase.md`)
**Stories:** `.docs/stories/finish-force-with-lease-after-sanctioned-rebase.md`
**Conflict check:** skipped per Tier S complexity
(`.docs/complexity/finish-force-with-lease-after-sanctioned-rebase.md`)
**Source:** jstoup111/ai-conductor#213

## Summary

Six tasks adding an explicit push-direction rule to the finish and pr skills so a branch
diverged by the daemon's sanctioned finish-time rebase is reconciled by
`git push --force-with-lease` — never by pulling the stale remote copy — with a
lease-failure stop-and-surface path. Skill prose + CHANGELOG/docs only; no TypeScript.

## Technical Approach

The bug is a missing instruction, not broken code: after the conductor's rebase step
(ADR-001/9.0), `origin/<branch>` holds pre-rebase commits, the branch reads "diverged /
behind the remote", and neither `skills/finish/SKILL.md` nor `skills/pr/SKILL.md` tells
the model which direction to reconcile — so it improvises a pull, re-imports the stale
commits, conflicts, and GATE 0 halts. The fix encodes the direction rule where the model
reads it:

- **`skills/finish/SKILL.md`** gets a new numbered practice ("Push direction — local is
  canonical") between the current section 1 (Fresh Verification / GATE 0) and section 2,
  stating: at SHIP time the conductor worktree's branch is single-writer canonical; a
  divergence from `origin/<branch>` after the sanctioned daemon rebase is *expected
  stale-remote state*, reconciled ONLY with `git push --force-with-lease`; pulling,
  fetch-and-rebasing onto, or merging `origin/<branch>` is prohibited. Lease failure =
  stop-and-surface: no plain `--force`, no pull, no PR, no `.pipeline/finish-choice`,
  report and end (mirrors the existing GATE 0 refusal contract). Section renumbering is
  avoided by making it "1b" — the repo's integrity check rejects *duplicate* section
  numbers, and existing cross-references to sections 2–6 stay valid.
- **`skills/pr/SKILL.md`** section 6 ("Create or Update the PR") gets the same rule at
  the command site: on a non-fast-forward rejection of `git push -u origin HEAD` (or when
  divergence is already known), push `git push --force-with-lease -u origin HEAD`; never
  sync from the remote branch; on lease failure stop and report, do not `--force`.
- **CHANGELOG/README** record the behavior change (Fixed entry; docs only if they
  describe finish's ship behavior).

Sequencing: finish rule first (the governing statement), then pr (the command path),
then docs, then the integrity suite as the commit gate.

## Prerequisites

None — prose edits on an up-to-date branch of the harness repo.

## Tasks

### Task 1: Add "Push direction — local is canonical" practice to finish SKILL.md
**Story:** Story 1 (finish treats local as canonical), happy paths + never-pull negative
**Type:** happy-path

**Steps:**
1. Write failing check: `grep -q 'force-with-lease' skills/finish/SKILL.md` exits
   non-zero (RED — rule absent).
2. Verify it fails.
3. Implement: insert practice **"### 1b. Push Direction — Local Is Canonical"** after
   section 1 of `skills/finish/SKILL.md`: name the sanctioned daemon finish-time rebase
   (ADR-001) as the expected cause of "diverged from / behind `origin/<branch>`" at SHIP;
   require `git push --force-with-lease` as the ONLY reconciliation; explicitly prohibit
   `git pull` / fetch+rebase onto / merge of `origin/<branch>`; state that no new
   `.pipeline` marker is introduced (finish-choice semantics unchanged).
4. Verify the grep passes and the section renders coherently in context (GREEN).
5. Commit: "fix(finish): local branch is canonical at SHIP — force-with-lease, never pull"

**Files likely touched:**
- `skills/finish/SKILL.md` — new practice section 1b

**Dependencies:** none

### Task 2: Add lease-failure stop-and-surface path to finish SKILL.md
**Story:** Story 3 (failed lease halts), happy path + no-plain-force negative
**Type:** negative-path

**Steps:**
1. Write failing check: section 1b does not yet mention lease failure
   (`grep -q 'lease fail' skills/finish/SKILL.md` non-zero, RED).
2. Verify it fails.
3. Implement: extend section 1b with the failure contract: if `--force-with-lease` is
   rejected (remote moved past the last fetch — someone genuinely pushed), STOP
   GATE-0-style: no plain `git push --force`, no pull, no PR create/update, no
   `.pipeline/finish-choice`; report branch + expected-vs-found so the conductor's
   failed-step handling HALTs for a human.
4. Verify grep passes (GREEN).
5. Commit: "fix(finish): lease failure is stop-and-surface, never plain --force"

**Files likely touched:**
- `skills/finish/SKILL.md` — section 1b failure contract

**Dependencies:** Task 1

### Task 3: Extend finish verification checklist
**Story:** Story 3 Done When (checklist covers push-direction + lease-failure)
**Type:** negative-path

**Steps:**
1. Write failing check: `## Verification` block of `skills/finish/SKILL.md` lacks a
   force-with-lease item (RED).
2. Verify it fails.
3. Implement: add two checklist items — "diverged branch reconciled via
   `--force-with-lease` (never pulled)" and "on lease failure: stopped with no
   plain `--force`, no pull, no `finish-choice`".
4. Verify (GREEN).
5. Commit: "fix(finish): verification checklist covers push direction + lease failure"

**Files likely touched:**
- `skills/finish/SKILL.md` — Verification section

**Dependencies:** Task 2

### Task 4: Add non-fast-forward handling to pr SKILL.md push step
**Story:** Story 2 (pr push step), happy path + never-sync-from-remote negative
**Type:** happy-path

**Steps:**
1. Write failing check: `grep -q 'force-with-lease' skills/pr/SKILL.md` non-zero (RED).
2. Verify it fails.
3. Implement: in section 6 ("Create or Update the PR") of `skills/pr/SKILL.md`, after the
   `git push -u origin HEAD` block, document: if the push is rejected non-fast-forward
   (stale remote copy after a sanctioned rebase), run
   `git push --force-with-lease -u origin HEAD`; NEVER pull/fetch-rebase/merge
   `origin/<branch>` to get ahead of the remote; if the lease itself fails, stop and
   report — do not escalate to `--force`.
4. Verify grep passes (GREEN).
5. Commit: "fix(pr): non-fast-forward push resolves via --force-with-lease, never pull"

**Files likely touched:**
- `skills/pr/SKILL.md` — section 6 push step (+ its section 7 checklist item)

**Dependencies:** none (parallel with Tasks 1–3)

### Task 5: CHANGELOG + docs
**Story:** Story 3 Done When (CHANGELOG Fixed entry; docs track features)
**Type:** infrastructure

**Steps:**
1. Check `README.md` / skill docs for descriptions of finish's ship/push behavior.
2. Implement: add under `## [Unreleased]` → `### Fixed` in `CHANGELOG.md`: finish/pr
   skills now force-with-lease push a branch diverged by the sanctioned daemon rebase
   instead of pulling stale pre-rebase commits (GATE 0 halt loop, #213). Update README
   only if it describes the old behavior.
3. Verify the entry sits in the `[Unreleased]` block.
4. Commit: "docs: changelog entry for finish stale-remote push fix (#213)"

**Files likely touched:**
- `CHANGELOG.md` — Unreleased/Fixed entry
- `README.md` — only if it states finish ship behavior

**Dependencies:** Tasks 1–4 (describes their result)

### Task 6: Run the harness integrity suite
**Story:** all stories' Done When (`test/test_harness_integrity.sh` passes)
**Type:** infrastructure

**Steps:**
1. Run `test/test_harness_integrity.sh` from the repo root.
2. Fix any failures (frontmatter, cross-references, duplicate section numbers —
   watch the new "1b" heading against check 7).
3. Re-run until green.
4. Commit any fixes: "fix: integrity suite fixes for finish/pr skill edits"

**Files likely touched:**
- none expected (verification gate)

**Dependencies:** Tasks 1–5

## Task Dependency Graph

```
Task 1 ─▶ Task 2 ─▶ Task 3 ─┐
                            ├─▶ Task 5 ─▶ Task 6
Task 4 ─────────────────────┘
```

## Integration Points

- After Task 3: finish skill self-consistent — a session reading only finish has the
  full rule + failure contract.
- After Task 4: the actual push command path (`/pr`) agrees with finish; the PR #209
  scenario (diverged after resolved rebase → force-with-lease → ship) is covered
  end-to-end.

## Coverage Mapping

| Story acceptance criterion | Task(s) |
|---|---|
| S1 happy: diverged → force-with-lease, no import from origin | 1, 4 |
| S1 happy: finish-choice semantics unchanged | 1 |
| S1 negative: no pull/fetch-rebase/merge from origin/<branch> | 1, 4 |
| S2 happy: non-fast-forward → force-with-lease → gh pr create/edit | 4 |
| S2 negative: no sync-from-remote on rejection | 4 |
| S3 happy: lease failure → stop, no force, no PR, no finish-choice, plain report | 2, 4 |
| S3 negative: plain `--force` prohibited | 2, 4 |
| S3 Done When: checklist + CHANGELOG/docs + integrity suite | 3, 5, 6 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
