# Implementation Plan: Refuse daemon auto-resume of an operator-action halt class

**Date:** 2026-09-06
**Stories:** .docs/stories/refuse-daemon-auto-resume-of-an-operator-action-ha.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the approved total-halt-classification contract, which already fixes the four read dispositions and states that only mechanical and explicitly legacy dispositions are re-kick eligible while needs-human and unclassified remain halted. Nothing here re-decides that contract; it applies it at two sites that predate or bypass it.

## Summary

Three bounded tasks deliver #1713. The daemon's progress-gated cross-dispatch re-kick and its rate-limit episode-end recovery sweep are the two remaining auto-resume paths that re-admit or clear a live halt without reading its class; both gain the classification veto the base-advance sweep already applies, and both name the blocking disposition in the operator-visible log. The classifier itself, the base-advance sweep, the dispatch ceilings, the retry budget, and every marker writer are unchanged. Build-stall exit stamping, an engine-level inherited-halt pre-dispatch guard, halt-clear cause attribution, and a new operator recovery verb are outside this slice.

## Technical Approach

The classification policy already exists and is single-sourced: `readHaltClass` maps a sidecar to one of `needs-human`, `mechanical`, `legacy`, `protected-artifact`, `plan-gap`, or `unclassified`, resolving a missing, unreadable, or unrecognized sidecar to `unclassified`; `isOperatorActionHalt` answers whether that disposition may only be lifted by an operator, and it includes `unclassified`. Reuse exactly that pair at both new sites. Do not add a second eligibility matrix, a new disposition, a new marker, or a new reader — the second desired outcome of the issue (no window where a present marker with an unwritten class reads as resumable) is already satisfied by that reader's fail-closed default, and the marker writer already unlinks a stale class sidecar before writing the body so the intermediate state can only read as `unclassified`.

Site one is the daemon loop's bounded progress-re-kick wrapper. The wrapper is the single chokepoint through which the progress predicate is consulted, and it already owns the per-feature ceiling bookkeeping and its once-per-feature refusal log, so the veto and its log belong there rather than in the predicate the CLI constructs. Add an optional classification-reader dependency to the daemon dependency interface, keyed by feature slug, and consult it inside the wrapper before the ceiling and the delta are considered. A disposition that only an operator may lift returns not-eligible and records one line naming the feature and the disposition, suppressed for repeats with the same once-per-feature set pattern the ceiling refusal already uses. A read that throws is treated as `unclassified` and therefore blocking. When the dependency is absent the wrapper behaves exactly as today, so hand-injected fixtures that do not supply it are unaffected.

Site two is the daemon CLI's episode-end recovery sweep, which today clears every stamped feature's marker after checking only operator-park. Apply the same pair before the clear, in the loop body, immediately after the existing operator-park refusal so the park refusal keeps precedence and its line is unchanged. A blocked feature is skipped with a line naming its disposition; a mechanical-classed feature is cleared exactly as today.

The CLI also owns the wiring: the runDaemon dependency object gains the classification reader for the feature's own worktree, resolved through the same `worktreeBase`/slug join the re-kick sweep's reader already uses, so the two paths cannot drift onto different roots. `readHaltClass` is already imported there.

Recording: both refusals go to the existing daemon logger that already carries the ceiling refusal and the base-advance sweep's own disposition-skip line. This is the same sink and the same operator surface, not a new channel, no watcher, no sidecar, and no stamped artifact, so the event-spine decision procedure stops at its first step and no `ConductorEvent` variant is added.

Tests follow the repository's test-design rules: the daemon-loop behavior is proved through the smallest seam that owns it — a bounded `runDaemon` fixture with injected fakes, a fixed backlog, an idle-poll bound, and no real provider, network, or Git — mirroring the existing progress-ceiling acceptance fixture. The CLI sweep gate is proved against real temporary worktree directories, which are the boundary under test, with the episode tracker and marker primitives real and no third party involved. The existing daemon CLI wiring tests are the established home for proving the dependency object actually threads a dependency; extend them rather than adding a third wiring file. Tests may vary fixture builders and assertion grouping provided the observable boundary proof is preserved.

## Preconditions and claim ledger

