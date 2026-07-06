# Remediation: FR-8 — Merged PR Announcement for Gated Specs

**PRD Audit Cycle:** 2 of 3  
**Status:** BLOCKING (impl-gap)  
**Root Cause:** Two compounding defects suppress PR announcements for gated specs:
1. Merged spec PRs are skipped from announcements (MERGED in TERMINAL_PR_STATES)
2. PR URL is only resolved from per-slug worktree state (which doesn't exist for pre-dispatch gated specs)

**Solution:** Resolve gated spec PRs from origin using `spec/<slug>` branch, allow MERGED PRs to be announced.

---

## Task 1: Fix gate-writeback MERGED skip logic

**Dependencies:** None

**Acceptance Criteria:**
- MERGED removed from TERMINAL_PR_STATES, becomes `new Set(['CLOSED','NOTFOUND'])`
- Doc comments (lines 31-38, 128-133) updated to explain MERGED specs ARE announced
- Early-return for !prUrl (147-150) and CLOSED/NOTFOUND skip (152-158) remain unchanged

**Files likely touched:**
- `src/conductor/src/engine/gate-writeback.ts`

---

## Task 2: Add resolveSpecPrUrl lookup function

**Dependencies:** Task 1

**Acceptance Criteria:**
- New function `resolveSpecPrUrl(runGh, cwd, branch, log?): Promise<string | undefined>`
- Uses `gh pr list --state all --head <branch> --json url,state --limit 1` to find merged PR
- Non-throwing: swallows errors and returns undefined
- Does NOT create PRs (no findOrCreatePr, no --draft)
- Located near findOrCreatePr in pr-labels.ts (~line 341)

**Files likely touched:**
- `src/conductor/src/engine/pr-labels.ts`

---

## Task 3: Wire resolveSpecPrUrl into daemon-cli announceGated closure

**Dependencies:** Task 2

**Acceptance Criteria:**
- After computing prUrl from per-slug conduct-state (lines 664-666), fall back to `resolveSpecPrUrl(runGh, projectRoot, spec/${entry.slug}, log)` if undefined
- Import resolveSpecPrUrl from './engine/pr-labels.js'
- Comment at 657-663 rewritten to reflect merged spec PR resolution from origin
- announceGatedIssue wiring (line 668) unchanged

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts`

---

## Task 4: Fix false-green MERGED test to drive terminal path

**Dependencies:** Task 1

**Acceptance Criteria:**
- Fix fakeGh to return proper MERGED state: `{ stdout: JSON.stringify({ state:'MERGED', mergeable:'MERGEABLE', statusCheckRollup:[], labels:[] }) }`
- Fix --json comments call to return: `{ stdout: JSON.stringify({ comments: [] }) }`
- Assert label add (gh api POST .../labels) actually fires
- Assert marker comment (pr comment create) actually fires
- Test at lines 165-177 now drives the terminal announcement path

**Files likely touched:**
- `src/conductor/test/acceptance/owner-gate-pr-writeback.acceptance.test.ts`

---

## Task 5: Add two new acceptance tests for daemon-cli resolution seam

**Dependencies:** Task 3

**Acceptance Criteria:**
- Test (a): Gated spec with NO worktree conduct-state
  - `gh pr list --head spec/<slug>` returns MERGED PR URL
  - Assert announceGatedPr labels + upserts one marker comment
  - Invoking twice yields exactly one marker comment (idempotency, PR: "exactly one after ten scans")
- Test (b): Local-commit fallback
  - `gh pr list --head spec/<slug>` returns empty
  - resolveSpecPrUrl yields undefined
  - NO `pr create` call is made

**Files likely touched:**
- `src/conductor/test/acceptance/owner-gate-pr-writeback.acceptance.test.ts`

---

## Complexity & Autonomy

- **Tier:** Small (5 focused tasks, isolated fixes, high test coverage)
- **Autonomy:** Standard (verify after task 4 before task 5, single evaluator at end)
- **Batch Structure:** One batch of 5 tasks; final batch evaluator run
