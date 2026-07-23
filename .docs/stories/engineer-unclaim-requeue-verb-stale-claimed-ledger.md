# Stories: stale claim recovery (unclaim / requeue + auto-heal)

**Date:** 2026-07-22
**Status:** Accepted
**Track:** product
**Spec:** .docs/specs/2026-07-22-engineer-unclaim-requeue-verb-stale-claimed-ledger.md

Each story is Given/When/Then with explicit happy and negative paths. FR references map to the PRD.

---

## Story 1 — Automatic recovery of an abandoned claim at claim time (FR-1, FR-2, FR-12)

**As** the engineer processing loop, **I want** stale checked-out ideas returned to the queue
automatically when I next pull work, **so that** a dead session never permanently starves intake.

- **Happy:**
  - **Given** an idea in `claimed` whose checkout age exceeds the staleness window,
  - **And** no other pending idea (or it is the oldest),
  - **When** the operator pulls the next idea from the queue,
  - **Then** the stale idea is returned to `pending` before dequeue,
  - **And** it is announced to the operator (a visible "recovered/healed" line, FR-12),
  - **And** it is then eligible to be claimed on that same pull.

- **Negative (protects live sessions — FR-3, FR-10):**
  - **Given** an idea in `claimed` whose checkout age is **within** the staleness window,
  - **When** the operator pulls the next idea,
  - **Then** that idea is **not** reaped and remains `claimed`,
  - **And** nothing about it is announced.

---

## Story 2 — Automatic recovery preserves queue position (FR-4, FR-11)

**As** an operator, **I want** a recovered idea to keep its place in line, **so that** a crash
doesn't penalize an idea's priority.

- **Happy:**
  - **Given** a stale `claimed` idea A with an earlier `capturedAt` than a `pending` idea B,
  - **When** automatic recovery returns A to `pending` and the queue is pulled,
  - **Then** A (older `capturedAt`) is claimed before B,
  - **And** A's `capturedAt` is unchanged by recovery,
  - **And** A's re-entry/churn count is incremented (FR-11).

---

## Story 3 — Manual single-idea recovery (FR-5, FR-4)

**As** an operator who knows a session is dead, **I want** to return one specific stranded idea
to the queue in one command, **so that** I don't wait for the automatic window or hand-edit state.

- **Happy:**
  - **Given** an idea in `claimed` (any age),
  - **When** the operator runs the single-idea recovery command referencing it,
  - **Then** the idea moves to `pending` with `capturedAt` preserved,
  - **And** the command reports success naming the idea.

---

## Story 4 — Manual recovery refuses a terminal idea (FR-6)

**As** an operator, **I want** recovery to refuse ideas that are already delivered/terminal,
**so that** I don't accidentally re-queue finished work.

- **Negative:**
  - **Given** an idea whose status is `done` (or another non-`claimed` terminal state),
  - **When** the operator runs the single-idea recovery command referencing it,
  - **Then** the command refuses the operation,
  - **And** it directs the operator to the correct disposition (resolve/forget) for such ideas,
  - **And** the ledger entry is unchanged.

---

## Story 5 — Manual recovery of an unknown reference (FR-7)

**As** an operator, **I want** a clear result when I reference an idea intake doesn't know,
**so that** a typo isn't a hard failure.

- **Negative:**
  - **Given** a reference the intake ledger has no entry for,
  - **When** the operator runs the single-idea recovery command,
  - **Then** the command reports a clear "not found" result,
  - **And** it exits as a non-error (success exit), changing nothing.

---

## Story 6 — Bulk recovery of the whole stranded class (FR-8, FR-4, FR-11)

**As** an operator facing many stranded ideas (e.g. the 2026-07-10 ten-entry pileup), **I want**
to recover them all in one command, **so that** intake is unblocked in a single action.

- **Happy:**
  - **Given** multiple ideas in `claimed`, some older than an optional age bound and some newer,
  - **When** the operator runs bulk recovery with that age bound,
  - **Then** every `claimed` idea older than the bound (whose issue is open — see Story 7) moves to
    `pending`, each preserving `capturedAt` and incrementing its re-entry count,
  - **And** ideas newer than the bound are left untouched,
  - **And** the command prints a summary (how many requeued, how many dropped).

---

## Story 7 — Bulk recovery liveness: closed upstream issue is dropped, not re-queued (FR-9)

**As** an operator, **I want** bulk recovery to drop ideas whose originating issue is already
closed, **so that** I don't re-process work that's no longer needed (the #279 liveness rule).

- **Happy/negative mix:**
  - **Given** a stale `claimed` idea whose originating GitHub issue is **closed**,
  - **And** another stale `claimed` idea whose issue is **open**,
  - **When** the operator runs bulk recovery,
  - **Then** the closed-issue idea is dropped from intake (forgotten), not returned to the queue,
  - **And** the open-issue idea is returned to `pending`,
  - **And** the summary distinguishes requeued from dropped.

- **Negative (liveness read fails):**
  - **Given** a stale `claimed` idea whose issue state cannot be read (network/gh error),
  - **When** the operator runs bulk recovery,
  - **Then** that idea is **not** dropped (fail-safe): it is left `claimed` or requeued, never
    forgotten on an unconfirmed-closed signal,
  - **And** the error is surfaced for that entry without aborting the whole run.

---

## Story 8 — Automatic reap never touches delivered entries (FR-6 boundary, safety)

**As** the system, **I want** the automatic reap to target only `claimed` ideas, **so that**
delivered or in-flight-terminal ideas are never re-queued.

- **Negative:**
  - **Given** an old `done` entry (delivered) and an old `claimed` entry both past the window,
  - **When** the operator pulls the next idea,
  - **Then** only the `claimed` entry is reaped to `pending`,
  - **And** the `done` entry is untouched by the reaper (its delivered-heal path, → `done`, takes
    precedence and runs first).

---

## Acceptance summary (FR coverage)

- FR-1, FR-2, FR-12 → Story 1
- FR-3, FR-10 → Story 1 (negative), Story 8
- FR-4 → Stories 2, 3, 6
- FR-5 → Story 3
- FR-6 → Stories 4, 8
- FR-7 → Story 5
- FR-8 → Story 6
- FR-9 → Story 7
- FR-11 → Stories 2, 6

All stories carry a happy and/or negative path with observable Then-clauses. **Status: Accepted.**
