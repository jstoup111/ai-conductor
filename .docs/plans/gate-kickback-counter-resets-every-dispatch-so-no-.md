# Implementation Plan: cross-dispatch kickback livelock bound (#984)

**Date:** 2026-07-26
**Stem:** gate-kickback-counter-resets-every-dispatch-so-no-
**Track:** technical (no PRD)
**Tier:** M
**Stories:** `.docs/stories/gate-kickback-counter-resets-every-dispatch-so-no-.md`
**ADR:** `.docs/decisions/adr-2026-07-26-cross-dispatch-kickback-livelock-bound.md` (APPROVED)
**Architecture:** `.docs/architecture/gate-kickback-counter-resets-every-dispatch-so-no-.md`
**Conflict check:** `.docs/conflicts/gate-kickback-counter-resets-every-dispatch-so-no-.md` (PASSED)

## Summary

Make the gate kickback bound survive daemon re-dispatch, stop an empty commit from laundering a
no-op lap as progress, and give `wiring_check` the D2 guard every peer gate already has. 16 tasks,
concentrated in one new `.pipeline/` ledger module plus four existing seams in `conductor.ts`.

## Technical Approach

Three independent defects sustain the observed livelock, and all three must close together — fixing
any two leaves the loop reachable:

1. **The bound is run-local.** `kickbackCounts` (`conductor.ts:2319`) and the #647 D2 baseline
   `kickbackToBuildContext` (`conductor.ts:2359`) are declared inside `Conductor.run()`, and the
   daemon builds a new `Conductor` per dispatch (`daemon-cli.ts:922` via `daemon-runner.ts:366`).
   Both move into `.pipeline/kickback-ledger.json`, following the atomic temp-file + `rename(2)`
   pattern of `task-evidence.ts:130-164` and the durable-counter lifecycle of
   `.pipeline/build-review-regrade.json` (`build-review-disposition.ts:107`, cleared on a fresh
   feature session at `conductor.ts:2176-2180`).

2. **The progress witness is falsifiable.** `classifyBuildProgress` (`kickback-escalation.ts:35-41`)
   compares HEAD commit shas via `currentCommitSha` (`project-prelude.ts:415`). An empty commit
   advances HEAD over a byte-identical tree and scores `'did-work'`, suppressing the halt. It moves
   to `git rev-parse HEAD^{tree}` — the codebase's first tree-hash use, verified absent today.

3. **`wiring_check` bypasses D2.** It increments the counter (`conductor.ts:5104`) but never calls
   the capture/check pair, and `continue`s at `:5134` before the generic site at `:5411`. It gains
   both calls in the ordering `build_review` already uses.

**The one constraint that shapes everything: the bound is keyed on the tree, never on reason text.**
Only `wiring_check` produces a deterministic failure reason. `build_review` reasons are LLM grader
prose (`artifacts.ts:1115-1124`), `manual_test` reasons are agent-authored markdown rows
(`artifacts.ts:715-740`), and `test_suite` reasons embed raw runner output with durations and temp
paths. A reason-keyed counter — which is what #984's wording literally asks for — would reset every
lap on three of four gates and leave the bug unfixed. Task 11 exists specifically to regression-test
this.

Reset condition is `tree hash differs OR resolved-task count increased` (conflict-check resolution
1), keeping this ledger, `classifyBuildProgress`, and the daemon's re-kick eligibility
(`daemon-cli.ts:472-479`) on one shared definition of progress.

**Release gates.** No `bin/conduct` CLI, hook-wiring, skill-symlink, or `settings.json` schema
change — no migration block is expected. A CHANGELOG `[Unreleased]` entry IS required (notable
reader-visible behavior change). **VERSION is not bumped** — this repository holds VERSION until
v1. If the release gate's path-based classifier flags a breaking surface anyway, the correct
response is a waiver under `.docs/release-waivers/gate-kickback-counter-resets-every-dispatch-so-no-.md`
naming the flagged canonical surface — never an invented empty migration block.

## Tasks

