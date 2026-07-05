# Conflict Check: Daemon Event-Driven Wake for Parked (HALTED) Features

**Date:** 2026-07-04
**Stories checked:** `.docs/stories/daemon-event-driven-wake-for-parked-halted-feature.md` (6
stories) against all existing `.docs/stories/` files (44) and active specs.
**Result:** PASSED — zero blocking conflicts; one degrading overlap explicitly accepted.

## Conflict: Rekick base-advance detection latency rises with the backstop cadence

**Stories involved:** "Poll backstop and shared discovery timer" vs
daemon-halt-reconciliation "base advance detected across polls" stories
**Files:** `.docs/stories/daemon-event-driven-wake-for-parked-halted-feature.md` vs
`.docs/stories/daemon-halt-reconciliation.md`
**Type:** overlap
**Severity:** degrading (accepted)

**Description:**
Halt-reconciliation detects a default-branch base advance when a refresh (`git fetch`) resolves
a new base SHA. This feature moves full refresh to the 60s timeout arm (the wake arm is a
local-only scan), so base-advance rekick detection latency changes from ≤5s to ≤60s by default.
Both behaviors remain correct; only detection latency changes, bounded by `--idle-poll`.

**Resolution:** Accepted by operator (2026-07-04) — inherent to the feature's goal of removing
the 5s fetch storm; single-timer decision (ADR 2026-07-04) retained; operators needing faster
base-advance detection lower `--idle-poll`. No story text changes required (the wake stories
already document the ≤60s sweep; halt-reconciliation stories say "across polls", which remains
true).

## Checked and clean

- **Contradiction:** none — no story asserts a fixed 5s cadence or per-tick logging as a
  requirement (owner-gate already moved to warn-once logging in #177, the same
  transition-only pattern these stories extend).
- **Behavioral overlap:** rekick's `HALT` → `HALT.cleared` rename emits `unlink` on the watched
  HALT path — the watcher serves rekick and operator `rm` through the same existing un-park
  path; no second dispatch route is created.
- **State conflict:** none — `parked`/`inFlight`/`started` semantics unchanged; watch is never
  dispatch authority.
- **Resource contention:** none — per-slug watchers on the daemon's own worktreeBase; no shared
  ports/DBs/queues; issue-priority ordering ("no network for ordering") is consistent with the
  no-network wake arm.
- **Sequencing:** none in story space. Code-level note: the unmerged
  `spec/daemon-auto-restart-on-stale-engine-code…` branch also edits the daemon loop; whichever
  builds second must refresh its base per the existing refresh-spec-branch-base practice
  (merge-order concern, not a story conflict).