- Operator approved Small scope, the reuse-the-existing-classifier approach, the technical track, and both stories on 2026-09-06 (delegated).
- Verified: `src/conductor/src/engine/halt-marker.ts` defines `readHaltClass`, which resolves a missing, unreadable, or unrecognized sidecar to `unclassified`, and `isOperatorActionHalt`, which returns true for `needs-human`, `protected-artifact`, `plan-gap`, and `unclassified`.
- Verified: `src/conductor/src/engine/halt-marker.ts`'s writer unlinks any stale class sidecar before writing the halt body and then replaces the class sidecar through a temp-file rename, so a partially written halt reads as `unclassified`.
- Verified: `src/conductor/src/engine/daemon-rekick.ts` consults that same pair before its clear and logs the disposition that skipped a feature; this is the precedent the two new sites copy.
- Verified: `src/conductor/src/engine/daemon.ts`'s `pickEligible` re-admits a parked feature whose halt marker is still live when the progress predicate returns true, and its bounded progress-re-kick wrapper reads only the per-feature count and the injected predicate — no class is read anywhere on that path.
- Verified: `src/conductor/src/daemon-cli.ts`'s `buildProgressReKickDeps` returns eligible purely on the live resolved count exceeding the sidecar-recorded count, and its episode-end sweep clears each stamped feature's marker after checking only operator-park.
- Verified: `src/conductor/src/daemon-cli.ts` already imports `readHaltClass` and already wires it into the base-advance sweep's dependency object using the same worktree-base join this plan reuses.
- Verified: `src/conductor/test/acceptance/daemon-halts-a-build-that-is-making-forward-progre.acceptance.test.ts` drives `runDaemon` with injected fakes, an injected sleep, and an idle-poll bound to prove ceiling-bounded re-kick counts; it is the fixture shape the new acceptance test follows.
- Verified: `src/conductor/test/engine/daemon-cli-progress-rekick-wiring.test.ts` and `src/conductor/test/engine/daemon-cli-episode-halt-wiring.test.ts` exist and already assert dependency threading for these two paths.
- Verified: `docs/runbooks/stalled-or-stuck-feature.md` documents the build-progress ceilings and the episode-stamped halt recovery in adjacent sections; those are the two paragraphs this change makes stale.
- Verified: this repository's own configuration enables the progress-halt block, and the shipped default is enabled, so both paths are live rather than dormant.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. Event-spine: no new channel — the existing daemon logger already carries the sibling refusals.
- Verify-claims verdict: CLEAR. No load-bearing assumption remains unconfirmed; the disputed question in the source issue — which mechanism performed the resume — is settled by reading the two paths above, and the progress path is the one that admits a live halt with no class read.

## Tasks

### Task 1: Veto a progress-gated re-kick of an operator-action halt
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/src/engine/daemon.ts, src/conductor/test/acceptance/refuse-daemon-auto-resume-of-an-operator-action-ha.acceptance.test.ts
**Dependencies:** none

**Steps:**
1. Write the failing acceptance fixture: a bounded `runDaemon` run over a single-item backlog whose feature halts on its first dispatch, whose progress predicate always reports forward progress, whose dispatch ceiling is above one, and whose injected classification reader returns a chosen disposition. Inject the sleep, bound the run with an idle-poll limit, and capture log lines. Assert the needs-human case dispatches exactly once and yields exactly one outcome for that feature, and that a case with no class sidecar behaves identically.
2. Add the mechanical and legacy cases to the same fixture, asserting the feature is dispatched more than once up to the ceiling, so the veto cannot be satisfied by disabling the path.
3. Assert the declined run records exactly one line naming both the feature and the blocking disposition across the whole run, not one per poll.
4. Verify RED, then add an optional slug-keyed classification-reader dependency to the daemon dependency interface and consult it inside the bounded progress-re-kick wrapper before the ceiling and delta checks, reusing the shipped classifier predicate and the wrapper's existing once-per-feature log-suppression set. Treat a thrown read as blocking. Leave behavior unchanged when the dependency is absent.
5. Verify GREEN, run the repository's typecheck target that covers test files, and commit the focused change.

**Done when:**
1. With the classification reader returning needs-human and a permanently positive progress delta, the bounded daemon run dispatches the feature exactly once and returns exactly one outcome for it.
2. With no class sidecar readable, the same run dispatches the feature exactly once.
3. With the classification reader returning mechanical, and again returning legacy, the same run dispatches the feature more than once and no more than the configured ceiling.
4. The declined run's captured log lines contain exactly one line that names both the feature slug and the blocking disposition.
5. A run supplying no classification-reader dependency reproduces today's dispatch count for a progressing, halted feature.

### Task 2: Supply the real classification reader to the daemon loop
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/test/engine/daemon-cli-progress-rekick-wiring.test.ts
**Dependencies:** 1

**Steps:**
1. Extend the existing progress-re-kick wiring test with a failing assertion that the runDaemon dependency object threads a slug-keyed classification reader resolved against the same worktree base the progress predicate uses, so the veto added in Task 1 is reachable from the production entrypoint rather than only from hand-injected fixtures.
2. Verify RED, then wire the already-imported classification reader into the runDaemon dependency object, joining the worktree base and the slug exactly as the base-advance sweep's dependency object does.
3. Verify GREEN, run the repository's typecheck target that covers test files, and commit.

**Done when:**
1. The production daemon entrypoint's runDaemon dependency object supplies a slug-keyed classification reader built from the shipped reader over the feature's own worktree path.
2. The extended wiring test fails against the entrypoint as it stands before this task and passes after it.
3. No second worktree-root derivation is introduced: the new reader resolves its path the same way the existing base-advance sweep dependency does.

### Task 3: Leave an operator-action halt in place at episode end
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/test/engine/daemon-cli-episode-halt-wiring.test.ts, docs/runbooks/stalled-or-stuck-feature.md
**Dependencies:** 2

