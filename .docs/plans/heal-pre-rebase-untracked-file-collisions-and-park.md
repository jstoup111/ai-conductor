# Implementation Plan: Heal pre-rebase untracked-file collisions and park them accurately

**Date:** 2026-09-06
**Stories:** .docs/stories/heal-pre-rebase-untracked-file-collisions-and-park.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent stays inside `performRebase` and halt-note selection, and leaves the gated resolution sub-loop's cap, dispatch, and acceptance guards exactly as the approved record describes them.

## Summary

Four bounded tasks deliver #415: recognise git's refusal to start a rebase because untracked files
would be overwritten, quarantine those files non-destructively, retry once, report the quarantine on
the existing rebase event bridge, and park an unhealable refusal with a recovery procedure that
works. The gated resolver sub-loop, the resolver skill, gate invalidation, other refusal classes,
and any restoration policy for quarantined files are outside this slice.

## Technical Approach

`performRebase` already reaches the exact branch this fixes: after `git rebase --autostash <base>`
exits non-zero it inspects unmerged paths and, finding none, returns a `conflict_halt` carrying the
raw git stderr. Insert the heal in that branch, gated on `rebaseStateActive` reporting no rebase
state — that probe is the mechanism that distinguishes "git refused to start" from "git paused
mid-rebase", and it already exists in the same module and is used by the pre-existing-rebase guard
higher up the function.

Recognition is a deterministic parser over git's own refusal text, not a substring search: match the
literal header line "error: The following untracked working tree files would be overwritten by
checkout:" and take the tab-indented lines that follow it until the "Please move or remove them"
line. Any other refusal text yields no paths and no heal. Each parsed path is then confirmed against
the worktree before anything moves — it must be relative, must not escape the worktree once joined
and normalised, and must be reported untracked by a porcelain status probe on that exact path. A
path failing any of those checks aborts the whole heal without moving a single file, because a
partially applied heal is worse than none.

Quarantine moves, never deletes: each confirmed path is relocated under a fixed directory inside the
worktree's gitignored pipeline directory, recreating its relative path beneath it. An existing entry
at a destination aborts the heal before any move, so the mechanism cannot overwrite an earlier
quarantine. Exactly one retry of the same `git rebase --autostash <base>` invocation follows a
complete quarantine; its result then flows through the function's existing classification, so a
clean retry produces the ordinary clean outcome with evidence translation, and a retry that stops on
real unmerged paths produces the ordinary paused-conflict outcome that the gated resolver already
handles.

Two carriers make the result legible downstream. The outcome type gains an optional quarantine
record — the moved paths and the directory holding them — that applies to every outcome kind, so a
healed clean rebase and a still-failed one both carry it. The `conflict_halt` variant gains an
optional start-failure flag, set only when git refused before creating rebase state. Nothing else
reads the flag except halt-note selection: `resolveRebaseConflicts`'s `onto === null` early return
stays exactly as it is, because dispatching an LLM resolver whose contract is `git rebase
--continue` at a state where no rebase exists is the wrong remedy, not a missing one.

Reporting rides the existing spine. `emitRebaseEvent` is the bridge both call sites already use, so
one new `ConductorEvent` variant emitted there — before the outcome's own event, whenever the
outcome carries a quarantine record — reaches every bus consumer with no call-site change and no
second format. Its sink declaration persists it to the event ledger; a daemon-log renderer is not
part of this slice.

Halt-note selection moves behind one exported helper in the same module that takes the outcome and
picks between today's conflict note and a new never-started note modelled on the existing seal
refusal note, which is the established precedent in this file for a refusal that must not send an
operator to `git rebase --continue`. Both existing rebase halt call sites switch to that helper, so
neither path can drift from the other.

Testing follows the repository's test-design rules. Parsing, path confirmation, and the quarantine
move are pure enough to unit-test with an injected runner and a temporary directory. Behaviour that
depends on git's own refusal and recovery semantics uses a real throwaway repository, following the
existing autostash real-git test in this suite as the pattern: initialise with a pinned initial
branch and local identity, no remote, and remove the exact temporary directory afterwards. Call-site
proof reuses the existing finish-time wiring fixture and the existing re-kick test module. No
ordinary test may reach a real LLM, GitHub, or any network service.

