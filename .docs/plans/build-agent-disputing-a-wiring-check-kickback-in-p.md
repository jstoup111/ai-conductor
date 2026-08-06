# Implementation Plan: Engine-stamped build outcome for a disputed kickback

**Date:** 2026-08-06
**Issue:** jstoup111/ai-conductor#1336
**Stories:** .docs/stories/build-agent-disputing-a-wiring-check-kickback-in-p.md
**Design:** .docs/decisions/adr-2026-08-05-build-settle-outcome-stamp.md
**Architecture review:** .docs/decisions/architecture-review-2026-08-05-build-agent-disputing-a-wiring-check-kickback-in-p.md
**Conflict check:** Clean as of 2026-08-06 — .docs/conflicts/2026-08-06-build-agent-disputing-a-wiring-check-kickback-in-p.md

## Summary

Adds a durable, engine-authored record of what each `build` step did to the worktree, and uses it to
make an empty build legible in the daemon log, to carry the build agent's dispute into the halt
reason, and to refuse an identical known-empty kickback cycle before paying for it. 21 tasks.

## Technical Approach

**One new pure module plus one new sidecar.** `src/conductor/src/engine/build-outcome.ts` holds the
pure classifiers (`classifyBuildSettle`, `sameNoOpCycle`) and the `.pipeline/build-outcome.json`
read/write pair, mirroring `kickback-ledger.ts:67-116` — atomic temp-file + `rename(2)` write,
fail-open read that degrades to an empty record set on a missing, corrupt, wrong-version, or
shape-invalid file. Nothing in the module performs classification and I/O in the same function, so
every decision is unit-testable without a Conductor fixture.

**Two movement witnesses, one classifier.** Per the D1 amendment (conflict resolution, 2026-08-06),
the record carries `treeBefore`/`treeAfter` **and** `headBefore`/`headAfter`. Only the tree hash
classifies `moved` / `no-movement` and therefore only the tree hash feeds the refusal — inherited
from #984, because an empty commit moves HEAD while leaving the tree byte-identical. The commit SHA
is recorded for legibility so this feature's log line and the existing `unattributed_progress` event
(`conductor.ts:5868`, `adr-2026-07-23-commit-movement-liveness-floor`) can be read side by side
without appearing to contradict each other. Consequently **every operator-facing string is
tree-scoped** ("tree abc1234 unchanged"), never an unqualified "no movement".

**Capture sites are existing ones, not new ones.** The tree-hash baseline is taken beside the
existing `headShaBeforeBuild` probe at `conductor.ts:4940` (conflict D-1 — no third `git` call
site), and the note reuses the `tail` value already computed at `conductor.ts:7508` rather than
re-reading provider output (C4). The stall breaker at `conductor.ts:5824-5877` is **not modified**.

**The refusal sits before build re-entry and owns no budget.** It is evaluated before the
`navigateStateBack(..., 'build', ...)` re-entry and short-circuits ahead of `consumeKickbackBudget`
(`conductor.ts:3344`), so `MAX_KICKBACKS_PER_GATE` remains solely #984's (D7). It fires only on a
definite match of all four components; a null or unreadable tree hash **dispatches** (C1) — the
inverse of `classifyBuildProgress` (`kickback-escalation.ts:38`), which it must not delegate to.

**No new halt class, no new event type.** `HaltClass` is untouched (D6); the annotation rides the
existing `step_completed` event rather than introducing a heartbeat that would compete with
`build_progress` / `build_no_progress` (conflict D-2). The `category` field is advisory and gates
nothing (C5).

**Documentation** is owned by this repository's `maintain-documentation` custom step, which runs
against the shipped diff; per the `/plan` documentation boundary no documentation tasks appear
below. `docs/guides/running-the-daemon.md` and `docs/runbooks/stalled-or-stuck-feature.md` are the
pages that step will need to touch. No CLI flag and no config key is added, so
`docs/reference/cli.md` and `docs/reference/configuration.md` are expected to be unaffected —
verified against the task set below, which adds no `--` flag and no `config.*` key.

