# ADR: Pending-restart queues durably and fires at the idle boundary

**Date:** 2026-07-04
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session
**Feature:** daemon-lifecycle-controls (FR-9, FR-11)

## Context

PRD FR-9: restart never interrupts an in-flight build; it takes effect immediately when
idle/paused, otherwise after in-flight work finishes or parks — and the operator is
told a restart is waiting and on what. The open question deferred by the PRD: does a
restart requested on a busy daemon **queue durably** (fires when idle) or does the
operator have to **pause first and retry**? Features can build for a long time, so any
answer must not require a human (or a foreground CLI process) to sit and poll.

## Options Considered

### Option A: Durable pending-restart marker, fired by the daemon at its idle boundary (chosen)
- `restart` on a busy daemon writes `.daemon/RESTART-PENDING` (informational JSON:
  requestedAt, requestedBy) and returns immediately, reporting the in-flight feature it
  is waiting behind. At the loop's sweep boundary, when nothing is in flight and the
  marker exists, the daemon triggers its own respawn-in-place (per
  adr-2026-07-04-respawn-in-place-restart) as its final act — tmux, an external
  process, performs the swap, so the requester needn't exist anymore.
- **Pros:** fire-and-forget for the operator; durable across daemon crashes (marker
  survives; consumed on next boot); composes with pause ("pause + restart --all" =
  orderly fleet upgrade with no polling); status can show restart-pending + what it's
  waiting on.
- **Cons:** one more marker with consume semantics; the daemon gains one
  self-lifecycle action (bounded and human-initiated — see adversarial review).

### Option B: Require-pause-first (restart errors on a busy daemon)
- **Pros:** no new marker; restart stays a purely synchronous verb.
- **Cons:** pushes a poll loop onto the operator (pause → watch until idle → restart),
  exactly the surgery the PRD calls out; fleet-wide upgrades become N babysitting
  sessions; FR-9's "reports what it is waiting on" degrades into "come back later".

### Option C: CLI blocks until idle, then restarts
- **Pros:** no daemon-side involvement.
- **Cons:** a foreground process pinned open for potentially hours; dies with the
  terminal/SSH session and the restart is silently lost; un-phone-friendly. Rejected.

## Decision

**Option A**, with these guardrails:

- **Immediate path unchanged:** idle or paused daemon → respawn now; the marker is only
  for the busy case.
- **Consume-once semantics:** the marker is removed by the new process at boot (restart
  fulfilled) and also treated as fulfilled by any daemon start (a fresh boot IS the
  restart). A stale marker can therefore never fire twice or dangle.
- **Reporting:** the requesting CLI prints the queued state + blocking feature; `daemon
  status` shows `restart-pending (waiting on <slug>)` until it fires.
- **Pause interplay (FR-11):** paused counts as idle — a pending restart on a paused
  daemon fires immediately and the replacement comes up paused (pause marker is
  repo-state and untouched by restart).
- **Bare-run daemons (no session hosting):** the daemon honors the marker by logging
  and exiting cleanly at the idle boundary; the marker is left consumed and the next
  `start`/`ensureRunning` brings up the fresh process. Session preservation is
  vacuously satisfied (there is no session); the restart still never interrupts work.
- **ADR-005 non-autonomy check:** this is not autonomous lifecycle management — the
  action is operator-initiated (a human ran `restart`); the daemon merely defers the
  human's instruction to the first safe moment. `ensureRunning` and all automation
  remain launch-only; nothing daemon-side ever *writes* the marker. Future
  auto-restart-on-engine-change would be a separate, explicitly gated decision — this
  ADR provides the primitive but does not enable any autonomous trigger.

## Negative paths / adversarial review

- **Daemon crashes before firing:** marker survives; next boot consumes it as
  fulfilled. No lost intent, no double fire.
- **Restart requested twice while busy:** marker write is idempotent (second request
  refreshes the informational payload; one fire).
- **Marker + PAUSED both present:** paused = idle → fires immediately; replacement is
  paused. Deterministic, tested.
- **In-flight feature HALT-parks instead of finishing:** parking empties in-flight →
  idle boundary reached → restart fires. Correct: parked work needs no live process.
- **Self-respawn kills the process that ordered it:** the respawn call is the daemon's
  final act and tmux executes it externally; if the call itself fails, the daemon logs
  and continues (next sweep retries) — it never exits without a successor arranged.
- **Clock/ordering games:** no time-based logic; the trigger is purely "idle ∧ marker
  exists" at a sweep boundary.

## Consequences

### Positive
- "Pause the fleet, rebuild, restart the fleet" becomes three fire-and-forget commands
  with zero babysitting — the PRD's acceptance walkthrough, literally.
- The primitive the future auto-restart feature needs exists behind a human-only verb.

### Negative
- Restart is now asynchronous in the busy case; tooling/tests must assert eventual
  firing, not synchronous completion.
- Two markers (`PAUSED`, `RESTART-PENDING`) with distinct lifecycles must be clearly
  documented to avoid operator confusion.

### Follow-up Actions
- [ ] restart-pending marker module (write/consume/report; single-source path).
- [ ] Sweep-boundary check + self-respawn final act (+ bare-run clean-exit variant).
- [ ] CLI + status reporting of pending state and blocking feature.
- [ ] Tests: crash-before-fire, double-request, paused-interplay, HALT-park-to-idle.
