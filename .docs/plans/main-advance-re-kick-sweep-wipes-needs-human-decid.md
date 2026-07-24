# Implementation Plan: needs-human halts survive the main-advance re-kick sweep

**Date:** 2026-07-24
**Design:** technical track — no PRD; approach recorded in `.memory/decisions/halt-class-survives-rekick.md`
**Stories:** .docs/stories/main-advance-re-kick-sweep-wipes-needs-human-decid.md
**Conflict check:** skipped (Tier S)
**Source:** jstoup111/ai-conductor#921

## Summary

Persist a machine-readable halt class at every needs-human halt write site and
teach `rekickSweep` to skip `needs-human` halts (with observable log lines)
while mechanical/unclassified halts keep re-kicking on base advance. 10 tasks.

## Technical Approach

- **Class record = sidecar marker, not prose.** `halt-marker.ts` (the single
  source of truth for `.pipeline/HALT`) gains a `HALT_CLASS_MARKER`
  (`.pipeline/HALT.class`) plus a `HaltClass` type (`'needs-human' |
  'mechanical'`). `writeHaltMarker(projectRoot, body, haltClass?)` writes the
  sidecar best-effort alongside the marker; omitted class writes no sidecar
  (legacy behavior). The HALT body/first-line-reason contract is untouched, so
  the dashboard and `HALT.cleared` preservation are unaffected.
- **Read side is tolerant.** A `readHaltClass(worktreePath)` helper returns
  `'needs-human' | 'mechanical' | 'unclassified'`; absent file, fs error, or
  unrecognized content all resolve to `'unclassified'` and never throw.
- **Sweep decision order.** In `rekickSweep`'s per-slug loop the class check
  runs AFTER the operator-park check and the `isProcessed` dedup (both
  unchanged, park still first) and BEFORE the FR-9 per-SHA guard:
  `needs-human` → push to `skipped`, log
  `re-kick <slug>: skipped — halt class needs-human (<reason>)`, touch nothing
  (no abort/clear/sentinel/lastRekickSha). `mechanical`/`unclassified` → fall
  through to today's guard + clear path; the clear/skip log lines carry the
  class so every sweep decision is observable (issue outcome 3).
- **Cleanup.** `clearMarker` also removes `.pipeline/HALT.class` so a stale
  class can never misclassify a later halt.
- **Writer migration.** The enumerated needs-human funnels pass
  `'needs-human'`: conductor.ts validation-group remediation halts and
  prd-audit halts (raw `writeFile(LOOP_HALT_MARKER)` sites move to the
  classified `writeHaltMarker`), the build_review scope-FAIL disposition halt,
  rebase.ts `writeHalt`, and self-host `writeSelfHostHalt` (covers
  release-gate + version-gate + integrity halts). The build-stall and
  gate-loop-budget funnels pass `'mechanical'` explicitly. All other legacy
  sites stay unclassified and keep today's re-kick behavior.
- **Sequencing.** Marker machinery first (Tasks 1-2), sweep behavior next
  (Tasks 3-5), writer migration after (Tasks 6-9), docs last (Task 10).

## Prerequisites

None — all changes are inside `src/conductor`; existing unit-test harness
(`vitest`) covers the touched modules.

## Tasks

### Task 1: Classified halt write in halt-marker.ts
**Story:** TR-3 (shared machinery; failed class write still leaves HALT)
**Type:** infrastructure

**Steps:**
1. Write failing tests: `writeHaltMarker(root, body, 'needs-human')` writes
   `.pipeline/HALT.class` containing `needs-human`; omitting the class writes
   no sidecar; a sidecar write failure (unwritable dir stubbed) still writes
   the HALT marker and throws nothing.
2. Verify RED.
3. Implement: add `HaltClass` type, `HALT_CLASS_MARKER = '.pipeline/HALT.class'`,
   optional third parameter on `writeHaltMarker`, best-effort sidecar write
   (`.catch(() => {})`, mirroring the marker write).
4. Verify GREEN.
5. Commit: "feat: halt-marker supports machine-readable halt class sidecar"

**Files likely touched:**
- src/conductor/src/engine/halt-marker.ts — HaltClass type, HALT_CLASS_MARKER, classified write
- src/conductor/src/engine/halt-marker.test.ts — new tests

**Wired-into:** src/conductor/src/engine/self-host/gate-halt.ts#writeGateHalt,
src/conductor/src/engine/rebase.ts (conflict HALT), src/conductor/src/engine/conductor.ts
(build-stall / gate-budget / needs-human HALTs) — all pass a halt class to
`writeHaltMarker`; `HALT_CLASS_MARKER` is consumed by
src/conductor/src/engine/daemon-rekick.ts#clearMarker (Tasks 5-9)

**Dependencies:** none

### Task 2: Tolerant readHaltClass helper
**Story:** TR-1 negative (unreadable/unrecognized class → unclassified, never throws)
**Type:** infrastructure

