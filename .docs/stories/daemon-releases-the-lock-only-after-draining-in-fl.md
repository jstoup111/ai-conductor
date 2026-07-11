# Stories: daemon releases the lock only after draining in-flight dispatch (#561)

Track: technical
Tier: S

Context: On SIGTERM the daemon must not free the 1-per-repo pidfile
(`.daemon/daemon.pid`) while a conductor is still dispatching. Today
`daemonSigtermHandler` (daemon-cli.ts) calls `process.exit(1)`, which fires
`releaseBackstop` → `lock.releaseSync()` and unlinks the pidfile immediately —
before `runDaemon`'s in-flight drain (daemon.ts L976-979). A respawn successor
then acquires the free lock via `O_EXCL` while the predecessor still runs → a
transient double-daemon window (observed 2026-07-11, real `node` daemons
stacking at 20:52:17 / 20:52:45 / 20:53:09).

---

## Story 1 (happy): SIGTERM mid-dispatch keeps the pidfile until dispatch settles, THEN releases

**As** the daemon lifecycle
**I want** a SIGTERM to trigger a cooperative drain of in-flight dispatch and
release the lock only AFTER the drain completes
**So that** there is no window where the pidfile is free while a conductor is
still running under the old process.

**Given** a daemon owns the 1-per-repo pidfile and has one feature in-flight
(`runDaemon` sitting in `collectOne()` / the fill loop)
**When** the process receives SIGTERM
**Then** the SIGTERM handler aborts in-flight rate-limit waits and requests a
cooperative stop (it does NOT immediately `process.exit`)
**And** `runDaemon` observes the stop signal at the top of its loop, stops
STARTING new features, and drains the in-flight feature through the existing
drain loop
**And** the pidfile remains present on disk for the entire drain window (it is
NOT unlinked by `releaseBackstop` mid-drain)
**And** only after `runDaemon` returns does the normal-completion path release
the lock (`process.off('exit', releaseBackstop)` → close log →
`await lock.release()`), after which the pidfile is gone.

---

## Story 2 (happy): a successor booting during the predecessor's drain is refused / waits until genuinely free

**As** a respawn successor daemon booting during a predecessor's drain
**I want** to see a still-held lock and refuse or wait until it is genuinely free
**So that** two daemons never dispatch against the same repo concurrently.

**Given** a predecessor daemon is draining after SIGTERM and its pidfile still
records a LIVE pid (this fix guarantees the pidfile persists through the drain)
**When** a successor calls `holdLock(projectRoot, { takeoverWaitMs, pollMs })`
during that drain window
**Then** `holdLock` sees an occupied lock owned by a live pid and does NOT
acquire it — it polls (bounded-wait) or returns `null` (1-per-repo refusal)
rather than reclaiming a live owner
**And** once the predecessor finishes draining and releases the pidfile, the
successor's next poll acquires cleanly via `O_EXCL`
**And** at no instant do both processes hold an owned lock handle for the repo.

(Composes with #554/#555 boot-refusal + per-sweep ownership check — this story
verifies the pidfile-persistence PRECONDITION those rely on.)

---

## Story 3 (negative): a hung daemon that cannot drain force-releases after a bounded timeout, logged

**As** an operator recovering a wedged daemon
**I want** a daemon whose in-flight dispatch will not settle to still yield the
lock within a bounded timeout
**So that** recovery is never blocked forever by an unyielding conductor.

**Given** a daemon received SIGTERM and requested a cooperative stop, but its
in-flight dispatch does not settle (the drain does not complete)
**When** the bounded force-release timeout (N seconds) elapses without the drain
finishing
**Then** the daemon force-releases the lock via the sync backstop
(`releaseBackstop` → flush log + `lock.releaseSync()`)
**And** it logs an explicit, greppable force-release line naming the timeout so
post-hoc forensics see WHY the lock was released without a clean drain
**And** the process exits (non-zero) so the pane/supervisor can respawn
**And** on the clean path (drain completes before the timeout) the timer is
cleared and NO force-release line is logged — the lock is released exactly once
via the normal `await lock.release()` path.

---

Status: Accepted
