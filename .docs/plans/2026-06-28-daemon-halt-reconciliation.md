# Implementation Plan: Daemon Halt-Reconciliation

**Date:** 2026-06-28
**Design:** `.docs/specs/2026-06-28-daemon-halt-reconciliation.md`
**Stories:** `.docs/stories/daemon-halt-reconciliation.md`
**Decisions:** ADR-013 (APPROVED); architecture-review 2026-06-28 (APPROVED WITH CONDITIONS)
**Conflict check:** Clean as of 2026-06-28 (1 blocking resolved → Option 1, abort-before-clear)

## Summary
Adds a startup inherited-state dashboard, base-SHA tracking, and a main-advance re-kick sweep to
the `src/conductor` daemon. 12 tasks. Re-kick reuses PR #109's un-park path (no new dispatch) and
9.0's rebase step (no duplicated rebase); the only safety-critical additions are aborting a paused
rebase before clearing and resuming rebase-first.

## Technical Approach

New modules, kept pure + injected so the state machine is unit-testable without git/network/worktree
(mirrors the existing `DaemonDeps`/`FeatureRunnerDeps` convention in `daemon.ts`/`daemon-deps.ts`):

- **`engine/daemon-sha.ts`** — `parseSha(raw): string|null` (40-hex, trims; empty/garbage→null);
  `readBaseSha(git, ref)` (`git rev-parse <ref>`); `readPersistedBaseSha(dir)` /
  `writePersistedBaseSha(dir, sha)` against `.daemon/last-base-sha` (corrupt/empty→absent, FR-11).
- **`engine/daemon-dashboard.ts`** — `scanInheritedState({worktreeBase, processedDir, discover})`
  → `{ halted[], inProgress[], eligible[], processedCount }` with precedence
  halted>processed>in-progress>eligible; `renderDashboard(state): string`. Best-effort per worktree
  (errors → `unknown`/skip, never throw).
- **`engine/daemon-rekick.ts`** — `rekickSweep(deps, sha)`: for each live-HALT worktree, FR-9
  guard (skip if `lastRekickSha === sha`) → log reason → `if hasRebaseInProgress: abortRebase`
  (best-effort; **failed abort → leave marker intact, skip worktree**) → rename `HALT`→`HALT.cleared`
  → `rm HALT` → write `.pipeline/REKICK` sentinel (FR-12) → record `lastRekickSha=sha`. Injected
  primitives: `listHaltedWorktrees`, `readHaltReason`, `hasRebaseInProgress`, `abortRebase`,
  `clearMarker`. No direct dispatch (FR-8).

Orchestration lives in `runDaemon` (`daemon.ts`) via new optional `DaemonDeps` hooks so ordering is
testable: at start → `renderStartupDashboard()`; seed `lastSeenSha` from `readPersistedBaseSha()`;
first-run (absent) → init, no sweep (FR-5); downtime-advance (persisted≠current) → `rekickSweep`
then persist (FR-5); in the idle-refresh branch → re-read base SHA, advance→sweep→persist (FR-6),
same-SHA/unresolved→no-op (FR-10). Real I/O impls wired in `daemon-cli.ts` `runDaemonMode`.

**FR-12 (rebase-first):** the sweep drops a `.pipeline/REKICK` sentinel. The conductor's worktree
run-entry (`runConductorInWorktree` in `daemon-cli.ts`) checks for it and, if present, runs 9.0's
**existing** rebase-onto-latest step first, deletes the sentinel, then resumes the normal step
sequence — so the pending gate (e.g. prd-audit) re-verifies on the advanced base. Re-kick reuses
9.0's rebase code, never reimplements it, and does no gap routing (that stays with the gate loop /
`/remediate`).

## Prerequisites
- PR #109 merged (un-park path) — done.
- No new dependencies; uses `node:fs/promises`, `node:path`, and the existing `execa`/git runner.

## Tasks

### Task 1: SHA parse/validate helper
**Story:** "Corrupt last-base-sha is treated as absent" (FR-11), "Resolve and persist the base-branch SHA" (FR-4)
**Type:** infrastructure
**Steps:**
1. Write failing test: `parseSha` returns the SHA for a 40-hex string (with trailing newline/space), and `null` for `''`, whitespace, `'main'`, and a short/long non-hex string.
2. Verify RED.
3. Implement `parseSha` in `engine/daemon-sha.ts`.
4. Verify GREEN.
5. Commit: "feat(daemon): parseSha — 40-hex validation, garbage→null (FR-11)"

