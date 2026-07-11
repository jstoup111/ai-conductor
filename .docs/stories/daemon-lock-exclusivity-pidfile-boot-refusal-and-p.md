# Stories: daemon lock exclusivity — pidfile boot refusal and per-sweep ownership check (#554 descoped S)

Scope boundary (binding — #554 operator descope 2026-07-11 ~22:30Z): pidfile-based boot
exclusivity (live-holder check with process-signature verification against pid reuse;
refuse with holder named; dead-holder takeover preserved) + per-sweep lock ownership
re-check (stop dispatching when the pidfile is no longer ours). Orphan-census /
`daemon status` surface is DEFERRED post-v1 and is NOT in these stories.

Design anchor: ADR-010 (1-per-repo pidfile mutex). All changes extend the existing
`daemon-lock.ts` primitive and the daemon boot/sweep seams — no new lock semantics.

---

## Story 1: Boot refusal names the live holder and exits nonzero

As an operator restarting a wedged daemon, I want a second daemon that finds a live
lock-holder to refuse loudly and exit nonzero (naming the holder pid), so stacked daemons
are impossible and the failure is observable rather than silent.

**Happy path**
- Given a repo whose `.daemon/daemon.pid` is owned by a live daemon process (pid P, a
  process whose command signature matches the daemon),
- When a second `daemon --continuous` boots and calls `holdLock` (including its bounded
  takeover wait, which expires with P still alive),
- Then the second daemon logs `another daemon is already running (pid P)` naming P,
- And it exits with a NONZERO code via the injected `exitProcess` seam,
- And it never writes the pidfile, never opens the activity log, and never dispatches a
  feature.

**Negative path (must NOT refuse)**
- Given `.daemon/daemon.pid` records pid P but P is a genuinely dead process (ESRCH),
- When a new daemon boots,
- Then it reclaims the stale pidfile (dead-holder takeover, unchanged), acquires the lock,
  logs `holding daemon lock (pid <self>)`, and proceeds to dispatch normally —
- And no nonzero refusal exit occurs.

---

## Story 2: A reused pid (imposter) does not block a new daemon

As an operator, I want a stale pidfile whose recorded pid has been recycled by an
UNRELATED live process to be treated as reclaimable, so a coincidental pid collision never
permanently refuses every future daemon (the conservative "alive → refuse" check alone
would wedge the repo).

**Happy path (imposter refused via signature mismatch → takeover)**
- Given `.daemon/daemon.pid` records pid P, and pid P is currently alive but is an
  unrelated process (its command signature does NOT match the daemon signature),
- When a new daemon boots and `holdLock` evaluates the owner,
- Then the signature probe returns `mismatch`, the owner is treated as stale (not a live
  daemon), the pidfile is reclaimed, and the new daemon acquires the lock and dispatches.

**Negative path (real daemon still refused)**
- Given `.daemon/daemon.pid` records pid P and pid P is alive AND its command signature
  matches the daemon signature,
- When a new daemon boots,
- Then the signature probe returns `match`, `holdLock` treats P as a genuine live owner,
  and the new daemon refuses (Story 1 outcome) — the signature check never weakens a real
  refusal.

**Negative path (signature undeterminable → conservative refuse)**
- Given `.daemon/daemon.pid` records a live pid P but the signature probe cannot read the
  process (returns `unknown` — e.g. a platform without `/proc`, or a permission error),
- When a new daemon boots,
- Then `holdLock` falls back to the liveness-only decision (alive → treat as live owner,
  refuse) exactly as before this change — no regression, no wrongful reclaim of a possibly
  live daemon.

---

## Story 3: A daemon that no longer owns the lock stops dispatching

As an operator recovering from a racy restart where a successor daemon replaced the
pidfile while the predecessor was still looping, I want the predecessor to notice it no
longer owns the lock and stop starting new features, so two daemons cannot double-dispatch
the same slug into one worktree.

**Happy path (ownership retained)**
- Given a daemon that holds the lock with uuid U (its own boot record),
- When each sweep iteration begins and the on-disk `.daemon/daemon.pid` still records uuid U,
- Then `ownsLock` returns true and the daemon continues filling the pool normally.

**Negative path (ownership lost mid-run)**
- Given a daemon holding the lock with uuid U,
- When a sweep iteration begins and the on-disk pidfile has been replaced (uuid != U, or
  the file is absent, or its pid differs from ours),
- Then the ownership check reports the lock lost, the daemon breaks the loop with stop
  reason `lock_lost`, logs that it no longer holds the lock, and starts NO further
  features (in-flight work drains normally — the check only gates NEW dispatch).

**Negative path (transient read failure does not false-stop)**
- Given a daemon holding the lock with uuid U,
- When a single ownership read fails transiently (I/O error) rather than definitively
  showing a different owner,
- Then the check is inconclusive and the daemon does NOT stop — it keeps the lock and
  re-checks next sweep (fail-safe toward continuing to own, matching the conservative
  `repoRootMissing` "definitive absence only" contract).

---

## Story 4: Signature capture is additive and back-compatible

As a maintainer, I want the pidfile signature metadata to be additive so older pidfiles
(written before this change) and non-`/proc` platforms never crash or wedge the lock.

**Happy path**
- Given a daemon writing its pidfile on a platform where its own command signature is
  readable,
- When `holdLock` acquires the lock,
- Then the record carries the additive signature metadata and the live-owner check for the
  NEXT booting daemon can use it.

**Negative path (legacy / absent signature)**
- Given an on-disk pidfile written before this change (no signature field) whose pid is
  alive,
- When a new daemon evaluates it,
- Then readers tolerate the absent field (never throw), the signature probe falls back to
  reading the live process directly (or returns `unknown`), and the decision degrades to
  liveness-only — the repo is never permanently refused and never wrongly reclaimed.

Status: Accepted