## Prerequisites

None. No migration, no dependency, no external setup. `.pipeline/` already exists per worktree and
is gitignored.

## Tasks

### Task 1: Define the build-outcome record shape and its pure settle classifier
**Story:** Story 1 — Every build step records whether it moved the tree, happy path — moved/no-movement classification and the resolved-count union
**Type:** infrastructure

**Steps:**
1. Write failing test: `classifyBuildSettle` returns `'moved'` for differing non-null tree hashes,
   `'no-movement'` for equal hashes, and `'moved'` when hashes are equal but `resolvedAfter >
   resolvedBefore`.
2. Verify test fails (RED)
3. Implement the `BuildOutcomeRecord` interface (`outcome`, `terminalOutcome`, `gate`, `verdict`,
   `rung`, `treeBefore`, `treeAfter`, `headBefore`, `headAfter`, optional `note`, optional
   `category`) and the pure `classifyBuildSettle`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(build-outcome): pure settle classifier and record shape"

**Files likely touched:**
- src/conductor/src/engine/build-outcome.ts — new module: types + `classifyBuildSettle`
- src/conductor/test/engine/build-outcome.test.ts — new unit test

**Wired-into:** none (inert until src/conductor/src/engine/conductor.ts)
**Dependencies:** none

---

### Task 2: Null tree hashes classify as no-movement without throwing
**Story:** Story 1 — Every build step records whether it moved the tree, negative path — git cannot produce a tree hash
**Type:** negative-path

**Steps:**
1. Write failing test: `classifyBuildSettle` with `treeBefore: null`, with `treeAfter: null`, and
   with both null each returns `'no-movement'` and throws nothing.
2. Verify test fails (RED)
3. Implement the null guard in `classifyBuildSettle`.
4. Verify test passes (GREEN)
5. Commit with message: "fix(build-outcome): null tree hash classifies as no-movement"

**Files likely touched:**
- src/conductor/src/engine/build-outcome.ts — null handling in `classifyBuildSettle`
- src/conductor/test/engine/build-outcome.test.ts — three null cases

**Wired-into:** same as Task 1
**Dependencies:** Task 1

---

### Task 3: `sameNoOpCycle` matches only on a definite four-component match
**Story:** Story 4 — An identical no-movement cycle is refused before it is paid for, happy path — definite four-component match
**Type:** happy-path

**Steps:**
1. Write failing test: a table asserting `sameNoOpCycle` returns `true` only when `gate`, tree hash,
   `verdict`, and `rung` are all present and equal on a `no-movement` prior; and `false` for each
   single-axis mismatch (different tree, different gate, different verdict, prior `outcome: "moved"`,
   absent prior).
2. Verify test fails (RED)
3. Implement `sameNoOpCycle` as a pure four-component equality with no fallbacks.
4. Verify test passes (GREEN)
5. Commit with message: "feat(build-outcome): definite-match no-op cycle comparison"

**Files likely touched:**
- src/conductor/src/engine/build-outcome.ts — `sameNoOpCycle`
- src/conductor/test/engine/build-outcome.test.ts — mismatch table

**Wired-into:** same as Task 1
**Dependencies:** Task 1

---

### Task 4: A null or absent component never matches, and the rung guards a capable retry
**Story:** Story 4 — An identical no-movement cycle is refused before it is paid for, negative paths — null components and a higher escalation rung
**Type:** negative-path

**Steps:**
1. Write failing test: `sameNoOpCycle` returns `false` when the prior tree hash is `null`, when the
   current tree hash is `null`, and when the prior rung is `(sonnet, medium)` against a current
   `(opus, high)`. Assert the module does not import `classifyBuildProgress`.
