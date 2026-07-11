# Complexity: daemon releases the lock only after draining in-flight dispatch (#561)

Tier: S

## Rationale

This is a localized teardown-ordering fix that reuses machinery that already
exists in the loop. No new subsystem, no schema change, no architectural
decision, no cross-cutting contract change.

### What actually changes

1. **`runDaemon` learns one cooperative stop signal.** Add an optional
   `shouldStop?: () => boolean` dep to `DaemonDeps` (modeled byte-for-byte on the
   existing `repoRootMissing?: () => string | null` dep at daemon.ts L362) and a
   new `DaemonStopReason` member (`'signal_teardown'`). Check it at the top of
   the loop, right beside the existing `repoRootMissing` / `ceilingHit()` checks
   (L703-711), and `break`. The loop's EXISTING in-flight drain (L976-979:
   `while (inFlight.size > 0) await collectOne()`) then settles in-flight work
   before `runDaemon` returns — the same "ceilings stop STARTING new features;
   in-flight work always drains" contract already documented at L516.

2. **The SIGTERM handler stops force-exiting.** `daemonSigtermHandler`
   (daemon-cli.ts L511-519) currently aborts in-flight waits then calls
   `process.exit(1)` — which fires `releaseBackstop` (`lock.releaseSync()`) while
   dispatch is still live. Change it to: abort waits (kept), REQUEST cooperative
   stop (flip the flag `shouldStop` reads), arm a bounded force-release timer,
   and RETURN. The existing normal-completion path (L1436-1442:
   `process.off('exit', releaseBackstop)` → `logSink.close()` →
   `await lock.release()`) becomes the release site, now reached only after the
   drain.

3. **Bounded force-release.** A `setTimeout` armed on SIGTERM: if the drain has
   not completed within N seconds (hung/unyielding conductor), run
   `releaseBackstop` (sync unlink + log flush), log the force-release, and
   `process.exit(1)`. The normal path clears this timer. This is the negative
   path — recovery is never blocked forever.

### Why S and not M

- Change is confined to two files (`daemon-cli.ts`, `engine/daemon.ts`) plus
  tests; the third file (`daemon-lock.ts`) is only READ (the existing
  `holdLock` bounded-wait already handles the successor-refusal story once the
  pidfile persists — no change needed there).
- Zero new abstractions: the stop-signal is a one-line predicate dep matching an
  existing one; the drain is already implemented; the release site already
  exists.
- ~4 tasks, each a tight RED→GREEN with existing test harnesses
  (`test/engine/daemon.test.ts`, `test/engine/daemon-cli.test.ts`).
- No architectural decision to record, no product surface, no conflicting
  stories. Signal handling is fiddly but the restructure is mechanical and
  well-bounded — the force-release timer is the only genuinely new primitive and
  it is a stock `setTimeout`.

### Re-tier trip-wire (checked, not hit)

If the drain required aborting a live conductor mid-step (interrupting an
in-progress BUILD, killing child processes cooperatively, coordinating state
saves across N workers), that would be an architectural change and this would
re-tier to M/L. It does NOT: the abort of `allWaitSignals` already exists, and
the bounded force-release is the sanctioned "conductor won't yield in time"
escape hatch — exactly what the issue's negative path asks for. No new drain
semantics are invented. S holds.

S tier ⇒ NO architecture / decisions / conflict-check artifacts.
