# Implementation Plan: suppress other-owner gate-writeback log noise unless verbose

**Date:** 2026-07-22
**Design:** technical track — no PRD; Tier S, no ADRs (architecture-review skipped)
**Stories:** `.docs/stories/2026-07-22-daemon-suppress-other-owner-log-noise.md`
**Complexity:** `.docs/complexity/2026-07-22-daemon-suppress-other-owner-log-noise.md` (Tier S)
**Conflict check:** skipped — Tier S
**Source:** issue jstoup111/ai-conductor#840

## Summary

Every gated spec is `other-owner` by construction (`GatedReason = 'other-owner'` is the only
gating reason; `decideSpecGate` returns `build:false` only for `other-owner`). The three
gate-writeback skip notices (`announceGatedPr` no-PR + terminal-PR-state; `announceGatedIssue`
no-usable-Source-Ref) therefore always name a non-assigned spec. Add a `verbose?: boolean` to
`GateWritebackDeps`, consult it in `logSkipOnce` so these skip notices are suppressed at
default verbosity and emitted (subject to the existing `warnedSkips` dedup) under verbose,
source `verbose` from a new validated config key `daemon_verbose` (boolean, default `false`),
and wire it at the daemon call site. Own-work logging (a different code path) is untouched.
9 tasks, logging-only — announce/upsert behavior, `warnedSkips` dedup, and the non-throwing
contract are unchanged.

## Technical Approach

- **Verbose seam:** add an optional `verbose?: boolean` field to `GateWritebackDeps`
  (`src/conductor/src/engine/gate-writeback.ts:66`), next to `warnedSkips`. Thread it into
  `logSkipOnce(log, warnedSkips, verbose, slug, reason, msg)`.
- **Suppression policy in `logSkipOnce`:** if `verbose` is not `true`, return WITHOUT logging
  (the notice is a gated/other-owner skip — suppressed at default verbosity). If `verbose` is
  `true`, apply the EXISTING dedup (skip when `${slug}:${reason}` already in `warnedSkips`,
  else record + `log?.(msg)`). Ordering guarantees: verbose-off → silent; verbose-on →
  once-per-`(slug, reason)` per run, identical to today's behavior. `logSkipOnce` is the sole
  choke point for all three skip sites, so a single guard covers `announceGatedPr` (no-pr,
  pr-terminal) and `announceGatedIssue` (no-source-ref).
- **Announcement work untouched:** the guard wraps only the `log?.(msg)` statements. The
  label ensure/add, comment upsert, `other-owner` silent-skip (line 267), and the
  best-effort try/catch are all outside `logSkipOnce` and are not modified — suppression
  silences logs only, never writes.
- **Config key:** add `daemon_verbose` to `knownTopLevelKeys` in
  `src/conductor/src/engine/config.ts` and validate it is a boolean (reject non-boolean with
  a keyed load-time error, mirroring the `owner_gate_cutover` contract — never silently
  coerced). Absent → treated as `false`.
- **Production wiring:** at `src/conductor/src/daemon-cli.ts` (~line 1093) extend
  `gatedWritebackDeps` to `{ cwd: projectRoot, log, warnedSkips: new Set<string>(), verbose:
  config?.daemon_verbose ?? false }`. This is the only production constructor of gate-writeback
  deps (grep-verified), so the flag governs every `announceGatedPr`/`announceGatedIssue` call
  across all discovery passes.
- **Own-work path is separate:** feature start/resume/status lines (daemon-cli.ts `log`
  closure ~line 486) and conductor build events (`renderDaemonEvent`) do not route through
  gate-writeback and are not modified — default verbosity keeps logging own work.
- **Test runner:** `rtk proxy npx vitest run test/engine/gate-writeback.test.ts` from
  `src/conductor`; config tests via the existing config test file.

## Prerequisites

None — no migrations, no new dependencies. `src/conductor` `npm install` must exist in the
build worktree (standing repo convention).

## Tasks

### Task 1: Add `verbose` to deps + thread through `logSkipOnce` signature
**Story:** enabling seam for Stories 1-3
**Type:** infrastructure

**Steps:**
1. Add `verbose?: boolean` to `GateWritebackDeps` (gate-writeback.ts:66) with a doc comment:
   suppresses gated skip notices at default verbosity; verbose surfaces them (subject to
   `warnedSkips` dedup).
