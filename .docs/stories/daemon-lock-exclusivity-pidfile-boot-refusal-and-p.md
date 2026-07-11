# Stories: daemon lock exclusivity — pidfile boot refusal and per-sweep ownership check (#554 descoped S)

Scope boundary (binding — #554 operator descope 2026-07-11 ~22:30Z, refined by the
2026-07-11 ~22:37Z read-only investigation comment on #554): pidfile-based boot
exclusivity (live-holder refusal naming the holder pid; dead-holder takeover preserved)
+ per-sweep lock ownership re-check keyed on the **on-disk `uuid`** already written by
every daemon boot (stop dispatching when the pidfile is no longer ours). Orphan-census /
`daemon status` surface is DEFERRED post-v1 and is NOT in these stories.

Design anchor: ADR-010 (1-per-repo pidfile mutex). All changes extend the existing
`daemon-lock.ts` primitive and the daemon boot/sweep seams — no new lock semantics and
**no new pidfile field**: the identity this design keys on already exists on disk.
`PidRecord` (`src/engine/daemon-lock.ts:54`) already carries a per-boot `uuid: string`
(`:56`, `randomUUID()` at `:163`, immune to pid reuse) and an additive `engineDir`
(the running build's directory, which distinguishes a source-mode `npx tsx` daemon from
a `dist-versions/` daemon).

Binding detection constraint (the load-bearing #554 finding): NO detection in this
work — at boot or per-sweep — may inspect a foreign process's command line
(`/proc/<pid>/cmdline`, `pgrep -f`, `ps | grep`). That substring match is a proven
false-positive source: the operator's own diagnostic shells (`pgrep`/`ps`/`grep`, RTK
wrappers) embed the literal `index.js daemon --continuous` string and self-match,
inflating any cmdline-based census. The only holder signals used are the pidfile
record's own fields (`pid`, `uuid`, `engineDir`) and `isLive(pid)` (`process.kill(pid,0)`).

---

## Story 1: Boot refusal names the live holder and exits nonzero

As an operator restarting a wedged daemon, I want a second daemon that finds a live
lock-holder to refuse loudly and exit nonzero (naming the holder pid, and its
`engineDir` when recorded), so stacked daemons are impossible and the failure is
observable rather than silent.

**Happy path**
- Given a repo whose `.daemon/daemon.pid` is owned by a live daemon process (pid P),
- When a second `daemon --continuous` boots and calls `holdLock` (including its bounded
  takeover wait, which expires with P still alive),
- Then the second daemon reads the on-disk holder record and logs
  `another daemon is already running (pid P)` naming P (and its recorded `engineDir`
  when present, so a source-mode vs dist collision is visible),
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

## Story 2: Boot detection keys on the on-disk record, never on cmdline matching

As a maintainer, I want the boot-refusal decision derived solely from the pidfile
record and `isLive(pid)`, never from matching a process's command line, so the daemon
never counts an operator's own diagnostic shell as a lock holder and never reintroduces
the `pgrep -f` self-match artifact documented on #554.

**Happy path (decision derived only from the record + liveness)**
- Given a booting daemon evaluating an occupied `.daemon/daemon.pid`,
- When it decides whether to refuse or reclaim,
- Then the decision reads only the on-disk record (`pid`/`uuid`/`engineDir`) and
  `isLive(pid)` — it spawns no child process and inspects no foreign process's
  `/proc/<pid>/cmdline`, `pgrep -f`, or `ps` output.

**Negative path (diagnostic-shell imposter is never a holder)**
- Given an unrelated live process whose argv happens to embed the literal daemon
  command string (an operator `pgrep`/`ps`/`grep` or RTK wrapper),
- When a daemon boots,
- Then that process is NEVER treated as the lock holder — holder identity comes only
  from the pid recorded in the pidfile, not from cmdline substring matching, so the
  false-positive class cannot occur.

**Negative path (coincidental reused pid: loud, recoverable, not a silent stack)**
- Given `.daemon/daemon.pid` records pid P, and pid P has been recycled by an unrelated
  live OS process (a genuine pid collision) — a case a boot-time check cannot safely
  disambiguate without probing the foreign process (which is banned),
- When a new daemon boots,
- Then it refuses loudly, NAMING P (Story 1), which the operator can act on (clear the
  stale pidfile) — strictly better than today's silent exit 0 — and it NEVER reclaims a
  possibly-live lock on a cmdline guess. The pid-reuse hazard that actually harms builds
  (double-dispatch by two live daemons) is closed at the sweep by Story 3's on-disk
  `uuid` check, not by a boot-time foreign-process probe.

---

## Story 3: A daemon that no longer owns the lock stops dispatching

As an operator recovering from a racy restart where a successor daemon replaced the
pidfile while the predecessor was still looping, I want the predecessor to notice its
own boot `uuid` no longer matches the on-disk pidfile and stop starting new features, so
two daemons cannot double-dispatch the same slug into one worktree.

**Happy path (ownership retained)**
- Given a daemon that holds the lock with boot uuid U (exposed on its lock handle),
- When each sweep iteration begins and the on-disk `.daemon/daemon.pid` still records
  uuid U,
- Then `ownsLock` returns true and the daemon continues filling the pool normally.

**Negative path (ownership lost mid-run)**
- Given a daemon holding the lock with boot uuid U,
- When a sweep iteration begins and the on-disk pidfile has been replaced (uuid != U, or
  the file is absent, or the record is corrupt),
- Then the ownership check reports the lock lost, the daemon breaks the loop with stop
  reason `lock_lost`, logs that it no longer holds the lock, and starts NO further
  features (in-flight work drains normally — the check only gates NEW dispatch). This is
  strictly better than `isLive(pid)`, which cannot distinguish a reused pid or a genuine
  second daemon.

**Negative path (transient read failure does not false-stop)**
- Given a daemon holding the lock with boot uuid U,
- When a single ownership read fails transiently (I/O error) rather than definitively
  showing a different owner,
- Then the check is inconclusive and the daemon does NOT stop — it keeps the lock and
  re-checks next sweep (fail-safe toward continuing to own, matching the conservative
  `repoRootMissing` "definitive absence only" contract).

---

## Story 4: The lock identity is already-present and back-compatible

As a maintainer, I want the ownership check to reuse the `uuid`/`engineDir` already on
the pidfile — adding no new schema field — so older pidfiles (written before `engineDir`
existed) and corrupt records never crash or wedge the lock.

**Happy path (no new field)**
- Given a daemon that acquires (or reclaims) the lock,
- When `holdLock` returns its handle,
- Then the handle exposes the same `uuid` that `acquire()`/`reclaim()` already wrote to
  the pidfile (`AcquireSuccess.uuid` / `ReclaimSuccess.uuid`) — no new capture step, no
  new pidfile field — and the per-sweep check compares that boot uuid to the on-disk
  record.

**Negative path (legacy / corrupt record tolerated)**
- Given an on-disk pidfile written before `engineDir` existed (field absent), or a
  corrupt/partial record,
- When a new daemon evaluates it at boot or a running daemon checks ownership,
- Then readers tolerate the absent/corrupt shape (never throw): boot refusal falls back
  to a pid-only message (still nonzero), and `ownsLock` returns false (the repo is never
  permanently wedged and a live lock is never wrongly reclaimed).

Status: Accepted