2. Verify test fails (RED)
3. Implement the definite-presence requirement and the rung comparison (C1, C2).
4. Verify test passes (GREEN)
5. Commit with message: "fix(build-outcome): null and rung mismatches never match a prior cycle"

**Files likely touched:**
- src/conductor/src/engine/build-outcome.ts — presence and rung checks
- src/conductor/test/engine/build-outcome.test.ts — null and rung cases

**Wired-into:** same as Task 1
**Dependencies:** Task 3

---

### Task 5: Fail-open read of the build-outcome sidecar
**Story:** Story 7 — A missing, corrupt, or discarded sidecar fails open, negative paths — missing, invalid JSON, wrong version, bad shape, unreadable
**Type:** negative-path

**Steps:**
1. Write failing test: `readBuildOutcome` returns the empty record set for a missing file, invalid
   JSON, an unsupported `version`, a well-formed file failing the shape guard, and an unreadable
   path — five cases, none throwing; the non-ENOENT cases log one warning naming the path.
2. Verify test fails (RED)
3. Implement `readBuildOutcome` and `isBuildOutcomeRecord`, mirroring
   `kickback-ledger.ts:67-89`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(build-outcome): fail-open sidecar read"

**Files likely touched:**
- src/conductor/src/engine/build-outcome.ts — `readBuildOutcome`, shape guard
- src/conductor/test/engine/build-outcome.test.ts — five fail-open cases

**Wired-into:** same as Task 1
**Dependencies:** Task 1

---

### Task 6: Atomic sidecar write with temp-file cleanup on failure
**Story:** Story 7 — A missing, corrupt, or discarded sidecar fails open, happy path — no partial file observable; negative path — rename failure
**Type:** infrastructure

**Steps:**
1. Write failing test: `writeBuildOutcome` writes via a temp file then `rename`; on a simulated
   rename failure the temp file is removed and no partial sidecar remains.
2. Verify test fails (RED)
3. Implement `writeBuildOutcome`, mirroring `kickback-ledger.ts:92-111`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(build-outcome): atomic sidecar write"

**Files likely touched:**
- src/conductor/src/engine/build-outcome.ts — `writeBuildOutcome`
- src/conductor/test/engine/build-outcome.test.ts — atomicity and cleanup cases

**Wired-into:** none (inert until src/conductor/src/engine/conductor.ts)
**Dependencies:** Task 1

---

### Task 7: Capture the tree-hash baseline at the existing build-step entry probe
**Story:** Story 1 — Every build step records whether it moved the tree, happy path — baseline captured at the existing headShaBeforeBuild site
**Type:** infrastructure

**Steps:**
1. Write failing test: entering a `build` step captures a tree-hash baseline alongside
   `headShaBeforeBuild`, asserted at the injected git boundary; exactly one build-step-entry probe
   block exists (conflict D-1).
2. Verify test fails (RED)
3. Add the `treeHashBeforeBuild` capture beside `headShaBeforeBuild` at `conductor.ts:4938-4949`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(conductor): capture tree-hash baseline at build-step entry"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — build-step entry baseline capture
- src/conductor/test/engine/build-outcome-stamp.test.ts — new bounded conductor test

**Wired-into:** src/conductor/src/engine/conductor.ts#run
**Dependencies:** Task 1

---

### Task 8: Stamp the record on a successful build settle, reusing the existing tail
**Story:** Story 1 — Every build step records whether it moved the tree, happy path — terminalOutcome done, note reuses the existing tail
**Type:** happy-path

**Steps:**
1. Write failing test: a `build` step settling successfully writes `.pipeline/build-outcome.json`
   whose latest record has `terminalOutcome: "done"`, both witness pairs populated, and a `note`
   identical to the `tail` value emitted on `step_completed`.
2. Verify test fails (RED)
3. Call `writeBuildOutcome` at the `step_completed` emit site (`conductor.ts:7503-7522`), sourcing
   `note` from the already-computed `tail` at `:7508` (C4) — no re-read of provider output.
