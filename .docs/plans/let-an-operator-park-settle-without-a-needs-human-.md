# Implementation Plan: Let an operator park settle without a needs-human halt

**Date:** 2026-09-06
**Stories:** .docs/stories/let-an-operator-park-settle-without-a-needs-human-.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent narrows one existing daemon-only backstop condition and adds no marker, class, event, or selection rule, so it cannot interact with another feature's contract.

## Summary

Five bounded tasks deliver #1803: one guard in the conductor's markerless-exit backstop so a run that already returned the typed operator-parked termination stops writing a needs-human halt for that exit, plus the unit, acceptance, and regression coverage that keeps a genuinely markerless exit halting exactly as it does today and proves the unparked feature is selectable again.

## Technical Approach

The defect is a single missing input to an existing decision. `run()` in the conductor already owns a shared `stopAtOperatorParkBoundary` helper that emits the park-boundary event and returns the typed operator-parked termination from every guarded dispatch site; the daemon runner classifies that return as a parked outcome without reading any marker. The same method's `finally` block then writes a needs-human halt for any daemon run that reaches it with neither the completion marker nor the halt marker, and that condition looks only at the daemon flag and the two markers. An intentional park and an abnormal unmarked exit are therefore indistinguishable to it, even though the run itself is holding the typed termination that separates them.

Record the park termination in a run-scoped local, set inside that one shared helper immediately before it returns, and read it in the backstop condition. The helper is declared above the `try` in the same method, so the local is in scope in `finally` with no new field, module, or plumbing. Keying the exemption on the run's own termination — not on marker text, log text, or the last emitted event type — is what keeps it narrow: only the five guarded park sites can set it, and every other markerless return still reaches the halt. Do not widen the exemption to the last-event breadcrumb, which is diagnostic text and can be set by any emitter.

Nothing downstream needs teaching. Once the halt is not written, the daemon's existing behavior already delivers the remaining outcomes: the parked outcome parks the claim, an explicit unpark clears the repo-root park marker, and `pickEligible` re-admits a claim-parked slug precisely when its worktree halt check reports clear. The re-kick sweep is untouched, so a genuine needs-human halt is still refused by disposition. The dashboard already filters parked slugs out of the halted group and renders every remaining halted slug with its reason and a clear-to-resume remedy, so the fourth desired outcome is already satisfied in production and this plan pins it with coverage rather than changing it.

Follow the repository's test-design rules for every task. Unit cases inject the step runner and the park-boundary reader and keep artifact verification off, since mocked runner success is their authority. The acceptance case exercises the real internal path — a real daemon-mode conductor run, the real worktree halt reader, and the real selection helper — over a temporary directory, with fakes at the git and github boundaries and no provider or network call. Bound every conductor fixture before writing it: pre-resolve unrelated steps in the persisted state, target the transition with the from-step option, and let the park itself end the run so no cleanup races a live loop. Comparable fixtures already exist in the park-boundary unit suite, the terminal-marker suite, and the park acceptance suite; reuse their temporary-root and state-writing helpers rather than inventing new ones, and search those files for the existing daemon-mode conductor construction before adding a new one. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, the backstop-exemption approach, and all three stories on 2026-09-06 (delegated).
- Verified: `src/conductor/src/engine/conductor.ts` declares `stopAtOperatorParkBoundary` inside `run()` above its `try`, and five guarded dispatch sites return its `{ kind: 'operator-parked', boundary }` result.
- Verified: the same method's `finally` backstop writes the halt whenever the daemon flag is set and neither the completion marker nor the halt marker exists, and the halt writer also stamps the halt-class sidecar.
- Verified: `src/conductor/src/engine/daemon-runner.ts` returns a parked status directly from the typed termination and never calls the outcome reader for it.
- Verified: `pickEligible` in `src/conductor/src/engine/daemon.ts` re-admits a claim-parked slug only when its worktree halt check reports clear; `src/conductor/src/engine/daemon-deps.ts` supplies that worktree halt reader.
- Verified: `readHaltClass` and `isOperatorActionHalt` in `src/conductor/src/engine/halt-marker.ts` retain the needs-human disposition, and `src/conductor/src/engine/daemon-rekick.ts` skips on it with a log line naming the disposition.
- Verified: `renderDashboard` in `src/conductor/src/engine/daemon-dashboard.ts` excludes parked slugs from the halted group and renders each remaining halted slug with its reason and a clear-to-resume remedy.
- Verified: `src/conductor/test/engine/operator-park-boundary.test.ts` already drives a real daemon-mode run to a park termination without asserting marker absence, and the park acceptance suite's typed-stop case stubs the conductor, so no existing test observes this defect.
- Scope check: consumer-facing engine defect fix; no new skill; provider-agnostic. Event spine: no new event, metric, span, or report — the park-boundary event and the halt event both already exist and neither changes shape.
- Verify-claims verdict: CLEAR. Every path and symbol above was read in this worktree at the current base commit; no unconfirmed assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Exempt a park-terminated run from the markerless-exit backstop
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/operator-park-boundary.test.ts
**Dependencies:** none

