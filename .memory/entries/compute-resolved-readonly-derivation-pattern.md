# Pattern: live-deriving progress via `deriveCompletion(..., { readOnly: true })`

**Category:** Technique / reusable pattern
**Discovered:** 2026-07-21, during build of #757
(`build-progress-marker-stays-0-n-for-the-whole-buil`)

## Problem
The daemon's build progress counter was frozen at `0/N` for the whole build
because it only reflected a stored/latched state, not what had actually
happened in git so far.

## Technique
`computeResolved` (in the build-progress watcher) re-derives the live task
count on every tick by calling the SAME completion-derivation logic the
gate itself uses for reconciliation — `deriveCompletion(..., { readOnly: true
})` — rather than maintaining a second, parallel counting mechanism.

Key properties that make this safe to reuse:
- `readOnly: true` guarantees the derivation call never writes disk state,
  so the watcher can call it on every tick without racing or corrupting the
  gate's own reconciliation pass.
- `resolved` is recomputed per tick, not latched — so the progress marker
  is always a fresh read of git-observable reality, not a cached value that
  can go stale.
- No-data ticks still skip cleanly (derivation-unavailable case falls back
  without erroring the watcher loop).

## Why it matters
This is the general pattern for "I need to show live progress that must
never contradict what the gate itself will independently conclude": reuse
the gate's own read-only derivation function instead of hand-rolling a
second counter that can drift from the source of truth.

## Known follow-up (non-blocking)
The evaluator flagged a broad `catch {}` around the read-only derivation
call in `computeResolved` — it's judged acceptable today (best-effort probe)
but could silently mask a genuine `deriveCompletion` regression as a normal
fallback. Worth narrowing in a future pass if `deriveCompletion` gains new
failure modes worth surfacing.