4. Verify test passes (GREEN)
5. Commit with message: "feat(conductor): stamp build outcome on successful settle"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — stamp at the `step_completed` emit site
- src/conductor/test/engine/build-outcome-stamp.test.ts — success-path stamp assertions

**Wired-into:** src/conductor/src/engine/conductor.ts#run
**Dependencies:** Task 6, Task 7

---

### Task 9: Stamp on a failed build terminal outcome
**Story:** Story 1 — Every build step records whether it moved the tree, negative path — step_failed still stamps
**Type:** negative-path

**Steps:**
1. Write failing test: a `build` step ending in `step_failed` still writes a record, with
   `terminalOutcome: "failed"` (C3).
2. Verify test fails (RED)
3. Add the stamp to the `step_failed` terminal path.
4. Verify test passes (GREEN)
5. Commit with message: "fix(conductor): stamp build outcome on a failed settle"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — stamp on the failed terminal path
- src/conductor/test/engine/build-outcome-stamp.test.ts — failed-path case

**Wired-into:** same as Task 8
**Dependencies:** Task 8

---

### Task 10: Stamp on a no-verdict terminal outcome including authFailure
**Story:** Story 1 — Every build step records whether it moved the tree, negative path — no-verdict and authFailure still stamp
**Type:** negative-path

**Steps:**
1. Write failing test: a `build` step ending with a no-verdict outcome carrying reason
   `authFailure` still writes a record with `terminalOutcome: "no-verdict"` and
   `reason: "authFailure"` (C3).
2. Verify test fails (RED)
3. Add the stamp to the no-verdict terminal path.
4. Verify test passes (GREEN)
5. Commit with message: "fix(conductor): stamp build outcome on a no-verdict settle"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — stamp on the no-verdict terminal path
- src/conductor/test/engine/build-outcome-stamp.test.ts — authFailure case

**Wired-into:** same as Task 8
**Dependencies:** Task 8

---

### Task 11: An unwritable `.pipeline/` never fails the build
**Story:** Story 1 — Every build step records whether it moved the tree, negative path — unwritable .pipeline/ never fails the build
**Type:** negative-path

**Steps:**
1. Write failing test: with `.pipeline/` unwritable, a build step's own result and emitted events
   are byte-identical to the un-stamped baseline and no error propagates.
2. Verify test fails (RED)
3. Wrap the stamp call so write failures are swallowed, matching `writeHaltMarker`'s best-effort
   contract.
4. Verify test passes (GREEN)
5. Commit with message: "fix(conductor): a failed build-outcome stamp never fails a build"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — best-effort stamp call
- src/conductor/test/engine/build-outcome-stamp.test.ts — unwritable-`.pipeline/` case

**Wired-into:** same as Task 8
**Dependencies:** Task 8

---

### Task 12: Record both witnesses so an empty commit is legible, not contradictory
**Story:** Story 1 — Every build step records whether it moved the tree, negative path — empty commit, HEAD moves while the tree is identical
**Type:** negative-path

**Steps:**
1. Write failing test: a build landing an empty commit produces a record with `outcome:
   "no-movement"`, `treeBefore === treeAfter`, and `headBefore !== headAfter`, while the existing
   `unattributed_progress` event still reports HEAD as moved — neither suppresses the other.
2. Verify test fails (RED)
3. Populate `headBefore`/`headAfter` from the existing `headShaBeforeBuild` / attempt-end SHA values
   without modifying the stall breaker at `conductor.ts:5824-5877`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(conductor): record both movement witnesses on the build stamp"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — populate the commit-SHA witness on the record
- src/conductor/test/engine/build-outcome-stamp.test.ts — empty-commit case

**Wired-into:** same as Task 8
**Dependencies:** Task 8

---

### Task 13: Derive the advisory category, preferring a declared dispute artifact
**Story:** Story 3 — A build agent's conclusion reaches a durable, readable artifact, happy paths — category values and declared-artifact precedence
**Type:** happy-path