2. Add a `verbose` parameter to `logSkipOnce` and update the three call sites in
   `announceGatedPr`/`announceGatedIssue` to pass `deps.verbose` (destructure `verbose` from
   deps alongside `warnedSkips`).
3. Typecheck: `rtk proxy npx tsc --noEmit` passes (no behavior change yet — logSkipOnce still
   logs; this task only plumbs the parameter).
4. Commit: "refactor(gate-writeback): thread verbose flag through logSkipOnce"

**Files likely touched:**
- `src/conductor/src/engine/gate-writeback.ts`

**Dependencies:** none

### Task 2: Default verbosity suppresses the no-PR skip notice
**Story:** Story 1 happy path
**Type:** happy-path

**Steps:**
1. Write failing test: `announceGatedPr` with `prUrl` falsy and deps `{ verbose: false }`
   asserts ZERO `[gate-writeback]` log lines and zero `gh` calls (currently logs one line —
   RED).
2. Implement in `logSkipOnce`: if `verbose !== true`, return before logging. Verify GREEN.
3. Add a second test: two consecutive passes with `verbose: false` → still zero lines.
4. Commit: "feat(gate-writeback): suppress no-PR skip notice at default verbosity"

**Files likely touched:**
- `src/conductor/src/engine/gate-writeback.ts`
- `src/conductor/test/engine/gate-writeback.test.ts`

**Dependencies:** Task 1

### Task 3: Suppression never blocks a later real announcement
**Story:** Story 1 negative path 1
**Type:** negative-path

**Steps:**
1. Write test: `verbose: false`; pass 1 `prUrl` falsy (suppressed skip); pass 2 same slug with
   a real OPEN/MERGED `prUrl` and a fake `runGh` → assert label ensure+add and comment upsert
   all happen on pass 2 (suppression guards only the log statement).
2. Verify GREEN (expected by construction — pin as safety regression).
3. Commit: "test(gate-writeback): default-verbosity suppression silences logs, not announces"

**Files likely touched:**
- `src/conductor/test/engine/gate-writeback.test.ts`

**Dependencies:** Task 2

### Task 4: Default verbosity suppresses terminal-PR-state + no-Source-Ref notices
**Story:** Story 2 happy path
**Type:** happy-path

**Steps:**
1. Write failing tests: (a) `announceGatedPr` with fake `runGh` reporting `CLOSED` and
   `verbose: false` → zero terminal-state lines; (b) `announceGatedIssue` with a malformed
   `sourceRef` and `verbose: false` → zero no-Source-Ref lines. (Both RED — currently log.)
2. Verify GREEN after Task 2's guard (same `logSkipOnce` choke point covers all three sites).
   Update any existing assertions pinned to the old unconditional log to construct
   verbose-enabled deps.
3. Commit: "feat(gate-writeback): suppress terminal-PR and no-Source-Ref skips by default"

**Files likely touched:**
- `src/conductor/src/engine/gate-writeback.ts` (only if a site was missed)
- `src/conductor/test/engine/gate-writeback.test.ts`

**Dependencies:** Task 2

### Task 5: Non-throwing + other-owner silent-skip contracts hold under suppression
**Story:** Story 2 negative paths
**Type:** negative-path

**Steps:**
1. Write tests: (a) `verbose: false`, injected `runGh` throws during `prMergeState` →
   `announceGatedPr` resolves without throwing; (b) `verbose: false`, `announceGatedIssue`
   for an `other-owner` spec with a VALID `sourceRef` → still no `gh` write (existing #691
   silent-skip at line 267 unchanged) and no skip line.
2. Verify GREEN; pin both as regressions.
3. Commit: "test(gate-writeback): suppression preserves non-throwing + other-owner skip"

**Files likely touched:**
- `src/conductor/test/engine/gate-writeback.test.ts`

**Dependencies:** Task 4

### Task 6: Verbose mode surfaces the suppressed notices (dedup still applies)
**Story:** Story 3 happy + negative paths
**Type:** happy-path

**Steps:**
1. Write failing tests: (a) `verbose: true`, `prUrl` falsy → exactly one no-PR line;
   (b) `verbose: true` → terminal-state and no-Source-Ref notices appear; (c) `verbose: true`
   AND shared `warnedSkips`, two passes one slug → exactly one line (dedup still bounds it).
2. Verify GREEN (Task 2's guard already logs when `verbose === true` and defers to
   `warnedSkips`); adjust guard ordering if a case fails.