**Files likely touched:** `src/conductor/src/engine/daemon-sha.ts`, `test/engine/daemon-sha.test.ts`
**Dependencies:** none

### Task 2: base-SHA read + persist primitives
**Story:** FR-4 happy + negative; FR-11 round-trip + unreadable
**Type:** infrastructure
**Steps:**
1. Write failing tests: `readBaseSha` runs `git rev-parse <ref>` (injected git runner) and returns `parseSha` of stdout; returns `null` when rev-parse fails. `writePersistedBaseSha`/`readPersistedBaseSha` round-trip exactly; read of empty/garbage/ENOENT/EACCES → `null` (absent); a failed write is swallowed (logged), not thrown.
2. Verify RED.
3. Implement in `engine/daemon-sha.ts` (reuse the existing git runner seam from `rebase.ts`).
4. Verify GREEN.
5. Commit: "feat(daemon): base-SHA read + .daemon/last-base-sha persist (corrupt→absent) (FR-4,FR-11)"

**Files likely touched:** `engine/daemon-sha.ts`, `test/engine/daemon-sha.test.ts`
**Dependencies:** Task 1

### Task 3: inherited-state scan (worktrees + ledger)
**Story:** "Render the inherited-state dashboard" (FR-1,FR-2), "Dashboard tolerates empty/missing/malformed" (FR-3)
**Type:** infrastructure
**Steps:**
1. Write failing tests: `scanInheritedState` classifies a fixture set — a live-HALT worktree → halted (reason = first line of HALT); a worktree with conduct-state + no HALT + not processed → inProgress (last meaningful step); a processed+stateful worktree → NOT inProgress (precedence); a slug both eligible and halted/processed → excluded from eligible; empty HALT → reason `unknown`; malformed conduct-state → step `unknown`; missing `.worktrees/` → zero; a per-worktree fs error → skipped not thrown.
2. Verify RED.
3. Implement `scanInheritedState` in `engine/daemon-dashboard.ts` (inject `discover` so eligibility uses `discoverBacklog`).
4. Verify GREEN.
5. Commit: "feat(daemon): scan inherited state — halted/in-progress/eligible/processed (FR-2,FR-3)"

**Files likely touched:** `engine/daemon-dashboard.ts`, `test/engine/daemon-dashboard.test.ts`
**Dependencies:** none

### Task 4: dashboard render
**Story:** FR-1 (both sinks, before dispatch), FR-2 (four groups + counts)
**Type:** happy-path
**Steps:**
1. Write failing test: `renderDashboard(state)` produces a four-group string with correct counts and member lines (slug + reason / last step); zero-state renders all groups at `0`.
2. Verify RED.
3. Implement `renderDashboard`.
4. Verify GREEN.
5. Commit: "feat(daemon): render inherited-state dashboard (FR-1,FR-2)"

**Files likely touched:** `engine/daemon-dashboard.ts`, `test/engine/daemon-dashboard.test.ts`
**Dependencies:** Task 3

### Task 5: rebase-in-progress probe + abort primitive
**Story:** "Re-kick sweep clears every halted marker" rebase scenarios (FR-7b)
**Type:** infrastructure
**Steps:**
1. Write failing tests **in an isolated repo with `daemon:true`** (per rebase-test convention): `hasRebaseInProgress(worktree)` true when `.git/rebase-merge` or `.git/rebase-apply` exists (resolving the worktree's gitdir, since a worktree's `.git` is a file), false otherwise; `abortRebase` runs `git rebase --abort` and resolves ok; a failing abort surfaces an error (caller leaves marker intact).
2. Verify RED.
3. Implement in `engine/daemon-rekick.ts` (or `engine/rebase.ts` if it fits the existing git helpers).
4. Verify GREEN.
5. Commit: "feat(daemon): rebase-in-progress probe + abort (FR-7b)"

**Files likely touched:** `engine/daemon-rekick.ts`, `test/engine/daemon-rekick.test.ts`
**Dependencies:** none