**Steps:**
1. Write failing test: `category` is one of `disputes-gate` / `belongs-to-decide` /
   `silent-no-movement`; a valid `.pipeline/build-dispute.json` category takes precedence; an
   absent or malformed one falls back to inference with no error; empty provider output yields an
   absent `note` and `silent-no-movement`.
2. Verify test fails (RED)
3. Implement the inference and the optional dispute-artifact read (never required — D2).
4. Verify test passes (GREEN)
5. Commit with message: "feat(build-outcome): advisory dispute category with optional artifact"

**Files likely touched:**
- src/conductor/src/engine/build-outcome.ts — category inference and dispute-artifact read
- src/conductor/test/engine/build-outcome.test.ts — category and dispute-artifact cases

**Wired-into:** same as Task 8
**Dependencies:** Task 8

---

### Task 14: Prove the category gates nothing
**Story:** Story 3 — A build agent's conclusion reaches a durable, readable artifact, negative path — category must not influence control flow
**Type:** negative-path

**Steps:**
1. Write failing test: over an otherwise identical fixture, flipping `category` across all three
   values yields byte-identical refusal, escalation, and halt-disposition outcomes (C5).
2. Verify test fails (RED)
3. Ensure no consumer reads `category` on a decision path; if one does, remove the read.
4. Verify test passes (GREEN)
5. Commit with message: "test(build-outcome): category is advisory and gates no decision"

**Files likely touched:**
- src/conductor/test/engine/build-outcome-stamp.test.ts — parameterized category invariance test

**Wired-into:** none (no new production surface)
**Dependencies:** Task 13

---

### Task 15: Carry the tree-scoped movement fact on `step_completed`
**Story:** Story 2 — The daemon log distinguishes a no-movement build from a moving one, happy path — the event carries the tree fact; negative path — no competing heartbeat
**Type:** infrastructure

**Steps:**
1. Write failing test: a `build` `step_completed` event carries the tree witness fields; no new
   event type is introduced that competes with `build_progress` / `build_no_progress` (conflict
   D-2).
2. Verify test fails (RED)
3. Add the optional fields to the `step_completed` variant and populate them at the emit site.
4. Verify test passes (GREEN)
5. Commit with message: "feat(events): carry the build tree-movement fact on step_completed"

**Files likely touched:**
- src/conductor/src/types/events.ts — optional fields on the `step_completed` variant
- src/conductor/src/engine/conductor.ts — populate the fields at the emit site
- src/conductor/test/engine/build-outcome-stamp.test.ts — event-shape assertions

**Wired-into:** src/conductor/src/engine/conductor.ts#run
**Dependencies:** Task 12

---

### Task 16: Render the tree-scoped annotation in the daemon log
**Story:** Story 2 — The daemon log distinguishes a no-movement build from a moving one, happy path — daemon render; negative paths — non-build steps, legacy events
**Type:** happy-path

**Steps:**
1. Write failing test: `build` renders `(tree abc1234 unchanged)` or `(tree abc1234..def5678)`; the
   no-movement line contains `tree` and no unqualified "no movement" claim; a non-`build` step's
   line is unchanged from baseline; an event lacking the fields renders the legacy bare line; an
   indeterminate hash renders `tree unknown` and makes no no-movement claim.
2. Verify test fails (RED)
3. Extend the `step_completed` case at `daemon-cli.ts:2055`, guarded to `build` only.
4. Verify test passes (GREEN)
5. Commit with message: "feat(daemon): render the tree-scoped build movement annotation"

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — `step_completed` render case
- src/conductor/test/engine/daemon-cli-render.test.ts — render cases

**Wired-into:** src/conductor/src/daemon-cli.ts#renderDaemonEvent
**Dependencies:** Task 15

---

### Task 17: Render the same distinction in interactive runs
**Story:** Story 2 — The daemon log distinguishes a no-movement build from a moving one, happy path — interactive renderer parity
**Type:** happy-path

