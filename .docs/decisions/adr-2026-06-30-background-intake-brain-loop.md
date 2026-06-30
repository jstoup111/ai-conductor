# ADR: Background intake runs on a single brain/supervisor loop; ledger stays single-writer

**Date:** 2026-06-30
**Status:** APPROVED
**Deciders:** James (solo dev) + harness architecture-review
**Amends:** adr-012-durable-intake-ledger-sole-dedup-authority (adds the concurrency boundary it
did not address)
**Feature:** Background Auto-Intake on the Conduct Loop (spec 2026-06-30)

<!-- Filename stem is the identifier: adr-2026-06-30-background-intake-brain-loop -->

## Context

Intake polling only fires at the bare `conduct-ts engineer` launcher pre-poll. A directly-invoked
`/engineer` session is blind to issues filed since the last launch (missed `best-stock-picker#65`),
and ideas processed without a live source reference never auto-close their issue (`honeydew#49`).
The feature makes intake continuous and automatic. Two architectural questions:

- **Q1 — which process hosts the cross-repo poll?** Intake spans *all* registered repos and writes
  one shared, global durable state (`~/.ai-conductor/engineer/ledger.json` + inbox).
- **Q2 — how is that shared ledger kept correct under a continuously-running poller?**

Forces:
- Phase 9 locked **"brain = planning/routing service, not the daemon parent"** — intake + routing
  is a planning concern, distinct from the per-repo build daemon that discovers and builds **merged**
  spec PRs.
- ADR-012 makes the ledger the **sole dedup authority** with **exactly-once pull** (skip any
  candidate already ledger-known) — but it assumed *one poller per process* and is silent on
  concurrent writers.
- ADR-008 keeps DECIDE **agent-hosted and human-gated**; intake polling must NOT spawn `claude` or
  run DECIDE unattended (spec FR-9/FR-11).
- A Non-Goal of the feature: leave the build daemon's merged-spec discovery/build path unchanged.

## Options Considered

### Q1 Option A: A single brain/supervisor intake loop polls all registered repos
- **Pros:** Matches the brain≠daemon split; one cross-repo actor owns cross-repo state; the build
  daemon is untouched; **single writer to the ledger by construction** → Q2 needs no lock; reuses
  the existing tmux-supervisor hosting + sleep/idle-poll pattern.
- **Cons:** Introduces one more long-running loop/process to host and observe.

### Q1 Option B: Each per-repo build daemon also polls its own repo's issues
- **Pros:** No new process; each daemon already runs a loop.
- **Cons:** Couples intake (planning) into the build daemon (violates brain≠daemon); **N concurrent
  writers** to one global ledger → requires a file lock (heavier Q2); a per-repo daemon writing
  global cross-repo state is an awkward ownership inversion.

### Q2 (given Q1=A): ledger concurrency
- **A — single-writer by construction (+ atomic writes, launcher defers):** the brain loop is THE
  poller; the manual `conduct-ts engineer` launcher pre-poll **defers to a running brain loop**
  (it just `claim`s); ledger writes are atomic (temp+rename) as a backstop so a rare overlap
  degrades to a harmless duplicate the next pass dedups. *Pros:* no lock, ADR-012 intact. *Cons:*
  the launcher must detect a running brain loop.
- **B — file-lock every read-modify-write (ADR-010 pidfile pattern):** *Pros:* allows multiple
  pollers. *Cons:* only needed if we pick Q1=B; lock contention + complexity for no benefit under A.

## Decision

**Q1 = A. Host the cross-repo intake poll in a single brain/supervisor loop** that, each tick,
mechanically polls every registered repo's assigned open issues, captures new ones into the durable
inbox (dedup via the ledger per ADR-012), auto-routes by origin, and notifies the operator — then
sleeps. It **never** spawns `claude`, runs DECIDE, or opens a PR (ADR-008 / FR-11 preserved). It
reuses the daemon's proven idle-poll + tmux-supervisor hosting rather than a new cron service —
this is the "conduct loop" the operator asked intake to run on.

**Q2 = A. The ledger stays single-writer by construction.** Because exactly one brain loop polls,
there is exactly one writer in steady state. The manual `conduct-ts engineer` launcher pre-poll
**becomes a no-op when a brain loop is live** (the inbox is already fresh; the launcher just
`claim`s); when no brain loop runs, the launcher pre-poll still works (sole writer at that moment).
Ledger writes remain atomic (temp+rename) so any rare launcher/loop overlap degrades to a duplicate
enqueue the next exactly-once pass collapses. **No new lock; ADR-012 remains authoritative**, this
ADR only adds the concurrency boundary it omitted.

We chose A/A because it is the *only* option that honors brain≠daemon, keeps the build daemon a
Non-Goal, and makes Q2 dissolve instead of requiring new locking — the cheapest correct design.

## Consequences

### Positive
- The build daemon is unchanged; intake is cleanly a brain concern.
- One ledger writer → no lock, no TOCTOU, ADR-012's exactly-once pull is sufficient as-is.
- Reuses tmux-supervisor hosting + idle-poll; modest implementation surface.

### Negative
- A new long-running loop to start/observe/stop (mitigated by reusing supervisor hosting).
- The launcher must learn to detect a live brain loop and skip its pre-poll (small coupling).

### Follow-up Actions
- [ ] Brain intake loop: tick = poll all registered repos → capture (ledger dedup) → route-by-origin
      → notify; configurable interval; isolates per-repo failures (FR-1/2/4/6/7/10).
- [ ] Make the `conduct-ts engineer` launcher pre-poll defer to a running brain loop (no second writer).
- [ ] Keep ledger writes atomic (temp+rename); add a test for launcher/loop overlap → no duplicate.
- [ ] Host the loop via the existing tmux supervisor port (not a new cron).