## Preconditions and claim ledger

- Verified: `src/conductor/src/engine/rebase.ts` defines `conflictedFiles`, `rebaseStateActive`, `writeHalt`, `writeSealHalt`, `RebaseOutcome`, `PerformRebaseOpts`, `performRebase`, `resolveRebaseConflicts`, and `emitRebaseEvent`, all exported from that one module.
- Verified: `performRebase` runs `git rebase --autostash <base>` and, on a non-zero exit with no unmerged paths, returns a `conflict_halt` whose reason is the raw git stderr.
- Verified: `resolveRebaseConflicts` returns the incoming outcome untouched when neither rebase state file resolves, so the resolver is never dispatched for a refusal that created no rebase state.
- Verified: `src/conductor/src/engine/conductor.ts` and `src/conductor/src/engine/daemon-rekick.ts` are the only two call sites that pass a rebase outcome to `writeHalt`, and both already call `emitRebaseEvent` with that same outcome.
- Verified: `src/conductor/src/engine/event-sinks.ts` declares `EVENT_SINKS` as a total record over the event union's type keys, so a new variant requires a row there.
- Verified: `src/conductor/test/engine/rebase-autostash.test.ts` is an existing real-git test of `performRebase` with a temporary repository, a pinned initial branch, and no remote.
- Verified: `src/conductor/test/engine/rebase-resolution-wiring.test.ts` exercises the finish-time rebase step against a real throwaway repository, and `src/conductor/test/engine/daemon-rekick.test.ts` exercises the play-forward re-kick path.
- Verified on git 2.53.0: an untracked file colliding with a path the base introduces as tracked makes the autostash rebase exit non-zero with the untracked-overwrite refusal, creates neither rebase state directory, reports no unmerged paths, and rebases cleanly once the file is moved aside.
- Scope check: consumer-facing engine behaviour; no new skill; provider-agnostic. Event spine: one added union variant on the existing bridge, no new channel.
- Verify-claims verdict: CLEAR. Every path, symbol, and behaviour above was read in this worktree or reproduced locally; no unconfirmed assumption changes the approach.

## Tasks

### Task 1: Recognise the refusal and confirm what may be quarantined
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/rebase.ts, src/conductor/test/engine/rebase-start-blocked.test.ts
**Dependencies:** none

**Steps:**
1. Write failing unit tests for a parser over git refusal text: the untracked-overwrite refusal yields its tab-indented path list in order; the unstaged-changes refusal, a bare "could not detach HEAD" line, and empty text each yield no paths.
2. Write failing unit tests for path confirmation against an injected status runner and a temporary directory: an absolute path, a path escaping the worktree after normalisation, and a path the status probe does not report untracked are each refused by name; a confirmed untracked path is accepted.
3. Write failing unit tests for the quarantine move: accepted paths are relocated under the fixed quarantine directory inside the worktree pipeline directory with their relative path recreated, byte content preserved; an already-occupied destination refuses before moving anything.
4. Establish RED, then implement the parser, the confirmation checks, and the move helper as small module-internal functions in the rebase module, exported only as far as the tests need.
5. Run the focused test file through the project's scoped test invocation, then its typecheck target that includes tests, and commit.

**Done when:**
1. Unit cases take the path list only from the untracked-overwrite refusal and return no paths for the unstaged-changes refusal, the detach-HEAD line, and empty text.
2. Unit cases refuse an absolute path, a path escaping the worktree, and a path the status probe does not report untracked, each naming the rejected path.
3. Unit cases prove an accepted path is moved under the quarantine directory with its bytes preserved, and that an occupied destination refuses before any file is moved.

