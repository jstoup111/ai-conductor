# Implementation Plan: Stale manual_test discovered at FINISH is unroutable

**Date:** 2026-08-16
**Design:** .docs/decisions/adr-2026-08-16-restore-the-current-head-publication-fence.md
**Stories:** .docs/stories/stale-manual-test-discovered-at-finish-is-unroutab.md
**Conflict check:** Clean as of 2026-08-16

## Summary

Twelve tasks that restore an APPROVED current-HEAD publication fence disabled since 2026-08-04,
pin the conditions that keep it enabled, and retire the placeholder halt the same commit left
behind. Closes ai-conductor#1613.

## Technical Approach

**The mechanism already exists and is one disjunct away from working.**
`adr-2026-07-26-rebase-tail-current-branch-before-publication` (APPROVED) requires a current-HEAD
validation fence before any `finish` dispatch or publication side effect, and requires that a
`stale` member count as non-green "even when an older artifact remains on disk". That fence is
`nonGreenFinishValidators` (`conductor.ts:1602-1640`), called from the pre-finish site
(`conductor.ts:5338-5361`). It returns `[]` on every production path because of
`this.finishPublication ||` at `:1609`. `git log -L` attributes that disjunct and the
`'requires its dedicated BUILD routing rule: '` placeholder halt to the same commit, `9a6005e61`
(#1295, 2026-08-04) — one change removed the prevention and left the cure unwritten.

**The primary change is Task 3: delete the disjunct.** The fence then does what the ADR specifies
without further authoring — resolve membership, `computeAndWriteVerdict` per applicable member,
mark only non-green members `stale`, emit one `kickback` from `finish` to the earliest, and
redirect. Most of this plan is therefore tests that pin behavior, not new production code. Expect
**zero new exports**; a new export in the diff means the implementation drifted toward re-authoring
the fence instead of enabling it.

**Why not a FINISH→BUILD route.** The first design did that, on
`adr-2026-08-01-engine-owned-resumable-finish-publication` D5. Conflict-check found
`adr-2026-07-13-kickback-build-no-op-escalation` forbids routing into an already-satisfied BUILD
("never re-kick"), which is exactly a stale SHIP validator over a complete BUILD;
`adr-2026-07-22` and `adr-2026-07-20` forbid its unconditional verdict invalidation; and
`adr-2026-07-25-content-addressed-full-suite-proof` made its evidence-artifact deletion ineffective
because reuse identity is the content fingerprint. That direction is recorded as rejected in the
ADR so it is not re-proposed.

**Sequencing.** Task 1 discharges review condition 1 before anything depends on it: the disjunct
carries no comment and no ADR, but #1295 added it deliberately, and if a genuine incompatibility
exists between the fence and the coordinator that is a design fork for the operator, not something
to work around. Tasks 2-3 restore the fence; 4-6 pin its behavior and its surviving exemption;
7-8 pin non-oscillation, the property that distinguishes recomputation from invalidation; 9-10
retire the placeholder; 11-12 pin the anti-regression condition and the end-to-end seam.

## Prerequisites

- None. No migration, config key, dependency, or external account.

## Tasks

### Task 1: Establish why the coordinator disjunct was added
**Story:** 1
**Type:** infrastructure
**Verify-only:** yes

**Steps:**
1. Read commit `9a6005e61` and its PR (#1295) for any stated reason the fence was disabled when the
   publication coordinator landed.
2. Search the suite for any test that asserts the fence is inactive with the coordinator wired.
3. Record the finding in the commit message. If a genuine incompatibility is found, stop and halt
   for the operator rather than proceeding to Task 3.
4. Commit an empty commit carrying `Task: 1` and `Evidence: skipped establishes findings only`.

**Files likely touched:**
- none

**Dependencies:** none

---

### Task 2: RED — the fence is active when the publication coordinator is wired
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a failing test asserting `nonGreenFinishValidators` returns its non-green members when the
   production publication coordinator is wired and a validator is `stale`.
2. Verify RED — today the guard returns `[]`.
3. Commit: "test(conductor): publication fence must run with the coordinator wired".

**Files likely touched:**
- `src/conductor/test/engine/conductor-finish-publication.test.ts` — fence activation case

**Dependencies:** Task 1

---

### Task 3: GREEN — remove the coordinator disjunct from the fence guard
**Story:** 1
**Type:** happy-path

**Steps:**
1. Delete `this.finishPublication ||` from the guard at `conductor.ts:1609`, leaving the
   mocked-dispatch exemption unchanged.
2. Extend the surviving clause's comment to state why it remains and cite the governing ADR for
   why the coordinator is not an exemption.
3. Verify Task 2 passes (GREEN).
4. Commit: "fix(conductor): restore the current-HEAD publication fence (adr-2026-07-26)".

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — guard clause and its comment

**Dependencies:** Task 2

---

### Task 4: RED — a stale validator blocks dispatch and kicks back to itself
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a failing test asserting that with `manual_test` `stale`, `finish` is not marked
   `in_progress`, no publication side effect occurs, and a `kickback` from `finish` to
   `manual_test` is emitted.
2. Assert the redirect targets the **earliest** non-green member when several are non-green, and
   that green siblings keep their `done` state.
3. Verify RED, then confirm Task 3 turns it GREEN with no further production change.
4. Commit: "test(conductor): stale SHIP validator blocks publication and redirects".

**Files likely touched:**
- `src/conductor/test/engine/conductor-finish-publication.test.ts` — redirect behavior

**Dependencies:** Task 3

---

### Task 5: RED — manual_test FAIL rows are non-green even when the step is done
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write a failing test asserting a `done` `manual_test` whose results contain FAIL rows is treated
   as non-green by the fence.
2. Verify the existing whitewash guard's behavior is unchanged.
3. Commit: "test(conductor): manual_test FAIL rows are non-green at the fence".

**Files likely touched:**
- `src/conductor/test/engine/conductor-finish-publication.test.ts` — FAIL-row case

**Dependencies:** Task 3

---

### Task 6: RED — the mocked-dispatch exemption and skipped members still hold
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests asserting the fence stays disabled in mocked-dispatch mode
   (`verifyArtifacts` false and not daemon), and that a validator skipped for tier, track,
   upstream skip, or configuration is excluded from membership rather than blocking.
2. Assert `--from finish` still crosses the fence.
3. Commit: "test(conductor): fence exemptions and membership resolution".

**Files likely touched:**
- `src/conductor/test/engine/conductor-finish-publication.test.ts` — exemption cases

**Dependencies:** Task 3

---

### Task 7: RED — an unchanged validator surface is preserved across a docs-only lap
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write a failing test driving a tail lap that commits only documentation, asserting every
   validator's verdict stays satisfied, none is marked `stale`, and `finish` dispatches.
2. Assert `test_suite` evidence with a matching content fingerprint is not forced to re-execute.
3. Commit: "test(conductor): an unchanged surface survives the fence".

**Files likely touched:**
- `src/conductor/test/engine/conductor-finish-publication.test.ts` — preservation case

**Dependencies:** Task 3

---

### Task 8: RED — repeated tail laps do not re-stale a green validator
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write a failing test driving repeated docs-only tail laps, asserting zero repeated re-staling
   and that the run converges rather than oscillating.
2. Assert an unreadable or indeterminate verdict is treated as non-green rather than passed.
3. Assert no unconditional `satisfied: false` write and no evidence-artifact deletion appears on
   this path.
4. Commit: "test(conductor): the fence recomputes rather than invalidates".

**Files likely touched:**
- `src/conductor/test/engine/conductor-finish-publication.test.ts` — oscillation case

**Dependencies:** Task 7

---

### Task 9: RED — no production string claims a routing rule is missing
**Story:** 4
**Type:** negative-path

**Steps:**
1. Rewrite the four-code table at `finish-publication.test.ts:836-865` to assert the evidence
   conditions halt with a reason describing the unresolved observation.
2. Assert the literal "requires its dedicated BUILD routing rule" appears in no halt reason.
3. Verify RED.
4. Commit: "test(finish): retire the missing-routing-rule placeholder".

**Files likely touched:**
- `src/conductor/test/engine/finish-publication.test.ts` — condition table rewrite

**Dependencies:** Task 3

---

### Task 10: GREEN — make the condition routing a total mapping
**Story:** 4
**Type:** negative-path

**Steps:**
1. Replace the four-code `if` at `finish-publication.ts:657-670` with a mapping total over
   `PublicationCondition['code']`, so a condition added without a declared route fails to compile.
2. Give the evidence conditions their new halt reason and delete the placeholder string; leave the
   five FINISH-local conditions on `retry_finish` and `implementation_invalid`'s BUILD route
   untouched.
3. Verify GREEN and that the five FINISH-local router tests pass unmodified.
4. Commit: "fix(finish): route publication conditions from a total mapping".

**Files likely touched:**
- `src/conductor/src/engine/finish-publication.ts` — replace the branch with the mapping

**Dependencies:** Task 9

---

### Task 11: RED — a coordinator-based exemption cannot be reintroduced
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write a failing-then-passing test pinning that the fence is active whenever the publication
   coordinator is wired, phrased so that re-adding any coordinator-based exemption fails the suite.
2. Assert the surviving mocked-dispatch exemption still passes.
3. Commit: "test(conductor): pin the fence active under the publication coordinator".

**Files likely touched:**
- `src/conductor/test/engine/conductor-finish-publication.test.ts` — anti-regression pin

**Dependencies:** Task 3

---

### Task 12: Wire the restored fence end to end at the SHIP-tail seam
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write a failing acceptance test for the production integration point: a run with `manual_test`
   `stale` and every other gate green reaches the fence, redirects, re-runs the validator, returns
   to `finish`, and publishes.
2. Assert no `.pipeline/HALT` is written at any point and no operator action is required.
3. Add the second observed shape — evidence invalidated by ship-tail `rebase` and
   `maintain_documentation` commits — as a second case.
4. Assert a genuinely failing validator still halts at the existing per-gate cap.
5. Commit: "test(acceptance): stale SHIP validator ships unattended".

**Files likely touched:**
- `src/conductor/test/acceptance/unattended-finish-publication.acceptance.test.ts` — end-to-end seam

**Dependencies:** Task 4; Task 8; Task 10

---

## Task Dependency Graph

```
Task 1 ──> Task 2 ──> Task 3 ─┬─> Task 4 ───────────────┐
                              ├─> Task 5                │
                              ├─> Task 6                │
                              ├─> Task 7 ──> Task 8 ────┤
                              ├─> Task 9 ──> Task 10 ───┤
                              └─> Task 11               │
                                                        └─> Task 12
```

Tasks 4, 5, 6, 7, 9 and 11 are independent of one another once Task 3 lands and may proceed in any
order. Task 12 waits on the three behaviors it exercises.

## Integration Points

- **After Task 3** — the fence is live; the routine halt is gone.
- **After Task 8** — non-oscillation is pinned, so the fence cannot trade one loop for another.
- **After Task 12** — both observed occurrences are covered end to end from a production entry
  point.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No terminal catch-all validation task
- [ ] Zero new exports introduced
### Task rem-build-review-scope-1: src/conductor/test/acceptance/stale-manual-test-finish-publication.acceptance.test.ts:53-270 — complete Task 12's second case by seeding passing manual-test evidence with a satisfied pre-tail verdict and codeStamp, applying later rebase and maintain_documentation commits, asserting stamp validity becomes rerun, and proving exactly one finish-to-manual_test kickback publishes without HALT
### Task rem-scope-1: src/conductor/test/tmpdir-leak-guard.ts:61 and src/conductor/test/tmpdir-leak-guard.test.ts:181-192 — remove 'bsp-apt-download.log' from IGNORED_TMPDIR_PREFIXES and from the concurrent-tooling ignored-entry fixture and expectation
### Task rem-completeness-1: src/conductor/test/engine/conductor-finish-publication.test.ts:244-279 — retain an inspectable publication advance spy in the several-non-green-validator test, assert it was not called, and assert the post-run finish state is not 'in_progress' while preserving the existing manual_test kickback checks
### Task rem-completeness-2: src/conductor/test/engine/conductor-finish-publication.test.ts:402-432 — after the malformed-evidence fence runs, read evidencePath and assert the retained manual-test artifact still contains 'MAYBE' alongside the existing no-publication, kickback, and unsatisfied-verdict assertions
