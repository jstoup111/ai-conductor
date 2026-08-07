**Status:** Accepted

# Stories: Engine-stamped build outcome for a disputed kickback

Issue: jstoup111/ai-conductor#1336
Track: technical (no PRD — acceptance criteria live here)
Tier: M
Authority: `adr-2026-08-05-build-settle-outcome-stamp.md` (APPROVED, D1–D8) and
`architecture-review-2026-08-05-build-agent-disputing-a-wiring-check-kickback-in-p.md`
(APPROVED WITH CONDITIONS, C1–C5).

Requirement ids below are the issue's five desired outcomes (`OUT-1` … `OUT-5`). Every story tags
the outcome it serves and the binding ADR decision or review condition it encodes.

---

## Story 1: Every build step records whether it moved the tree

**Requirement:** OUT-1 (enables OUT-3), D1, C3

As an operator reading a halted feature, I want the engine itself to record whether each build step
changed the worktree, so that "the build ran" and "the build did something" stop being the same
observation.

### Acceptance Criteria

#### Happy Path
- Given a build step that commits at least one change, when the step reaches its terminal outcome,
  then `.pipeline/build-outcome.json` exists and its latest record has `outcome: "moved"` with
  `treeBefore` and `treeAfter` set to different non-null hashes.
- Given any build step, when it settles, then the record carries **both** movement witnesses —
  `treeBefore`/`treeAfter` (the classification witness) and `headBefore`/`headAfter` (the commit-SHA
  witness `adr-2026-07-23-commit-movement-liveness-floor` already maintains) — so the two guards'
  observations of the same turn are recorded side by side rather than inferred from each other.
- Given the build step's existing entry-time `headShaBeforeBuild` capture, when the tree-hash
  baseline is taken, then it is captured at that same site rather than at a new probe point.
- Given a build step whose provider settles successfully but which changes nothing, when the step
  reaches its terminal outcome, then the latest record has `outcome: "no-movement"` and
  `treeBefore === treeAfter`.
- Given a build step that changes no files but marks a task resolved, when the step settles, then
  the record has `outcome: "moved"` with `resolvedAfter > resolvedBefore` — matching the union
  `classifyBuildProgress` already applies.
- Given any build step, when it settles, then the record carries the `gate` that kicked back (or
  `null` when the build was not entered via a kickback), the gate verdict at entry, and the
  escalation rung (model + effort) the step dispatched at.

#### Negative Paths
- Given a build step that ends in `step_failed`, when the step reaches that terminal outcome, then a
  record is still written with `terminalOutcome: "failed"` — the sidecar is not success-only (C3).
- Given a build step that ends with a no-verdict outcome carrying reason `authFailure`, when the
  step terminates, then a record is still written with `terminalOutcome: "no-verdict"` and
  `reason: "authFailure"` (C3).
- Given `git` cannot produce a tree hash (non-git directory, unborn HEAD), when the step settles,
  then the record is written with `treeBefore` and/or `treeAfter` as `null` and
  `outcome: "no-movement"`, and no exception propagates out of the settle boundary.
- Given the `.pipeline/` directory cannot be written (permission denied), when the step settles,
  then the write failure is swallowed, the step's own outcome is unchanged, and the run continues —
  a failed stamp never fails a build.
- Given a build step that lands an **empty commit** (HEAD moves, tree byte-identical), when the step
  settles, then the record has `outcome: "no-movement"` with `treeBefore === treeAfter` AND
  `headBefore !== headAfter`, and the existing `unattributed_progress` event still reports HEAD as
  moved — the two witnesses disagree by design and both are recorded, with neither overwriting nor
  suppressing the other.

### Done When
- [ ] `src/conductor/src/engine/build-outcome.ts` exports a pure `classifyBuildSettle` returning
      `'moved' | 'no-movement'` from `(treeBefore, treeAfter, resolvedBefore, resolvedAfter)`.
- [ ] `.pipeline/build-outcome.json` is written at the build step's terminal outcome for all three
      terminal kinds (`done`, `failed`, `no-verdict`), verified by three separate tests.
- [ ] A unit test asserts a null `treeBefore` or `treeAfter` yields `'no-movement'` without throwing.
- [ ] A test asserts an unwritable `.pipeline/` leaves the step result byte-identical to the
      un-stamped baseline.
- [ ] The record schema carries both witness pairs, and an empty-commit test asserts
      `treeBefore === treeAfter` with `headBefore !== headAfter` in the same record.
- [ ] The tree-hash baseline is captured at the existing `headShaBeforeBuild` site
      (`conductor.ts:4940`) — verified by there being exactly one build-step-entry probe block.

---

## Story 2: The daemon log distinguishes a no-movement build from a moving one