**Steps:**
1. Write failing tests: `readHaltClass(root)` returns `needs-human` /
   `mechanical` for matching sidecar content (trimmed); returns
   `unclassified` for absent file, unreadable file, and unrecognized content;
   never throws.
2. Verify RED.
3. Implement `readHaltClass` in halt-marker.ts.
4. Verify GREEN.
5. Commit: "feat: tolerant readHaltClass resolver for halt class sidecar"

**Files likely touched:**
- src/conductor/src/engine/halt-marker.ts — readHaltClass
- src/conductor/src/engine/halt-marker.test.ts — tests

**Wired-into:** src/conductor/src/daemon-cli.ts#rekick sweep deps construction
(`readHaltClass: (slug) => readHaltClass(join(worktreeBase, slug))`), consumed by
src/conductor/src/engine/daemon-rekick.ts#rekickSweep (Tasks 3 and 5)

**Dependencies:** Task 1

### Task 3: rekickSweep skips needs-human halts
**Story:** TR-1 happy (survives sweep; survives repeated advances) + TR-1 negative (park checked first)
**Type:** happy-path

**Steps:**
1. Write failing unit tests driving `rekickSweep` with an injected
   `readHaltClass` dep: needs-human slug → in `skipped`, not `cleared`, no
   `clearMarker`/`abortRebase` calls, `lastRekickSha` not updated, log line
   contains slug + `needs-human` + skip reason; same slug skipped again at a
   second SHA; operator-parked + needs-human slug → park log line, class dep
   never called.
2. Verify RED.
3. Implement: add optional `readHaltClass?: (slug) => Promise<HaltClass |
   'unclassified'>` to `RekickSweepDeps`; class branch after
   park/isProcessed, before the per-SHA guard; absent dep → unchanged
   behavior.
4. Verify GREEN.
5. Commit: "feat: re-kick sweep skips needs-human classified halts"

**Files likely touched:**
- src/conductor/src/engine/daemon-rekick.ts — class dep + skip branch + logs
- src/conductor/src/engine/daemon-rekick.test.ts — tests

**Wired-into:** src/conductor/src/engine/daemon-rekick.ts#rekickSweep

**Dependencies:** Task 2

### Task 4: Mechanical/unclassified halts keep re-kicking, with class in the log
**Story:** TR-2 happy (mechanical + legacy class-less re-kick) + TR-2 negative (per-SHA guard intact)
**Type:** happy-path

**Steps:**
1. Write failing tests: mechanical-classified slug → cleared + REKICK sentinel
   + log line carrying `mechanical`; class-less slug → cleared, logged
   `unclassified`; classified slug already re-kicked at SHA X → per-SHA guard
   still skips at X.
2. Verify RED.
3. Implement: thread the resolved class into the existing clear/skip log lines.
4. Verify GREEN.
5. Commit: "feat: re-kick log lines carry halt class"

**Files likely touched:**
- src/conductor/src/engine/daemon-rekick.ts — log wording
- src/conductor/src/engine/daemon-rekick.test.ts — tests

**Wired-into:** same as Task 3

**Dependencies:** Task 3

### Task 5: clearMarker removes the class sidecar; wire real readHaltClass into daemon deps
**Story:** TR-2 negative (no stale class survives a clear)
**Type:** negative-path

**Steps:**
1. Write failing tests: `clearMarker(worktree)` removes
   `.pipeline/HALT.class` when present (and stays a no-op-safe on absence);
   the production `RekickSweepDeps` wiring passes a real `readHaltClass`
   bound to the worktree path.
2. Verify RED.
3. Implement: `rm(join(worktreePath, HALT_CLASS_MARKER), { force: true })` in
   `clearMarker`; wire `readHaltClass` where the daemon CLI builds the sweep
   deps.
4. Verify GREEN.
5. Commit: "feat: clear halt class with the marker; wire class read into daemon sweep deps"

**Files likely touched:**
- src/conductor/src/engine/daemon-rekick.ts — clearMarker + real dep export
- src/conductor/src/daemon-cli.ts — deps wiring
- src/conductor/src/engine/daemon-rekick.test.ts — tests

**Wired-into:** src/conductor/src/daemon-cli.ts#rekick sweep deps construction

**Dependencies:** Task 3

### Task 6: Classify conductor validation-group + prd-audit halts as needs-human
**Story:** TR-3 happy (validation-group "needs human DECIDE", prd-audit halt variants)
**Type:** happy-path

**Steps:**
1. Write failing tests (funnel-level where practical): the validation-group
   remediation halt path and the prd-audit halt paths persist a `needs-human`
   class sidecar next to the HALT they write.
2. Verify RED.
3. Implement: switch these raw `writeFile(LOOP_HALT_MARKER, ...)` sites in
   conductor.ts (validation-group remediation halts, prd-audit needs-human
   DECIDE + un-ALIGNED FR halts, build_review scope-FAIL disposition halt) to
   `writeHaltMarker(root, body, 'needs-human')`.
