# Implementation Plan: Setup-before-dispatch wedge — deterministic setup-failure triage (#446)

**Date:** 2026-07-09
**Design:** .docs/decisions/adr-2026-07-09-setup-failure-triage.md (APPROVED)
**Stories:** .docs/stories/setup-before-dispatch-wedge-deterministic-setup-fa.md (TS-1..TS-5, Accepted)
**Conflict check:** Clean as of 2026-07-09 (.docs/conflicts/2026-07-09-setup-failure-triage.md — 1 resolved)

## Summary

Adds a two-stage setup-failure triage (mechanical quarantine+retry, then one
mechanically-verified fix-session) at the daemon's worktree-prepare seam, in 17 TDD tasks.

## Technical Approach

- **Classification (TS-1):** `prepareWorktree` (src/conductor/src/engine/worktree-prepare.ts)
  gains a typed `SetupFailureError` thrown ONLY when `bin/setup` itself fails (spawn failure
  included), carrying the final 50 lines of combined output (`execa`'s `all` is already
  captured; on throw the execa error object exposes the same). Namespace-write failures and
  the no-`bin/setup` no-op keep today's untyped path — triage never sees them.
- **Triage core (TS-2..TS-4):** new pure module `src/conductor/src/engine/setup-triage.ts`,
  dependency-injected (`git` runner bound to the worktree, `runPrepare`, `dispatchFixSession`,
  `log`), returning a discriminated union: `pass | quarantined-pass | fixed-pass | park`.
  Quarantine mechanism: `git add -A` + `git commit` on the feature branch → `git branch -f
  wip/setup-quarantine-<slug> <sha>` → `git reset --hard HEAD~1`. Preservation is a commit
  BEFORE any reset by construction; any git failure before the branch ref exists aborts the
  triage with the tree restored/untouched (abort-toward-error-park). The retry re-runs the
  FULL prepare (namespace `.env` re-established after the reset cleans it).
- **Fix-session (TS-3):** new `resolveSetupFailure(ctx)` on `StepRunner`
  (src/conductor/src/engine/step-runners.ts, `DefaultStepRunner` at :279), mirroring
  `resolveRebaseConflict` (:~604): fresh session per dispatch, prompt = setup output tail +
  explicit success contract. The engine verifies the contract itself: re-run full prepare
  (exit 0) AND `git status --porcelain` empty. Exactly one dispatch per rotation; dispatch
  throw ⇒ contract failure.
- **Wiring (TS-2..TS-5):** `makeRunFeature` (src/conductor/src/engine/daemon-runner.ts:192–204)
  catches `SetupFailureError` when `deps.daemon` is true and runs triage; `pass`-flavored
  outcomes continue to `runConductor`, `park` routes to the existing error-park with an
  extended diagnostic HALT (writer at :359–372) naming the output tail, quarantine ref (or its
  absence), and contract outcome. A `.pipeline/QUARANTINE` sentinel (REKICK-sentinel shape,
  daemon-rekick.ts precedent) surfaces the ref + preserved paths to the resuming build agent.
  Production deps wired in src/conductor/src/daemon-cli.ts next to the rebase resolver
  (:1216–1238); test spawns guarded by the global vitest env kill-switch convention.
- **Sequencing:** classification → triage core (quarantine → retry → fix-session → park) →
  runner wiring → surfacing → production wiring → superseded-test updates → docs.

## Prerequisites

None — no schema, config, or CLI surface changes. Engine-internal; if the self-host release
gate's path classifier flags a canonical surface, commit a waiver at
`.docs/release-waivers/setup-before-dispatch-wedge-deterministic-setup-fa.md` (expected NOT
needed: no bin/conduct CLI, hook wiring, settings schema, or symlink targets touched).

## Tasks

### Task 1: Typed SetupFailureError with output tail
**Story:** TS-1 happy (classified failure carries tail); TS-1 negative (spawn ENOENT/EACCES classified)
**Type:** happy-path

**Steps:**
1. Write failing tests in test/engine/worktree-prepare.test.ts: `bin/setup` exit≠0 rejects
   with `SetupFailureError` exposing `outputTail` containing the script's last output lines
   (assert a marker string from the stub script's stderr); a non-executable/missing-interpreter
   spawn failure also rejects with `SetupFailureError` carrying the spawn error text.
2. Verify RED.
3. Implement: export `class SetupFailureError extends Error { outputTail: string }` from
   worktree-prepare.ts; in `runProjectSetup`'s catch, build the tail (last 50 lines of
   `err.all ?? err.message`) and throw the typed error.