### Task 6: re-kick sweep core
**Story:** "Re-kick sweep clears every halted marker and preserves its reason" (FR-7), "Re-kick is bounded" (FR-9)
**Type:** happy-path + negative-path
**Steps:**
1. Write failing tests (injected primitives, no real git): sweep over 3 halted worktrees clears each (reason logged, `HALT.cleared` written, `HALT` removed, `REKICK` sentinel written, lastRekickSha recorded); a worktree with in-progress rebase gets `abortRebase` BEFORE clear; a **failed** abort leaves the marker intact (no `.cleared`, no sentinel); a non-halted worktree is untouched; FR-9 — a worktree with `lastRekickSha === sha` is skipped; a per-worktree clear error is isolated and the sweep continues; clearing an already-absent marker is a no-op.
2. Verify RED.
3. Implement `rekickSweep` in `engine/daemon-rekick.ts`.
4. Verify GREEN.
5. Commit: "feat(daemon): re-kick sweep — abort→preserve→clear, FR-9 bound (FR-7,FR-9)"

**Files likely touched:** `engine/daemon-rekick.ts`, `test/engine/daemon-rekick.test.ts`
**Dependencies:** Task 5

### Task 7: runDaemon startup orchestration (dashboard + first-run + downtime-advance)
**Story:** FR-1 (before dispatch), FR-5 (first-run init; downtime advance → sweep)
**Type:** infrastructure + happy-path
**Steps:**
1. Write failing tests (pure-core `DaemonDeps` injection): at start `renderStartupDashboard` is called before any dispatch; absent persisted SHA → init, zero sweeps, markers intact; persisted≠current → exactly one sweep then persist=current; persisted==current → no sweep, markers intact (PR #109).
2. Verify RED.
3. Add optional `DaemonDeps` hooks (`renderStartupDashboard`, `resolveBaseSha`, `readPersistedBaseSha`, `writePersistedBaseSha`, `rekickSweep`) and the startup block in `runDaemon`.
4. Verify GREEN.
5. Commit: "feat(daemon): startup dashboard + downtime-advance re-kick (FR-1,FR-5)"

**Files likely touched:** `engine/daemon.ts`, `test/engine/daemon.test.ts`
**Dependencies:** Tasks 2,4,6

### Task 8: runDaemon live-advance wiring
**Story:** "A live base advance during a run re-kicks" (FR-6), "SHA detection degrades gracefully" (FR-10)
**Type:** happy-path + negative-path
**Steps:**
1. Write failing tests (pure-core): a refresh that advances the SHA triggers one sweep + persist; consecutive same-SHA refreshes trigger no further sweep; an unresolved SHA (offline) is treated as no-advance, no sweep, loop continues; a throwing `resolveBaseSha` is caught (no-advance), loop survives.
2. Verify RED.
3. Wire the base-SHA re-read + advance check into `runDaemon`'s idle-refresh branch.
4. Verify GREEN.
5. Commit: "feat(daemon): live base-advance re-kick + graceful degrade (FR-6,FR-10)"

**Files likely touched:** `engine/daemon.ts`, `test/engine/daemon.test.ts`
**Dependencies:** Task 7

### Task 9: FR-12 resume rebase-first (REKICK sentinel honored by conductor)
**Story:** "A re-kicked feature plays forward — rebase-onto-latest precedes the pending gate" (FR-12)
**Type:** happy-path + negative-path
**Steps:**
1. Write failing tests **(isolated repo, `daemon:true` for the rebase part)**: when `.pipeline/REKICK` is present, `runConductorInWorktree` runs 9.0's rebase-onto-latest BEFORE the pending gate re-verifies (assert ordering), then deletes the sentinel; a rebase-conflict halt satisfies rebase-first inherently; a re-conflict on the new base re-halts via 9.0's existing path (not a re-kick path) and is FR-9-bounded; re-kick code performs no gap routing (residual gap flows to gate loop / `/remediate`).
2. Verify RED.
3. Implement the sentinel check in `runConductorInWorktree` invoking the existing 9.0 rebase step first; ensure one-shot (delete sentinel).
4. Verify GREEN.
5. Commit: "feat(daemon): re-kick resumes rebase-first via REKICK sentinel (FR-12)"

**Files likely touched:** `daemon-cli.ts` (`runConductorInWorktree`), the conduct-ts step entry, `test/...`
**Dependencies:** Task 6

### Task 10: PR #109 no-advance invariant regression test
**Story:** "Restart with no base advance preserves all markers" (FR-5/FR-8 regression guard) — Condition 3
**Type:** negative-path
**Steps:**
1. Write test: a restart with halted worktrees and persisted==current clears zero markers and emits zero `▶ start` for halted features; a manual single-marker clear still re-dispatches exactly that one (existing PR #109 path).
2. Verify it passes against Tasks 7–8 (or RED→fix if a gap exists).
3. Commit: "test(daemon): pin PR #109 no-advance invariant under re-kick path (FR-8)"

**Files likely touched:** `test/engine/daemon.test.ts`
**Dependencies:** Tasks 7,8

### Task 11: daemon-cli real-I/O wiring + entry-point verification
**Story:** FR-8 live path; orphaned-primitives guard
**Type:** integration
**Steps:**
1. Write/extend an integration test that `runDaemonMode` assembles the real primitives (dashboard render, SHA read/persist, sweep) into `DaemonDeps`.
2. Implement the real impls in `daemon-cli.ts` and wire them.
3. **Verify the real entry point uses them** and `grep` that no superseded code path bypasses the new deps (orphaned-primitives check): the live `runDaemonMode` → `runDaemon` path calls the new hooks.
4. Verify GREEN + `npm run build`.
5. Commit: "feat(daemon): wire dashboard + base-SHA + re-kick into runDaemonMode (FR-1,FR-4,FR-6)"

**Files likely touched:** `daemon-cli.ts`, `test/cli-*.test.ts` or `test/engine/daemon-cwd.test.ts`
**Dependencies:** Tasks 7,8,9

### Task 12: CHANGELOG + docs
**Story:** harness "Docs track features" convention
**Type:** infrastructure
**Steps:**
1. Add `## [Unreleased]` entries (Added: startup dashboard, main-advance re-kick, `.daemon/last-base-sha`, `.pipeline/HALT.cleared`/`REKICK`).
2. Update `README.md` + `src/conductor/README.md` (daemon behavior: dashboard, re-kick trigger/policy, rebase-first, last-base-sha).
3. Commit: "docs(daemon): document halt-reconciliation (dashboard + main-advance re-kick)"

**Files likely touched:** `CHANGELOG.md`, `README.md`, `src/conductor/README.md`
**Dependencies:** Tasks 1–11

## Task Dependency Graph
```
T1 ─▶ T2 ─▶ T7 ─▶ T8 ─▶ T10
T3 ─▶ T4 ─▶ T7
T5 ─▶ T6 ─▶ T7
            T6 ─▶ T9
T7,T8,T9 ─▶ T11 ─▶ T12
T10 ─▶ T12
```
**Dependencies:** T1→T2; T3→T4; T5→T6; {T2,T4,T6}→T7; T7→T8; T8→T10; T6→T9; {T7,T8,T9}→T11; {T10,T11}→T12. Acyclic.

## Integration Points
- After Task 7: startup dashboard + downtime-advance re-kick observable in a pure-core daemon run.
- After Task 9: a re-kicked gate-halt plays forward (rebase-first) end-to-end in an isolated repo.
- After Task 11: the live `conduct-ts daemon` path exercises all new behavior.

## Verification
- [ ] All happy-path criteria covered (FR-1..FR-12) — see mapping below.
- [ ] All negative-path criteria covered (malformed state T3; corrupt SHA T1/T2; failed abort T6; offline/unresolved T8; re-conflict T9; no-advance invariant T10).
- [ ] No task exceeds ~5 min.
- [ ] Dependencies explicit and acyclic.
- [ ] Conditions: rebase-abort tested isolated-repo daemon:true (T5,T9); PR #109 invariant (T10); orphaned-primitives entry-point check (T11).

### FR → Task coverage
FR-1→T3,T4,T7 · FR-2→T3,T4 · FR-3→T3 · FR-4→T1,T2 · FR-5→T7 · FR-6→T8 · FR-7→T5,T6 ·
FR-8→T6,T10,T11 · FR-9→T6 · FR-10→T2,T8 · FR-11→T1,T2 · FR-12→T9