4. Verify GREEN.
5. Commit: "feat: classify conductor needs-human halts"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — needs-human halt sites
- src/conductor/src/engine/conductor.test.ts — funnel tests (or nearest existing suite)

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 7: Classify rebase-conflict halts as needs-human
**Story:** TR-3 happy (rebase `writeHalt`)
**Type:** happy-path

**Steps:**
1. Write failing test: `writeHalt(root, conflicts, reason)` persists a
   `needs-human` class sidecar.
2. Verify RED.
3. Implement: `rebase.ts#writeHalt` passes `'needs-human'`.
4. Verify GREEN.
5. Commit: "feat: classify rebase-conflict halts as needs-human"

**Files likely touched:**
- src/conductor/src/engine/rebase.ts — writeHalt
- src/conductor/src/engine/rebase.test.ts — test

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 8: Classify self-host gate halts as needs-human
**Story:** TR-3 happy (`writeSelfHostHalt`: release-gate, version-gate, integrity)
**Type:** happy-path

**Steps:**
1. Write failing test: `writeSelfHostHalt(root, reason)` persists a
   `needs-human` class sidecar.
2. Verify RED.
3. Implement: `gate-halt.ts#writeSelfHostHalt` passes `'needs-human'`.
4. Verify GREEN.
5. Commit: "feat: classify self-host gate halts as needs-human"

**Files likely touched:**
- src/conductor/src/engine/self-host/gate-halt.ts — writeSelfHostHalt
- src/conductor/src/engine/self-host/gate-halt.test.ts — test

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 9: Classify build-stall and gate-loop-budget halts as mechanical
**Story:** TR-3 happy (mechanical sites explicit) / TR-2 happy
**Type:** happy-path

**Steps:**
1. Write failing tests: the build-stall terminal halt and the
   gate-selected-N-times halt persist a `mechanical` class sidecar.
2. Verify RED.
3. Implement: switch those two conductor.ts funnels to
   `writeHaltMarker(root, body, 'mechanical')`.
4. Verify GREEN.
5. Commit: "feat: classify build-stall and gate-budget halts as mechanical"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — mechanical halt sites
- src/conductor/src/engine/conductor.test.ts — funnel tests

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 10: Document halt classes + changelog
**Story:** TR-3 Done-When (docs) — repo docs-track-features rule
**Type:** infrastructure

**Steps:**
1. Document in `docs/daemon-operations.md`: the two halt classes, the sweep's
   skip/re-kick decision table (park → processed → class → per-SHA guard), the
   `unclassified` fallback, and how an operator releases a needs-human halt
   (remove `.pipeline/HALT`; the class sidecar is cleared with it).
2. Mirror the operational note in `src/conductor/README.md`.
3. Add a CHANGELOG.md `[Unreleased]` **Fixed** entry (needs-human halts no
   longer wiped by main-advance re-kick sweeps) — no VERSION bump (pre-v1).
4. Run `test/test_harness_integrity.sh`; fix any failures.
5. Commit: "docs: halt classes and re-kick sweep survival rules"

**Files likely touched:**
- docs/daemon-operations.md — halt class documentation
- src/conductor/README.md — operational note
- CHANGELOG.md — [Unreleased] Fixed entry

**Wired-into:** none (no new production surface)

**Dependencies:** Task 3, Task 4, Task 5, Task 6, Task 7, Task 8, Task 9

## Task Dependency Graph

```
Task 1 ──┬── Task 2 ── Task 3 ──┬── Task 4 ──┐
         │                      └── Task 5 ──┤
         ├── Task 6 ────────────────────────┤
         ├── Task 7 ────────────────────────┼── Task 10
         ├── Task 8 ────────────────────────┤
         └── Task 9 ────────────────────────┘
```

## Integration Points

- After Task 5: end-to-end sweep behavior testable — a needs-human-classified
  worktree survives a simulated base advance; a mechanical one re-kicks with
  class-bearing log lines and no stale sidecar.
- After Task 9: every enumerated halt funnel writes its class; a daemon run
  reproducing issue #921's log pattern shows `skipped — halt class needs-human`
  instead of a re-kick.

## Coverage

- TR-1 happy (survives sweep, repeated advances, operator release) → Tasks 3, 5
- TR-1 negative (unreadable class → unclassified re-kick; park first) → Tasks 2, 3
- TR-2 happy (mechanical + legacy re-kick, class in log) → Tasks 4, 9
- TR-2 negative (per-SHA guard intact; no stale class after clear) → Tasks 4, 5
- TR-3 happy (all needs-human funnels classified; mechanical explicit) → Tasks 6, 7, 8, 9
- TR-3 negative (failed class write leaves HALT, degrades to legacy) → Task 1
- TR-3 docs Done-When → Task 10

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
