# Implementation Plan: Operator park blocks every dispatch entry point (#651)

Stem: park-all-dispatch-paths
Track: technical
Tier: S
Source: jstoup111/ai-conductor#651
ADR: .docs/decisions/adr-2026-07-13-park-all-dispatch-paths.md

## Goal

Consult the single-source operator-park predicate **immediately before every build-start**, closing the
selection→dispatch race in the pool. The pool's park check today lives only at selection
(`pickEligible`, `daemon.ts:137`, called at `daemon.ts:856`/`:875`); the actual start —
`dispatch(next)` (`daemon.ts:896`) → `deps.runFeature(item)` (`daemon.ts:652`) — has no check and is
separated from selection by `await rebuildAndMaybeRestartForStaleEngine()` (`daemon.ts:890`). A marker
written in that window is dispatched anyway (2026-07-13 20:43Z incident).

Mechanism: an async `guardedDispatch(item)` in `daemon.ts` awaits `deps.isParked?.(item.slug)` immediately
before delegating to the existing sync `dispatch` body; a parked (or predicate-throwing) slug is skipped,
logged with its marker path, and never started. Re-kick sweep (`daemon-rekick.ts:118`) and re-kick resume
(`daemon-cli.ts:825`) already check park first and are left as-is (re-asserted by the enumeration test).
`deps.isParked` stays optional → absent preserves today's behavior exactly.

## Files

- `src/conductor/src/engine/daemon.ts` — Task 1. Add `async function guardedDispatch(item): Promise<boolean>`
  next to `dispatch` (`:631`): await `deps.isParked?.(item.slug)` (treat throw as parked, fail-closed); on
  parked → log one line naming `.daemon/parked/<slug>` and return `false` without calling `dispatch`; else
  delegate to `dispatch(item)` and return `true`. Replace `dispatch(next)` (`:896`) with
  `await guardedDispatch(next)`, and only `continue` the fill loop when it returned `true`. Retain
  `pickEligible`'s selection-time check (`:137`) as an early filter.
- `src/conductor/test/engine/daemon.test.ts` — Task 1 RED tests (pool race / block / fail-closed /
  backward-compat), driven through `runDaemon` with injected `isParked`/`runFeature` fakes.
- `src/conductor/test/engine/daemon-park-dispatch-guard.test.ts` (new) — Task 2 grep-enumeration
  regression test (mirrors the existing `daemon-cli-rekick-sentinel-park-guard.test.ts` source-scan
  pattern).
- `README.md`, `src/conductor/README.md` — Task 3. Note that operator park blocks every dispatch entry
  point (checked immediately before dispatch, not only at selection).
- `CHANGELOG.md` — Task 3. `[Unreleased] → ### Fixed`. No Migration block (no `bin/conduct` CLI,
  `settings.json` schema, hook wiring, or skill-symlink change).

## Non-goals

- **No marker-store cwd/split-store change** — #534 (PR #606 redo) and #486 own it; reuse the existing
  `isOperatorParked(projectRoot, …)` predicate untouched.
- **No new config / kill-switch** — park is a safety invariant (ADR D4).
- **No change to `pickEligible` selection logic** beyond keeping it as an early filter; **no change** to
  re-kick, resume, completion derivation, or evidence.
- **Do not modify the incident feature's worktree/branch or the running daemon** — evidence.

## Task Dependency Graph

```
Task 1 (guardedDispatch in daemon.ts + call-site swap + pool RED tests)
   └─> Task 2 (grep-enumeration regression test — new file)
          └─> Task 3 (README + CHANGELOG + validate)
```

## Tasks

### Task 1: `guardedDispatch` — park check immediately before dispatch (RED first)

Add `async function guardedDispatch(item: BacklogItem): Promise<boolean>` adjacent to `dispatch`
(`daemon.ts:631`):
- `let parked = false; try { parked = !!(await deps.isParked?.(item.slug)); } catch { parked = true; }`
  (fail-closed toward the emergency-stop; mirrors `isOperatorParked`'s own fail-toward-parked contract).
- If `parked`: `log(...)` one line naming the marker path (e.g.
  `park: skipped dispatch of <slug> — operator-parked (.daemon/parked/<slug>)`), return `false`. Do NOT
  call `dispatch`, do NOT add to `started`.
- Else: `dispatch(item); return true;`

Replace `dispatch(next)` at `daemon.ts:896` with `const dispatched = await guardedDispatch(next);` and
guard the following `continue` on `dispatched` (a skip falls through to the idle/await section so the tick
does not re-pick the same parked slug in a tight loop).

**RED tests** (`daemon.test.ts`, through `runDaemon` with injected deps):
- `pool does not start a slug parked between selection and dispatch (race)` — `isParked` returns `false`
  on the first call (selection) and `true` on the second (guardedDispatch): assert `runFeature` is never
  called for that slug and the marker-path log line is emitted. (Story 1 negative — the incident.)
- `pool starts an unparked slug exactly once` — `isParked` always `false`: `runFeature` called once, slug
  in `started`. (Story 1 happy.)
- `guardedDispatch blocks a parked slug even if selection is bypassed` — drive `guardedDispatch` with
  `isParked → true`: `runFeature` never called. (Story 2 negative.)
- `guardedDispatch fails closed when isParked throws` — `isParked` throws: `runFeature` never called,
  anomaly logged. (Story 4 negative.)
- `guardedDispatch is a no-op guard when deps.isParked is undefined` — pure core: `runFeature` called,
  behavior identical to pre-change. (Story 4 happy.)

### Task 2: Grep-enumeration regression test (RED first)

New file `src/conductor/test/engine/daemon-park-dispatch-guard.test.ts`, mirroring the source-scan
approach of `daemon-cli-rekick-sentinel-park-guard.test.ts`:
- Read `daemon.ts`, `daemon-rekick.ts`, `daemon-cli.ts` source text.
- Derive the build-start call-site set by matching `/\.runFeature\(/` and the re-kick resume dispatch
  (`resumeRebaseFirst`). Assert the count/locations equal the known-guarded set: the single `runFeature`
  call in `daemon.ts` lives inside `dispatch`, whose only caller is `guardedDispatch`; the resume dispatch
  in `daemon-cli.ts` is preceded by an `isOperatorParked` check; the rekick sweep in `daemon-rekick.ts`
  checks `isOperatorParked` first.
- Assert `guardedDispatch` contains an `isParked`/`deps.isParked` await BEFORE it references `dispatch(`
  (mirrors the rekick sentinel test's ordering assertion). This fails loudly if a new bypassing
  build-start call site is added (Story 3 negative).

**RED**: the test fails before Task 1 lands `guardedDispatch` (no such symbol / `runFeature` reachable
without a preceding check).

### Task 3: Docs, CHANGELOG, validate

- Document in `README.md` and `src/conductor/README.md` (daemon park / dispatch section) that an operator
  park blocks every dispatch entry point, checked immediately before dispatch (not only at selection).
- Add a `CHANGELOG.md` `[Unreleased] → ### Fixed` entry referencing #651. No Migration block (no
  `bin/conduct` CLI, `settings.json` schema, hook wiring, or skill-symlink change). VERSION untouched.
- Run `test/test_harness_integrity.sh` and the conductor vitest suite (`daemon.test.ts`,
  `daemon-pick-eligible.test.ts`, `daemon-park-dispatch-guard.test.ts`); all green before commit.