4. Verify GREEN.
5. Commit: "feat(engine): classify bin/setup failures as SetupFailureError with output tail"

**Files:**
- src/conductor/src/engine/worktree-prepare.ts
- src/conductor/test/engine/worktree-prepare.test.ts

**Dependencies:** none

### Task 2: Non-setup failures stay unclassified
**Story:** TS-1 negatives (namespace-write failure bypasses triage; absent bin/setup no-op)
**Type:** negative-path

**Steps:**
1. Write failing tests: a namespace `.env` write failure (unwritable worktree dir) rejects
   with a plain Error (NOT `instanceof SetupFailureError`); a worktree with no `bin/setup`
   resolves without error and without any triage-observable effect.
2. Verify RED (the instanceof assertion is the new part).
3. Implement: ensure only `runProjectSetup`'s script-failure path throws the typed error.
4. Verify GREEN.
5. Commit: "test(engine): namespace failures and absent bin/setup never classify as setup failure"

**Files:**
- src/conductor/src/engine/worktree-prepare.ts
- src/conductor/test/engine/worktree-prepare.test.ts

**Dependencies:** Task 1

### Task 3: setup-triage module — types and tree classifier
**Story:** TS-2 (dirty vs clean routing); TS-3 (clean-HEAD routing)
**Type:** infrastructure

**Steps:**
1. Write failing tests in new test/engine/setup-triage.test.ts: `classifyTree(git)` returns
   `dirty` for modified-tracked, staged, and untracked states (porcelain fixtures); `clean`
   for an empty porcelain output.
2. Verify RED.
3. Implement: create src/conductor/src/engine/setup-triage.ts with injected `GitRunner`,
   `TriageOutcome` discriminated union (`pass | quarantined-pass | fixed-pass | park` with
   evidence fields: outputTail, quarantineRef?, preservedPaths?, contractOutcome?), and
   `classifyTree`.
4. Verify GREEN.
5. Commit: "feat(engine): setup-triage module skeleton — outcome types + tree classifier"

**Files:**
- src/conductor/src/engine/setup-triage.ts
- src/conductor/test/engine/setup-triage.test.ts

**Dependencies:** none

### Task 4: Quarantine step — preserve-then-reset via branch ref
**Story:** TS-2 happy (ALL uncommitted+untracked preserved BEFORE reset; branch ref created)
**Type:** happy-path

**Steps:**
1. Write failing test (temp git repo): dirty tree (tracked mod + untracked file) →
   `quarantine(git, slug)` creates `wip/setup-quarantine-<slug>` whose tip commit contains
   both files byte-for-byte (hash comparison), feature branch ends clean at the original
   HEAD, and the returned value names the ref + preserved paths.
2. Verify RED.
3. Implement: `git add -A` → `git commit` → capture SHA → `git branch -f
   wip/setup-quarantine-<slug> <sha>` → `git reset --hard HEAD~1`.
4. Verify GREEN.
5. Commit: "feat(engine): quarantine step — preserve dirty state to wip/setup-quarantine ref before reset"

**Files:**
- src/conductor/src/engine/setup-triage.ts
- src/conductor/test/engine/setup-triage.test.ts

**Dependencies:** Task 3

### Task 5: Preservation failure aborts triage, tree untouched
**Story:** TS-2 negative (git failure during preservation ⇒ byte-for-byte untouched tree, error-park)
**Type:** negative-path

**Steps:**
1. Write failing test: inject a git runner that fails the `commit` call → triage returns
   `park` with the preservation failure named; `git status --porcelain` output is identical
   before/after; no `wip/setup-quarantine-<slug>` ref exists; no reset ran.
2. Verify RED.
3. Implement: on any preservation-phase git failure, roll back staging (`git reset` index
   only if `add` succeeded), return `park` immediately — never proceed to reset/retry.
4. Verify GREEN.
5. Commit: "feat(engine): preservation failure aborts triage toward error-park, tree untouched"

**Files:**
- src/conductor/src/engine/setup-triage.ts
- src/conductor/test/engine/setup-triage.test.ts

**Dependencies:** Task 4

### Task 6: Retry-once re-runs the FULL prepare
**Story:** TS-2 happy (retry passes ⇒ quarantined-pass); TS-2 Done-When (.env re-established)
**Type:** happy-path

