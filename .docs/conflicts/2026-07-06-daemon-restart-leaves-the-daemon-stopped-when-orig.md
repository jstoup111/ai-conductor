# Conflict Report: Stale-engine restart respawn wiring (#353)

**Date:** 2026-07-06
**New stories:** `.docs/stories/daemon-restart-leaves-the-daemon-stopped-when-orig.md` (TR-1…TR-5)
**Scope scanned:** all `.docs/stories/*.md`, high-risk pairs reasoned individually:
2026-07-03-daemon-auto-restart-stale-engine, 2026-07-04-daemon-lifecycle-controls
(restart/queue/pause FR-8–12/20–21), expose-daemon-pause-resume-verbs,
daemon-event-driven-wake, guard-bin-install-and-self-build-relink (#363),
daemon-api-rate-limit-episode. Open PRs / unmerged spec branches checked for source-file
contention (#329, #267, #201, spec/*).

**Result:** 0 blocking after resolution. 1 behavioral overlap resolved by amendment
annotation; 1 degrading resource contention accepted.

---

## Conflict 1: stale-verdict exit contract vs respawn-in-place (RESOLVED — amendment)

**Stories involved:** "Detect stale engine at the idle boundary and request restart"
(2026-07-03-daemon-auto-restart-stale-engine.md) vs TR-2 (new)
**Type:** behavioral overlap (same trigger, different required outcome)
**Severity:** degrading (design amendment already operator-APPROVED)

**Description:** The shipped stories require the stale verdict to end in
"write `.daemon/RESTART_PENDING` → release pidfile → exit 0" unconditionally, and
marker-write failure to end in exit(1). TR-2 requires a session-hosted daemon to respawn in
place instead of exiting, and marker-write failure while session-hosted to abort-and-stay-
alive. Both cannot hold for the same trigger. Confidence: verified (contradicting texts read
directly).

**Resolution applied (option 1, least disruptive):** the old story file carries an
amendment note scoping its exit contract to headless daemons; the new stories + APPROVED
adr-2026-07-06-stale-engine-respawn-in-place govern the session-hosted path. Headless
behavior remains byte-identical, so the shipped tests stay valid for that mode. No kickback
needed — the upstream design decision was already reconciled in the ADR (which amends the
2026-07-03 ADR explicitly).

## Conflict 2: daemon.ts idle-boundary contention with unmerged #329 (ACCEPTED — degrading)

**Stories involved:** TR-2 vs daemon-event-driven-wake-for-parked-halted-feature (PR #329,
unmerged)
**Type:** resource contention (same source region: `daemon.ts` idle wait/boundary)
**Severity:** degrading

**Description:** No behavioral contradiction — #329 changes how the idle sleep resolves
(wake arm vs poll), TR-2 changes what happens when a stale verdict fires at that boundary.
Whichever lands second must rebase over the other's edits to the idle-boundary block.

**Resolution:** accepted as a merge-order compromise; noted for the implementation plan
(prefer additive edits around the existing `hasRestartPending` block; do not restructure the
idle loop).

---

## Clean-pass notes (pairs examined, no conflict)

- **daemon-lifecycle-controls (FR-8–12, FR-20–21):** "restart brings up a fresh daemon on
  the current engine / session preserved / queue consume-once / paused counts as idle" —
  TR-1/TR-4 are additive (relink step before respawn; remain-on-exit fix makes the FR-20/21
  stories' assumed semantics actually true). Queue and pause interplay untouched.
- **pending-restart-queue non-autonomy:** TR-2 explicitly asserts daemon code never touches
  the hyphen marker — alignment, not conflict.
- **expose-daemon-pause-resume-verbs:** help-text-only stories; TR-4 keeps respawn-in-place
  semantics those texts describe.
- **guard-bin-install-and-self-build-relink (#363):** TR-3 consumes that feature's guarded
  primitive as designed (reuse, not contention).
- **rate-limit episode coordinator (merged #361):** touches wait/episode logic, not the
  stale/restart path; no shared marker or contract.
