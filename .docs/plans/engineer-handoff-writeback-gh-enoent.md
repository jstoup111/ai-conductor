# Implementation Plan: engineer handoff write-back gh ENOENT fix

**Date:** 2026-07-06
**Track:** technical (no PRD) — see `.docs/track/engineer-handoff-writeback-gh-enoent.md`
**Stories:** `.docs/stories/engineer-handoff-writeback-gh-enoent.md` (Status: Accepted)
**Complexity:** Tier S (`.docs/complexity/engineer-handoff-writeback-gh-enoent.md`) — conflict-check and architecture artifacts skipped per tier.
**Source:** intake issue jstoup111/ai-conductor#290

## Summary

Fix the `spawn gh ENOENT` intake write-back failure (cwd resolves to the just-deleted
per-idea worktree) and make any remaining write-back failure visible and actionable.
9 tasks across 4 files plus tests.

## Technical Approach

- **Root cause (verified):** `github-issues.ts` `report()` resolves its gh cwd as
  `repoPaths.get(repo) ?? process.cwd()`. `repoPaths` is populated only by `poll()`,
  which the `engineer handoff` CLI path never calls, so the cwd is `process.cwd()` —
  the per-idea worktree that `engineer-cli.ts` removes *before* calling `reportDone`.
  Node reports a child spawn into a missing cwd as `spawn gh ENOENT`.
- **Fix 1 — guaranteed-existing cwd (TR-1):** add a `resolveReportCwd(repo)` step in
  the adapter: poll-cache hit → injected `registry.list()` lookup (match on
  `ghRepo ?? name`) → `os.homedir()` final fallback; every candidate is checked with
  `existsSync` before use; `process.cwd()` is no longer consulted. All write-back gh
  calls already pass `-R <owner/repo>`, so any existing directory is sufficient.
- **Fix 2 — failure visibility (TR-2/TR-3):** `IntakePort.report()` returns a
  `ReportOutcome` (`{ ok: true } | { ok: false, remediation: string[] }`). The
  adapter composes fully-substituted remediation commands on failure (comment and/or
  label step, matching what actually failed) and emits them via its injected `log`
  sink (wired to stderr in the CLI). `reportDone` in `writeback.ts` consumes the
  outcome and attaches `writebackPending: true` to the `done` ledger transition on
  failure, `writebackPending: false` (clear) on success. FR-37 stays intact: nothing
  throws, exit code and stdout JSON are unchanged. FR-38 de-dup marker behavior is
  unchanged (marker only set on success, exactly as today).
- **Ledger:** `LedgerEntry` and `transition()` meta gain an optional
  `writebackPending?: boolean` — `true` sets the flag, `false` deletes it,
  `undefined` leaves it untouched. Additive; no existing state is migrated.
- **Sequencing:** ledger meta first (leaf dependency), then the port contract, then
  the adapter cwd fix, then adapter failure outcomes, then `reportDone` wiring, then
  CLI-level regression tests, then docs/changelog.

## Prerequisites

- Worktree has its own `npm install` under `src/conductor` (run `rtk proxy npx vitest run`
  from `src/conductor` for tests).

## Tasks

### Task 1: Ledger — `writebackPending` meta on `transition()`
**Story:** TR-2/TR-3 (ledger marker set + cleared)
**Type:** infrastructure

**Steps:**
1. Write failing tests in the existing ledger test file: (a) `transition(..., { writebackPending: true })` persists the flag on the entry; (b) `transition(..., { writebackPending: false })` removes it; (c) omitting it leaves an existing flag untouched; (d) existing `{branch, prUrl}` meta behavior unchanged.
2. Verify RED.
3. Implement: add `writebackPending?: boolean` to `LedgerEntry` and the `transition()` meta parameter in `src/conductor/src/engine/engineer/intake/ledger.ts`; set/delete/preserve per above.
4. Verify GREEN.
5. Commit: "feat(conductor): ledger transition carries writebackPending marker (#290)"

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/ledger.ts` — entry type + transition meta
- `src/conductor/test/engine/engineer/intake/ledger.test.ts` — new cases

**Dependencies:** none

### Task 2: Port — `ReportOutcome` return contract
**Story:** TR-2 (failure signal reaches the caller)
**Type:** infrastructure

**Steps:**
1. Write failing type-level/unit test: `claude-session` adapter's `report()` resolves to `{ ok: true }`.
2. Verify RED (type error / assertion failure).
3. Implement: in `port.ts` add `export type ReportOutcome = { ok: true } | { ok: false; remediation: string[] }`; change `IntakePort.report` to `Promise<ReportOutcome>`; update the claude-session no-op to return `{ ok: true }`.
4. Verify GREEN + full compile (`tsc`) passes — confirms no other implementers/callers break.
5. Commit: "feat(conductor): IntakePort.report returns a ReportOutcome (#290)"

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/port.ts` — type + interface
- `src/conductor/src/engine/engineer/intake/claude-session.ts` — no-op returns ok
- adjacent tests

