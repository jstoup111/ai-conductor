# Conflict Check: Daemon rate-limit episode coordinator

**Date:** 2026-07-05
**New stories:** `.docs/stories/daemon-api-rate-limit-episode-cascades-into-mass-h.md`
**Scanned against:** event-driven-wake (#111), rate-limit-wait-signal, daemon-halt-reconciliation,
operator-park, content-aware-dedup, dependency-ordered-intake.
**Result:** PASS — 0 blocking, 1 accepted degrading overlap.

## Conflict: Shared daemon dispatch-loop region + DaemonDeps seam with event-driven-wake

**Stories involved:** "Dispatch loop pauses NEW feature dispatch during an active episode" (new)
vs event-driven-wake's "Poll backstop and shared discovery timer" / "Event-driven re-dispatch"
**Files:** `daemon-api-rate-limit-episode-cascades-into-mass-h.md` vs
`daemon-event-driven-wake-for-parked-halted-feature.md`
**Type:** resource-contention / sequencing (same code region, same `DaemonDeps` type)
**Severity:** degrading (confidence ~85%)

**Description:**
Both features edit the daemon dispatch loop's pre-dispatch/idle region (`daemon.ts:568-621`, the
`checkPaused` gate at ~574 and the idle `sleep`) and both add an optional injected dep to
`DaemonDeps`. Behaviorally they are orthogonal — the episode gate *suppresses new picks* while the
waker *races the idle sleep to wake faster* — so there is no logical contradiction or impossible
state. The overlap is purely structural: the two diffs touch adjacent lines and the same type.
event-driven-wake is currently on an unmerged, stalled branch (PR #329, needs-remediation), and
this spec is authored against `main`, so there is **no textual conflict today**.

**Resolution Options:**
1. Land independently; whichever merges second rebases and integrates the other's dispatch-loop
   edits (both gates + the sleep/waker race coexist). Least disruptive.
2. Sequence deliberately: land event-driven-wake first (once remediated), then this on top.
3. Merge both into one dispatch-loop refactor. Most disruptive; unnecessary given orthogonality.

**Recommendation:** Option 1. The changes are additive and orthogonal; the daemon core is already
dep-injected (optimization-never-authority), so both optional deps and both gate checks compose
without contention. The implementer of whichever lands second reconciles the `DaemonDeps` type and
the pre-dispatch gate ordering (episode-gate and PAUSE-gate both suppress new picks; waker only
affects wake latency). **Accepted as a degrading overlap.**

## Compatible overlaps (not conflicts)
- **rate-limit-wait-signal:** additive. New stories preserve `result.waitSeconds ?? 300` for the
  first probe and the `attempt--` no-budget-burn invariant, extending with escalation + AbortSignal
  + coordination. Confidence ~90% compatible.
- **operator-park / daemon-halt-reconciliation:** the episode gate composes with the operator PAUSE
  marker (explicit negative-path story); PAUSE remains authoritative. No contention.
- **event-driven-wake self-heal:** complementary — this feature avoids HALTing during an episode
  (nothing to unpark); event-driven-wake still handles any HALT that does occur. No overlap in mechanism.
