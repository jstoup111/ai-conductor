# ADR: Stale-engine respawn is single-generation — predecessor exits unconditionally on a fired trigger; lock-losers terminate

**Date:** 2026-07-07
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session for jstoup111/ai-conductor#400
**Amends:** adr-2026-07-06-stale-engine-respawn-in-place (narrow: the session-hosted "fire
`triggerSelfRestart` and don't exit" clause of Decision step 2c)
**Enforces:** adr-010-pidfile-lock-daemon-liveness (the "loser no-ops/**exits 0**" clause,
which the shipped loser path does not actually deliver)
**Reconciles with:** adr-2026-07-04-pending-restart-queue (hyphen marker stays human-only,
untouched), adr-2026-07-03-daemon-auto-restart-stale-engine (all gates unchanged)

## Context

Issue #400, observed 2026-07-07: six concurrent `daemon --continuous` processes in one tmux
pane after stale-engine transitions — one 3h-old predecessor, the pidfile owner, and four
stacked in a ~60s burst. `auto_restart_on_stale_engine` was operationally disabled (#402)
pending this fix.

Three verified defects (all confidence **verified**, direct code read 2026-07-07 in this
worktree):

1. **Predecessor survives a successful trigger.** The session-hosted branch of
   `createRestartRequester` (`src/conductor/src/daemon-cli.ts`, "call triggerSelfRestart and
   don't exit") awaits `deps.triggerSelfRestart()` and returns — no lock release, no
   `process.exit`. The #353 design trusted tmux `respawn-pane -k` to kill the pane process;
   #400's evidence shows the daemon process survives it (mechanism unverified — process-tree
   shape under the wrapped command is the leading theory at ~60% — but the fix below does not
   depend on the mechanism).
2. **The idle-boundary trigger is not one-shot.** The stale branch in
   `src/conductor/src/engine/daemon.ts` (idle boundary) awaits `deps.requestRestart(...)` and
   falls through to `idlePolls++` → sleep → `continue`. Because of defect 1 the predecessor is
   still alive and still stale on the next poll, so it re-fires — four respawns in ~60s. The
   sibling `RESTART-PENDING` verb path guards with `restartTriggeredSuccessfully`; the stale
   path has no equivalent.
3. **Lock-losers stay resident.** A successor that loses `holdLock` merely `return`s from
   `runDaemonMode` (`daemon-cli.ts`); observed processes remain alive afterwards (live
   event-loop handles keep node running — inferred from #400's five resident losers), directly
   violating ADR-010's "loser no-ops/exits 0". There is also no allowance for a predecessor
   that is mid-exit: the loser verdict is instant.

## Options Considered

### Option A (chosen): Harden the existing underscore path in place
Unconditional predecessor exit on a fired trigger + one-shot loop exit + bounded lock
takeover + explicit loser termination. Minimal delta on tested seams; marker schema, boot
handshake, suppression, and all gates unchanged.

### Option B: Unify stale-engine restarts onto the guarded RESTART-PENDING verb pipeline
Rejected for this fix — cleaner long-term but rewrites consume-once semantics an APPROVED ADR
specifies and two test suites assert; regression risk on the restart verb. Filed as follow-up
jstoup111/ai-conductor#408; must not gate re-enabling the feature.

### Option C: Successor kills the predecessor by pidfile pid
Rejected — pid-kill is the riskiest primitive (pid reuse, killing a mid-handoff owner); only
worth revisiting if A's unconditional exit proves insufficient against wedged predecessors.

## Decision

Four coordinated changes, plus the config re-enable:

1. **Fired trigger ⇒ predecessor terminates, unconditionally.** In the session-hosted branch,
   after `triggerSelfRestart()` **returns successfully**: release the pidfile lock
   (`lock.releaseSync()`) and `process.exit(0)` — explicitly, never relying on `respawn-pane
   -k`, natural return, or event-loop drain. If `-k` kills us first, the outcome is identical
   (dead-pid pidfile → successor stale-reclaims, existing tested semantics). The
   **trigger-failure path is unchanged**: log, stay alive, retry at a later idle boundary
   (stale-but-alive beats down-and-blocked, preserved verbatim from the 2026-07-06 ADR).
2. **The idle-boundary trigger becomes one-shot per firing.** `requestRestart` reports whether
   the trigger actually fired; on a fired trigger the idle branch **breaks** the loop with
   `stopReason: 'engine_restart'` (mirroring the existing dispatch-boundary break) instead of
   falling through to sleep/continue. Reaching that break is already unreachable-by-
   construction after change 1 (a fired trigger exits inside the requester) — it is a
   structural backstop so a future refactor of the requester cannot silently reintroduce the
   multi-fire. A **failed** attempt still falls through and may retry at a later boundary —
   retry is not multi-fire; only a *fired* trigger is one-shot.
3. **Bounded lock takeover.** `holdLock` acquisition tolerates a mid-exit predecessor: when
   the pidfile is held by a **live** pid, poll for release for a bounded window (order of
   seconds, constant confined to the lock module) before returning `null`. Dead-pid stale
   reclaim is unchanged. Single-winner `O_EXCL` semantics are unchanged — this stays inside
   ADR-010's swappable module boundary.
4. **Lock-loser terminates.** The `lock === null` branch logs (as today) and ends with an
   explicit `process.exit(0)` — never `return` into a resident process. This makes the shipped
   behavior match what ADR-010 already specifies.
5. **Re-enable `auto_restart_on_stale_engine`** (revert the #402 operational disable) in the
   same change set, gated on the acceptance evidence below.

## Negative paths / adversarial review

- **Trigger reported success but no successor ever boots** (e.g. tmux accepted the respawn
  but the relaunch dies): predecessor has exited — the pane is a revivable dead pane
  (remain-on-exit armed at session creation since #353) holding the marker; `daemon start` /
  `ensureRunning` revives. The 2026-07-06 invariant — *exit leaves a running successor or a
  revivable dead pane* — is preserved, now via the dead-pane arm.
- **Predecessor killed by `-k` between trigger and release:** pidfile holds a dead pid;
  successor's stale reclaim wins (tested today). Bounded wait only applies to a live holder.
- **Bound too short / predecessor exit slower than the window:** successor logs and exits 0
  (loser path); the predecessor it lost to is exiting, leaving a dead-pid pidfile; the next
  `ensureRunning`/`start` nudge converges. Never two builders, never a resident loser.
- **Two independent starts racing (no restart in progress):** unchanged ADR-010 semantics —
  one winner; the loser now provably exits instead of lingering.
- **Suppression / non-converging engine:** untouched — boot handshake and
  `.daemon/RESTART_PENDING.suppression` semantics are not modified.
- **Headless bare-run:** byte-identical (release + exit 0 was already the headless contract).
- **Verb-path (`RESTART-PENDING`) interaction:** none — no shared flag or marker is touched;
  `restartTriggeredSuccessfully` remains verb-path-only.

## Consequences

- The #400 invariant becomes testable and tested: **across a stale-engine transition,
  exactly one `daemon --continuous` process exists for the repo at steady state** (`pgrep`
  count == 1), and the predecessor pid is provably gone.
- The #393 tests that pin "session-hosted: no lock release, no exit"
  (`daemon-cli-restart-requester.test.ts`) are **deliberately flipped** — the pinned behavior
  is the bug. Trigger-failure stay-alive assertions are retained.
- `auto_restart_on_stale_engine` returns to service; #402's disable is reverted.
- The two-marker structure remains (documented in the 2026-07-06 ADR); unification is #408.

## Evidence

- Session-hosted no-exit branch, trigger-failure stay-alive, headless release+exit:
  `src/conductor/src/daemon-cli.ts` (read 2026-07-07, this worktree).
- Unguarded idle-boundary fall-through (`requestRestart` → `idlePolls++` → sleep →
  `continue`): `src/conductor/src/engine/daemon.ts` idle branch (read 2026-07-07).
- Loser `return` without exit: `runDaemonMode`, `daemon-cli.ts` (`lock === null` branch).
- Resident-process observations (6 stacked daemons, 5 non-owners alive, 4-in-60s burst):
  issue jstoup111/ai-conductor#400 (operator-verified 2026-07-07, manual cleanup performed).
- Dispatch-boundary precedent for `stopReason: 'engine_restart'` break:
  `daemon.ts` `rebuildAndMaybeRestartForStaleEngine` call site.
- Dead-pid stale reclaim + single-winner: `src/conductor/src/engine/daemon-lock.ts`
  (`holdLock`), pinned by `daemon-lock.test.ts`.
