# Implementation Plan: Phase-Scoped .docs Write-Guard (#788)

**Date:** 2026-07-22
**Design:** .docs/decisions/adr-2026-07-22-phase-scoped-docs-write-guard.md (APPROVED); .docs/decisions/architecture-review-2026-07-22-block-edits-to-docs-spec-artifacts-during-build-an.md (APPROVED)
**Stories:** .docs/stories/block-edits-to-docs-spec-artifacts-during-build-an.md (Status: Accepted)
**Conflict check:** Clean as of 2026-07-22 (1 blocking conflict resolved — always-allowed `.docs/release-waivers/` prefix; .docs/conflicts/block-edits-to-docs-spec-artifacts-during-build-an.md)

## Summary

Adds a mechanical, phase-scoped write-guard for `.docs/` spec artifacts: a
`.pipeline/phase-active` marker written by the conductor around every BUILD/SHIP step, a
two-part engine allowlist resolved into the marker, and a new `docs-guard.sh` PreToolUse
hook wired in daemon worktrees and primary checkouts. 13 tasks.

## Technical Approach

- **New engine module `src/conductor/src/engine/phase-marker.ts`** (sibling of
  `attribution-enforcement.ts`): `phaseMarkerPath(root)`, `writePhaseMarker(root, {step,
  phase, allow})`, `removePhaseMarker(root)`. Marker format is line-oriented for bash:
  `step: «name»` / `phase: «BUILD|SHIP»` / `written: «ISO»` / zero+ `allow: «prefix»`.
- **Two-part allowlist in the same module:** `DOCS_WRITE_ALLOWLIST: Record<string,
  string[]>` (per-step; seed: `retro → ['.docs/retros/', '.docs/stories/']`) and
  `DOCS_WRITE_ALWAYS_ALLOWED: string[]` (seed: `['.docs/release-waivers/']`);
  `resolveDocsAllowlist(stepName)` = always-allowed ∪ per-step.
- **Conductor lifecycle (in `Conductor#run`'s step dispatch):** at EVERY step entry,
  `removePhaseMarker` first (stale correction); if the entering step's `phase` (from
  `steps.ts`) is BUILD or SHIP, `writePhaseMarker` with the resolved allowlist — keyed
  off `step.phase`, never names. Clear again in the existing `finally` beside
  `removeBuildStepMarker` (~conductor.ts:3010).
- **Hook `DOCS_GUARD_HOOK`** exported from `session-hook-assets.ts` as a sibling of
  `MUTATION_GATE_HOOK`, mirroring its structure: marker-absent fast path (exit 0, no
  stdin read); write-surface fail-closed posture (undeterminable target under an active
  marker → exit 2); target under `.docs/` → boundary-safe prefix test against `allow:`
  lines; rejection stderr names step, phase, marker path, and the
  `rm .pipeline/phase-active` remedy.
- **Wiring:** `worktree-prepare.ts` writes `.pipeline/session-hooks/docs-guard.sh` and
  merges its OWN settings entry (matcher `Edit|Write|NotebookEdit`) — no chaining to
  mutation-gate. Primary checkouts: `bin/install`'s `harness_hooks` gains the same
  matcher entry pointing at `hooks/claude/docs-guard.sh`.
- **Single-source mechanism (decided):** `hooks/claude/docs-guard.sh` is a GENERATED
  file emitted from the TS const by new `bin/generate-docs-guard-hook`, with a drift
  check in `test/test_harness_integrity.sh` — the exact `bin/generate-model-table`
  pattern already enforced by check 5a.
- **Sequencing:** engine primitives → conductor lifecycle → hook script + behavior tests
  → wiring (worktree, generator, integrity, install) → CHANGELOG/migration/docs.

## Prerequisites

None — pure additions; no migrations, no new dependencies.

## Tasks

### Task 1: Phase-marker module — path/write/remove primitives
**Story:** "Phase-keyed marker written on BUILD/SHIP step entry" (marker format criteria)
**Type:** infrastructure

