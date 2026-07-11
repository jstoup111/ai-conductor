# Conflict Check: Stale-engine auto-restart residuals (#369)

**Date:** 2026-07-10
**New stories:** .docs/stories/2026-07-10-stale-engine-residuals-369.md (4 stories)
**Result:** PASSED — zero blocking, zero degrading conflicts

## Pairs examined (reasoned, not assumed)

1. **Story 3 (suppression key = marker target) vs "Restart-loop suppression on
   non-convergence"** (2026-07-03-daemon-auto-restart-stale-engine.md) — the original story
   requires suppression to hold "until the on-disk identity changes from the suppressed
   value." That is only coherent when the suppressed value is the marker's targetIdentity:
   keying on the fresh identity can never match a stale verdict (on-disk = fresh ⇒ verdict
   is `current`, no restart to suppress). Story 3 makes the original's only-coherent reading
   explicit — **agreement, not contradiction** (confidence 95%, grounded in the quoted
   clause + adr-2026-07-03 §4). The as-built CODE contradicts the original story; that is
   the bug being fixed, not a story conflict.
2. **Story 4 (clear-on-convergence) vs original "identity moving past the suppressed value
   re-arms"** — the original re-arms via isSuppressed mismatch without deleting the record;
   Story 4 additionally deletes the record when it is provably obsolete. Deletion strengthens
   re-arm; the mismatch path is still asserted in Story 3's negative path. **No state
   conflict** — no scenario exists where one story requires the record present and the other
   requires it absent at the same point.
3. **Story 1 (boot through initStaleEngineState) vs respawn-transport stories**
   (fix-400-stale-engine-respawn-in-place-stacks-daemo.md,
   daemon-restart-leaves-the-daemon-stopped-when-orig.md) — those govern the requester/
   respawn side (marker write, generation guard, respawn-in-place). This change is strictly
   upstream (boot handshake + record/log/clear); marker read-and-clear semantics are
   unchanged. **No behavioral overlap.**
4. **Story 2 (verdict log identities) vs all** — additive log content at two existing
   sites; no story anywhere asserts the current identity-less log text. **No contradiction.**
5. **Resource contention sweep** — `.daemon/RESTART_PENDING.suppression` keeps its schema
   (`suppressedTarget`, `at`); only the value recorded changes to what the schema's field
   name already declares. No column/file/queue acquires a second meaning.

## Sequencing

No story assumes another feature runs first; existing suppression tests that pin the buggy
key will be UPDATED by this feature's plan (implementation concern, not a story conflict).

## Verdict

Conflict check passed. Proceed to /plan.