3. Commit: "feat(gate-writeback): verbose mode re-surfaces gated skip notices"

**Files likely touched:**
- `src/conductor/src/engine/gate-writeback.ts` (guard ordering, if needed)
- `src/conductor/test/engine/gate-writeback.test.ts`

**Dependencies:** Tasks 2, 4

### Task 7: Config schema — add + validate `daemon_verbose`
**Story:** Story 4 config validation
**Type:** happy-path + negative-path

**Steps:**
1. Add `daemon_verbose` to `knownTopLevelKeys` (config.ts ~line 156) with a comment.
2. Add validation: if `obj.daemon_verbose !== undefined` and not a boolean, return
   `errVal('daemon_verbose must be a boolean')`. Absent → allowed (default-off applied at the
   wiring site).
3. Write tests in the config test file: accept `true`, accept `false`, accept absent, reject
   a string (keyed error). Verify GREEN.
4. Commit: "feat(config): validate daemon_verbose boolean key"

**Files likely touched:**
- `src/conductor/src/engine/config.ts`
- the existing config validation test file (e.g. `test/engine/config.test.ts`)

**Dependencies:** none

### Task 8: Wire the verbose flag at the daemon call site + own-work-still-logs test
**Story:** Story 4 happy path + wiring
**Type:** infrastructure

**Steps:**
1. Extend `gatedWritebackDeps` (daemon-cli.ts ~line 1093) to include
   `verbose: config?.daemon_verbose ?? false`.
2. Grep-verify exactly one production constructor of gate-writeback deps carries `verbose`,
   defaulting off when unset.
3. Write a test asserting that at default verbosity own-work log lines (start/resume/status)
   are emitted while the gate-writeback no-PR notice is suppressed in the same run (drive the
   `log` closure + a suppressed `announceGatedPr` and assert on the log sink).
4. Typecheck + run the gate-writeback and daemon-cli test files → GREEN.
5. Commit: "feat(daemon): source gate-writeback verbose flag from daemon_verbose config"

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts`
- a daemon-cli / gate-writeback test file

**Dependencies:** Tasks 6, 7

### Task 9: Docs + CHANGELOG + full suite + integrity
**Story:** Story 4 Done When (docs + changelog); repo release gate
**Type:** infrastructure

**Steps:**
1. Add a `CHANGELOG.md` `[Unreleased]` entry (`### Changed` or `### Fixed`): gate-writeback
   other-owner skip notices are now suppressed at default verbosity and surfaced under
   `daemon_verbose: true` (#840).
2. Document the `daemon_verbose` config key in `README.md` and `src/conductor/README.md`
   (Docs-track-features rule).
3. Run `rtk proxy npx vitest run test/engine/gate-writeback.test.ts` and the config +
   daemon-cli test files → GREEN; then `test/engine` for collateral damage.
4. Run `test/test_harness_integrity.sh` from the repo root (repo validation rule).
5. Commit: "docs(changelog): daemon_verbose gate-writeback suppression (#840)"

**Files likely touched:**
- `CHANGELOG.md`, `README.md`, `src/conductor/README.md`

**Dependencies:** Tasks 1-8

## Task Dependency Graph

```
Task 1 ── Task 2 ──┬─ Task 3
                   ├─ Task 4 ──┬─ Task 5
                   │           └─ Task 6 (also needs 2)
Task 7 ────────────┴─ Task 8 (needs 6, 7)
Tasks 1-8 ── Task 9
```

## Integration Points

- After Task 2: the no-PR site is suppressed at default verbosity — the pattern the other
  two sites inherit for free (shared `logSkipOnce` choke point).
- After Task 8: end-to-end production behavior exists — a shared-repo daemon at default
  verbosity writes zero gate-writeback skip notices for other-owner specs, and
  `daemon_verbose: true` restores them (deduped once per run).

## Verification

- [ ] All happy path criteria covered by a task (Story 1 → Tasks 2-3; Story 2 → Tasks 4-5;
      Story 3 → Task 6; Story 4 → Tasks 7-8)
- [ ] All negative path criteria covered by explicit tasks (Tasks 3, 5, 6, 7)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Announce/upsert behavior, `warnedSkips` dedup, and the non-throwing contract asserted
      unchanged (Tasks 3, 5, 6)
- [ ] Own-work logging asserted unaffected at default verbosity (Task 8)
- [ ] CHANGELOG `[Unreleased]` entry + README docs added (Task 9)
