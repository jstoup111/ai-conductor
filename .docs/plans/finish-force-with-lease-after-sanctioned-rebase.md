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
`git push --force-with-lease` **only after the remote is proven stale** — never by
pulling the stale remote copy, and never by forcing over unproven (potentially foreign)
remote commits — with stop-and-surface paths for both a failed staleness proof and a
failed lease. Skill prose + CHANGELOG/docs only; no TypeScript.

## Technical Approach

The bug is a missing instruction, not broken code: after the conductor's rebase step
(ADR-001/9.0), `origin/<branch>` holds pre-rebase commits, the branch reads "diverged /
behind the remote", and neither `skills/finish/SKILL.md` nor `skills/pr/SKILL.md` tells
the model which direction to reconcile — so it improvises a pull, re-imports the stale
commits, conflicts, and GATE 0 halts.

The rule deliberately does NOT assume "local is canonical" (single-engineer locality):
in a multi-operator / multi-checkout deployment another writer may have pushed real
commits to the feature branch, and `--force-with-lease` cannot protect them once they
have been fetched into the remote-tracking ref (the rebase step fetches — the lease
would pass and the force would wipe them). Canonicality is therefore **proven, not
assumed**:

- **Staleness proof** (prerequisite for any force): the `origin/<branch>` tip must be
  provably our own pre-rebase history — fast path
  `git merge-base --is-ancestor origin/<branch> ORIG_HEAD` (ORIG_HEAD is set by the
  sanctioned rebase); fallback, the remote tip SHA appears in the local branch's reflog
  as a former head (covers multi-rebase retries where ORIG_HEAD points at an
  intermediate state). Proof holds → `git push --force-with-lease`. Proof fails →
  foreign commits: stop GATE-0-style (no force of any kind, no pull, no
  `finish-choice`), report `git log HEAD..origin/<branch> --oneline`, end.
