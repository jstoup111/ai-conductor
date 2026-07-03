# Implementation Plan: harness-daemon-profile — daemon build-to-PR enablement (#174)

**Date:** 2026-07-03
**Design:** adr-2026-07-03-harness-daemon-profile, adr-2026-07-03-version-gate-semver-escalation (both APPROVED); .docs/architecture/2026-07-03-harness-daemon-profile.md
**Stories:** .docs/stories/harness-daemon-profile.md (Status: Accepted, TR-1..TR-4)
**Conflict check:** Clean as of 2026-07-03 (.docs/conflicts/2026-07-03-harness-daemon-profile.md)

## Summary

Ships daemon build-to-PR enablement for the harness repo in 17 tasks: a committed `bin/setup`
(TR-1), a pure fail-closed `classifyVersionSignal` classifier + `VersionApprovalGate`
escalation with an audit record (TR-2/TR-3), and docs/CHANGELOG reconciliation (TR-4).

## Technical Approach

- **`bin/setup`** (new, repo root): bash, `set -euo pipefail`; runs `npm install` then
  `npm run build` in `<repo>/src/conductor` resolved relative to the script's own location.
  No engine change — `prepareWorktree` (worktree-prepare.ts:89-118) already executes a repo's
  `bin/setup` with `CI=true` + `WORKTREE_NAMESPACE` and already implements keep-worktree/error
  on non-zero exit.
- **Classifier** (new `src/conductor/src/engine/self-host/version-signal.ts`): pure function
  `classifyVersionSignal(changed: ChangedFile[] | null): VersionSignal` where `VersionSignal =
  { level: 'patch' } | { level: 'minor' | 'major', signals: {kind, files}[] } | { level:
  'halt-undeterminable', reason }`. Reuses the `ChangedFile` shape and `classifyBreakingSurfaces`
  (release-gate.ts:152-196) for MAJOR; adds MINOR detectors (added `skills/*/SKILL.md`, added
  `hooks/` file, any `HARNESS.md` change, added file under engine self-host/steps paths);
  PATCH requires EVERY path to match the exported `PATCH_SAFE_GLOBS` allow-list. Precedence:
  undeterminable > major > minor > patch; empty change set is undeterminable.
- **Gate extension** (version-gate.ts): `evaluateVersionApproval` gains an optional
  `signal: VersionSignal` input consulted ONLY on the absent-marker branch (marker match/mismatch
  branches byte-identical to today). `runVersionApprovalGate` gains `changedFiles` +
  `writeAudit` options: on patch auto-pass it writes `.pipeline/version-signal.json`
  ({ verdict, level, files, classifiedAt }) and HALTs if that write fails (audit is part of the
  pass contract). HALT reasons name level + files + resume procedure.
- **Wiring** (conductor.ts:556-560, wiring.ts): thread `changedFiles: () =>
  this.selfBuildChangedFiles()` into the `versionGate` call, mirroring the existing
  `releaseGate` pattern at conductor.ts:569. `SelfHostGuardrails.versionGate` signature widens
  accordingly.
- **Sequencing:** classifier first (pure, test-heavy), then gate extension, then wiring, then
  script + docs. Tests: `rtk proxy npx vitest run` in `src/conductor`; no daemon-spawning
  tests needed (all gate tests are pure/injected); no VERSION edit (frozen 0.99.19).

## Prerequisites

- Phase 6 self-host wiring on main (present). No migrations, no new deps.

## Tasks

### Task 1: bin/setup script
**Story:** TR-1 happy (script exists, runs install+build)
**Type:** infrastructure
**Steps:**
1. Write `bin/setup`: bash header, `set -euo pipefail`, resolve repo root from `$0`, run
   `npm install` then `npm run build` in `src/conductor` (build only after install succeeds).
2. `chmod +x bin/setup`; verify `bash -n bin/setup` passes.
3. Run `test/test_harness_integrity.sh` — bin/ syntax section must cover the new script.
4. Commit: "feat(self-host): add bin/setup worktree toolchain prep (#174)"
**Files likely touched:** `bin/setup` (new)
**Dependencies:** none