**Steps:**
1. Add a unit case to the park-boundary suite that drives the existing daemon-mode conductor fixture to a park at the first pending serial unit and asserts the temporary project root carries neither the pipeline halt marker nor its class sidecar, alongside the typed termination the suite already checks.
2. Add a second unit case whose injected park-boundary reader rejects, so the run fails toward the pre-first-unit park, and assert the same termination and the same marker absence.
3. Establish RED on both, then declare a run-scoped local in `run()` beside the existing `lastSettledUnit`, set it inside `stopAtOperatorParkBoundary` immediately before that helper returns its termination, and add it as a negated conjunct to the `finally` backstop's existing daemon-and-no-marker condition.
4. Verify GREEN, confirm the backstop's diagnostics assembly and halt wording are unchanged, then run the focused file through scoped-run plus the repository typecheck target that covers test files, and commit.

**Done when:**
1. A daemon-mode run that returns the operator-parked termination leaves no halt marker and no halt-class sidecar under its project root.
2. A run whose park-boundary reader rejects still returns the pre-first-unit park termination and still writes no halt marker.
3. The exemption local is set only inside the shared park-boundary helper and read only by the finally backstop, so no other markerless exit path is exempted.

### Task 2: Keep a genuinely markerless exit halting needs-human
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/test/engine/conductor-terminal-marker.test.ts
**Dependencies:** 1

**Steps:**
1. Add a case in which a daemon-mode run supplied with no park-boundary reader at all exits markerless from a blocked gate, and assert the halt body still names the resolved last step, the last emitted event, and the exit index, and that the class sidecar reads needs-human.
2. Add a sibling case whose injected park-boundary reader resolves to no park requested, and assert the same halt is written and the run resolves to no park termination.
3. Leave the suite's existing backstop diagnostics cases and its interactive markerless case untouched, so the unchanged wording stays asserted by the coverage that already owns it.
4. Run the focused file through scoped-run plus the typecheck target that covers test files, and commit.

**Done when:**
1. A markerless daemon exit with no park-boundary reader supplied still writes the needs-human halt naming the resolved last step, the last event, and the exit index.
2. A markerless daemon exit whose park-boundary reader reports no park requested still writes that same halt and resolves to no park termination.

### Task 3: Prove post-unpark selection over a real park-terminated worktree
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/test/acceptance/operator-park-boundary.acceptance.test.ts
**Dependencies:** 1

**Steps:**
1. Add an acceptance case that builds a temporary worktree root with the suite's existing helper, drives the real daemon-mode conductor to a boundary park with an injected step runner, and confirms the typed termination.
2. Pass that same directory to the real worktree halt reader exported by the daemon dependency module, and call the real selection helper with a backlog holding the slug, a claim record already parked for it, and an operator park check that reports cleared.
3. Assert the selection returns that slug, and assert the case removed no file between the park and the selection so the eligibility comes from the absent marker rather than from cleanup.
4. Run the focused acceptance file through scoped-run plus the typecheck target that covers test files, and commit.

**Done when:**
1. The acceptance case drives a real daemon-mode park termination and then receives that slug back as the eligible selection through the real worktree halt reader.
2. The case removes no marker file between the park and the selection.

### Task 4: Keep a real needs-human halt excluded after unpark
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/acceptance/operator-park-boundary.acceptance.test.ts
**Dependencies:** 3

**Steps:**
1. Add a sibling acceptance case whose temporary worktree carries a needs-human halt and its class sidecar, written through the engine halt-marker writer rather than by hand, so the fixture cannot drift from the production format.
2. Call the same real selection helper with the same parked claim record and cleared operator park check, and assert it returns no item for that slug.
3. Drive the re-kick sweep over that worktree with the real halt-class reader and faithful fakes at the git and github boundaries, and assert the slug is skipped and the captured log names its needs-human halt disposition.
4. Run the focused acceptance file through scoped-run plus the typecheck target that covers test files, and commit.