**Steps:**
1. Write failing test: `writePhaseMarker(root, {step:'acceptance_specs', phase:'BUILD', allow:[]})` creates `.pipeline/phase-active` containing `step: acceptance_specs`, `phase: BUILD`, and a `written:` ISO line; `removePhaseMarker` is idempotent; write creates `.pipeline/` when absent (no ENOENT).
2. Verify test fails (RED)
3. Implement `src/conductor/src/engine/phase-marker.ts` mirroring `attribution-enforcement.ts`'s marker fns (non-empty-root guard included).
4. Verify test passes (GREEN)
5. Commit: "feat(engine): phase-active marker primitives (#788)"

**Files likely touched:**
- src/conductor/src/engine/phase-marker.ts — new module
- src/conductor/src/engine/phase-marker.test.ts — new tests

**Wired-into:** src/conductor/src/engine/conductor.ts#run
**Dependencies:** none

### Task 2: Two-part allowlist table + resolver
**Story:** "Allowlisted retro writes pass during SHIP" (marker-composition criteria)
**Type:** infrastructure

**Steps:**
1. Write failing test: `resolveDocsAllowlist('retro')` = `['.docs/release-waivers/', '.docs/retros/', '.docs/stories/']`; `resolveDocsAllowlist('manual_test')` = `['.docs/release-waivers/']`; unknown step → always-allowed only.
2. Verify test fails (RED)
3. Implement `DOCS_WRITE_ALLOWLIST`, `DOCS_WRITE_ALWAYS_ALLOWED`, `resolveDocsAllowlist` in phase-marker.ts.
4. Verify test passes (GREEN)
5. Commit: "feat(engine): two-part .docs write allowlist (#788)"

**Files likely touched:**
- src/conductor/src/engine/phase-marker.ts — table + resolver
- src/conductor/src/engine/phase-marker.test.ts — resolver tests

**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 3: Clear-on-every-step-entry stale correction
**Story:** "Stale marker corrected at every step entry" (happy + DECIDE-entry negative)
**Type:** happy-path

**Steps:**
1. Write failing test (conductor step-dispatch seam, existing harness for marker behavior): with a leftover `.pipeline/phase-active` on disk, entering a DECIDE step (e.g. `stories`) removes it before dispatch and does NOT rewrite it.
2. Verify test fails (RED)
3. Implement: unconditional `removePhaseMarker(this.projectRoot)` at step entry in `Conductor#run`, before the phase decision.
4. Verify test passes (GREEN)
5. Commit: "feat(engine): stale phase-marker cleared at every step entry (#788)"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — step-entry clear
- src/conductor/src/engine/conductor.test.ts (or existing dispatch-seam test file) — stale-correction test

**Wired-into:** src/conductor/src/engine/conductor.ts#run
**Dependencies:** Task 1

### Task 4: Phase-keyed marker write on BUILD/SHIP entry + finally clear
**Story:** "Phase-keyed marker written on BUILD/SHIP step entry, cleared on exit" (all criteria)
**Type:** happy-path

**Steps:**
1. Write failing tests: entering a BUILD step (`acceptance_specs`) and a SHIP step (`manual_test`) writes the marker with resolved allowlist; a fixture step with a NOVEL name and `phase: 'SHIP'` also gets a marker (proves phase-keying, no name enumeration); marker removed in `finally` on success, failure, and thrown error.
2. Verify tests fail (RED)
3. Implement: in `Conductor#run`, beside the `writeBuildStepMarker` site (~2954): `if (step.phase === 'BUILD' || step.phase === 'SHIP') writePhaseMarker(root, {step: step.name, phase: step.phase, allow: resolveDocsAllowlist(step.name)})`; add `removePhaseMarker` to the existing `finally` (~3010).
4. Verify tests pass (GREEN)
5. Commit: "feat(engine): phase-active marker lifecycle around BUILD/SHIP steps (#788)"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — write + finally clear
- src/conductor/src/engine/conductor.test.ts (or dispatch-seam test file) — lifecycle tests