**Requirement:** OUT-1

As an operator triaging from `.daemon/daemon.log` alone, I want a settled build to say whether it
moved the tree, so that I can tell a productive turn from an empty one without opening a worktree.

### Acceptance Criteria

#### Happy Path
- Given a build step that moved the tree from `abc1234` to `def5678`, when the step completes, then
  the daemon log line for that step names the movement — e.g. `build ✓ done (tree abc1234..def5678)`
  — rather than the bare `build ✓ done` printed today.
- Given a build step that settled successfully without moving the tree, when the step completes,
  then the daemon log line marks it unambiguously and **tree-scoped** — e.g.
  `build ✓ done (tree abc1234 unchanged)`. The line MUST NOT use the unqualified word "movement",
  because the engine's other witness (HEAD commit SHA, per
  `adr-2026-07-23-commit-movement-liveness-floor`) may legitimately report movement on the same turn.
- Given the same two cases, when the run is interactive rather than daemon, then
  `ui/create-renderer.ts` surfaces the same distinction.

#### Negative Paths
- Given a tree hash could not be determined, when the step completes, then the log line says the
  movement is unknown (e.g. `tree unknown`) and does NOT claim no-movement — an unobservable tree
  must never be reported as a confirmed empty turn.
- Given a step other than `build` completes, when it is rendered, then its log line is byte-identical
  to today's output — no movement annotation leaks onto unrelated steps.
- Given an event log written by an older engine with no movement field, when it is rendered, then
  the renderer falls back to today's bare line rather than throwing or printing `undefined`.
- Given a build step that landed an empty commit, when the daemon log is read end to end, then the
  `unattributed_progress` line (HEAD moved) and the `step_completed` line (tree unchanged) are both
  present and each names its own witness, so an operator can see they describe different facts
  rather than contradicting each other.
- Given this feature's annotation, when a build runs long enough to emit `build_progress` /
  `build_no_progress` heartbeats, then no duplicate or competing heartbeat is introduced — the
  annotation appears only on the terminal `step_completed`.

### Done When
- [ ] `daemon-cli.ts`'s `step_completed` case renders the tree-scoped annotation for `build` only.
- [ ] `ui/create-renderer.ts` renders the same distinction for interactive runs.
- [ ] A test asserts a non-`build` step's rendered line is unchanged from the pre-change baseline.
- [ ] A test renders an event lacking the movement field and asserts the legacy line is produced.
- [ ] A test asserts the rendered no-movement line contains the word `tree` and does not contain an
      unqualified "no movement" claim.
- [ ] A test asserts no new event type competes with `build_progress` / `build_no_progress`.

---

## Story 3: A build agent's conclusion reaches a durable, readable artifact

**Requirement:** OUT-2, C4, C5

As an operator, I want the build agent's stated conclusion — "the gate is wrong", "this belongs to
DECIDE" — to survive in an artifact something reads, so that it stops sitting unread in
`.pipeline/events.jsonl` while the halt reason says only that nothing moved.

### Acceptance Criteria

#### Happy Path
- Given a build step whose provider output ends with a dispute, when the step settles, then the
  record's `note` field carries that output, and the note is the same bounded value
  `step_completed.tail` already carries — the last 200 lines — not a re-read or an unbounded capture
  (C4).
- Given provider output longer than 200 lines, when the step settles, then the note contains exactly
  the last 200 lines and no more.
- Given a build step whose note is dispute-shaped, when the record is written, then `category` is set
  to one of `disputes-gate` / `belongs-to-decide` / `silent-no-movement`.
- Given `.pipeline/build-dispute.json` exists and declares a category, when the record is written,
  then the declared category is used in preference to the inferred one.

#### Negative Paths
- Given `.pipeline/build-dispute.json` is absent, when the record is written, then every behavior in
  this story and in every other story still holds — the agent artifact is never required (D2).
- Given `.pipeline/build-dispute.json` is present but malformed JSON or fails its shape check, when
  the record is written, then it is ignored, the inferred category is used, and no error surfaces to
  the run.
- Given a record whose `category` is `disputes-gate`, when the pre-dispatch refusal, the kickback
  escalation, and the halt disposition are evaluated, then none of the three reads `category` —
  asserted by a test that flips the category between all three values over an otherwise identical
  fixture and observes byte-identical control-flow decisions (C5).
- Given the provider produced no output at all, when the step settles, then `note` is absent (not the
  empty string) and `category` is `silent-no-movement`.

### Done When
- [ ] The note is sourced from the existing `tail` value at the `step_completed` emit site; a test
      asserts a 250-line provider output yields exactly 200 note lines.
