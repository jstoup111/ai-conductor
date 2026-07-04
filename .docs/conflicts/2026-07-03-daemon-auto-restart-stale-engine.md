# Conflict Check: Daemon auto-restart on stale engine code
**Date:** 2026-07-03
**Stories checked:** 2026-07-03-daemon-auto-restart-stale-engine.md (new, 5 stories) against
daemon-supervised-hosting.md, harness-daemon-profile.md, daemon-halt-reconciliation.md,
2026-07-03-daemon-issue-priority-scheduling.md, dependency-ordered-intake-and-dispatch.md,
self-host guardrail stories/specs, phase-9.3b-github-intake-writeback.md
**Result:** No blocking conflicts. One potential contradiction resolved upstream (ADR
amendment); one overlap hardened into a story criterion.

## Checked pairs of note

### 1. vs adr-2026-07-03-harness-daemon-profile ("new code goes live only on bin/install")
**Type:** contradiction — **resolved before stories**: the APPROVED
adr-2026-07-03-daemon-auto-restart-stale-engine narrowly amends that clause; the amended ADR
carries an `Amended by:` pointer. The mid-build invariant is preserved (idle-branch-only).

### 2. vs daemon-supervised-hosting FR-4 ("operator can restart on demand")
**Type:** overlap — **not a conflict.** FR-4 grants operators a restart verb; it does not make
operators the exclusive initiator. The new feature's daemon never runs the restart verb at all
(exit-to-respawn); the transport that respawns is #215's primitive, which FR-4's machinery may
well provide. Both can be true simultaneously. Sequencing is enforced by the native
blocked_by(#256 → #215) link.

### 3. vs daemon-halt-reconciliation / restart re-dispatch history (PR #109 class)
**Type:** state-conflict risk (severity: degrading if unaddressed) — **resolved in stories.**
Frequent automatic restarts amplify any boot-time re-dispatch regression (human-parked or
processed features re-dispatched on restart). Added an explicit parity criterion to the
"Startup restart handshake" story: post-engine-refresh boot must make dispatch decisions
identical to a manual restart (processed + HALT markers honored, no new dispatch caused by
the restart reason).

### 4. vs #215 pause/resume semantics (future)
**Type:** sequencing — **no conflict.** A durable pause signal (per #215's design notes)
survives an exit-to-respawn cycle by construction (file-based, honored at the dispatch
boundary). Nothing in the new stories consumes or mutates pause state.

### 5. vs once-mode / backlog-drained exit, priority scheduling, dependency-ordered dispatch
**Type:** overlap — **no conflict.** Once-mode is explicitly excluded by a negative path.
The stale check runs only when nothing is eligible, so it cannot race a dispatch decision;
priority/dependency ordering operates strictly upstream of the idle branch.

### 6. vs self-host guardrails (sandbox, HALT gates, relink)
**Type:** alignment — **no conflict.** The feature reuses `classifySelfHost` and adds no new
build/finish-plane behavior; guardrail gates are untouched.

## Accepted compromises
None.
