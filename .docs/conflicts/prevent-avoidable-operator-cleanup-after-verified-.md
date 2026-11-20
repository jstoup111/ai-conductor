# Verified rebase recovery conflict check

**Result:** Passed after operator resolution on 2026-11-19. Zero outstanding conflicts.

Story 1 originally shared a halt class with stops reserved for human decisions. The approved [classification amendment](../decisions/adr-2026-07-28-total-halt-classification-legacy-boundary.md) gives evidenced rebases their own class. Both base-advance and episode-end sweeps retain it, as do the progress-triggered retry and generic dispatch clear. The existing kickback authorization requires its own class and generation. Only the dedicated rebase path can authorize automatic recovery.

Story 2 preserves operator parks and replacement blockers. Story 3 uses revision-bound gate evidence and restart recovery. Neither can authorize dispatch while Story 1 is blocked. The replay-intent, park, dispatch-boundary and gate-transition decisions remain applicable. ADRs outside halt ownership, replay, gate validity and dispatch have no shared decision surface.
