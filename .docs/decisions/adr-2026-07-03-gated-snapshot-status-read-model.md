# ADR: Per-pass atomic gated snapshot as the status CLI's read model

**Date:** 2026-07-03
**Status:** APPROVED
**Deciders:** James (operator), engineer DECIDE session for #208

## Context

PRD FR-5..FR-7/FR-13/FR-14 + NFR: `conduct-ts daemon status` must show gated work per repo
without re-scanning repos or touching the network. `runDaemonStatus`
(daemon-observe-cli.ts:153) is a registry-wide liveness sweep that already reads per-repo
`.daemon/` files (pid record); it shares no code with the startup dashboard and cannot call
`discover()` (needs per-repo config, identity resolution, git). The dashboard itself stays on
the live channel (`adr-2026-07-03-owner-gate-gated-channel`).

## Options Considered

### Option A: Per-pass whole-file snapshot `.daemon/gated.json`, atomic rewrite
Every discovery pass serializes the full gated result (per-spec entries, repo warnings,
written-at timestamp) to a temp file and renames it over `.daemon/gated.json`. Status reads
it, renders age from written-at; missing/unparseable → explicit "unknown".
- **Pros:** status stays cheap and offline; whole-file rewrite makes staleness self-healing
  (an entry absent this pass vanishes — no per-slug cleanup); rename is atomic on POSIX so
  readers never see a torn file; works when the daemon is down (age label says how stale).
- **Cons:** second representation of gated state (live channel + snapshot) — must be
  derived from the same per-pass list in one place.

### Option B: Status CLI runs read-only discovery per repo
- **Pros:** always fresh, single representation.
- **Cons:** git + identity + config work in every registered repo on every status call —
  turns the phone-check sweep expensive and failure-prone; violates the PRD NFR ("status
  must remain cheap").

### Option C: Per-slug gated marker files (like `.daemon/warned/`)
- **Pros:** no serialization format.
- **Cons:** needs explicit cleanup on every exit path from gated (owner declared, built,
  spec removed, cutover changed) — bookkeeping that drifts; `.daemon/warned/` never-cleaned
  semantics are wrong for current-state display.

## Decision

**Option A.** One snapshot file per repo at `.daemon/gated.json`: `{ writtenAt, repoWarnings[],
gated[] }`, serialized from the same in-memory gated list the dashboard consumes, written
temp-then-rename at the end of every discovery pass — **including passes with zero gated
specs** (an empty snapshot is the FR-13 "explicitly none" signal and keeps written-at fresh)
**and the identity-unresolved early return** (repo warning, empty gated). The status CLI is
read-only on this file, renders `written-at` as an age label, and degrades to "gated state
unknown" on missing/unreadable (FR-14). This does not conflict with the waiting-channel
ADR's rejection of a side-channel file: that rejected a file as the *dashboard's* source of
truth; here the dashboard never reads the snapshot — it is purely the out-of-process read
model.

## Consequences

### Positive
- `daemon status` gains gated visibility at the cost of one small JSON read per repo.
- Self-healing: no cleanup logic, no stale per-slug markers; bounded staleness, labeled.
- The mechanism is reusable if WAITING later wants status-surface parity (noted as a
  follow-up in the waiting-channel ADR, not implemented by #246).

### Negative
- Live channel and snapshot must be produced from the same list at the same point — a
  divergence would show different truths on the two surfaces; single-writer helper enforced
  by story/test.
- Snapshot schema becomes a small cross-process contract; version it with a `schemaVersion`
  field from day one.