**Wired-into:** src/conductor/src/engine/conductor.ts#run
**Dependencies:** Task 1, Task 2, Task 3

### Task 5: DOCS_GUARD_HOOK script — inert paths
**Story:** "Guard is inert outside BUILD/SHIP and for non-docs targets" (happy paths + no-stdin negative)
**Type:** happy-path

**Steps:**
1. Write failing tests (bash-execution harness used for MUTATION_GATE_HOOK tests): marker absent → exit 0 with no stdin read/hang; marker present + target `src/foo.ts` → exit 0.
2. Verify tests fail (RED)
3. Implement `DOCS_GUARD_HOOK` in `session-hook-assets.ts`: read target path from payload (Edit/Write/NotebookEdit `tool_input.file_path`/`notebook_path`), marker-absent fast path first; mirror MUTATION_GATE_HOOK's bounded stdin (1MiB, timeout 3) and node JSON parse.
4. Verify tests pass (GREEN)
5. Commit: "feat(hooks): docs-guard hook — inert fast paths (#788)"

**Files likely touched:**
- src/conductor/src/engine/session-hook-assets.ts — DOCS_GUARD_HOOK export
- src/conductor/src/engine/session-hook-assets.test.ts — hook execution tests

**Wired-into:** src/conductor/src/engine/worktree-prepare.ts#writeSessionHooks
**Dependencies:** Task 1

### Task 6: Docs-guard block path — default-deny with actionable rejection
**Story:** "Docs-guard blocks .docs writes during BUILD/SHIP with default-deny" (happy paths); "Stale marker" (remedy-message negative)
**Type:** happy-path

**Steps:**
1. Write failing tests: active marker (`step: build`, no per-step allows), Edit/Write targeting `.docs/plans/x.md`, `.docs/stories/x.md`, `.docs/specs/x.md`, `.docs/decisions/adr-x.md` → each exit 2; stderr contains phase, step name, `.pipeline/phase-active`, and the `rm` remedy; unlisted-subdir `.docs/future-artifact-type/x.md` → exit 2.
2. Verify tests fail (RED)
3. Implement the `.docs/` prefix branch + rejection message in DOCS_GUARD_HOOK.
4. Verify tests pass (GREEN)
5. Commit: "feat(hooks): docs-guard default-deny block path (#788)"

**Files likely touched:**
- src/conductor/src/engine/session-hook-assets.ts — block branch
- src/conductor/src/engine/session-hook-assets.test.ts — block-path tests

**Wired-into:** same as Task 5
**Dependencies:** Task 5

### Task 7: Docs-guard allow paths — boundary-safe prefixes
**Story:** "Allowlisted retro writes pass during SHIP" (hook criteria); "default-deny" (release-waivers + boundary negatives)
**Type:** happy-path

**Steps:**
1. Write failing tests: marker with `allow: .docs/retros/` + `allow: .docs/stories/` + `allow: .docs/release-waivers/` → Write `.docs/retros/x.md` exit 0, Write `.docs/stories/y.md` exit 0, Edit `.docs/plans/z.md` exit 2; any BUILD marker (only `allow: .docs/release-waivers/`) → Write `.docs/release-waivers/stem.md` exit 0; boundary negatives `.docs/retros-evil/x.md` and `.docs/release-waivers-evil/x.md` → exit 2.
2. Verify tests fail (RED)
3. Implement boundary-safe prefix compare (match on full directory segments) over `allow:` lines.
4. Verify tests pass (GREEN)
5. Commit: "feat(hooks): docs-guard allow-prefix pass paths (#788)"

**Files likely touched:**
- src/conductor/src/engine/session-hook-assets.ts — allow branch
- src/conductor/src/engine/session-hook-assets.test.ts — allow-path tests

