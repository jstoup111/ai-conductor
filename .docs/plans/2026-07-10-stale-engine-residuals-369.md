# Implementation Plan: Stale-engine auto-restart residuals (#369)

**Date:** 2026-07-10
**Design:** .docs/decisions/architecture-review-2026-07-10-stale-engine-residuals-369.md (+ .docs/architecture/2026-07-10-stale-engine-residuals-369.md)
**Stories:** .docs/stories/2026-07-10-stale-engine-residuals-369.md
**Conflict check:** Clean as of 2026-07-10
**Source-Ref:** jstoup111/ai-conductor#369

## Summary

Repairs the three #307 residuals: fixes suppression semantics inside `initStaleEngineState`,
wires that primitive into `daemon-cli.ts` as the single boot path (deleting the inline
duplicate), and adds identity pairs to both stale-verdict log sites. 14 tasks.

## Technical Approach

- **Fix the primitive first, then wire it.** `initStaleEngineState`
  (`src/conductor/src/engine/stale-engine-init.ts`, ~100 lines) currently duplicates the
  inline bug. Tasks 1–6 make the primitive correct and fully covered (suppression key =
  `marker.targetIdentity`, `clearSuppression` on convergence/obsolescence, failure-path
  degradation). Tasks 7–9 then swap `daemon-cli.ts`'s inline Task 8-10 block (~lines
  561–601 of 1464) for a call to the primitive — checker construction stays in daemon-cli
  from the returned identity, and daemon-cli passes the pre-gated
  `(config?.auto_restart_on_stale_engine ?? false) && isSelfHost` as `flag`.
- **Suppression lifecycle** (per adr-2026-07-03 §4, restored): non-converged handshake
  records the marker's `targetIdentity`; `isSuppressed(targetIdentity)` (existing call
  sites in `engine/daemon.ts:687,889` and the daemon-cli wrapper) now actually matches
  within the same boot; converged handshake — or a boot whose fresh identity equals the
  suppressed target — clears the record. `recordSuppression`/`isSuppressed`/
  `clearSuppression` signatures are unchanged.
- **Log identities** at both verdict sites in `engine/daemon.ts` (idle-tick ~885–905,
  rebuild path ~668–695) using the `fromIdentity`/`targetIdentity` already in scope.
- **Test strategy:** update `test/engine/daemon-startup-handshake.test.ts` (currently pins
  the buggy fresh-identity key at :236/:254 via direct-record), re-point
  `test/acceptance/daemon-auto-restart-stale-engine-dispatch-parity.acceptance.test.ts`
  so it certifies the wired production path, and add a real-flow suppression acceptance
  test (real marker → real handshake → real checker → real `isSuppressed`, no injected
  fakes) — the false-green class from #307/#367.
- Tests run from `src/conductor` (`npx vitest run`), per repo convention.

## Prerequisites

None — no migrations, deps, or config changes. `.daemon/` fixtures use temp dirs.

## Tasks

### Task 1: Suppression key — record the marker's targetIdentity
**Story:** Story 3, happy path 1
**Type:** happy-path

**Steps:**
1. Write failing test: non-converged handshake (marker `{from: F, target: T}`, fresh X ≠ T)
   through `initStaleEngineState` ⇒ suppression file has `suppressedTarget === T` (not X).
   Update the direct-record assertions at `daemon-startup-handshake.test.ts:236,254` to the
   real handshake flow while here.
2. Verify test fails (RED — current code records X).
3. Implement: in `stale-engine-init.ts`, pass `marker.targetIdentity` to `recordSuppression`;
   keep the warning log naming both identities.
4. Verify test passes (GREEN).
5. Commit: "fix(daemon): suppression records marker target, not fresh boot identity"

**Files:**
- src/conductor/src/engine/stale-engine-init.ts
- src/conductor/test/engine/daemon-startup-handshake.test.ts

**Dependencies:** none

### Task 2: Same-boot hold — suppressed target blocks the restart request
**Story:** Story 3, happy path 2
**Type:** happy-path