**Steps:**
1. Write failing test: injected `runPrepare` that fails first call, passes second →
   `runTriage` on a dirty tree returns `quarantined-pass`; `runPrepare` was called exactly
   once post-quarantine (full prepare, not bare setup — assert the injected fn is the
   prepare-shaped one); simulated `.env` removal by the reset is repaired because the retry
   goes through `runPrepare`.
2. Verify RED.
3. Implement: after quarantine, call injected `runPrepare(worktreePath)` once; success ⇒
   `quarantined-pass`, failure ⇒ fall through to fix-session stage carrying the retry's tail.
4. Verify GREEN.
5. Commit: "feat(engine): post-quarantine retry re-runs full prepare exactly once"

**Files:**
- src/conductor/src/engine/setup-triage.ts
- src/conductor/test/engine/setup-triage.test.ts

**Dependencies:** Task 4

### Task 7: Existing quarantine branch is refreshed
**Story:** TS-2 negative (pre-existing wip/setup-quarantine-<slug> force-moved, refresh logged)
**Type:** negative-path

**Steps:**
1. Write failing test: pre-create `wip/setup-quarantine-<slug>` at an old commit → new
   quarantine moves the branch to the new tip; the log sink received a "refreshed" line; the
   old tip SHA still resolves (`git rev-parse` on the old SHA succeeds).
2. Verify RED.
3. Implement: `git branch -f` already force-moves; add the refresh detection (ref existed?)
   and log line.
4. Verify GREEN.
5. Commit: "feat(engine): refresh existing quarantine branch, log the move"

**Files:**
- src/conductor/src/engine/setup-triage.ts
- src/conductor/test/engine/setup-triage.test.ts

**Dependencies:** Task 4

### Task 8: Zero-touch guarantees
**Story:** TS-1/TS-2 negatives (setup exit 0 ⇒ no triage side effects; dirty tree + passing setup untouched)
**Type:** negative-path

**Steps:**
1. Write failing tests: `runTriage` is never invoked when prepare succeeds (assert at the
   runner-wiring seam via ordering array — placeholder here, asserted again in Task 13);
   within triage, a dirty tree is never quarantined unless the initial failure is present
   (guard: triage only constructed with a `SetupFailureError`); no `.pipeline/QUARANTINE`,
   no ref, no log line on the happy path.
2. Verify RED where assertable at module level.
3. Implement: constructor/entry guard requiring the classified failure as input.
4. Verify GREEN.
5. Commit: "test(engine): zero happy-path side effects from setup triage"

**Files:**
- src/conductor/src/engine/setup-triage.ts
- src/conductor/test/engine/setup-triage.test.ts

**Dependencies:** Task 6

### Task 9: StepRunner.resolveSetupFailure fix-session method
**Story:** TS-3 happy (one dispatch, prompt carries output tail)
**Type:** infrastructure

**Steps:**
1. Write failing test (injected provider, no real spawn — kill-switch respected): calling
   `resolveSetupFailure({ worktreePath, outputTail, slug })` assembles a fresh session
   (new uuid, mirrors resolveRebaseConflict) whose prompt contains the output tail and the
   success contract text; returns `{ attempted: true }`-shaped result.
2. Verify RED.
3. Implement: add `resolveSetupFailure` to the StepRunner interface + DefaultStepRunner
   (src/conductor/src/engine/step-runners.ts), modeled on resolveRebaseConflict.
4. Verify GREEN.
5. Commit: "feat(engine): StepRunner.resolveSetupFailure — bounded fix-session dispatch"

**Files:**
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/step-runners.test.ts

**Dependencies:** none

### Task 10: Fix-session stage — mechanical contract verification
**Story:** TS-3 happy + all three TS-3 negatives
**Type:** happy-path

**Steps:**
1. Write failing tests with an injected `dispatchFixSession` seam: (a) seam resolves, then
   injected `runPrepare` passes and porcelain is empty ⇒ `fixed-pass`; (b) seam resolves
   claiming success but `runPrepare` still fails ⇒ `park` with contractOutcome
   `setup-still-failing` (claim ignored); (c) `runPrepare` passes but porcelain dirty ⇒
   `park` with the dirty paths named; (d) seam throws ⇒ `park`, seam called exactly once.