**Steps:**
1. Write failing test: `ui/create-renderer.ts` renders the same tree-scoped distinction for `build`
   and leaves every other step's line unchanged.
2. Verify test fails (RED)
3. Extend the renderer's `step_completed` case at `ui/create-renderer.ts:110`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(ui): render the tree-scoped build movement annotation"

**Files likely touched:**
- src/conductor/src/ui/create-renderer.ts — `step_completed` render case
- src/conductor/test/ui/create-renderer.test.ts — render cases

**Wired-into:** src/conductor/src/ui/create-renderer.ts#createRenderer
**Dependencies:** Task 15

---

### Task 18: Refuse a definite-match empty cycle before re-entering build
**Story:** Story 4 — An identical no-movement cycle is refused before it is paid for, happy path — zero provider calls on a match; negative paths — each mismatch dispatches
**Type:** happy-path

**Steps:**
1. Write failing test: with a matching prior `no-movement` record, a `wiring_check` kickback halts
   with **zero** provider invocations at the injected `StepRunner`/`LLMProvider` boundary; with any
   mismatched component, or no prior record, the build dispatches normally.
2. Verify test fails (RED)
3. Evaluate `sameNoOpCycle` before the `navigateStateBack(..., 'build', ...)` re-entry, short-
   circuiting ahead of `consumeKickbackBudget` (`conductor.ts:3344`).
4. Verify test passes (GREEN)
5. Commit with message: "feat(conductor): refuse a known-empty kickback cycle before dispatch"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — pre-dispatch refusal ahead of the build re-entry
- src/conductor/test/engine/build-outcome-refusal.test.ts — new bounded conductor test

**Wired-into:** src/conductor/src/engine/conductor.ts#run
**Dependencies:** Task 4, Task 8

---

### Task 19: A refusal leaves the kickback ledger untouched
**Story:** Story 4 — An identical no-movement cycle is refused before it is paid for, negative path — the kickback ledger is untouched
**Type:** negative-path

**Steps:**
1. Write failing test: `.pipeline/kickback-ledger.json` is byte-identical before and after a
   refusal fires (D7).
2. Verify test fails (RED)
3. Confirm the refusal returns before any `consumeKickbackBudget` call; adjust ordering if not.
4. Verify test passes (GREEN)
5. Commit with message: "test(conductor): a refusal never consumes kickback budget"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — refusal ordering relative to budget consumption
- src/conductor/test/engine/build-outcome-refusal.test.ts — ledger-invariance case

**Wired-into:** same as Task 18
**Dependencies:** Task 18

---

### Task 20: Compose a halt reason that names the operator's decision
**Story:** Story 5 — The halt reason names what the operator must decide, happy paths — all three categories; negative paths — HALT.class and re-kick unchanged
**Type:** happy-path

**Steps:**
1. Write failing test: the composed reason names the gate, states the build changed nothing, and
   names the decision, quoting the note when present; `.pipeline/HALT.class` contains exactly
   `needs-human` (D6); `.pipeline/HALT`'s first non-empty line stays a single reason line for a
   multi-line note; `rekickSweep`'s `{cleared, skipped}` result is byte-identical to the pre-change
   baseline for the same fixture.
2. Verify test fails (RED)
3. Implement the composer and call it at the two `wiring_check` halt sites
   (`conductor.ts:4247-4259`, `:6764-6772`), leaving `writeHaltMarker`'s class argument as
   `'needs-human'`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(conductor): halt reason names the operator's decision"

**Files likely touched:**
- src/conductor/src/engine/build-outcome.ts — pure halt-reason composer
- src/conductor/src/engine/conductor.ts — call the composer at the two wiring_check halt sites
- src/conductor/test/engine/build-outcome-halt-reason.test.ts — composer and re-kick cases