**Steps:**
1. Write failing test: after a Task-1-style handshake, a stale verdict with target T and
   `isSuppressed(T)` consulted ⇒ returns true, hold logged once, no restart request.
2. Verify RED (with the old key the record holds X, so `isSuppressed(T)` is false).
3. Implement: no production change expected beyond Task 1 — this test certifies the
   record/check pair now composes; fix any residue it exposes.
4. Verify GREEN.
5. Commit: "test(daemon): suppression holds within the boot that recorded it"

**Files:**
- src/conductor/test/engine/daemon-startup-handshake.test.ts

**Dependencies:** Task 1

### Task 3: Re-arm — a different target is not suppressed; converged boot records nothing
**Story:** Story 3, negative paths 1–2
**Type:** negative-path

**Steps:**
1. Write failing/characterization tests: (a) record for T, verdict targets U ≠ T ⇒
   `isSuppressed(U)` false (restart proceeds); (b) converged handshake (fresh == T) ⇒ no
   suppression file written.
2. Verify status (RED where behavior missing, GREEN-as-characterization where held).
3. Implement any gap in `stale-engine-init.ts`.
4. Verify GREEN.
5. Commit: "test(daemon): suppression re-arms past its target; converged boot records nothing"

**Files:**
- src/conductor/src/engine/stale-engine-init.ts
- src/conductor/test/engine/daemon-startup-handshake.test.ts

**Dependencies:** Task 1

### Task 4: clearSuppression on converged handshake
**Story:** Story 4, happy path
**Type:** happy-path

**Steps:**
1. Write failing test: pre-existing suppression record + marker whose target equals the
   fresh identity (converged) ⇒ after `initStaleEngineState`, the suppression file is gone.
2. Verify RED (clearSuppression currently has zero callers).
3. Implement: call `clearSuppression(repoPath, log)` in the converged branch of the
   handshake in `stale-engine-init.ts`.
4. Verify GREEN.
5. Commit: "feat(daemon): clear suppression record on converged handshake"

**Files:**
- src/conductor/src/engine/stale-engine-init.ts
- src/conductor/test/engine/daemon-startup-handshake.test.ts

**Dependencies:** Task 1

### Task 5: clearSuppression when running the once-failed target (no marker)
**Story:** Story 4, negative path 1 (operator-approved design 2026-07-10)
**Type:** negative-path

**Steps:**
1. Write failing test: suppression record for T, NO restart marker, boot with fresh
   identity T ⇒ record cleared; and with fresh X ≠ T ⇒ record left in place.
2. Verify RED.
3. Implement: in `initStaleEngineState`, when no marker is present, read the record via
   `getSuppression`; if `suppressedTarget === engineIdentity`, clear it.
4. Verify GREEN.
5. Commit: "feat(daemon): obsolete suppression record cleared when boot runs the suppressed target"

**Files:**
- src/conductor/src/engine/stale-engine-init.ts
- src/conductor/test/engine/daemon-startup-handshake.test.ts

**Dependencies:** Task 4

### Task 6: Persistence-failure degradation (record + clear)
**Story:** Story 3 negative paths 3–4; Story 4 negative path 2
**Type:** negative-path

**Steps:**
1. Write tests: (a) suppression write fails (unwritable `.daemon/`) ⇒ failure logged, boot
   continues, marker STILL cleared afterwards; (b) clear failure ⇒ logged, boot continues;
   (c) corrupt suppression file ⇒ `isSuppressed` false, warn-once, boot proceeds.
2. Verify status (RED for any missing ordering guarantee, characterization otherwise).
3. Implement gaps (ordering: marker clear must not be skipped by a suppression error).
4. Verify GREEN.
5. Commit: "test(daemon): suppression persistence failures degrade without breaking boot"

**Files:**
- src/conductor/src/engine/stale-engine-init.ts
- src/conductor/test/engine/daemon-startup-handshake.test.ts

