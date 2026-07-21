# Track: Operator park blocks every dispatch entry point — backlog scan included (#651)

Track: technical

## Rationale

Internal daemon dispatch-safety fix. The operator-park marker (`.daemon/parked/<slug>`) is meant to be
an emergency-stop: while it exists, the daemon must never start (dispatch) that slug from ANY path. The
re-kick path honors it — `rekickSweep` checks `isOperatorParked` FIRST, immediately before touching each
slug (`src/conductor/src/engine/daemon-rekick.ts:114-130`), and the re-kick *resume* path checks it
before `resumeRebaseFirst` (`src/conductor/src/daemon-cli.ts:822-847`). But the pool's fresh-dispatch
path checks park only at *selection* time, not immediately before *dispatch*, so a parked slug can still
be started. No user-facing product capability, no new command, no `bin/conduct` CLI / `settings.json`
schema / hook wiring / skill-symlink change (the change is internal to `daemon.ts` dispatch). →
**technical track** (skip `/prd`).

## The hole (verified against code, file:line)

`pickEligible` (`daemon.ts:128`) is the pool's park gate: `if (ctx.isParked && (await
ctx.isParked(b.slug))) continue;` (`daemon.ts:137`). It runs at **selection** time — the two call sites
are `daemon.ts:856` (local scan) and `daemon.ts:875` (post-refresh scan). The selected item is then
handed to `dispatch(next)` at `daemon.ts:896`, which is separated from selection by
`await rebuildAndMaybeRestartForStaleEngine()` (`daemon.ts:890`) — a rebuild/restart await that can take
seconds — and, across outer-loop iterations, by `await collectOne()` on in-flight features.

`dispatch(item)` (`daemon.ts:631`), whose only build-start primitive is `deps.runFeature(item)`
(`daemon.ts:652`), performs **no** operator-park check. So a park marker written into the main-repo
`.daemon/parked/<slug>` *after* selection but *before* `runFeature` starts is never re-consulted, and the
parked slug is dispatched. This is precisely the "consulted at scan-snapshot time, not immediately
before dispatch" race issue outcome #1 names, and it matches the observed 2026-07-13 20:43Z incident
(`rebase-orphans-every-sha-anchored-evidence-citatio`: marker present in the MAIN repo's `.daemon/parked/`
at dispatch time, dispatched at 20:43:52 anyway).

Store is NOT the hole. Production wires `deps.isParked = (slug) => isOperatorParked(projectRoot, slug)`
(`daemon-cli.ts:1176`), where `projectRoot` is the main-repo root — the correct store. The hole is
WHERE the predicate is consulted (selection, not dispatch), not WHICH root.

## Corrected premise (load-bearing)

The issue hypothesizes the fresh-dispatch path "appears not to consult the operator-park store at all,
or consults only the worktree-side store." Verified: the pool DOES consult the correct main-repo store,
but only at `pickEligible` selection (`daemon.ts:137`), not immediately before `dispatch`/`runFeature`.
The fix is a single shared park predicate consulted **immediately before every build-start**, closing
the selection→dispatch race and giving every current and future dispatch entry point one funnel.

## Scope boundary vs #534 / #486

- **#534** (park/unpark cwd resolution — PR #606 redo) and **#486** (auto-park markers written to the
  worktree-side `.daemon`, invisible to root reads) own marker-**store** unification (which cwd/root the
  marker lives in and is read from). This spec does NOT touch store location; it wires the existing
  `isOperatorParked(projectRoot, …)` predicate into the one consumer path that skips it. Consumer-side,
  not store-side.