**Wired-into:** same as Task 5
**Dependencies:** Task 6

### Task 8: Docs-guard fail-closed edges
**Story:** "default-deny" (malformed-marker negative); "inert" (undeterminable-path negative); "default-deny" (NotebookEdit negative — settings matcher asserted in Tasks 9/12)
**Type:** negative-path

**Steps:**
1. Write failing tests: malformed/empty marker + `.docs/` target → exit 2 (generic freeze reason); active marker + unparseable payload (target undeterminable on write surface) → exit 2; NotebookEdit payload targeting `.docs/plans/x.ipynb` with active marker → exit 2 (script handles `notebook_path`).
2. Verify tests fail (RED)
3. Implement the fail-closed branches.
4. Verify tests pass (GREEN)
5. Commit: "feat(hooks): docs-guard fail-closed edges (#788)"

**Files likely touched:**
- src/conductor/src/engine/session-hook-assets.ts — fail-closed branches
- src/conductor/src/engine/session-hook-assets.test.ts — edge tests

**Wired-into:** same as Task 5
**Dependencies:** Task 6

### Task 9: Worktree wiring — write + own settings entry, idempotent
**Story:** "Daemon worktrees get the guard via worktree-prepare" (all criteria)
**Type:** infrastructure

**Steps:**
1. Write failing tests (existing worktree-prepare test harness): after prepare, `.pipeline/session-hooks/docs-guard.sh` exists + executable; `.claude/settings.local.json` has a PreToolUse entry matcher `Edit|Write|NotebookEdit` invoking it, distinct from mutation-gate's; re-run keeps exactly one entry; provisioning failure logs + continues; entry written even when mutation-gate entry absent.
2. Verify tests fail (RED)
3. Implement in `writeSessionHooks` + a `mergeHookEntry` call for the new entry.
4. Verify tests pass (GREEN)
5. Commit: "feat(worktree): wire docs-guard hook in prepared worktrees (#788)"

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — write + wire
- src/conductor/src/engine/worktree-prepare.test.ts — wiring tests

**Wired-into:** src/conductor/src/engine/worktree-prepare.ts#writeSessionHooks
**Dependencies:** Task 5

### Task 10: Generated hooks/claude/docs-guard.sh + generator
**Story:** "Single-source hook asset" (happy paths)
**Type:** infrastructure

**Steps:**
1. Write failing test: running `bin/generate-docs-guard-hook` produces `hooks/claude/docs-guard.sh` byte-identical to the TS const's content (compare against a fresh emit).
2. Verify test fails (RED)
3. Implement `bin/generate-docs-guard-hook` (emits from the built engine, mirroring `bin/generate-model-table`); run it; commit the generated `hooks/claude/docs-guard.sh` (executable).
4. Verify test passes (GREEN); `bash -n hooks/claude/docs-guard.sh` passes.
5. Commit: "feat(hooks): generated docs-guard.sh + generator (#788)"

**Files likely touched:**
- bin/generate-docs-guard-hook — new generator
- src/conductor/src/tools/generate-docs-guard-hook-main.ts — direct-execution entry point
- hooks/claude/docs-guard.sh — generated artifact (committed)

**Wired-into:** src/conductor/src/tools/generate-docs-guard-hook-main.ts#runGenerateDocsGuardHookCli, bin/install#harness_hooks
**Dependencies:** Task 5

### Task 11: Integrity-suite drift check for the generated hook
**Story:** "Single-source hook asset" (drift negative)
**Type:** negative-path

**Steps:**
1. Write failing check: add a `test_harness_integrity.sh` step comparing `hooks/claude/docs-guard.sh` against a fresh generator emit (pattern of check 5a model-table drift); prove it FAILS on a deliberately diverged copy (temp fixture in test), passes on the committed pair.
2. Verify the deliberate-divergence case fails (RED for the fixture)
3. Finalize the check wiring.
4. Verify suite passes on the real tree (GREEN)
5. Commit: "test(integrity): docs-guard generated-hook drift check (#788)"