**Dependencies:** Task 5

### Task 7: Wire initStaleEngineState into daemon-cli (delete the inline block)
**Story:** Story 1, happy paths 1–2
**Type:** refactor

**Steps:**
1. Write failing test: a daemon-cli-level boot test (or exported boot seam) asserting the
   boot sequence produces the primitive's effects end-to-end — identity log, ARMED line,
   handshake log, marker cleared — via `initStaleEngineState` (spy/module-level assertion),
   not the inline copy.
2. Verify RED.
3. Implement: in `daemon-cli.ts`, replace the inline Task 8-10 block (~561–601) with
   `const engineIdentity = await initStaleEngineState({ repoPath: projectRoot, entryPath:
   engineEntryPath, flag: isArmed, log })`; keep `createStaleEngineChecker` construction
   from the returned identity; delete the duplicated lines.
4. Verify GREEN.
5. Commit: "refactor(daemon): boot runs through initStaleEngineState — inline duplicate deleted"

**Files:**
- src/conductor/src/daemon-cli.ts
- src/conductor/test/engine/daemon-startup-handshake.test.ts

**Dependencies:** Tasks 1–6 (primitive must be correct before it becomes the boot path)

### Task 8: ARMED gating parity — primitive receives flag && isSelfHost
**Story:** Story 1, negative path 3
**Type:** negative-path

**Steps:**
1. Write failing test: config flag true, self-host false ⇒ ARMED/DISARMED line says
   DISARMED through the wired path.
2. Verify status (RED if Task 7 wired the raw flag; characterization otherwise).
3. Implement: ensure daemon-cli passes the pre-gated value.
4. Verify GREEN.
5. Commit: "test(daemon): DISARMED when self-host is false regardless of config flag"

**Files:**
- src/conductor/src/daemon-cli.ts

**Dependencies:** Task 7

### Task 9: Capture-failure and corrupt-marker degradation through the wired path
**Story:** Story 1, negative paths 1–2
**Type:** negative-path

**Steps:**
1. Write tests through the wired boot: (a) missing/unreadable `dist/index.js` ⇒ init
   returns null, handshake skipped, checker constructed permanently-disabled, no crash;
   (b) corrupt marker JSON ⇒ logged + removed, no suppression write, boot continues.
2. Verify status (mostly characterization of existing primitive behavior, now certified on
   the production path).
3. Implement any exposed gap.
4. Verify GREEN.
5. Commit: "test(daemon): boot degrades cleanly on capture failure and corrupt marker"

**Files:**
- src/conductor/src/engine/stale-engine-init.ts
- src/conductor/test/engine/daemon-startup-handshake.test.ts

**Dependencies:** Task 7

### Task 10: Re-point the dispatch-parity acceptance test at the real path
**Story:** Story 1, Done When 3
**Type:** refactor

**Steps:**
1. Update `daemon-auto-restart-stale-engine-dispatch-parity.acceptance.test.ts` so its
   handshake phase certifies the wired production entry (daemon-cli boot seam), not a bare
   dynamic import of the module — the test must FAIL if daemon-cli stops calling
   `initStaleEngineState`.
2. Verify it passes against the wired code and fails when the wiring is reverted
   (spot-check by stubbing).
3. Commit: "test(daemon): dispatch-parity acceptance certifies the wired boot path"

**Files:**
- src/conductor/test/acceptance/daemon-auto-restart-stale-engine-dispatch-parity.acceptance.test.ts

**Dependencies:** Task 7

### Task 11: Idle-tick stale verdict logs both identities
**Story:** Story 2, happy path 1 + negative path 2
**Type:** happy-path

**Steps:**
1. Write failing test: idle-tick stale verdict ⇒ log line contains captured X and target T
   before any restart request; `current`/`indeterminate` verdicts emit no identity-pair line.
2. Verify RED (site currently logs nothing at the verdict).
3. Implement: add the log at the idle-tick verdict site in `engine/daemon.ts` (~885–905),
   using the in-scope `fromIdentity`/`targetIdentity`.