- [ ] A test with `build-dispute.json` absent exercises the full no-movement → halt path and passes.
- [ ] A parameterized test over all three `category` values asserts identical refusal, escalation,
      and disposition outcomes.
- [ ] A malformed `build-dispute.json` test asserts the inferred category is used and the run is
      unaffected.

---

## Story 4: An identical no-movement cycle is refused before it is paid for

**Requirement:** OUT-3, C1, C2, D7

As the daemon, I want to refuse re-entering `build` for a cycle already observed to produce nothing,
so that a feature stops burning 0.5M–2.4M input tokens re-running a turn whose outcome is already
recorded.

### Acceptance Criteria

#### Happy Path
- Given a prior record with `outcome: "no-movement"` for gate `wiring_check`, tree `abc1234`, verdict
  `fail`, rung `(opus, high)`, when the conductor is about to re-enter `build` under a `wiring_check`
  kickback at the same tree, verdict, and rung, then no build step is dispatched and the run halts.
- Given that refusal, when it fires, then no provider call is made for the build step — asserted at
  the injected `StepRunner`/`LLMProvider` boundary, not merely by token count.
- Given the refusal fires, when the halt is written, then it is the *first* dispatch of that cycle
  that is skipped — the previously observed cycle was paid for exactly once.

#### Negative Paths
- Given a prior no-movement record whose tree hash is `null`, when the refusal is evaluated, then it
  does NOT fire and the build dispatches — a null component is never a match (C1).
- Given the current tree hash cannot be determined, when the refusal is evaluated, then it does NOT
  fire and the build dispatches (C1). This is the inverse of `classifyBuildProgress`, which folds
  null into `'no-work'`; a test asserts the refusal does not delegate to that helper.
- Given a prior no-movement record at rung `(sonnet, medium)`, when the next dispatch would run at
  `(opus, high)`, then the refusal does NOT fire and the build dispatches — a strictly more capable
  retry is never refused (C2).
- Given a prior no-movement record for gate `manual_test`, when `wiring_check` is the kicking-back
  gate, then the refusal does NOT fire — records are matched per gate.
- Given a prior no-movement record at tree `abc1234`, when the current tree is `def5678`, then the
  refusal does NOT fire.
- Given a prior record with `outcome: "moved"`, when every other component matches, then the refusal
  does NOT fire.
- Given no prior record exists at all (first kickback of a fresh feature), then the refusal does NOT
  fire.
- Given the refusal fires, when `.pipeline/kickback-ledger.json` is inspected afterwards, then the
  kickback count is unchanged — `MAX_KICKBACKS_PER_GATE` remains solely owned by #984 (D7).

### Done When
- [ ] `build-outcome.ts` exports a pure `sameNoOpCycle(prior, current)` returning `true` only when
      all four components are present, comparable, and equal.
- [ ] A test table covers each mismatch axis (tree, gate, verdict, rung) and both null axes, and
      asserts `false` for every one.
- [ ] An acceptance test drives the conductor through a refused re-entry and asserts zero provider
      invocations at the injected boundary.
- [ ] A test asserts the kickback ledger's count is byte-identical before and after a refusal.

---

## Story 5: The halt reason names what the operator must decide

**Requirement:** OUT-4, D6

As an operator reading a re-kick skip line, I want the halt reason to state the decision in front of
me, so that I do not have to reconstruct it from a worktree that says only "no movement occurred".

### Acceptance Criteria

#### Happy Path
- Given a no-movement halt whose record carries a `belongs-to-decide` category and a note, when the
  halt is written, then `.pipeline/HALT` names the gate, states that the build made no change, and
  states the decision — that the operator must choose between accepting the gate's finding and
  returning the feature to DECIDE — and quotes the recorded note.
- Given the same halt, when `daemon-rekick`'s sweep logs the skip, then the logged reason carries that
  decision text rather than the generic no-movement string alone.
- Given a no-movement halt with a `silent-no-movement` category (no dispute recorded), when the halt
  is written, then the reason names the decision as investigating why the build produced nothing.

#### Negative Paths
- Given any halt in this feature, when `.pipeline/HALT.class` is read, then it contains exactly
  `needs-human` — the `HaltClass` union is not extended and `readHaltClass` recognizes no new value
  (D6).
- Given a no-movement halt, when `daemon-rekick`'s sweep runs, then the feature is skipped on every
  sweep exactly as today — a test asserts the sweep's `cleared`/`skipped` result is byte-identical to
  the pre-change baseline for the same fixture.
- Given a recorded note containing content that would break the halt marker's first-line reason
  contract (embedded newlines, a very long single line), when the halt is written, then the first
  non-empty line remains a single readable reason and the note is quoted below it.
- Given no note was recorded, when the halt is written, then the reason still names the decision and
  contains no empty quotation block or `undefined`.