- **`skills/finish/SKILL.md`** gets a new practice ("1b. Push Direction — Canonical Is
  Proven, Not Assumed") between the current section 1 (Fresh Verification / GATE 0) and
  section 2: names the sanctioned daemon rebase as the expected cause of divergence,
  requires the staleness proof before `--force-with-lease`, prohibits pulling /
  fetch-and-rebasing onto / merging `origin/<branch>`, defines the foreign-commit halt
  (including the explicit warning that a passing lease does not authorize a force), and
  defines lease failure = stop-and-surface: no plain `--force`, no pull, no PR, no
  `.pipeline/finish-choice`, report and end (mirrors the existing GATE 0 refusal
  contract). Numbering as "1b" avoids renumbering — the integrity check rejects
  *duplicate* section numbers, and existing cross-references to sections 2–6 stay valid.
- **`skills/pr/SKILL.md`** section 6 ("Create or Update the PR") gets the same rule at
  the command site: on a non-fast-forward rejection of `git push -u origin HEAD`, run
  the staleness proof; on proof, `git push --force-with-lease -u origin HEAD`; never
  sync from the remote branch; on failed proof or failed lease, stop and report — do
  not `--force`.
- **CHANGELOG/README** record the behavior change (Fixed entry; docs only if they
  describe finish's ship behavior).

Sequencing: finish rule first (the governing statement), then pr (the command path),
then docs, then the integrity suite as the commit gate.

## Prerequisites

None — prose edits on an up-to-date branch of the harness repo.

## Tasks

### Task 1: Add "Push direction — canonical is proven, not assumed" practice to finish SKILL.md
**Story:** Story 1 (finish proves the remote is stale), happy paths + never-pull negative
**Type:** happy-path

**Steps:**
1. Write failing check: `grep -q 'force-with-lease' skills/finish/SKILL.md` exits
   non-zero (RED — rule absent).
2. Verify it fails.
3. Implement: insert practice **"### 1b. Push Direction — Canonical Is Proven, Not
   Assumed"** after section 1 of `skills/finish/SKILL.md`: name the sanctioned daemon
   finish-time rebase (ADR-001) as the expected cause of "diverged from / behind
   `origin/<branch>`" at SHIP; require the staleness proof before any force — fast path
   `git merge-base --is-ancestor origin/<branch> ORIG_HEAD`, fallback remote-tip SHA is
   a former head in the local branch's reflog — then `git push --force-with-lease` as
   the ONLY reconciliation; explicitly prohibit `git pull` / fetch+rebase onto / merge
   of `origin/<branch>`; state that no new `.pipeline` marker is introduced
   (finish-choice semantics unchanged).
4. Verify the grep passes and the section renders coherently in context (GREEN).
5. Commit: "fix(finish): prove remote staleness, then force-with-lease — never pull"

**Files likely touched:**
- `skills/finish/SKILL.md` — new practice section 1b

**Dependencies:** none

### Task 2: Add the two halt paths (foreign commits, failed lease) to finish SKILL.md
**Story:** Story 2 (foreign commits halt) + Story 4 (failed lease halts), happy paths +
no-plain-force / lease-not-trusted negatives
**Type:** negative-path

**Steps:**
1. Write failing check: section 1b does not yet mention foreign commits or lease failure
   (`grep -qiE 'foreign|lease fail' skills/finish/SKILL.md` non-zero, RED).
2. Verify it fails.
3. Implement: extend section 1b with both failure contracts. (a) **Failed staleness
   proof** — remote-only commits outside our pre-rebase history mean another writer:
   STOP GATE-0-style with no force of ANY kind (explicitly: a passing lease does NOT
   authorize the force — fetched-but-foreign commits pass the lease), no pull, no PR
   create/update, no `.pipeline/finish-choice`; report the foreign commits
   (`git log HEAD..origin/<branch> --oneline`). (b) **Failed lease** — remote moved
   past the last fetch: same stop, no plain `git push --force`; report branch +
   expected-vs-found. Both leave the conductor's failed-step handling to HALT for a
   human.
4. Verify grep passes (GREEN).
5. Commit: "fix(finish): foreign commits and failed lease are stop-and-surface"

**Files likely touched:**
- `skills/finish/SKILL.md` — section 1b failure contracts

**Dependencies:** Task 1

### Task 3: Extend finish verification checklist
**Story:** Story 4 Done When (checklist covers push-direction, proof, and halt paths)
**Type:** negative-path

**Steps:**
1. Write failing check: `## Verification` block of `skills/finish/SKILL.md` lacks a
   force-with-lease item (RED).
2. Verify it fails.
3. Implement: add checklist items — "diverged branch: staleness proven (ORIG_HEAD
   ancestry / reflog former-head) before `--force-with-lease` (never pulled)", "on
   unproven staleness (foreign commits): stopped with no force of any kind", and "on
   lease failure: stopped with no plain `--force`, no pull, no `finish-choice`".
4. Verify (GREEN).
5. Commit: "fix(finish): verification checklist covers proof + halt paths"

**Files likely touched:**
- `skills/finish/SKILL.md` — Verification section

**Dependencies:** Task 2

### Task 4: Add non-fast-forward handling to pr SKILL.md push step
**Story:** Story 3 (pr push step), happy path + never-sync-from-remote / failed-proof
negatives
**Type:** happy-path

**Steps:**
1. Write failing check: `grep -q 'force-with-lease' skills/pr/SKILL.md` non-zero (RED).
2. Verify it fails.
3. Implement: in section 6 ("Create or Update the PR") of `skills/pr/SKILL.md`, after the
   `git push -u origin HEAD` block, document: if the push is rejected non-fast-forward,
   run the same staleness proof as finish (ORIG_HEAD ancestry or reflog former-head of
   the `origin/<branch>` tip); on proof, `git push --force-with-lease -u origin HEAD`;
   NEVER pull/fetch-rebase/merge `origin/<branch>` to get ahead of the remote; on failed
   proof (foreign commits) or failed lease, stop and report — do not escalate to
   `--force`.
4. Verify grep passes (GREEN).
5. Commit: "fix(pr): non-fast-forward push proves staleness, then force-with-lease"

**Files likely touched:**
- `skills/pr/SKILL.md` — section 6 push step (+ its section 7 checklist item)

**Dependencies:** none (parallel with Tasks 1–3)

### Task 5: CHANGELOG + docs
**Story:** Story 3 Done When (CHANGELOG Fixed entry; docs track features)
**Type:** infrastructure

**Steps:**
1. Check `README.md` / skill docs for descriptions of finish's ship/push behavior.
2. Implement: add under `## [Unreleased]` → `### Fixed` in `CHANGELOG.md`: finish/pr
   skills now prove the remote branch is a stale pre-rebase copy and force-with-lease
   push it after the sanctioned daemon rebase, instead of pulling stale commits back in
   (GATE 0 halt loop, #213); unproven staleness (foreign commits) or a failed lease
   halts instead of forcing. Update README only if it describes the old behavior.
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
  full rule (proof + force) and both halt contracts.
- After Task 4: the actual push command path (`/pr`) agrees with finish; the PR #209
  scenario (diverged after resolved rebase → proof holds trivially → force-with-lease →
  ship) and the foreign-writer scenario (proof fails → halt) are covered end-to-end.

## Coverage Mapping

Story numbering follows file order: S1 = finish proves staleness, S2 = foreign commits
halt, S3 = pr push step, S4 = failed lease halts.

| Story acceptance criterion | Task(s) |
|---|---|
| S1 happy: diverged → staleness proof (ORIG_HEAD / reflog) → force-with-lease, no import from origin | 1, 4 |
| S1 happy: finish-choice semantics unchanged | 1 |
| S1 negative: no pull/fetch-rebase/merge from origin/<branch> | 1, 4 |
| S1 negative: unprovable staleness never treated as "probably fine" | 1, 2 |
| S2 happy: foreign commits → stop, no force of any kind, report SHAs, no finish-choice | 2 |
| S2 negative: passing lease does not authorize the force | 2 |
| S3 happy: non-fast-forward → proof → force-with-lease → gh pr create/edit | 4 |
| S3 negative: no sync-from-remote on rejection | 4 |
| S3 negative: failed proof at pr push → stop and report | 4 |
| S4 happy: lease failure → stop, no force, no PR, no finish-choice, plain report | 2, 4 |
| S4 negative: plain `--force` prohibited | 2, 4 |
| S4 Done When: checklist + CHANGELOG/docs + integrity suite | 3, 5, 6 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