4. Verify GREEN.
5. Commit: "feat(daemon): idle-tick stale verdict logs captured and target identities"

**Files:**
- src/conductor/src/engine/daemon.ts
- src/conductor/test/acceptance/daemon-auto-restart-stale-engine.acceptance.test.ts

**Dependencies:** none

### Task 12: Rebuild-path stale verdict logs both identities (+ null rendering)
**Story:** Story 2, happy path 2 + negative path 1
**Type:** happy-path

**Steps:**
1. Write failing test: `rebuildAndMaybeRestartForStaleEngine` stale ⇒ its log line carries
   both identities; with checker identity accessors returning null ⇒ line renders `null`
   and nothing throws.
2. Verify RED.
3. Implement: extend the `engine stale after rebuild` log in `engine/daemon.ts` (~692).
4. Verify GREEN.
5. Commit: "feat(daemon): rebuild-path stale verdict logs captured and target identities"

**Files:**
- src/conductor/src/engine/daemon.ts
- src/conductor/test/acceptance/daemon-auto-restart-stale-engine.acceptance.test.ts

**Dependencies:** Task 11

### Task 13: Real-flow suppression acceptance test
**Story:** Story 3, Done When 2 (the #307/#367 false-green class)
**Type:** negative-path

**Steps:**
1. Write the acceptance test in a new file
   `test/acceptance/stale-engine-suppression-real-flow.acceptance.test.ts`: real marker
   file on a temp repo ⇒ real `initStaleEngineState` handshake ⇒ real
   `createStaleEngineChecker` verdict targeting T ⇒ real `isSuppressed` consult ⇒ restart
   held within the same boot; then on-disk moves to U ≠ T ⇒ restart proceeds. No injected
   suppression/record fakes anywhere in the flow.
2. Verify it passes against the completed implementation (and fails against pre-Task-1
   code — assert by reverting the key locally once).
3. Commit: "test(daemon): real-flow suppression acceptance — loop breaks in the same boot"

**Files:**
- src/conductor/test/acceptance/stale-engine-suppression-real-flow.acceptance.test.ts

**Dependencies:** Tasks 2, 7

### Task 14: Orphan sweep, changelog, full suite
**Story:** Story 1 Done When 2/4; Story 4 Done When 1
**Type:** infrastructure

**Steps:**
1. Verify wiring: `grep -rn "initStaleEngineState\|clearSuppression" src/conductor/src
   --include='*.ts'` shows non-test production callers for BOTH; grep confirms the inline
   duplicate block is gone from `daemon-cli.ts`.
2. Add `CHANGELOG.md` entry under `## [Unreleased]` / Fixed (three residuals, issue #369).
3. Run the full suite from `src/conductor`: `npx vitest run` — green.
4. Commit: "chore(daemon): #369 residuals — changelog + orphan sweep evidence"

**Files:**
- CHANGELOG.md

**Dependencies:** Tasks 1–13

## Task Dependency Graph

```
1 ─┬─ 2 ─────────────┐
   ├─ 3              ├─ 13
   └─ 4 ─ 5 ─ 6 ─ 7 ─┼─ 8
                     ├─ 9
                     └─ 10
11 ─ 12
1–13 ─ 14
```

## Integration Points

- After Task 7: a real daemon boot exercises the fixed suppression semantics end-to-end.
- After Task 13: the full restart-loop scenario is certified with zero injected fakes.

## Coverage

- Story 1: HP1–2 → T7; NP1–2 → T9; NP3 → T8; Done When → T7/T10/T14
- Story 2: HP1 → T11; HP2 → T12; NP1 → T12; NP2 → T11
- Story 3: HP1 → T1; HP2 → T2; NP1–2 → T3; NP3 → T6; NP4 → T6; Done When 2 → T13
- Story 4: HP → T4; NP1 → T5; NP2 → T6; Done When 1 → T14

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Dependencies are explicit and acyclic