### Task 2: Retry the rebase once after a complete quarantine
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/rebase.ts, src/conductor/test/engine/rebase-start-blocked.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing real-git tests using a temporary repository with a pinned initial branch, local identity, and no remote: a feature branch, a base commit introducing a path as tracked, and an untracked file at that same path in the feature worktree.
2. Add cases for the healed clean rebase, for a retry that stops on a genuine content conflict in a different file, for a second refusal after the quarantine, for a named path that is not untracked, and for an occupied quarantine destination.
3. Establish RED, then implement the branch in `performRebase`: when the rebase exits non-zero, no unmerged paths exist, and no rebase state directory is present, run Task 1's recognition, confirmation, and quarantine, then reissue the same autostash rebase exactly once.
4. Carry the results on the outcome: add an optional quarantine record applying to every outcome kind and an optional start-failure flag on the conflict outcome, set only when git refused before any rebase state existed. Leave the pre-existing in-progress guard and the unmerged-path branch untouched.
5. Run the focused test file and the existing rebase test modules through the project's scoped test invocation, then its typecheck target that includes tests, and commit.

**Done when:**
1. A real-git test proves the rebase completes after the heal and leaves the base version of the collided path checked out on the feature branch.
2. A real-git test proves the quarantined file's original bytes are readable from the quarantine directory after that heal.
3. A real-git test proves exactly one retry is issued: a second refusal returns a conflict outcome flagged as a start failure rather than a further rebase invocation.
4. A real-git test proves a retry that stops on a genuine content conflict returns the ordinary paused-conflict outcome with the quarantine record still carried.
5. A real-git test proves a path that is not untracked and an occupied quarantine destination each leave the worktree unchanged and return the start-failure outcome.

### Task 3: Report the quarantine on the existing rebase event bridge
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/types/events.ts, src/conductor/src/engine/event-sinks.ts, src/conductor/src/engine/rebase.ts, src/conductor/test/engine/rebase.test.ts
**Dependencies:** 2

**Steps:**
1. Write failing tests against `emitRebaseEvent` with a recording emitter: an outcome carrying a quarantine record emits the new variant before the outcome's own event, for a healed clean outcome and for a start-failure outcome; an outcome with no quarantine record emits exactly what it emits today.
2. Establish RED, then add one variant to the event union carrying the moved paths and the quarantine directory, and add its row to the total sink declaration record with persistence enabled and no renderer.
3. Emit the variant from `emitRebaseEvent` inside its existing best-effort guard, so an emitter failure still cannot affect the rebase result.
4. Run the focused rebase and event-sink test modules through the project's scoped test invocation, then its typecheck target that includes tests, and commit.

**Done when:**
1. The event union carries one rebase quarantine variant with the moved paths and the quarantine directory, and the total sink record compiles with its row present.
2. Recorded emissions show the new variant emitted before the outcome's own event for a healed clean outcome and for a start-failure outcome.
3. Recorded emissions for an outcome with no quarantine record match the events emitted before this change, asserted as an exact sequence.

### Task 4: Park a never-started rebase with a recovery procedure that works
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/rebase.ts, src/conductor/src/engine/conductor.ts, src/conductor/src/engine/daemon-rekick.ts, src/conductor/test/engine/rebase-resolution-wiring.test.ts, src/conductor/test/engine/daemon-rekick.test.ts
**Dependencies:** 2

**Steps:**
1. Write failing tests for a halt-selection helper that takes a rebase outcome: a start-failure outcome produces a note stating no rebase is in progress, carrying git's refusal text and a recovery procedure of reviewing the quarantined files, clearing the halt marker, and re-queueing; every other outcome produces today's note unchanged.
2. Establish RED, then implement the helper in the rebase module beside the existing seal refusal note writer, reusing the same halt-marker writer and halt class.
3. Switch the finish-time rebase step and the play-forward re-kick path to call that helper with the outcome, replacing their direct conflict-note calls. Leave the shipment-evidence halt calls in the re-kick module unchanged.
4. Extend the existing finish-time wiring fixture and the existing re-kick test module so each call site is proven to write the start-failure note from a real untracked-collision refusal.
5. Run those two test modules plus the rebase test modules through the project's scoped test invocation, then its typecheck target that includes tests, and commit.

