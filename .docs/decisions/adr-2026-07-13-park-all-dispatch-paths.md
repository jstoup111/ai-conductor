# ADR 2026-07-13: Operator park blocks every dispatch entry point (immediate-before-dispatch predicate)

Status: Proposed
Feature: park-all-dispatch-paths
Issue: jstoup111/ai-conductor#651

## Context

The operator-park marker (`.daemon/parked/<slug>`, `src/conductor/src/engine/park-marker.ts`) is an
emergency-stop: while it exists, the daemon must never start (dispatch) that slug from any path until it
is unparked. `isOperatorParked(root, slug)` is the single-source predicate.

Two of the three dispatch-capable paths honor it correctly, checked FIRST, immediately before acting:

| Path | Park check | Site |
| --- | --- | --- |
| Re-kick sweep (base-advance) | `isOperatorParked` first, before abort/clear/sentinel | `daemon-rekick.ts:114-130` |
| Re-kick resume (sentinel) | `isOperatorParked` before `resumeRebaseFirst` | `daemon-cli.ts:822-847` |
| **Pool fresh-dispatch** | **only at selection, not before dispatch** | `daemon.ts` (below) |

The pool's park gate is `pickEligible` (`daemon.ts:128`):
`if (ctx.isParked && (await ctx.isParked(b.slug))) continue;` (`daemon.ts:137`). It runs at **selection**
time, at `daemon.ts:856` (local scan) and `daemon.ts:875` (post-refresh scan). The selected item is then
passed to `dispatch(next)` at `daemon.ts:896`, separated from selection by
`await rebuildAndMaybeRestartForStaleEngine()` (`daemon.ts:890`, a rebuild/restart await that can take
seconds) and, across outer-loop iterations, by `await collectOne()` on in-flight features.

`dispatch(item)` (`daemon.ts:631`) — whose only build-start primitive is `deps.runFeature(item)`
(`daemon.ts:652`) — performs **no** park check. So a park marker written into the main-repo
`.daemon/parked/<slug>` after selection but before `runFeature` starts is never re-consulted, and the
parked slug is dispatched. This is the "consulted at scan-snapshot time, not immediately before dispatch"
race issue outcome #1 names, and it matches the 2026-07-13 20:43Z incident
(`rebase-orphans-every-sha-anchored-evidence-citatio` dispatched with its main-repo park marker present).

The **store** is not the hole. Production wires
`deps.isParked = (slug) => isOperatorParked(projectRoot, slug)` (`daemon-cli.ts:1176`); `projectRoot` is
the main-repo root — the correct store. The hole is WHERE the predicate is consulted (selection, not
dispatch). Marker-store cwd/split-store unification is owned by #534 (PR #606 redo) and #486 and is out
of scope here.

## Decision

Consult the existing single-source park predicate immediately before every build-start, so every current
and future dispatch entry point funnels through one authoritative check against the main-repo store.

### D1 — `guardedDispatch`: park check immediately before `runFeature`

Introduce `async function guardedDispatch(item: BacklogItem): Promise<boolean>` in `daemon.ts`. It:

1. Awaits `deps.isParked?.(item.slug)`. If the predicate throws, treat as parked (fail-closed toward the
   emergency-stop — `isOperatorParked` itself already fails toward `true` on non-ENOENT errors).
2. If parked → log ONE line naming the marker path (D3), do NOT call `runFeature`, do NOT add the slug to
   `started`, return `false`. The slug stays eligible; the very next `pickEligible` filters it at
   selection (its marker is now visible there too), so there is no busy-loop.
3. Else → delegate to the existing synchronous `dispatch(item)` body unchanged, return `true`.

Replace the sole call site `dispatch(next)` (`daemon.ts:896`) with `await guardedDispatch(next)`, and
only `continue` the fill-another-slot loop when it returned `true` (a skip falls through to the
idle/await section so the tick does not re-pick the same parked slug in a tight loop).

`deps.isParked` remains optional: absent (pure-core default) → the guard is a no-op and behavior is
byte-for-byte the pre-change loop. Production always wires it (`daemon-cli.ts:1176`), so the authoritative
check now sits immediately before `runFeature`, eliminating the selection→dispatch race. `pickEligible`'s
selection-time check is retained as a cheap early filter (it avoids the rebuild/restart work for an
already-parked slug), but is no longer the last word.

### D2 — Single shared predicate, one funnel

All build-start call sites consult the SAME `isOperatorParked(projectRoot, …)` predicate immediately
before starting:
- Pool: `guardedDispatch` (D1).
- Re-kick sweep: already correct (`daemon-rekick.ts:118`).
- Re-kick resume: already correct (`daemon-cli.ts:825`).

No second predicate, no second store. The only build-start primitive in the pool remains
`deps.runFeature(item)` (`daemon.ts:652`); guarding it once covers the pool.

### D3 — Park-skipped dispatch logs the marker path (observable)

When `guardedDispatch` skips, it logs one line naming the marker path, e.g.
`park: skipped dispatch of <slug> — operator-parked (.daemon/parked/<slug>)`. `OPERATOR_PARKED_SUBDIR`
and the `.daemon/parked/<slug>` layout are already spelled in `park-marker.ts`; the log reuses that path
shape so an operator can find and clear the marker.

### D4 — No kill-switch (issue scope item 4)

Park enforcement is a safety invariant, not a behavior toggle. A config that could disable the check
would reintroduce the exact hole. No repo precedent gates the *tightening of a safety guard* behind an
opt-in (the existing `pickEligible` park check, the rekick park check, and halt-marker enforcement all
ship unconditionally). The operator's existing levers — `.daemon/PAUSED` (pause all dispatch) and
`daemon park`/`unpark <slug>` — are the correct controls. The kill-switch is deliberately omitted.

## Consequences

- An operator park is now honored by every dispatch path, including the pool fresh-dispatch path, with no
  race window between selection and start.
- A future dispatch entry point (e.g. a custom-step scheduler, PR #603) that adds a new build-start call
  site MUST funnel through `guardedDispatch`; the grep-enumeration regression test (below) fails loudly if
  a new `runFeature`/build-start site bypasses the guard.
- No behavior change when `deps.isParked` is absent (pure core / legacy tests) — additive and
  backward-compatible.

## Regression strategy

- **Grep-derived entry-point enumeration** (not hand-listed): a test greps `daemon.ts` (and the rekick
  paths) for build-start call sites — `\.runFeature(` and the `resumeRebaseFirst` dispatch — and asserts
  the enumerated set equals the known-guarded set, so a new bypassing call site fails the test.
- **Park blocks each path**: `isParked → true` ⇒ `guardedDispatch` never calls `runFeature`; rekick/resume
  already covered by their suites, re-asserted.
- **Race test**: `isParked` returns `false` at `pickEligible` selection and `true` at `guardedDispatch`
  (marker written in the selection→dispatch window) ⇒ `runFeature` is never called and the skip line is
  logged.
- **Fail-closed test**: `isParked` throws ⇒ treated as parked, no dispatch.
- **Backward-compat test**: `deps.isParked` undefined ⇒ dispatch proceeds exactly as today.

## Non-goals

- No marker-store cwd/split-store change (#534/#486 own it) — the predicate reads the existing
  `projectRoot` store untouched.
- No new config/kill-switch (D4).
- No change to `pickEligible`'s selection logic beyond retaining it as an early filter, no change to
  re-kick, resume, completion derivation, or evidence.
- No change to `bin/conduct` CLI, `settings.json` schema, hook wiring, or skill symlinks → no CHANGELOG
  Migration block.