2. Verify RED.
3. Implement: fix-session stage in setup-triage.ts — one `dispatchFixSession` call, then
   engine-side verification (runPrepare + porcelain), outcomes per union.
4. Verify GREEN.
5. Commit: "feat(engine): fix-session stage with engine-verified success contract"

**Files:**
- src/conductor/src/engine/setup-triage.ts
- src/conductor/test/engine/setup-triage.test.ts

**Dependencies:** Task 6, Task 9

### Task 11: Park evidence — extended diagnostic HALT
**Story:** TS-4 happy (HALT names tail + quarantine ref + contract outcome); TS-4 negative (no-ref case explicit)
**Type:** happy-path

**Steps:**
1. Write failing tests in test/engine/daemon-runner.test.ts: a `park` triage outcome produces
   a `.pipeline/HALT` whose content includes the output tail, the quarantine ref when taken,
   the literal statement that no quarantine exists in the clean-HEAD case, and the contract
   outcome; park status/rekick eligibility identical to a plain errored feature.
2. Verify RED.
3. Implement: extend the diagnostic HALT writer (daemon-runner.ts:359–372 area) to accept
   triage evidence and render it.
4. Verify GREEN.
5. Commit: "feat(engine): diagnostic HALT carries setup-triage evidence"

**Files:**
- src/conductor/src/engine/daemon-runner.ts
- src/conductor/test/engine/daemon-runner.test.ts

**Dependencies:** Task 10

### Task 12: HALT-write failure still parks
**Story:** TS-4 negative (fs error on HALT write ⇒ still parked, failure logged)
**Type:** negative-path

**Steps:**
1. Write failing test: make the HALT write fail (unwritable .pipeline) → feature outcome is
   still `error`/parked; log sink received the write-failure line; no dispatch happened.
2. Verify RED (if current writer already swallows, assert the log line — the new part).
3. Implement: keep the existing `.catch(() => {})` swallow but route through the log sink.
4. Verify GREEN.
5. Commit: "fix(engine): HALT write failure logs and never converts a failed triage into a dispatch"

**Files:**
- src/conductor/src/engine/daemon-runner.ts
- src/conductor/test/engine/daemon-runner.test.ts

**Dependencies:** Task 11