**Done when:**
1. The halt marker written for a start-failure outcome states that no rebase is in progress, includes git's refusal text, and contains no instruction to continue a rebase.
2. The halt marker written for any outcome not flagged as a start failure matches the note produced before this change, asserted for an unmerged-path conflict and for the rebase-already-in-progress refusal.
3. The finish-time rebase step writes the start-failure note, proven through its existing real-git conductor fixture at that call site.
4. The play-forward re-kick path writes the same start-failure note from the same outcome, proven at that call site.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature worktree holds an untracked file at a path the base introduces as tracked, when the rebase step runs, then the colliding file is moved into a quarantine directory under the worktree's pipeline directory and the rebase completes with its ordinary clean outcome. | 1, 2 | "A real-git test proves the rebase completes after the heal and leaves the base version of the collided path checked out on the feature branch." | diff-local |
| Story 1 happy: Given a rebase completed only after colliding untracked files were moved aside, when the rebase step reports its outcome, then the event ledger records one occurrence naming every quarantined path and the quarantine directory holding them. | 3 | "Recorded emissions show the new variant emitted before the outcome's own event for a healed clean outcome and for a start-failure outcome." | diff-local |
| Story 1 negative: Given git names a colliding path that is not reported as untracked in the worktree, when the rebase step runs, then no file is moved, the rebase is not retried, and the feature parks. | 1, 2 | "A real-git test proves a path that is not untracked and an occupied quarantine destination each leave the worktree unchanged and return the start-failure outcome." | diff-local |
| Story 1 negative: Given the quarantine destination for a colliding path is already occupied, when the rebase step runs, then no file is moved or overwritten, the rebase is not retried, and the feature parks. | 1, 2 | "A real-git test proves a path that is not untracked and an occupied quarantine destination each leave the worktree unchanged and return the start-failure outcome." | diff-local |
| Story 1 negative: Given colliding untracked files were moved aside but the retried rebase stops on a genuine content conflict, when the rebase step reports its outcome, then the quarantined paths are still recorded and the conflict follows the existing paused-rebase handling. | 2 | "A real-git test proves a retry that stops on a genuine content conflict returns the ordinary paused-conflict outcome with the quarantine record still carried." | diff-local |
| Story 2 happy: Given git refused to start the rebase and no heal was possible, when the feature parks, then the halt note states that no rebase is in progress, carries git's own refusal text, and gives a recovery procedure that does not instruct continuing a rebase. | 4 | "The halt marker written for a start-failure outcome states that no rebase is in progress, includes git's refusal text, and contains no instruction to continue a rebase." | diff-local |
| Story 2 negative: Given a rebase actually paused on unmerged files, when the feature parks, then the halt note keeps the existing conflict resume procedure unchanged. | 4 | "The halt marker written for any outcome not flagged as a start failure matches the note produced before this change, asserted for an unmerged-path conflict and for the rebase-already-in-progress refusal." | diff-local |
| Story 2 negative: Given a rebase was already in progress when the step ran, when the feature parks, then the existing in-progress refusal message and its resume procedure are unchanged. | 4 | "The halt marker written for any outcome not flagged as a start failure matches the note produced before this change, asserted for an unmerged-path conflict and for the rebase-already-in-progress refusal." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: each is decided inside a temporary repository or a controlled fixture
created by the test itself, so no commit outside this diff can change whether it holds. Task 1 owns
unit coverage of recognition, path confirmation, and the move. Task 2 owns real-git coverage of the
heal, the single retry bound, and the three refusal cases, using real local git because git's own
refusal and checkout semantics are the behaviour under test. Task 3 owns emission coverage at the
existing event bridge with a recording emitter. Task 4 owns cross-boundary integration: the rebase
step is reached through two production entry points, the conductor's finish-time step and the
daemon's play-forward re-kick, and Task 4 proves the halt note at each of them rather than only at
the helper. Third-party boundaries are faked throughout; no ordinary test reaches an LLM, GitHub, or
the network. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3
Task 2 -> Task 4