**Steps:**
1. Extend the episode-halt wiring test with a failing case over real temporary worktree directories: three stamped features, one classed mechanical, one classed needs-human, one with no class sidecar, each carrying a live halt marker. Drive the episode-end sweep binding with the real tracker and the real marker primitives, capturing its lines. No provider, network, or GitHub call is involved.
2. Verify RED, then apply the shipped classifier predicate over the shipped reader to each stamped feature in the sweep body, immediately after the existing operator-park refusal, skipping a blocked feature with a line naming its disposition and clearing the rest exactly as today.
3. Add a case proving an operator-parked stamped feature is still refused by the pre-existing park check with its existing line, so precedence is unchanged.
4. Update the runbook's build-progress ceilings paragraph and its rate-limit episode paragraph to state that a halt awaiting operator action is never progress-re-kicked and never cleared by episode recovery, and that the log names the disposition that blocked it.
5. Verify GREEN, run the repository's typecheck target that covers test files, and commit.

**Done when:**
1. After the sweep runs over the fixture, the marker file is still present for the needs-human-classed feature and for the feature with no class sidecar.
2. After the same sweep, the marker file is gone for the mechanical-classed feature.
3. The sweep's captured lines name each blocked feature together with its disposition, and the operator-park refusal line is byte-identical to the one produced before this change.
4. The runbook's build-progress ceilings paragraph and its rate-limit episode paragraph each state the classification refusal and that the recorded line names the blocking disposition.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a parked feature whose live halt is classed mechanical and whose last dispatch made forward progress, when the daemon polls for work, then the feature is re-dispatched exactly as it is today, bounded by the existing per-feature dispatch ceiling. | 1 | "With the classification reader returning mechanical, and again returning legacy, the same run dispatches the feature more than once and no more than the configured ceiling." | diff-local |
| Story 1 happy: Given a parked feature whose live halt is classed legacy and whose last dispatch made forward progress, when the daemon polls for work, then the feature is re-dispatched, preserving pre-classification compatibility behavior. | 1 | "With the classification reader returning mechanical, and again returning legacy, the same run dispatches the feature more than once and no more than the configured ceiling." | diff-local |
| Story 1 negative: Given a parked feature whose live halt is classed needs-human and whose live resolved-task count exceeds the count its last dispatch recorded, when the daemon polls for work, then the feature is not dispatched on that poll or any later poll of the same run. | 1, 2 | "With the classification reader returning needs-human and a permanently positive progress delta, the bounded daemon run dispatches the feature exactly once and returns exactly one outcome for it." | diff-local |
| Story 1 negative: Given a parked feature with a live halt whose class is missing, unreadable, or unrecognized, and a positive resolved-task delta, when the daemon polls for work, then the feature is not dispatched. | 1 | "With no class sidecar readable, the same run dispatches the feature exactly once." | diff-local |
| Story 1 negative: Given the daemon declines a progress-gated re-kick on classification, when it records that decision, then the operator-visible line names the feature and the halt disposition that blocked it, and it is recorded once per feature rather than on every poll. | 1 | "The declined run's captured log lines contain exactly one line that names both the feature slug and the blocking disposition." | diff-local |
| Story 2 happy: Given a feature stamped as halted during a rate-limit episode whose live halt is classed mechanical, when the episode ends and the recovery sweep runs, then its marker is cleared and the recovery is recorded exactly as it is today. | 3 | "After the same sweep, the marker file is gone for the mechanical-classed feature." | diff-local |
| Story 2 negative: Given a feature stamped as halted during a rate-limit episode whose live halt is classed needs-human, when the episode ends and the recovery sweep runs, then its marker is left in place and the recorded line names the disposition that blocked the clear. | 3 | "After the sweep runs over the fixture, the marker file is still present for the needs-human-classed feature and for the feature with no class sidecar." | diff-local |
| Story 2 negative: Given a feature stamped as halted during a rate-limit episode whose halt class is missing or unreadable, when the episode ends and the recovery sweep runs, then its marker is left in place. | 3 | "After the sweep runs over the fixture, the marker file is still present for the needs-human-classed feature and for the feature with no class sidecar." | diff-local |
| Story 2 negative: Given a stamped feature is also operator-parked, when the episode ends and the recovery sweep runs, then the existing operator-park refusal still wins and no marker is cleared. | 3 | "The sweep's captured lines name each blocked feature together with its disposition, and the operator-park refusal line is byte-identical to the one produced before this change." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures; no criterion depends on a third party, a real provider, or a network call. Task 1 owns the daemon-loop behavior through a bounded acceptance fixture that drives the real loop with injected fakes — one fixture covers the mechanical, legacy, needs-human, and no-sidecar dispositions plus the once-per-feature recording assertion, because they are the same decision observed under four inputs and do not warrant four fixtures. Task 2 owns the production-reach proof for Story 1: the daemon entrypoint's dependency assembly, which is the boundary a loop-level fixture cannot reach and the exact failure mode that made an earlier progress-re-kick feature inert. Task 3 owns the episode-end sweep integration against real temporary worktree directories, which are the boundary under test, and also carries the runbook correction for both refusals. The existing halt-marker and base-advance sweep tests remain authoritative for the classifier itself and for the disposition matrix; this plan adds no test that re-proves them. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3