### Task 13: makeRunFeature wiring — daemon-only triage routing
**Story:** TS-2 happy (feature dispatches after quarantined-pass); TS-1 negative (non-setup errors keep today's path); zero-touch ordering
**Type:** happy-path

**Steps:**
1. Write failing tests in test/engine/daemon-runner.test.ts: prepare throwing
   `SetupFailureError` with `deps.daemon` true and an injected triage returning
   `quarantined-pass` ⇒ order is createWorktree → prepareWorktree → triage → runConductor;
   triage returning `park` ⇒ runConductor never runs, worktree kept, outcome error; prepare
   throwing a PLAIN Error ⇒ triage never invoked (today's path byte-identical); prepare
   succeeding ⇒ triage never invoked.
2. Verify RED.
3. Implement: wrap the `deps.prepareWorktree` call; catch `instanceof SetupFailureError`,
   run injected `runSetupTriage` (optional dep — absent ⇒ today's behavior), route outcomes.
4. Verify GREEN.
5. Commit: "feat(engine): route classified setup failures through triage in makeRunFeature"

**Files:**
- src/conductor/src/engine/daemon-runner.ts
- src/conductor/test/engine/daemon-runner.test.ts

**Dependencies:** Task 10

### Task 14: Quarantine surfacing to the resuming agent
**Story:** TS-5 (all criteria)
**Type:** happy-path

**Steps:**
1. Write failing tests: a quarantine this rotation (or an existing
   `wip/setup-quarantine-<slug>` ref) ⇒ `.pipeline/QUARANTINE` sentinel written in the
   worktree naming ref + preserved paths + "recover deliberately" text, and the build
   dispatch context includes it; no quarantine ⇒ no sentinel, no notice; sentinel present
   but ref deleted externally ⇒ notice states the ref is missing, dispatch proceeds.
2. Verify RED.
3. Implement: sentinel write in the triage wiring (REKICK-sentinel shape,
   daemon-rekick.ts:37 precedent); include-file in the conductor dispatch context assembly.
4. Verify GREEN.
5. Commit: "feat(engine): surface quarantine ref to the resuming build agent via .pipeline/QUARANTINE"

**Files:**
- src/conductor/src/engine/setup-triage.ts
- src/conductor/src/engine/daemon-runner.ts
- src/conductor/test/engine/setup-triage.test.ts
- src/conductor/test/engine/daemon-runner.test.ts

**Dependencies:** Task 13

### Task 15: Production wiring in daemon-cli
**Story:** TS-2/TS-3 (real deps: worktree git runner, fresh DefaultStepRunner per fix-session)
**Type:** infrastructure

**Steps:**
1. Write failing test (wiring-level, injected): the daemon deps construction passes a
   `runSetupTriage` built from makeGitRunner(worktreePath), prepareWorktree, and a
   fix-session dispatcher that constructs a fresh DefaultStepRunner (uuid session) — assert
   shape/args, not a real spawn (env kill-switch).
2. Verify RED.
3. Implement: wire in src/conductor/src/daemon-cli.ts adjacent to the rebase resolver
   (:1216–1238 pattern) and thread through makeFeatureRunnerDeps
   (src/conductor/src/engine/daemon-deps.ts).
4. Verify GREEN.
5. Commit: "feat(daemon): wire production setup-triage deps (git runner + fix-session step runner)"

**Files:**
- src/conductor/src/daemon-cli.ts
- src/conductor/src/engine/daemon-deps.ts
- src/conductor/test/engine/daemon-cli-setup-triage.test.ts

**Dependencies:** Task 13, Task 9

### Task 16: Update superseded pinned tests (conflict resolution)
**Story:** conflict resolution 2026-07-09 (harness-daemon-profile TR-1 supersession)
**Type:** refactor

**Steps:**
1. Update test/engine/daemon-runner.test.ts "a prepareWorktree failure aborts before the
   build and keeps the worktree" (:194 area) and any worktree-prepare pinned assertions:
   keep-worktree stays; terminal assertion becomes routed-to-triage (absent triage dep ⇒
   legacy errored path still asserted for backward compat).
2. Run the full engine test file set; verify GREEN.
3. Commit: "test(engine): supersede keep-worktree/errored pins with routed-to-triage (#446 conflict resolution)"

**Files:**
- src/conductor/test/engine/daemon-runner.test.ts
- src/conductor/test/engine/worktree-prepare.test.ts

**Dependencies:** Task 13

### Task 17: Docs + CHANGELOG
**Story:** repo conventions (docs track features; CHANGELOG [Unreleased] gate)
**Type:** infrastructure

**Steps:**
1. Update src/conductor/README.md (daemon behavior: setup-failure triage, quarantine ref,
   fix-session, HALT evidence) and root README.md if daemon docs there mention setup failure.
2. Add CHANGELOG.md `## [Unreleased]` → Added entry. Verify no canonical breaking surface is
   touched (expected none); if the release-gate classifier flags one, add the waiver file
   .docs/release-waivers/setup-before-dispatch-wedge-deterministic-setup-fa.md instead of an
   empty migration block.
3. Run test/test_harness_integrity.sh; verify pass.
4. Commit: "docs: setup-failure triage — README + CHANGELOG"

**Files:**
- src/conductor/README.md
- README.md
- CHANGELOG.md

**Dependencies:** Task 15, Task 16

## Task Dependency Graph

```
T1 → T2
T3 → T4 → T5
      T4 → T6 → T8
      T4 → T7
T9 ─┐
T6 ─┴→ T10 → T11 → T12
       T10 → T13 → T14
T13 + T9 → T15
T13 → T16
T15 + T16 → T17
(T1/T2 feed T13's classification catch; independent start: T1, T3, T9)
```

## Integration Points

- After Task 8: triage core fully testable end-to-end at module level (temp git repos).
- After Task 13: daemon-runner path testable — classified failure → triage → dispatch/park.
- After Task 15: full production wiring; a real self-host daemon exercises triage on the next
  wedged worktree.

## Verification

- [ ] All happy path criteria covered: TS-1→T1, TS-2→T4/T6/T13, TS-3→T9/T10, TS-4→T11, TS-5→T14
- [ ] All negative path criteria covered: TS-1→T2 (+T1 spawn case), TS-2→T5/T7/T8 (+T6 fall-through),
      TS-3→T10(b,c,d) + rotation bound via T13 park semantics, TS-4→T11(no-ref)/T12, TS-5→T14
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies explicit and acyclic (graph above)
- [ ] Conflict-resolution test update included (T16)