### Task 1: RED — ledger read/write contract
**Story:** Story 1, negative path
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/kickback-ledger.test.ts`, modeled on
   `task-evidence.test.ts` (`mkdtemp` in `beforeEach`, `rm` in `afterEach`): absent file → empty
   ledger; corrupt JSON → empty ledger + `console.warn` (assert via `vi.spyOn`); `version !== 1` →
   treated as absent; roundtrip of a populated ledger; concurrent writes never yield a torn read.
2. Verify RED (module does not exist).
3. Implement: nothing yet.
4. n/a
5. Commit: "test(engine): RED for kickback ledger read/write contract"

**Files likely touched:**
- `src/conductor/test/engine/kickback-ledger.test.ts` — new file

**Wired-into:** none (no new production surface yet)
**Dependencies:** none

### Task 2: GREEN — `kickback-ledger.ts`
**Story:** Story 1, happy path + negative path
**Type:** happy-path

**Steps:**
1. Covered by Task 1.
2. Verify RED.
3. Implement `src/conductor/src/engine/kickback-ledger.ts`: `KickbackLedger` /
   `KickbackGateEntry` types (`{count, treeHash, lastReason, priorVerdict, resolvedBefore}`),
   `KICKBACK_LEDGER_PATH = '.pipeline/kickback-ledger.json'`, `version: 1`; `readKickbackLedger`
   (tolerant, never throws), `writeKickbackLedger` (unique temp file in the same directory +
   `rename`), `clearKickbackLedger`.
4. Verify GREEN.
5. Commit: "feat(engine): durable per-feature kickback ledger"

**Files likely touched:**
- `src/conductor/src/engine/kickback-ledger.ts` — new module

**Wired-into:** `src/conductor/src/engine/kickback-ledger.ts#readKickbackLedger`
**Dependencies:** Task 1

### Task 3: RED — tree hash is the progress witness
**Story:** Story 2, happy + negative paths
**Type:** negative-path

**Steps:**
1. Extend `src/conductor/test/engine/kickback-escalation.test.ts`: a real
   `git commit --allow-empty` between snapshots classifies `'no-work'`; a real file change
   classifies `'did-work'`; a null tree hash on either side folds to `'no-work'`; a
   resolved-count increase over an unchanged tree still classifies `'did-work'`.
2. Verify RED (commit-sha comparison scores the empty commit `'did-work'`).
3. Implement: nothing yet.
4. n/a
5. Commit: "test(engine): RED — empty commit must not count as build progress"

**Files likely touched:**
- `src/conductor/test/engine/kickback-escalation.test.ts` — new describe block

**Wired-into:** none
**Dependencies:** none

### Task 4: GREEN — `currentTreeHash` + tree-keyed classifier
**Story:** Story 2, happy path
**Type:** happy-path

**Steps:**
1. Covered by Task 3.
2. Verify RED.
3. Implement `currentTreeHash(projectRoot)` in `project-prelude.ts` (`git rev-parse HEAD^{tree}`,
   null on failure, mirroring `currentCommitSha` at `:415`). Rename
   `ClassifyBuildProgressInput.headBefore/headAfter` to `treeBefore/treeAfter` and update
   `classifyBuildProgress` — the function stays pure; callers gather the hashes.
4. Verify GREEN.
5. Commit: "fix(engine): key build-progress classification on tree hash, not commit sha"

**Files likely touched:**
- `src/conductor/src/engine/project-prelude.ts` — new `currentTreeHash`
- `src/conductor/src/engine/kickback-escalation.ts` — tree-keyed inputs

**Wired-into:** `src/conductor/src/engine/kickback-escalation.ts#classifyBuildProgress`
**Dependencies:** Task 3

### Task 5: RED — bump/reset semantics
**Story:** Story 4, happy + negative paths
**Type:** negative-path

**Steps:**
1. Write failing tests: unchanged tree + unchanged resolved count → `count` increments;
   changed tree → `count` resets to 1 and `treeHash` is rewritten; unchanged tree + increased
   resolved count → `count` resets; `count` never exceeds `MAX_KICKBACKS_PER_GATE` without
   reporting exhaustion.
2. Verify RED.
3. Implement: nothing yet.
4. n/a
5. Commit: "test(engine): RED for kickback ledger bump/reset semantics"

**Files likely touched:**
- `src/conductor/test/engine/kickback-ledger.test.ts` — bump/reset describe block

**Wired-into:** none
**Dependencies:** Task 2, Task 4

### Task 6: GREEN — `bumpKickbackGate`
**Story:** Story 4, happy path
**Type:** happy-path

**Steps:**
1. Covered by Task 5.
2. Verify RED.
3. Implement a pure `bumpKickbackGate(entry, {treeHash, resolvedCount, reason})` returning the next
   entry plus an `exhausted` boolean, and an I/O wrapper that loads, bumps, and persists.
4. Verify GREEN.
5. Commit: "feat(engine): tree-keyed kickback bump with progress reset"

**Files likely touched:**
- `src/conductor/src/engine/kickback-ledger.ts` — bump/reset logic

**Wired-into:** `src/conductor/src/engine/kickback-ledger.ts#bumpKickbackGate`
**Dependencies:** Task 5

