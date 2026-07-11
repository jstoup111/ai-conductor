# Track: daemon releases the lock only after draining in-flight dispatch (#561)

Track: technical

## Why technical

No user-facing product surface changes. This is an internal daemon-lifecycle
correctness fix: the SIGTERM teardown path in `src/conductor/src/daemon-cli.ts`
releases the 1-per-repo pidfile (via `releaseBackstop` → `lock.releaseSync()`)
BEFORE the in-flight dispatch loop (`runDaemon` in
`src/conductor/src/engine/daemon.ts`) has drained. A tmux `respawn-pane`
successor then acquires the now-free lock via `O_EXCL` while the predecessor is
still dispatching → a transient double-daemon window against one repo.

The fix is the PREVENTION half of the daemon-stacking class (the DETECTION half
is #554/#555's per-sweep ownership check). It reorders existing teardown steps
and adds a bounded force-release timer — pure engine mechanics, no product
requirements, no PRD. Technical track: explore → complexity → stories →
plan (prd + prd-audit skipped).

## Scope anchor

- Real code studied: `daemon-cli.ts` SIGTERM handler (`daemonSigtermHandler`,
  ~L511-520), `releaseBackstop`/`process.once('exit', ...)` (~L496-500),
  normal completion release path (~L1436-1442), `runDaemon` call (~L1077).
- `engine/daemon.ts`: `DaemonStopReason` union (~L409), `DaemonDeps`
  (~L161, model dep `repoRootMissing` ~L362), loop-top stop checks (~L703-711),
  existing in-flight drain loop (~L976-979).
- `engine/daemon-lock.ts`: `DaemonLockHandle.release`/`releaseSync` (~L371-416),
  `holdLock` bounded-wait takeover (~L444-498).

Composes with (does not re-implement): the existing "in-flight work always
drains" semantics already used by ceilings, and `holdLock`'s `takeoverWaitMs`
bounded-wait — a successor booting mid-drain already waits/refuses once the
pidfile PERSISTS through the drain (which is exactly what this fix guarantees).