### Task 2: bin/setup real-binary smoke
**Story:** TR-1 happy (worktree-local node_modules + dist; primary dist untouched)
**Type:** happy-path
**Steps:**
1. Write failing test (bash or vitest integration, per existing real-binary smoke patterns from
   PR #143): create a scratch git worktree of the repo, run `bin/setup` inside it, assert
   `src/conductor/node_modules/` and `src/conductor/dist/index.js` exist under the WORKTREE and
   the primary checkout's `src/conductor/dist` mtime is unchanged.
2. Verify RED (script missing pieces / assertion wiring), then GREEN with Task 1's script.
3. Commit: "test(self-host): real-binary smoke for bin/setup worktree isolation (#174)"
**Files likely touched:** `test/` (new smoke script) or `src/conductor/test/integration/`
**Dependencies:** Task 1

### Task 3: bin/setup failure propagation
**Story:** TR-1 negative (install fails → no build, non-zero, keep-worktree/errored)
**Type:** negative-path
**Steps:**
1. Write failing test: run `bin/setup` with an injected failing npm (PATH shim npm that exits 1
   on `install`), assert exit non-zero AND build step never ran (no marker file the shim would
   have written on `run build`). Second case: install ok, build fails → non-zero.
2. Confirm the engine contract via the EXISTING worktree-prepare tests (prepareWorktree throw →
   keep worktree + feature errored) — extend only if the harness script surfaces a new gap.
3. GREEN; commit: "test(self-host): bin/setup failure propagation (#174)"
**Files likely touched:** `test/` smoke additions
**Dependencies:** Task 1

### Task 4: classifier module + allow-list constant
**Story:** TR-2 PATCH (allow-list is a single exported constant with exact-contents test)
**Type:** infrastructure
**Steps:**
1. Write failing test asserting `PATCH_SAFE_GLOBS` exact contents and that
   `classifyVersionSignal([])` → undeterminable (empty set is not patch-proof).
2. Implement `version-signal.ts` skeleton: types, `PATCH_SAFE_GLOBS`, null/empty handling.
3. GREEN; commit: "feat(self-host): version-signal classifier skeleton, fail-closed core (#174)"
**Files likely touched:** `src/conductor/src/engine/self-host/version-signal.ts` (new),
`src/conductor/test/engine/self-host/version-signal.test.ts` (new)
**Dependencies:** none

### Task 5: MAJOR surface detection
**Story:** TR-2 MAJOR happy (M bin/conduct; R skills→archive via origPath)
**Type:** happy-path
**Steps:**
1. Failing tests: `M bin/conduct` → major/"bin/conduct CLI"; `R100 skills/tdd/SKILL.md →
   archive/tdd/SKILL.md` → major (origPath inspected); `D skills/finish/SKILL.md` → major;
   `M hooks/claude/block-default-branch.sh` → major; `M templates/settings.json` → major.
2. Implement MAJOR branch delegating to `classifyBreakingSurfaces`, refined: hooks/ paths with
   A status are excluded here (they are MINOR — Task 7).
3. GREEN; commit: "feat(self-host): MAJOR surface signals in version classifier (#174)"
**Files likely touched:** version-signal.ts, version-signal.test.ts
**Dependencies:** Task 4

### Task 6: mixed-signal precedence
**Story:** TR-2 MAJOR negative (minor+major set → MAJOR, all signals listed)
**Type:** negative-path
**Steps:**
1. Failing test: `A skills/new-skill/SKILL.md` + `D bin/install` → level major, signals array
   contains BOTH the new-skill and symlink-target entries.
2. Implement signal accumulation (collect all, report max level).
3. GREEN; commit: "feat(self-host): signal precedence + full signal reporting (#174)"
**Files likely touched:** version-signal.ts, version-signal.test.ts
**Dependencies:** Task 5

### Task 7: MINOR signal detection
**Story:** TR-2 MINOR happy (added SKILL.md, added hook)
**Type:** happy-path
**Steps:**
1. Failing tests: `A skills/new-thing/SKILL.md` → minor/"new skill"; `A hooks/claude/new.sh` →
   minor/"new hook" (added ≠ modified).
2. Implement MINOR detectors.
3. GREEN; commit: "feat(self-host): MINOR additive signals (#174)"
**Files likely touched:** version-signal.ts, version-signal.test.ts
**Dependencies:** Task 6

### Task 8: MINOR near-misses (adversarial)
**Story:** TR-2 MINOR negatives (HARNESS.md one-liner; new engine gate file vs modified engine
file; skills supporting file without SKILL.md)
**Type:** negative-path
**Steps:**
1. Failing tests: `M HARNESS.md` → minor-halt (additivity undecidable); `A src/conductor/src/
   engine/self-host/new-gate.ts` → minor; `M src/conductor/src/engine/self-host/version-gate.ts`
   alone → patch; `A skills/new-thing/reference.md` (no SKILL.md) → NOT new-skill (falls to
   allow-list → halt as unclassified).
2. Implement path-precision in detectors.
3. GREEN; commit: "test(self-host): adversarial near-miss coverage for MINOR signals (#174)"
**Files likely touched:** version-signal.ts, version-signal.test.ts
**Dependencies:** Task 7

### Task 9: PATCH fail-closed boundaries
**Story:** TR-2 PATCH happy + negatives (docs/test/engine-mod set passes; null/unknown-path/
mixed halt)
**Type:** negative-path
**Steps:**
1. Failing tests: {M README.md, M .docs/plans/foo.md, M test/engine/x.test.ts,
   M src/conductor/src/engine/selector.ts} → patch with full file list; `null` → undeterminable;
   {M README.md, A some/new/dir/file.txt} → halt naming the unclassified path;
   {M README.md, A skills/x/SKILL.md} → minor (allow-listed neighbors don't dilute).
2. Implement every-path-must-match rule.
3. GREEN; commit: "feat(self-host): PATCH allow-list, fail-closed on any unknown path (#174)"
**Files likely touched:** version-signal.ts, version-signal.test.ts
**Dependencies:** Task 8

### Task 10: evaluateVersionApproval — marker invariance
**Story:** TR-3 happy (marker match short-circuits classifier) + negative (mismatch not rescued)
**Type:** happy-path
**Steps:**
1. Failing tests: marker==VERSION passes with a classifier spy asserting it was NEVER invoked;
   marker≠VERSION halts with the existing mismatch reason even when the change set is pure
   patch (classification cannot rescue a mismatch).
2. Extend `evaluateVersionApproval` signature (optional signal input consulted only on absent
   marker); keep existing branches byte-identical.
3. GREEN; commit: "feat(self-host): marker-invariant escalation seam in version gate (#174)"
**Files likely touched:** version-gate.ts, version-gate tests
**Dependencies:** Task 9

### Task 11: no-marker classification + HALT reasons
**Story:** TR-3 negative (signal HALT names level, files, resume procedure)
**Type:** negative-path
**Steps:**
1. Failing tests: no marker + minor set → HALT reason contains level, triggering paths, and
   the resume text (VERSION per CLAUDE.md rule 4 / write marker); no marker + null diff →
   HALT undeterminable; no marker + patch set → verdict ok.
2. Implement the no-marker branch calling the classifier.
3. GREEN; commit: "feat(self-host): escalated no-marker version gate (#174)"
**Files likely touched:** version-gate.ts, version-gate tests
**Dependencies:** Task 10

### Task 12: audit record write + write-failure HALT
**Story:** TR-3 happy (version-signal.json on auto-pass) + negatives (no stale pass record on
HALT; unwritable .pipeline → HALT not unaudited pass)
**Type:** negative-path
**Steps:**
1. Failing tests: patch auto-pass writes `.pipeline/version-signal.json` with verdict/level/
   files; signal HALT leaves no file claiming a pass (absent, or overwritten with the halt
   verdict); injected fs failure on the audit write → gate HALTs.
2. Implement audit write via injected writer (default node:fs), part of the pass contract.
3. GREEN; commit: "feat(self-host): auditable auto-pass record, halt on unauditable (#174)"
**Files likely touched:** version-gate.ts, version-gate tests
**Dependencies:** Task 11

### Task 13: thread changedFiles through wiring + conductor
**Story:** TR-3 happy (real runSelfHostFinishGates composition) + negative (gate disabled →
no classification, no audit file)
**Type:** happy-path / integration
**Steps:**
1. Failing tests: widen `SelfHostGuardrails.versionGate` type; a conductor-level test drives
   `runSelfHostFinishGates` with a docs-only diff (stub git runner) asserting versionGate
   auto-passes and received the SAME thunk source as releaseGate; config
   `version_approval_gate: false` → classifier spy never called, no version-signal.json.
2. Implement: conductor.ts:556-560 gains `changedFiles: () => this.selfBuildChangedFiles()`;
   wiring.ts default bundle updated.
3. GREEN; commit: "feat(self-host): wire change-set thunk into version gate (#174)"
**Files likely touched:** conductor.ts, wiring.ts, conductor/wiring tests
**Dependencies:** Task 12

### Task 14: orphaned-primitive sweep
**Story:** TR-3 Done-When (grep evidence: no unwired classification path, no stale always-HALT
caller)
**Type:** refactor / verification
**Steps:**
1. Grep: every caller of `evaluateVersionApproval`/`runVersionApprovalGate` passes through the
   new signature; `classifyVersionSignal` has exactly one production call site (version-gate);
   no dead export of the old no-marker behavior remains.
2. Record the grep evidence in the task output (for code review).
3. Commit only if cleanup needed: "refactor(self-host): remove superseded gate callers (#174)"
**Files likely touched:** none expected
**Dependencies:** Task 13

### Task 15: README reconciliation
**Story:** TR-4 happy (retire cutover guidance; escalation table) + negative (grep-zero)
**Type:** infrastructure (docs)
**Steps:**
1. Replace the "MUST NOT be set on the harness self-host repo / Leave it unset on the harness"
   guidance (~lines 434, 443-444) with the actual policy (committed cutover 2026-07-02T11:00:00Z,
   adr-2026-07-03-harness-daemon-profile); add the escalation table (PATCH auto / MINOR HALT /
   MAJOR HALT / undeterminable HALT) + version-signal.json note to §self-host guardrails.
2. Verify: `grep -c "MUST NOT be set on the harness" README.md` → 0.
3. Commit: "docs: reconcile README with harness daemon profile (#174)"
**Files likely touched:** README.md
**Dependencies:** Task 13 (documents shipped behavior)

### Task 16: src/conductor/README daemon-on-harness note
**Story:** TR-4 happy (registration note, bin/setup purpose + hazard)
**Type:** infrastructure (docs)
**Steps:**
1. Add note: repo is daemon-registered build-to-PR (human merge); `bin/setup` preps worktrees;
   bin/setup is worktree-prep only — primary-checkout rebuild hazard, see issue #215.
2. Commit: "docs(conductor): daemon-on-harness registration note (#174)"
**Files likely touched:** src/conductor/README.md
**Dependencies:** Task 15

### Task 17: CHANGELOG + integrity gate
**Story:** TR-4 happy (Unreleased entry) + negative (integrity suite green on full diff)
**Type:** infrastructure
**Steps:**
1. Add `## [Unreleased]` → Added entry: daemon profile — bin/setup worktree prep, version-gate
   semver escalation (PATCH auto-pass w/ audit, MINOR/MAJOR HALT), README reconciliation
   (refs #174). No Migration block needed: no settings schema/hook wiring/symlink-target/
   bin-conduct change (bin/setup is additive).
2. Run `test/test_harness_integrity.sh` on the full tree — must pass.
3. Run full vitest: `rtk proxy npx vitest run` in src/conductor — must pass.
4. Commit: "docs: changelog for harness daemon profile (#174)"
**Files likely touched:** CHANGELOG.md
**Dependencies:** Tasks 14-16

## Task Dependency Graph

```
Task 1 ─┬─ Task 2
        └─ Task 3
Task 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17
(Tasks 1-3 independent of 4-14; docs 15-17 after 13)
```

## Integration Points

- After Task 2: a scratch worktree is fully self-sufficient (install+build+test runnable).
- After Task 13: a simulated self-build with a docs-only diff flows finish gates end-to-end
  without a HALT; a skill-adding diff HALTs with a named MINOR signal.
- After Task 17: integrity suite + full vitest green on the complete change.

## Coverage Mapping

| Story criterion | Task(s) |
|---|---|
| TR-1 happy: prepareWorktree runs bin/setup, install+build | 1, 2 |
| TR-1 happy: worktree-local artifacts, primary untouched | 2 |
| TR-1 neg: install fails → no build, keep+errored | 3 |
| TR-1 neg: build fails → keep+errored | 3 |
| TR-1 neg: consumer repos unaffected | 1 (script is repo-local; no engine change) |
| TR-2 MAJOR happy: bin/conduct, rename-out-of-skills | 5 |
| TR-2 MAJOR neg: deleted skill, modified hook, settings, mixed precedence | 5, 6 |
| TR-2 MINOR happy: added SKILL.md, added hook | 7 |
| TR-2 MINOR neg: HARNESS.md, engine gate add vs modify, supporting-file near-miss | 8 |
| TR-2 PATCH happy: allow-listed set passes with file list | 9 |
| TR-2 PATCH neg: null, empty, unknown path, mixed | 4, 9 |
| TR-2 Done-When: allow-list exact-contents test | 4 |
| TR-3 happy: marker short-circuit | 10 |
| TR-3 happy: patch auto-pass + audit record | 12 |
| TR-3 happy: real composition, same thunk | 13 |
| TR-3 neg: mismatch not rescued | 10 |
| TR-3 neg: signal HALT reason contents; no stale pass record | 11, 12 |
| TR-3 neg: audit write failure → HALT | 12 |
| TR-3 neg: gate disabled → no classification/audit | 13 |
| TR-3 Done-When: grep evidence | 14 |
| TR-4 happy: README policy + escalation table; conductor README note; CHANGELOG | 15, 16, 17 |
| TR-4 neg: grep-zero retired guidance; integrity suite green | 15, 17 |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Dependencies are explicit and acyclic
