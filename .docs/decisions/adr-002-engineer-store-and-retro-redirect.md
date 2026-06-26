# ADR 002: Engineer store format + retro-redirect mechanism

**Date:** 2026-06-25
**Status:** APPROVED
**Deciders:** James (solo dev) + harness architecture-review
**Feature:** Phase 9.1 — structured retro signal + engineer memory store

## Context

On daemon feature completion (done/halted), 9.1 must persist a structured signal + a narrative to
a cross-project engineer store at `~/.ai-conductor/engineer/`, keyed by project/feature, **without**
writing retros into the daemon's project repo, and without breaking a ship or corrupting the log
under parallel workers (PRD FR-1..FR-11). Two design points need locking: (1) how the **narrative**
is produced for daemon runs without landing in the repo, and (2) the **store format + write
mechanism**.

Forces:
- The structured signal is assembled at emission time from existing sources (`events.jsonl`,
  `report-renderer`, `FeatureOutcome`) regardless — no new loop instrumentation (FR-4).
- Halted features halt **before** the retro step, so a halted narrative is necessarily produced at
  emission time, not by the in-loop retro (FR-6).
- Small-tier features **skip** the retro step (ST-005), so the narrative source can't be assumed.
- The daemon is one process with a parallel worker pool (Phase 6), so concurrent appends come from
  one process, multiple async writes (FR-11).

## Options Considered (narrative mechanism)

### Option A: skip the in-loop `retro` step for daemon runs; emission produces the narrative
The gate loop omits `retro` under the daemon. After `readOutcome` (before teardown), the emission
step generates the narrative — full retro for `done`, short halt narrative for `halted` — straight
into the engineer store.
- **Pros:** One place owns the narrative end-to-end; no repo write to undo; `done`/`halted`/
  tier-skip handled uniformly (no in-loop retro to special-case); the worktree context is still
  present pre-teardown.
- **Cons:** Narrative generation (a Claude call for `done`) moves to emission — but it's the same
  work the in-loop retro would have done, relocated.

### Option B: keep the in-loop `retro` step; redirect its output to the store
The `retro` step, when under the daemon, writes to the engineer store instead of `.docs/retros/`.
- **Pros:** Reuses the existing retro step.
- **Cons:** Couples the retro step to the engineer-store concept and daemon-awareness; halted +
  tier-skip features still need an emission-time narrative path, so narrative production is **split**
  across two mechanisms; the structured signal is assembled separately anyway.

## Decision

**Adopt Option A** — skip the in-loop `retro` step for daemon runs and have the emission step own
narrative production. It unifies narrative generation (done/halted/tier-skip) in one place, keeps
the repo clean by construction (no write-then-undo), and composes with the emission step that
already owns the structured signal. Option B's only advantage (reuse the in-loop step) is undercut
because halted and tier-skipped features force an emission-time narrative path regardless — so B
ends up with two mechanisms where A has one.

**Store format + mechanism (locked):**
- `~/.ai-conductor/engineer/signals.jsonl` — append-only, **one JSON line per feature-run**.
- `~/.ai-conductor/engineer/narratives/<project>/<feature>-<runId>.md` — narratives keyed by `runId`
  (FR-8: re-runs never overwrite).
- Record schema (FR-3): `{schemaVersion, ts, project, feature, runId, outcome, kickbacks[],
  halts[], retryHotspots[], tokens{input,output,cacheRead,cacheCreation}, durationByStep{},
  narrativeRef?}` — `narrativeRef` **optional** (absent when retro was skipped).
- **Concurrency (FR-11):** each record is appended in **one atomic append write** (`O_APPEND`, the
  whole line incl. newline in a single `appendFile` call). Small lines → atomic; full narratives
  live in separate files, never inline, so the line stays small.
- **Best-effort (FR-10):** the entire emission is wrapped so any store error is logged and
  swallowed; `FeatureOutcome` and teardown/PR are unaffected.
- Path override via `$AI_CONDUCTOR_ENGINEER_DIR` / user config; dir auto-created (FR-2).
- A **stub reader interface** (types only, no behavior) is exported so 9.3's engineer consumes a
  consumer-aware schema.

## Consequences

### Positive
- Single narrative path; repo stays clean by construction; uniform done/halted/tier-skip handling.
- Concurrency- and failure-safety are simple (atomic line append + swallow), not a new subsystem.

### Negative
- The gate loop gains a **daemon-conditional skip** of the `retro` step (must not affect manual runs).
- Emission does a Claude call for the `done` narrative outside the loop — acceptable (same work).

### Follow-up Actions
- [ ] Daemon-conditional skip of the in-loop `retro` step (manual runs unchanged).
- [ ] Emission module: assemble signal (reuse report-renderer), produce narrative, atomic append + narrative write, best-effort wrap.
- [ ] Engineer-store path resolution (`~/.ai-conductor/engineer/` + override + auto-create).
- [ ] `runId` scheme + narrative keying; `narrativeRef` optional.
- [ ] Stub reader interface (types) for 9.3.