**Done when:**
1. Selection returns no item for a slug whose worktree carries a needs-human halt written through the engine halt-marker writer.
2. The re-kick sweep skips that slug and its captured log line names the needs-human halt disposition.

### Task 5: Pin the daemon status view of a feature still held by a halt
**Story:** Story 3
**Type:** happy-path
**Files:** src/conductor/test/engine/daemon-dashboard.test.ts
**Dependencies:** none

**Steps:**
1. Confirm by reading the dashboard renderer that a halted slug absent from the parked input already renders in the halted group with its reason and remedy, and record that no production change is required for this story.
2. Add a rendering case with one halted entry whose slug is absent from the parked input, and assert the halted group lists that slug with its halt reason and the clear-to-resume remedy.
3. Add the mirror case with the same slug present in the parked input, and assert it renders only under the parked group with the halted count unaffected by it.
4. Run the focused file through scoped-run plus the typecheck target that covers test files, and commit.

**Done when:**
1. The rendered halted group lists the unparked slug together with its halt reason and the clear-to-resume remedy.
2. The same slug present in the parked input renders only under the parked group and does not raise the halted count.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a daemon-mode run whose operator park boundary is active, when the loop settles at a scheduling-unit boundary, then the run returns the typed operator-parked termination and its project root carries neither a halt marker nor a halt-class sidecar. | 1 | "A daemon-mode run that returns the operator-parked termination leaves no halt marker and no halt-class sidecar under its project root." | diff-local |
| Story 1 happy: Given the operator park boundary read is indeterminate and the run fails toward a park at the pre-first-unit boundary, when the loop stops there, then it still returns the typed operator-parked termination and still writes no halt marker. | 1 | "A run whose park-boundary reader rejects still returns the pre-first-unit park termination and still writes no halt marker." | diff-local |
| Story 1 negative: Given a daemon-mode run with no operator park boundary behind it, when the loop exits with neither a completion marker nor a halt marker, then it writes the needs-human halt whose reason names the resolved last step, the last emitted event, and the exit index. | 2 | "A markerless daemon exit with no park-boundary reader supplied still writes the needs-human halt naming the resolved last step, the last event, and the exit index." | diff-local |
| Story 1 negative: Given a daemon-mode run whose park boundary check reports that no park was requested, when the loop exits without a terminal marker, then the needs-human halt is still written and the run returns no park termination. | 2 | "A markerless daemon exit whose park-boundary reader reports no park requested still writes that same halt and resolves to no park termination." | diff-local |
| Story 2 happy: Given a worktree left behind by a boundary-settled park and a claim already parked for that slug, when the daemon selects work after an explicit unpark, then that slug is returned as eligible without any marker being deleted by hand. | 3 | "The acceptance case drives a real daemon-mode park termination and then receives that slug back as the eligible selection through the real worktree halt reader." | diff-local |
| Story 2 negative: Given a worktree carrying a needs-human halt from a genuinely markerless exit and a claim already parked for that slug, when the daemon selects work after an explicit unpark, then no item is returned for that slug and the re-kick sweep still refuses it by its halt disposition. | 4 | "The re-kick sweep skips that slug and its captured log line names the needs-human halt disposition." | diff-local |
| Story 3 happy: Given a slug that is not operator-parked and whose worktree carries a live halt, when the daemon status dashboard renders, then that slug appears in the halted group with its halt reason and the remedy that clears it. | 5 | "The rendered halted group lists the unparked slug together with its halt reason and the clear-to-resume remedy." | diff-local |
| Story 3 negative: Given the same slug while it is still operator-parked, when the daemon status dashboard renders, then it appears only in the parked group and is not also counted or listed as a halted row. | 5 | "The same slug present in the parked input renders only under the parked group and does not raise the halted count." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local against controlled temporary fixtures; no criterion depends on a commit outside this feature's diff. Task 1 owns the production guard and its unit proof at the conductor's own park boundary, the narrowest seam that holds the behavior. Task 2 owns the negative regression at the backstop, using the suite that already owns the halt wording rather than duplicating it. Task 3 owns the cross-boundary integration: the observable behavior is that a daemon selecting work after an explicit unpark returns the slug, proved through the real worktree halt reader and the real selection helper rather than through a direct assertion on the guard. Task 4 owns the mirrored refusal across that same boundary plus the re-kick disposition. Task 5 owns the daemon status rendering, which needs no production change and is covered at the renderer rather than through a daemon run. Third-party boundaries are faked throughout; no test reaches a provider, a package registry, or the network, and no terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
Task 3 -> Task 4
Task 5 (independent)