### Task 7: RED — a fresh feature session clears the ledger
**Story:** Story 1, negative path
**Type:** negative-path

**Steps:**
1. Write a failing test asserting that with `state.run_started_at` unset, the conductor clears
   `.pipeline/kickback-ledger.json`, and that with it set the ledger is preserved.
2. Verify RED.
3. Implement: nothing yet.
4. n/a
5. Commit: "test(engine): RED — fresh feature session clears the kickback ledger"

**Files likely touched:**
- `src/conductor/test/engine/conductor-kickback-ledger.test.ts` — new file

**Wired-into:** none
**Dependencies:** Task 2

### Task 8: GREEN — clear on fresh feature session
**Story:** Story 1, negative path
**Type:** happy-path

**Steps:**
1. Covered by Task 7.
2. Verify RED.
3. Call `clearKickbackLedger` alongside the existing `resetRegradeCounter` inside the
   `isFreshFeatureSession` branch at `conductor.ts:2176-2180`.
4. Verify GREEN.
5. Commit: "feat(engine): clear kickback ledger on a fresh feature session"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — fresh-session branch

**Wired-into:** `src/conductor/src/engine/conductor.ts#run`
**Dependencies:** Task 7

### Task 9: RED — the bound survives re-dispatch
**Story:** Story 1, happy path
**Type:** happy-path

**Steps:**
1. Write a failing test driving two sequential `Conductor` instances over one worktree with an
   unchanged tree, asserting the second resumes the persisted count instead of restarting at zero,
   and that the cap trips on the second dispatch rather than never.
2. Verify RED (today the count restarts every dispatch).
3. Implement: nothing yet.
4. n/a
5. Commit: "test(engine): RED — kickback bound must survive re-dispatch"

**Files likely touched:**
- `src/conductor/test/engine/conductor-kickback-ledger.test.ts` — cross-dispatch describe block

**Wired-into:** none
**Dependencies:** Task 6, Task 8

### Task 10: GREEN — migrate both run-local maps onto the ledger
**Story:** Story 1, happy path
**Type:** happy-path

**Steps:**
1. Covered by Task 9.
2. Verify RED.
3. Replace `kickbackCounts` (`conductor.ts:2319`) and `kickbackToBuildContext` (`:2359`) with
   ledger reads/writes. Update `captureKickbackToBuildContext` (`:2371`) and
   `checkKickbackToBuildEscalation` (`:2389`) to persist and consult the ledger entry, gathering
   tree hashes via `currentTreeHash`. Preserve the single-use consume semantics
   (`kickbackToBuildContext.delete`, `:2394`) as an explicit ledger field clear. Leave
   `stuckGate`, `prdAuditSelfHeals`, `remediationRounds`, and `manualTestSelfHeals` untouched
   (ADR Non-goals).
4. Verify GREEN.
5. Commit: "fix(engine): persist kickback bound and D2 baseline across dispatches (#984)"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — declarations + the four existing capture/check sites

**Wired-into:** `src/conductor/src/engine/conductor.ts#run`
**Dependencies:** Task 9

### Task 11: RED — unstable reason text must still terminate
**Story:** Story 4, negative path
**Type:** negative-path

**Steps:**
1. Write a failing test in which a gate fails repeatedly over an unchanged tree with **different**
   reason text each lap, asserting the loop still terminates within `MAX_KICKBACKS_PER_GATE`. This
   is the regression guard for the ADR's central constraint — it fails against any future refactor
   that reintroduces reason-text equality as the bound key.
2. Verify RED where applicable; assert GREEN after Task 10.
3. Implement: nothing beyond Task 10.
4. Verify GREEN.
5. Commit: "test(engine): bound terminates despite varying failure-reason text"

**Files likely touched:**
- `src/conductor/test/engine/conductor-kickback-ledger.test.ts` — reason-instability describe block

**Wired-into:** none
**Dependencies:** Task 10

### Task 12: RED — `wiring_check` D2 wiring + incident replay
**Story:** Story 3, happy + negative paths
**Type:** happy-path

**Steps:**
1. Write failing tests: `captureKickbackToBuildContext('wiring_check')` runs before the
   `navigateBack` at `conductor.ts:5125`; `checkKickbackToBuildEscalation('wiring_check')` is
   consulted before the counter at `:5104`; and an incident replay (identical gap message,
   unchanged tree, across two dispatches) HALTs within two laps. Add the
   `kickback_escalation.enabled: false` case asserting D2 stays silent while the D1 cap still
   bounds the loop.
2. Verify RED.
3. Implement: nothing yet.
4. n/a
5. Commit: "test(engine): RED — wiring_check must be guarded by kickback escalation"