**Files likely touched:**
- test/test_harness_integrity.sh — drift check

**Wired-into:** none (no new production surface)
**Dependencies:** Task 10

### Task 12: bin/install primary-checkout wiring
**Story:** "Primary checkouts get the guard via bin/install" (happy + merge negatives)
**Type:** infrastructure

**Steps:**
1. Write failing assertion (install test/scripted check): after the settings merge, a PreToolUse entry with matcher `Edit|Write|NotebookEdit` invokes `«hooks_dir»/docs-guard.sh`; user-defined entries preserved; re-run leaves exactly one docs-guard entry.
2. Verify it fails (RED)
3. Implement: add the entry to `harness_hooks` in `bin/install` (~315).
4. Verify passes (GREEN); `bash -n bin/install` passes.
5. Commit: "feat(install): wire docs-guard hook into primary-checkout settings (#788)"

**Files likely touched:**
- bin/install — harness_hooks entry
- test/ (existing install-merge test location) — merge assertions

**Wired-into:** bin/install#harness_hooks
**Dependencies:** Task 10

### Task 13: CHANGELOG + Migration block + docs
**Story:** "Primary checkouts…" (migration-block negative); Documentation Upkeep (CLAUDE.md)
**Type:** infrastructure

**Steps:**
1. Write failing check: release-gate classifier run (or integrity check) over the diff confirms the `## Migration` section with a runnable ```bash migration``` block exists for the hook-wiring surface (this feature changes real hook behavior — waiver NOT applicable).
2. Verify it fails (RED)
3. Implement: CHANGELOG `[Unreleased]` Added entry; `## Migration` block re-running the install settings merge; README.md + src/conductor/README.md document the guard, marker, allowlist, and manual remedy.
4. Verify passes (GREEN); full `test/test_harness_integrity.sh` green.
5. Commit: "docs(release): changelog, migration block, README for docs-guard (#788)"

**Files likely touched:**
- CHANGELOG.md — entry + migration block
- README.md — guard documentation
- src/conductor/README.md — engine/hook documentation

**Wired-into:** none (no new production surface)
**Dependencies:** Task 9, Task 12

## Task Dependency Graph

```
T1 ──┬─ T2 ──┐
     ├─ T3 ──┼─ T4
     └─ T5 ──┬─ T6 ──┬─ T7
             │       └─ T8
             ├─ T9 ──────────┐
             └─ T10 ─┬─ T11  ├─ T13
                     └─ T12 ─┘
```

Acyclic; T1 roots the engine chain, T5 roots the hook/wiring chain.

## Integration Points

- After Task 4: engine lifecycle observable end-to-end (marker appears/disappears around
  a dispatched BUILD step in a sandbox run).
- After Task 9: full daemon-worktree behavior testable — a prepared worktree session's
  `.docs` Edit is rejected while a BUILD step runs.
- After Task 12: primary-checkout behavior testable after `bin/install`.

## Verification

- [ ] All happy path criteria covered: T1/T4 (marker lifecycle), T3 (stale), T6/T7
  (block/allow), T5 (inert), T9 (worktree), T12 (install), T10 (single-source)
- [ ] All negative path criteria covered: T3 (DECIDE entry), T4 (novel-step fixture,
  finally-on-throw), T6 (unlisted subdir, remedy message), T7 (boundary-safe evil
  twins), T8 (malformed marker, undeterminable path, NotebookEdit), T9 (idempotent,
  fail-open provisioning, no chaining), T11 (drift), T12 (user-preserving merge),
  T13 (migration-block presence)
- [ ] No task exceeds 5 minutes
- [ ] Dependencies explicit and acyclic (graph above)
- [ ] Every task carries Wired-into: per architecture-review's Wiring Surface