### Done When
- [ ] A halt-reason composer is exercised by unit tests over all three category values plus the
      no-note case, asserting the decision sentence is present in each.
- [ ] A test asserts `.pipeline/HALT.class` contents equal `needs-human` for every halt this feature
      can produce.
- [ ] A `rekickSweep` test asserts the same `{cleared, skipped}` result as the pre-change baseline.
- [ ] A test with a multi-line note asserts `.pipeline/HALT`'s first non-empty line is a single
      reason line.

---

## Story 6: A genuine wiring failure still halts and still requires a human

**Requirement:** OUT-5, D6, D7, D8

As the maintainer of the wiring gate, I want a build that really failed to close a real gap to behave
exactly as it does today, so that this change cannot become an automatic pass or an unbounded retry.

### Acceptance Criteria

#### Happy Path
- Given a build that committed changes but left the wiring gap open, when the gate re-fails, then the
  record says `moved`, the pre-dispatch refusal does not fire, and the kickback budget is consumed
  exactly as before this change.
- Given repeated moving-but-unfixing builds, when `MAX_KICKBACKS_PER_GATE` is reached, then the run
  halts with the existing cap reason and `needs-human`, unchanged.
- Given a build that moved the tree and closed the gap, when the gate re-runs, then it passes and the
  run proceeds — this change adds no new failure mode to the success path.

#### Negative Paths
- Given a build that disputes the gate in prose but the wiring gap is real, when the halt is written,
  then the run still halts and still requires a human — recording the dispute never converts it into
  a pass. The engine writes no gate verdict of its own (D8).
- Given a build whose recorded category is `disputes-gate`, when `wiring_check` is next evaluated,
  then its evidence and verdict are computed exactly as today — `artifacts.ts`'s HEAD-gated
  re-derivation is untouched, asserted by a test that the wiring evidence file is byte-identical to
  the pre-change baseline for the same fixture (D8).
- Given the pre-dispatch refusal fires, when the halt is written, then it is a halt and never a skip
  forward past the gate — a test asserts the gate's state remains unsatisfied.
- Given any path in this feature, when the run completes, then no code path grants a retry beyond the
  existing `MAX_KICKBACKS_PER_GATE` — asserted by a test that the maximum number of build dispatches
  for a repeating failure is less than or equal to the pre-change baseline.

### Done When
- [ ] An acceptance test drives a moving-but-unfixing build to the existing cap halt and asserts the
      reason and `HALT.class` match the pre-change baseline.
- [ ] A test asserts wiring evidence is byte-identical to baseline when a dispute is recorded.
- [ ] A test asserts the build-dispatch count for a repeating failure never exceeds the pre-change
      baseline.

---

## Story 7: A missing, corrupt, or discarded sidecar fails open

**Requirement:** OUT-3 (bounding its failure mode), D7

As the daemon, I want an unreadable build-outcome sidecar to allow a dispatch rather than block one,
so that the guard's failure mode is a wasted turn and never a feature that can no longer be built.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/build-outcome.json` does not exist, when the refusal is evaluated, then it does not
  fire and the build dispatches.
- Given the sidecar is written concurrently by two writers, when it is read, then a reader never
  observes a partially written file — the write is a temp-file `rename(2)`, matching
  `kickback-ledger.ts`.
- Given a worktree is deleted and recreated from its branch (#497 class), when the feature is
  re-dispatched, then the sidecar is absent, the refusal does not fire, and a fresh dispatch proceeds.

#### Negative Paths
- Given the sidecar contains invalid JSON, when it is read, then an empty record set is returned, a
  warning is logged once, and the run continues — matching `readKickbackLedger`'s fail-open contract.
- Given the sidecar declares an unsupported `version`, when it is read, then it is treated as empty
  and a warning naming the path is logged.
- Given the sidecar's JSON is well-formed but fails its shape guard (missing `outcome`, non-string
  `treeHash`), when it is read, then it is treated as empty rather than partially trusted.
- Given the sidecar cannot be read for any reason (`EACCES`, `EISDIR`), when it is read, then the read
  resolves to empty and never throws into the conductor loop.
- Given the temp file cannot be renamed, when the write fails, then the temp file is removed and no
  partial sidecar is left behind.

### Done When
- [ ] `readBuildOutcome` returns the empty record set for: missing file, invalid JSON, wrong version,
      failed shape guard, and an unreadable path — five separate tests, none of which throw.
- [ ] `writeBuildOutcome` writes via temp file + `rename`, and a test asserts the temp file is removed
      on a simulated rename failure.
- [ ] An acceptance test deletes the sidecar mid-feature and asserts the next dispatch proceeds.

---

**Status:** Accepted
