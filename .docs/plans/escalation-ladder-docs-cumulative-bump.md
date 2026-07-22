# Implementation Plan: escalation-ladder-docs-cumulative-bump

**Date:** 2026-07-22
**Design:** technical track — no PRD; intent from intake jstoup111/ai-conductor#713 +
`adr-2026-07-05-retry-as-escalation-ladder.md`
**Stories:** `.docs/stories/escalation-ladder-docs-cumulative-bump.md`
**Conflict check:** Skipped — Tier S (`.docs/complexity/escalation-ladder-docs-cumulative-bump.md`)

## Summary

Docs-only correction in 4 tasks: make the retry-escalation-ladder prose in `HARNESS.md` and
`src/conductor/README.md` state the cumulative `(attempt − 2)`-tier model bump the ADR and
`escalateAttempt` actually implement, add a `[Unreleased]` changelog entry, and verify with
greps + the harness integrity suite. No runtime behavior changes.

## Technical Approach

The implementation is the source of truth and does not change:
`src/conductor/src/engine/escalation.ts` (`escalateAttempt`) targets
`bumpModel(baseModel, attempt − 2)` for attempt ≥ 3 — cumulative, monotonic, capped at
`fable` — exactly as decided in `adr-2026-07-05-retry-as-escalation-ladder.md` ("cumulative
and monotonic", "model bumped (attempt − 2) tiers up from base"). Two operator-facing prose
sites paraphrase this as "attempt 3+ … bumps the model one tier", which is only true for
attempt 3 and silently understates cost for any retry budget deeper than the default 3.

Each prose site is rewritten in place to state: attempt N (N ≥ 3) holds the attempt-2 effort
and bumps the model **(N − 2) tiers** up from base (attempt 3 = one tier, attempt 4 = two,
e.g. `sonnet→fable`), capped at `fable`; plus one explicit cost sentence: raising a step's
retry budget beyond 3 authorizes a further tier per extra attempt (multi-tier, premium-model
escalation). The historical #188 entry in a released CHANGELOG section keeps its stale
wording untouched (released history is never rewritten); the correction is recorded as a new
`### Fixed` line under `## [Unreleased]`. All edits are pure prose — the generated
model-selection-table region of `HARNESS.md` is not touched, so integrity check 5a
(table drift) must remain green.

Sequencing: the three edit tasks are independent; a final verify-only task runs the greps
and the full integrity suite over the combined result.

## Prerequisites

- None (docs-only; no migrations, deps, or setup).

## Tasks

### Task 1: Correct the HARNESS.md retry-ladder paragraph
**Story:** HARNESS.md ladder prose states the cumulative model-bump formula (both happy-path
criteria + "no stale phrasing" negative path)
**Type:** happy-path

**Steps:**
1. Write failing check: `grep -q "attempt − 2\|attempt - 2" HARNESS.md` exits non-zero and
   `grep -q "bumps the model one" HARNESS.md` exits zero (RED: formula absent, stale phrase present).
2. Verify check fails (RED).
3. Implement: rewrite the "Retry-as-escalation ladder (#188)" paragraph (~line 191) so
   attempt 3+ reads: holds the attempt-2 effort and bumps the model **(attempt − 2) tiers**
   up the capability ladder (`haiku→sonnet→opus→fable`) — attempt 3 is one tier, attempt 4
   two (e.g. base `sonnet` reaches `fable`), capped at `fable`. Append the cost sentence:
   a retry budget deeper than 3 authorizes one further tier per extra attempt, so deep
   budgets escalate to premium models.
4. Verify check passes (GREEN): formula grep hits, `grep -c "bumps the model one" HARNESS.md`
   outputs 0.
5. Commit with message: "docs(harness): state cumulative (attempt−2)-tier retry escalation (#713)"

**Files:**
- `HARNESS.md` — retry-as-escalation paragraph rewritten; generated table region untouched

**Wired-into:** none (no new production surface)

**Dependencies:** none

### Task 2: Correct the src/conductor/README.md retry-as-escalation bullet
**Story:** src/conductor/README.md ladder bullet states the cumulative formula (happy path +
"no stale phrasing" negative path)
**Type:** happy-path

**Steps:**
1. Write failing check: `grep -q "attempt − 2\|attempt - 2" src/conductor/README.md` exits
   non-zero and `grep -q "bumps the model one" src/conductor/README.md` exits zero (RED).
2. Verify check fails (RED).
3. Implement: rewrite the "Retry-as-escalation" bullet (~line 165) to the same cumulative
   rule: attempt 3+ holds the attempt-2 effort and bumps the model (attempt − 2) tiers from
   base (attempt 3 = one, attempt 4 = two), capped at `fable`, matching `escalateAttempt`
   in `src/conductor/src/engine/escalation.ts` and the ADR.
4. Verify check passes (GREEN): `grep -c "bumps the model one" src/conductor/README.md`
   outputs 0.
5. Commit with message: "docs(conductor): README retry ladder matches escalateAttempt formula (#713)"

**Files:**
- `src/conductor/README.md` — retry-as-escalation bullet rewritten

**Wired-into:** none (no new production surface)

**Dependencies:** none

### Task 3: Record the fix under CHANGELOG [Unreleased] without touching released sections
**Story:** CHANGELOG records the docs fix without rewriting history (happy path + released-
section-untouched negative path)
**Type:** happy-path

**Steps:**
1. Write failing check: `awk '/## \[Unreleased\]/,/## \[/' CHANGELOG.md | grep -q "#713"`
   exits non-zero (RED: no entry yet).
2. Verify check fails (RED).
3. Implement: add under `## [Unreleased]` → `### Fixed`: "Escalation-ladder docs
   (`HARNESS.md`, `src/conductor/README.md`) said attempt 3+ bumps the model one tier;
   corrected to the implemented cumulative `(attempt − 2)`-tier formula with a cost note
   for retry budgets deeper than 3 (#713).". Do not modify any `## [X.Y.Z]` section —
   the historical #188 entry (~line 282) keeps its original wording.
4. Verify check passes (GREEN): the awk|grep hits, and `git diff main -- CHANGELOG.md`
   shows additions only inside the `[Unreleased]` block.
5. Commit with message: "docs(changelog): unreleased Fixed entry for escalation-ladder docs (#713)"

**Files:**
- `CHANGELOG.md` — one new `### Fixed` line under `## [Unreleased]` only

**Wired-into:** none (no new production surface)

**Dependencies:** none

### Task 4: Verify combined result — greps + harness integrity suite
**Story:** all three stories' "Done When" gates (including the HARNESS.md table-drift
negative path)
**Type:** negative-path

**Steps:**
1. Run `grep -c "bumps the model one" HARNESS.md src/conductor/README.md` — expect 0 for both.
2. Run `git diff main -- CHANGELOG.md` — confirm no hunk touches a released `## [X.Y.Z]` section.
3. Run `test/test_harness_integrity.sh` — expect full pass (notably check 5a: HARNESS.md
   generated model-selection-table drift).
4. If any check fails, fix the offending prose edit and re-run until green.
5. Commit (empty) with message: "chore: verify escalation-ladder docs correction (#713)" and
   trailer `Evidence: skipped verify-only — greps + integrity suite green, no code change`

**Files:** none

**Wired-into:** none (no new production surface)

**Verify-only:** yes

**Dependencies:** 1, 2, 3

## Task Dependency Graph

```
Task 1 (HARNESS.md) ──┐
Task 2 (README.md) ───┼──▶ Task 4 (verify: greps + integrity suite)
Task 3 (CHANGELOG) ───┘
```

## Integration Points

- After Tasks 1–3: all three docs are individually correct; full-repo verification is Task 4.

## Verification

- [ ] All happy path criteria covered by at least one task (Tasks 1–3)
- [ ] All negative path criteria covered by at least one task (stale-phrase greps in Tasks 1–2,
      released-section guard in Task 3, table-drift/integrity in Task 4)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic (1,2,3 independent → 4)
