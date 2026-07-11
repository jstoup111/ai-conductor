**Status:** Accepted

# Stories: Stale-engine auto-restart residuals (#369)

Technical track — no PRD. Acceptance criteria derived from issue jstoup111/ai-conductor#369,
adr-2026-07-03-daemon-auto-restart-stale-engine §4 (APPROVED), and
architecture-review-2026-07-10-stale-engine-residuals-369.md. Source-Ref: jstoup111/ai-conductor#369.

## Story 1: Daemon boot runs through initStaleEngineState (single path)

As an operator, I want the daemon's stale-engine boot sequence to run through the one
extracted, tested primitive so that the parity acceptance test certifies the code that
actually runs — not an orphaned copy.

### Acceptance Criteria

#### Happy Path
- Given a daemon boot with a capturable engine identity and no restart marker, when
  `runDaemonMode` starts, then `initStaleEngineState` performs identity capture, logs
  `daemon identity: <sha>`, logs the ARMED/DISARMED line, and returns the identity that
  daemon-cli then uses to construct the stale-engine checker.
- Given a restart marker `{fromIdentity: F, targetIdentity: T}` on disk and a fresh boot
  identity equal to T (converged), when the daemon boots, then the handshake logs
  `restarted for engine refresh — from F to T, fresh T`, clears the marker before the
  first backlog scan, and records no suppression.

#### Negative Paths
- Given identity capture fails (missing/unreadable `dist/index.js`), when the daemon boots,
  then `initStaleEngineState` returns null, the handshake is skipped entirely, the checker
  is constructed in its permanently-disabled form (always `current`, warn-once), and the
  daemon continues to its dispatch loop without crashing.
- Given a corrupt restart marker (invalid JSON), when the daemon boots, then the corrupt
  marker is logged and removed by `readRestartMarkerWithStatus`, no handshake log or
  suppression write occurs, and boot continues.
- Given the config flag is true but the repo is NOT self-host, when the daemon boots, then
  the ARMED/DISARMED line reports DISARMED — the caller passes the pre-gated
  `flag && isSelfHost` value into the primitive, never the raw config flag.

### Done When
- [ ] `daemon-cli.ts` imports and calls `initStaleEngineState`; the inline Task 8-10 block
      (identity capture + ARMED log + handshake + suppression + marker clear) is deleted.
- [ ] `grep -rn "initStaleEngineState" src/conductor/src --include='*.ts'` shows at least
      one non-test production caller (daemon-cli.ts) — zero-caller orphan state is gone.
- [ ] The dispatch-parity acceptance test asserts the REAL boot path (drives daemon-cli's
      boot wiring or an exported seam of it, not the module in isolation) and is green.
- [ ] Full conductor suite green (`npx vitest run` from `src/conductor`).

## Story 2: Stale verdict logs carry both identities

As an operator reading `.daemon/daemon.log`, I want every stale-engine verdict line to name
the captured and target identities so that I can trust (or diagnose) a self-restart without
reconstructing state from adjacent lines.

### Acceptance Criteria

#### Happy Path
- Given the idle-tick check returns `stale` with captured identity X and target identity T,
  when the daemon logs the verdict, then the line contains both X and T (e.g.
  `stale engine detected — captured <X>, on-disk <T>`) before any restart request.
- Given `rebuildAndMaybeRestartForStaleEngine` finds the engine stale after a rebuild, when
  it logs `engine stale after rebuild`, then that line also carries the captured and target
  identities.

#### Negative Paths
- Given the checker cannot supply an identity (`capturedIdentity`/`targetIdentity` return
  null), when a stale verdict is logged, then the line renders `null` for the missing value
  and the daemon neither throws nor omits the log line.
- Given the verdict is `current` or `indeterminate`, when the idle tick runs, then NO
  identity-pair verdict line is emitted (no log spam on healthy ticks).

### Done When
- [ ] Both verdict sites in `engine/daemon.ts` (idle-tick path and rebuild path) emit
      `fromIdentity`/`targetIdentity` in the stale-verdict log line.
- [ ] A test asserts the log line content (both identities present) at each site.
- [ ] Full conductor suite green.

## Story 3: Suppression records the marker target and holds within the same boot

As an operator, I want a non-converged restart to actually suppress the next restart attempt
toward the same target so that the daemon cannot enter a restart loop (ADR-2026-07-03 §4).

### Acceptance Criteria

#### Happy Path
- Given a restart marker `{fromIdentity: F, targetIdentity: T}` and a fresh boot identity
  X ≠ T (non-converged), when the handshake runs, then `recordSuppression` is called with
  **T (the marker's targetIdentity)** — not X — and the suppression file records
  `suppressedTarget: T`.
- Given that same boot later hits a stale verdict whose on-disk target is T, when the
  restart gates are evaluated, then `isSuppressed(T)` returns true, the hold is logged once,
  and NO restart is requested — the loop is broken within the boot that detected it.

#### Negative Paths
- Given a suppression record for T, when a later stale verdict targets a DIFFERENT identity
  U ≠ T (the on-disk engine moved past the failed target), then `isSuppressed(U)` returns
  false and the restart proceeds — suppression must not outlive its target.
- Given a converged handshake (fresh == T), when the boot completes, then NO suppression
  record is written.
- Given the suppression file write fails (e.g. unwritable `.daemon/`), when the handshake
  records suppression, then the failure is logged and boot continues — a persistence error
  never crashes the daemon (invariant side-effect: the marker is STILL cleared afterwards).
- Given a corrupt suppression file, when `isSuppressed` is consulted, then it returns false
  (re-arm), warns once, and the daemon proceeds.

### Done When
- [ ] The handshake record site (inside the wired `initStaleEngineState`) passes
      `marker.targetIdentity` to `recordSuppression`.
- [ ] A **real-flow acceptance test** exists: it writes a real marker, boots the real
      handshake (no injected suppression fakes), drives a stale verdict targeting T through
      the real `isSuppressed`, and asserts the restart is held within the same boot. This is
      the acceptance criterion the original Story 4 lacked (#307's false-green escape).
- [ ] Full conductor suite green.

## Story 4: Suppression record is cleared when it no longer applies

As an operator, I want stale suppression records removed once the daemon converges so that a
leftover record can never silently pin a future legitimate restart.

### Acceptance Criteria

#### Happy Path
- Given a suppression record from a previous non-converged boot and a restart marker whose
  targetIdentity equals the fresh boot identity (converged), when the handshake runs, then
  `clearSuppression` is called and the suppression file is removed.

#### Negative Paths
- Given a suppression record exists and the boot has NO restart marker at all (normal
  manual start), when the daemon boots, then the record is left in place only if it still
  names an identity the on-disk engine could re-target; if the fresh boot identity equals
  the suppressed target (we are now RUNNING the once-failed target), then the record is
  cleared — it can no longer describe a failed convergence.
- Given `clearSuppression`'s file removal fails, when the handshake clears, then the error
  is logged and boot continues (never throws — `rm force` semantics).

### Done When
- [ ] `grep -rn "clearSuppression" src/conductor/src --include='*.ts'` shows at least one
      non-test production caller — zero-caller state is gone.
- [ ] A test asserts the record is gone after a converged handshake, and a test asserts a
      clear failure degrades to a log line.
- [ ] Full conductor suite green.