**Wired-into:** src/conductor/src/engine/conductor.ts#run
**Dependencies:** Task 13, Task 18

---

### Task 21: A real wiring gap still halts, unchanged
**Story:** Story 6 — A genuine wiring failure still halts and still requires a human, negative paths — cap unchanged, no auto-pass, evidence untouched, dispatch bounded
**Type:** negative-path

**Steps:**
1. Write failing test: a moving-but-unfixing build reaches the existing `MAX_KICKBACKS_PER_GATE`
   cap halt with a reason and `HALT.class` matching the pre-change baseline; the wiring evidence
   file is byte-identical to baseline when a dispute is recorded (D8); the build-dispatch count for
   a repeating failure never exceeds the pre-change baseline; a refusal halts and never skips the
   gate forward.
2. Verify test fails (RED)
3. Adjust only what the assertions require — the expected outcome is that no production change is
   needed here beyond confirming the earlier tasks did not alter these paths.
4. Verify test passes (GREEN)
5. Commit with message: "test(conductor): a genuine wiring gap still halts needs-human"

**Files likely touched:**
- src/conductor/test/engine/build-outcome-refusal.test.ts — negative-path regression cases

**Wired-into:** none (no new production surface)
**Dependencies:** Task 20

---

## Task Dependency Graph

```text
Task 1  (record shape + classifier)
 ├─ Task 2  (null → no-movement)
 ├─ Task 3  (sameNoOpCycle) ── Task 4  (null + rung never match)
 ├─ Task 5  (fail-open read)
 ├─ Task 6  (atomic write) ─┐
 └─ Task 7  (entry baseline) ┴─ Task 8  (stamp on success)
                                 ├─ Task 9   (stamp on failed)
                                 ├─ Task 10  (stamp on no-verdict)
                                 ├─ Task 11  (unwritable .pipeline/)
                                 ├─ Task 12  (both witnesses) ── Task 15 (event fields)
                                 │                                ├─ Task 16 (daemon render)
                                 │                                └─ Task 17 (ui render)
                                 └─ Task 13  (advisory category) ── Task 14 (category gates nothing)

Task 4 + Task 8 ── Task 18 (pre-dispatch refusal)
                    ├─ Task 19 (ledger untouched)
                    └─ Task 20 (halt reason)  ← also depends on Task 13
                        └─ Task 21 (real gap still halts)
```

Acyclic. Tasks 2–7 are independent of one another and may run in any order after Task 1.

## Integration Points

- **After Task 8** — the sidecar is written end to end for a real build settle; `.pipeline/build-outcome.json` can be inspected on a live run.
- **After Task 12** — both witnesses are recorded, so the empty-commit case is observable before any renderer changes.
- **After Task 17** — outcome 1 is fully deliverable: the daemon log and interactive runs both distinguish a tree-unchanged build.
- **After Task 19** — outcome 3 is fully deliverable and provably budget-neutral.
- **After Task 20** — outcomes 2 and 4 are deliverable: the dispute and the decision both reach `.pipeline/HALT`.

## Coverage Mapping

| Story | Tasks |
|---|---|
| Every build step records whether it moved the tree | 1, 2, 7, 8, 9, 10, 11, 12 |
| The daemon log distinguishes a no-movement build from a moving one | 15, 16, 17 |
| A build agent's conclusion reaches a durable, readable artifact | 8 (note), 13, 14 |
| An identical no-movement cycle is refused before it is paid for | 3, 4, 18, 19 |
| The halt reason names what the operator must decide | 20 |
| A genuine wiring failure still halts and still requires a human | 21 |
| A missing, corrupt, or discarded sidecar fails open | 5, 6, 11 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Every task carries a `**Wired-into:**` line
- [ ] No terminal catch-all validation task (Task 21 owns named negative-path regressions, not a
      re-validation of the feature)
- [ ] No task touches CHANGELOG.md or VERSION
- [ ] No task names another feature's sealed `.docs/` artifact
