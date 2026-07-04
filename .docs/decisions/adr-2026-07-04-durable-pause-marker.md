# ADR: Durable repo-scoped pause marker at the dispatch boundary

**Date:** 2026-07-04
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session
**Feature:** daemon-lifecycle-controls (FR-1–7, FR-11, FR-17–19)

## Context

Pause must gate **pickup of new work** (never execution of in-flight work), survive
daemon crashes/restarts/reboots, be honored by automation-started daemons, and be
distinctly visible in status (PRD FR-1–7). The daemon loop already honors durable file
signals: per-feature HALT (`.pipeline/HALT`, single-source module `halt-marker.ts`,
checked in `pickEligible`), rekick sentinel, processed markers. Fleet operations must
keep per-repo authority with the repo (adr-010: registry is a non-authoritative
mirror). `ensureRunning` must stay launch-not-manage (ADR-005).

## Options Considered

### Option A: Durable marker file `.daemon/PAUSED`, honored at the dispatch boundary (chosen)
- **Pros:** exactly the established signal pattern (HALT precedent), but repo-scoped
  (`.daemon/`, beside `daemon.pid`) rather than feature-scoped (`.pipeline/`); durable
  by construction (file survives crash/reboot/restart); a freshly-launched daemon reads
  it at boot → automation cannot override an operator's pause without any change to
  `ensureRunning`; trivially visible to `daemon status` and dashboards; write/remove is
  naturally idempotent (FR-6).
- **Cons:** one more marker file to document; unreadable-marker semantics must be
  defined (below).

### Option B: `daemonState` flag in the machine-wide registry
- **Pros:** single place for fleet state.
- **Cons:** violates adr-010 — the registry is explicitly non-authoritative and "no
  control decision reads the mirror"; a control bit in the mirror resurrects exactly the
  split-brain adr-010 closed. Rejected on principle.

### Option C: Key in the repo's committed `.ai-conductor/config.yml`
- **Pros:** durable, visible in the repo.
- **Cons:** config is read once at daemon startup (restart-to-apply — established
  operational fact), so a live pause wouldn't take effect; pause is operational state,
  not configuration; committing operational state churns the repo. Rejected.

### Option D: In-process signal (IPC/socket/POSIX signal to the daemon)
- **Pros:** immediate effect.
- **Cons:** not durable (lost on crash/restart); requires the daemon to be alive to
  pause a repo (FR-7 requires pausing a stopped repo); adds an IPC surface the
  architecture deliberately lacks. Rejected.

## Decision

**Option A.**

- **Marker:** `.daemon/PAUSED` in the target repo. Existence is authoritative; contents
  are informational JSON (`pausedAt`, `pausedBy`) surfaced by status. Single-source
  module (pause-marker sibling of `halt-marker.ts`) owns the path, a best-effort
  writer/remover, and an `isPaused(repoRoot)` predicate.
- **Loop integration:** the predicate is injected as a daemon dep and checked at the
  fill-pool boundary before any dispatch, and re-polled on the idle tick. In-flight
  features drain normally (finish or HALT-park); HALT semantics untouched. A paused
  daemon keeps sweeping/observing — it is alive and standing by (FR-1).
- **Queue position (FR-2):** pause never mutates backlog state (ledger, processed
  markers, priority ordering). Resume re-enters the unchanged discovery path, so
  ordering is whatever the scheduler would have done anyway — nothing is lost by
  pausing. (Composes with #200 priority scheduling by construction: pause gates the
  *consumer*, not the queue.)
- **Verbs:** `pause`/`resume` join the management verbs (human-only, per
  adr-2026-06-29 authority split). Fleet forms iterate the registry for enumeration
  only and act per repo (write/remove the marker in that repo), reporting per-repo
  outcomes; one repo's failure never aborts the rest (FR-17). Unknown names error
  clearly; valid ones still proceed (FR-18).
- **Startup:** the daemon logs pause state at boot and comes up paused when the marker
  exists (FR-4) — including daemons started by `ensureRunning`, which itself is
  unchanged (ADR-005 preserved: it may launch; the launched daemon self-gates).
- **Status (FR-5):** paused is a first-class state alongside running/stopped/stale —
  an enum in the status row model, not a boolean bolt-on.

## Negative paths / adversarial review

- **Unreadable marker (EACCES, IO error — not ENOENT):** treat as **paused** and warn.
  On ambiguity the daemon must not dispatch new work (conservative direction: a wrongly
  idle daemon costs time; a wrongly dispatching daemon defeats an operator's explicit
  quiesce). Status surfaces the degraded read.
- **Pause of a stopped repo (FR-7):** marker write requires no live daemon; the next
  daemon start honors it.
- **Already-paused / not-paused no-ops (FR-6):** reported distinctly
  (`paused` vs `already-paused`), never an error, file ops idempotent.
- **Marker vs. RESTART-PENDING interplay:** paused counts as idle for restart gating;
  a restarted paused daemon comes back paused (FR-11) because the marker is repo-state,
  not process-state.
- **Transition window:** daemons still running the **old engine** do not read the
  marker until restarted onto the new engine. Fleet pause is only fully effective after
  each daemon's first post-upgrade restart. Documented rollout step (one-time
  old-style restart after merging).
- **Cross-repo isolation (FR-19):** the marker lives in the target repo's own
  `.daemon/`; there is no shared pause state anywhere.

## Consequences

### Positive
- Durability, automation-compatibility, and observability all fall out of one file.
- No change to `ensureRunning`, HALT, ledger, or scheduling — minimal blast radius.

### Negative
- `.daemon/` grows another marker; docs and status must teach it.
- Pause takes effect at the next tick boundary, not instantly (acceptable: the PRD
  gates pickup, not execution).

### Follow-up Actions
- [ ] pause-marker module (single-source path + predicate + writer/remover).
- [ ] Daemon dep injection + fill-pool/idle-tick checks + boot-time log.
- [ ] `pause`/`resume` verbs with multi-repo/`--all` selectors + per-repo reporting.
- [ ] Status enum extension (paused distinct from stopped/stale) + version display tie-in.