**Dependencies:** none

### Task 3: Adapter — cwd resolved from registry, never `process.cwd()` (happy path)
**Story:** TR-1 happy paths
**Type:** happy-path

**Steps:**
1. Write failing test: construct the github-issues adapter with an injected GhRunner that records each call's `cwd` and a registry whose repo path is a real temp dir; call `report(ref, 'done', {prUrl})` WITHOUT any prior `poll()`; assert every recorded cwd === the registered repo path (and exists).
2. Verify RED (current code records `process.cwd()`).
3. Implement `resolveReportCwd` in `github-issues.ts`: poll-cache → registry lookup (`ghRepo ?? name` match) with `existsSync` guard → `os.homedir()`; use it in `report()`; delete the `?? process.cwd()` fallback.
4. Verify GREEN.
5. Commit: "fix(conductor): intake write-back resolves gh cwd from the registry (#290)"

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/github-issues.ts` — resolveReportCwd + report()
- `src/conductor/test/engine/engineer/intake/github-issues.test.ts` — cwd-recording tests

**Dependencies:** none (parallel-safe with 1–2)

### Task 4: Adapter — deleted-worktree regression test
**Story:** TR-1 happy path 2 ("worktree removed, write-back still attempted")
**Type:** negative-path

**Steps:**
1. Write failing-before-fix regression test: create a temp dir, `process.chdir()` into it (restore after), delete it, then run `report(..., 'done', ...)` with a registry pointing at an existing path; assert the GhRunner was invoked with an existing cwd and no error escaped. (On the pre-fix code this reproduces the ENOENT-shaped failure.)
2. Verify it passes on the Task 3 implementation (it is the pinned regression proof).
3. Commit: "test(conductor): deleted-cwd write-back regression proof (#290)"

**Files likely touched:**
- `src/conductor/test/engine/engineer/intake/github-issues.test.ts`

**Dependencies:** Task 3

### Task 5: Adapter — registry-miss and registry-failure fallbacks
**Story:** TR-1 negative paths
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) sourceRef repo absent from registry → gh still called with an existing cwd (homedir fallback) and `-R <repo>` targeting, no throw; (b) `registry.list()` rejects → report degrades without throwing and the TR-2 failure path applies only if gh itself then fails.
2. Verify RED, implement fallback ordering in `resolveReportCwd`, verify GREEN.
3. Commit: "fix(conductor): write-back cwd fallbacks for unregistered repos (#290)"

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/github-issues.ts`
- `src/conductor/test/engine/engineer/intake/github-issues.test.ts`

**Dependencies:** Task 3