**Files likely touched:**
- `src/conductor/test/wiring-gate-loop.test.ts` — new cases (existing cases unmodified)

**Wired-into:** none
**Dependencies:** Task 10

### Task 13: GREEN — wire `wiring_check` into the D2 pair
**Story:** Story 3, happy path
**Type:** happy-path

**Steps:**
1. Covered by Task 12.
2. Verify RED.
3. Add the check before `conductor.ts:5104` and the capture before the `navigateBack` at `:5125`,
   matching `build_review`'s ordering (`:4969` before `:4989`). Preserve the deliberate
   non-daemon-gating of this block (`:5060-5068`).
4. Verify GREEN, and confirm the pre-existing `test/wiring-gate-loop.test.ts` cases pass unmodified.
5. Commit: "fix(engine): guard wiring_check kickbacks with no-op escalation (#984)"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `wiring_check` self-heal block

**Wired-into:** `src/conductor/src/engine/conductor.ts#run`
**Dependencies:** Task 12

### Task 14: RED — HALT names the gate and is classified
**Story:** Story 5, happy + negative paths
**Type:** negative-path

**Steps:**
1. Write failing tests: the cap HALT body contains the gate name, the lap count, and the recorded
   `lastReason`; `.pipeline/HALT.class` reads back `needs-human` via `readHaltClass` for both the
   `build_review` and `wiring_check` cap paths; an absent/empty `lastReason` still yields a
   well-formed marker with a stated placeholder.
2. Verify RED (both paths hand-roll `writeFile` and write no class sidecar).
3. Implement: nothing yet.
4. n/a
5. Commit: "test(engine): RED — livelock HALT must name its gate and carry a class"

**Files likely touched:**
- `src/conductor/test/engine/conductor-kickback-ledger.test.ts` — halt describe block

**Wired-into:** none
**Dependencies:** Task 10

### Task 15: GREEN — classified, informative cap HALTs
**Story:** Story 5, happy path
**Type:** happy-path

**Steps:**
1. Covered by Task 14.
2. Verify RED.
3. Convert the hand-rolled markers at `conductor.ts:5029-5036` (`build_review`) and `:5137-5144`
   (`wiring_check`) to `writeHaltMarker(this.projectRoot, reason + '\n', 'needs-human')`, with
   `reason` naming gate, lap count, and `lastReason`. Preserve the established ordering:
   `writeState` → `surfaceRemediationPr` → `emit({type:'loop_halt'})` → detach handlers → return.
4. Verify GREEN.
5. Commit: "fix(engine): classify and describe the kickback-cap HALT (#984)"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — the two cap-HALT sites

**Wired-into:** `src/conductor/src/engine/conductor.ts#run`
**Dependencies:** Task 14

### Task 16: Docs, changelog, and full validation
**Story:** Story 5 verification
**Type:** happy-path

**Steps:**
1. n/a (no new behavior).
2. n/a
3. Update `docs/daemon-operations.md` (the durable bound, the `needs-human` cap HALT and what an
   operator does with it) and `docs/configuration.md` (`kickback_escalation.enabled` now also
   gates the tree-hash witness). Add a CHANGELOG `[Unreleased]` entry. **Do not bump VERSION** —
   held until v1. If the release gate flags a breaking surface, add a waiver under
   `.docs/release-waivers/` naming the canonical surface verbatim.
4. Run `test/test_harness_integrity.sh` and the full `vitest` suite; both must pass.
5. Commit: "docs: record cross-dispatch kickback bound (#984)"

**Files likely touched:**
- `docs/daemon-operations.md`, `docs/configuration.md`, `CHANGELOG.md`

**Wired-into:** none (documentation)
**Dependencies:** Task 11, Task 13, Task 15

## Task Dependency Graph

```
Task 1 ─▶ Task 2 ─┬─▶ Task 5 ─▶ Task 6 ─┐
                  │                      ├─▶ Task 9 ─▶ Task 10 ─┬─▶ Task 11 ─┐
Task 3 ─▶ Task 4 ─┘                      │                      │            │
                                         │                      ├─▶ Task 12 ─▶ Task 13 ─┤
Task 2 ─▶ Task 7 ─▶ Task 8 ──────────────┘                      │                        ├─▶ Task 16
                                                                └─▶ Task 14 ─▶ Task 15 ──┘
```

Two independent entry points (Task 1 the ledger, Task 3 the tree witness) converge at Task 9. After
Task 10 lands the migration, the three closing branches — reason-instability regression (11),
`wiring_check` wiring (12→13), and HALT classification (14→15) — are mutually independent and can
proceed in parallel.