### Task 6: Adapter — failure outcomes with substituted remediation commands
**Story:** TR-2 happy path 1 + partial-failure negative
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) GhRunner rejects on `issue comment` → `report()` resolves `{ ok: false, remediation }` where remediation contains `gh issue comment <N> --repo <owner/repo> --body "Spec PR opened: <prUrl>"` and `gh api repos/<owner/repo>/issues/<N>/labels -f "labels[]=engineer:handled"` with real values, and the log sink received them; (b) comment succeeds, label add rejects → `{ ok: false }` with remediation covering only the label step; (c) success → `{ ok: true }`, no remediation logged, posted-marker set (FR-38 unchanged); (d) failure → posted-marker NOT set (retry stays possible, as today).
2. Verify RED.
3. Implement in `report()`: track which step failed, compose commands from `parsed.repo`/`number`/`meta.prUrl`, log via `log`, return the outcome. `label create` "already exists" stays swallowed and is NOT a failure.
4. Verify GREEN.
5. Commit: "feat(conductor): write-back failures return actionable remediation (#290)"

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/github-issues.ts` — report() outcome plumbing
- `src/conductor/test/engine/engineer/intake/github-issues.test.ts`

**Dependencies:** Task 2, Task 3

### Task 7: `reportDone`/`reportRouted` — pending marker set, cleared, and advisory-safe
**Story:** TR-2 happy path (ledger done + prUrl + pending), TR-2 negative (ledger write fails), TR-3 (clear on success)
**Type:** happy-path + negative-path

**Steps:**
1. Write failing tests for `writeback.ts` `reportDone`: (a) port returns `ok:false` → ledger transition to `done` with `{ prUrl, branch, writebackPending: true }`; (b) port returns `ok:true` → transition with `writebackPending: false` (and a pre-seeded stale flag is cleared — TR-3); (c) port absent → transition without the flag key change; (d) ledger.transition rejects → `reportDone` still resolves (advisory, nothing thrown); (e) `reportRouted` signature updated consistently but keeps current behavior.
2. Verify RED.
3. Implement: `reportDone` captures the port outcome (default `{ok:true}` when no port) and threads `writebackPending` into the transition meta.
4. Verify GREEN.
5. Commit: "feat(conductor): reportDone records writeback-pending on failed write-back (#290)"

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/writeback.ts`
- `src/conductor/test/engine/engineer/intake/writeback.test.ts`

**Dependencies:** Tasks 1, 2, 6

### Task 8: CLI regression — handoff with failing write-back stays a successful handoff
**Story:** TR-2 happy path 2 (exit 0, unchanged JSON) + TR-3 de-dup regression
**Type:** negative-path

**Steps:**
1. Write failing/verifying CLI-level tests for `dispatchEngineer` handoff with `--source-ref` and an injected gh that succeeds for `pr create` but fails write-back calls: assert exit code 0, stdout still exactly `{ "kind": "pr-opened", "url": ... }`, stderr contains the remediation commands, ledger entry is `done` + prUrl + `writebackPending: true`.
2. Add a companion assert on the all-success path: no remediation on stderr, no pending flag, GhRunner call counts match pre-fix expectations (FR-38 de-dup unchanged).
3. Verify GREEN; run the full engineer test suite (`rtk proxy npx vitest run` in `src/conductor`) — existing write-back tests must pass unmodified or with mechanical-only updates.
4. Commit: "test(conductor): handoff write-back failure is visible, non-fatal, deduped (#290)"

**Files likely touched:**
- `src/conductor/test/engine/engineer-cli.test.ts` (or the existing handoff test file)

**Dependencies:** Tasks 3–7

### Task 9: Docs + changelog
**Story:** repo gates (CLAUDE.md: changelog on every PR; docs track features)
**Type:** infrastructure

**Steps:**
1. Add `CHANGELOG.md` `[Unreleased]` → Fixed: write-back ENOENT root cause + Added: writeback-pending marker and remediation output.
2. Update `src/conductor/README.md` where intake write-back/advisory semantics are described (remediation output + `writebackPending` ledger field).
3. Run `test/test_harness_integrity.sh`.
4. Commit: "docs(conductor): write-back remediation + pending marker (#290)"

**Files likely touched:**
- `CHANGELOG.md`, `src/conductor/README.md`

**Dependencies:** Tasks 1–8

## Task Dependency Graph

```
T1 (ledger meta) ─────────────┐
T2 (port outcome) ───┬────────┤
T3 (cwd fix) ──┬─ T4 (regression)
               ├─ T5 (fallbacks)
               └─ T6 (remediation outcomes, needs T2)
T1 + T2 + T6 ──── T7 (reportDone wiring)
T3..T7 ─────────── T8 (CLI regression)
T1..T8 ─────────── T9 (docs/changelog)
```

## Integration Points

- After Task 7: the full library-level path (adapter → writeback → ledger) is testable end-to-end in-process.
- After Task 8: the real CLI handoff flow is regression-proven (deleted worktree + failing gh).

## Verification

- [ ] All happy path criteria covered: TR-1 (T3, T4), TR-2 (T6, T7, T8), TR-3 (T7, T8)
- [ ] All negative path criteria covered: TR-1 registry-miss/failure (T5), TR-2 partial failure + ledger-write failure (T6, T7), TR-3 de-dup (T6, T8)
- [ ] No task exceeds ~5 minutes of focused work
- [ ] Dependencies explicit and acyclic (graph above)
- [ ] `.docs/plans/engineer-handoff-writeback-gh-enoent.md` stem matches the complexity marker stem
