# Implementation Plan: stale claim recovery (unclaim / requeue + claim-time auto-heal)

**Date:** 2026-07-22
**Design:** .docs/specs/2026-07-22-engineer-unclaim-requeue-verb-stale-claimed-ledger.md (Approved, FR-1..FR-12)
**Stories:** .docs/stories/engineer-unclaim-requeue-verb-stale-claimed-ledger.md (Accepted)
**ADRs:** adr-2026-07-22-stale-claim-staleness-window-default,
adr-2026-07-22-requeue-claimed-distinct-from-reopen,
adr-2026-07-22-attempts-counter-on-crash-recovery,
adr-2026-07-22-heartbeat-lease-deferred (all APPROVED)
**Conflict check:** Clean as of 2026-07-22 (.docs/conflicts/2026-07-22-engineer-unclaim-requeue-verb-stale-claimed-ledger.md)
**Intake:** jstoup111/ai-conductor#468

## Summary

Add recovery for stranded `claimed` intake entries in 16 TDD tasks across four seams: a new
`Ledger` transition (`claimed → pending`), a shared staleness predicate + config default, a
claim-time auto-heal reap rule inside the existing delivery-guard pass, and two new `engineer`
CLI verbs (single-idea `unclaim`, bulk `requeue --stale`) with a GitHub liveness rule.

## Technical Approach

- **Ledger transition (ADR-2):** add `requeueClaimed(source, sourceRef)` to `Ledger` and its
  file-backed factory in `engineer/intake/ledger.ts`. It transitions **only** a `claimed` entry to
  `pending`, preserves `capturedAt` (FR-4), increments `attempts` (ADR-3, FR-11), and returns a
  result signalling whether it acted (used by `unclaim` for refuse-on-terminal). Distinct from
  `reopen` (`done → pending`).
- **Staleness predicate + config (ADR-1):** a small `engineer/intake/stale-claim.ts` exporting
  `isStaleClaim(entry, nowMs, windowMs)` = `status === 'claimed' && nowMs − Date.parse(lastSeenAt) > windowMs`.
  The default window (24h) is added as an engine tunable resolved the same way other engine config is
  (`resolved-config.ts` / `config.ts`), overridable.
- **Auto-heal reap (FR-2, conflict items 1–3):** extend `createDeliveryGuardedQueue`
  (`engineer/intake/delivery-guard.ts`) so the claim-time pass, **after** the existing delivered→`done`
  heal, reaps each stale `claimed` entry via `requeueClaimed` and announces it via the existing
  `logger.info`. Reap persists before the queue selects the oldest `pending` so a reaped idea is
  claimable on the same pull.
- **CLI verbs (FR-5..FR-9):** two new cases in `engineer-cli.ts` beside `claim`/`forget`/`resolve`:
  `unclaim <owner/repo#N>` (single `requeueClaimed`; refuse when the entry is not `claimed`,
  directing to resolve/forget; unknown ref → non-error "not found"), and `requeue --stale
  [--older-than <duration>]` (list `claimed` entries, optionally age-bounded via `isStaleClaim`,
  liveness-check each issue, closed → `forget`, open/unknown → `requeueClaimed`, print a summary).
  Register both in the CLI verb metadata/help table.
- **Liveness (FR-9, #279):** reuse the existing `gh` issue-state read used elsewhere in intake; a
  closed issue routes to `forget`, an unreadable state is fail-safe (never `forget`).
- **Sequencing:** ledger transition first (independent), then predicate+config, then the delivery-guard
  reap, then the CLI verbs, then docs/changelog.

## Prerequisites

None — no migrations, no new dependencies. Additive `conduct-ts engineer` subcommands are MINOR
(not a breaking CLI change): add a `CHANGELOG.md [Unreleased] → Added` entry and update `README.md`
+ `src/conductor/README.md` (Documentation Upkeep). Do **not** bump `VERSION` (locked pre-v1). If the
self-host release gate's path classifier flags the CLI surface as breaking, commit an internal-only
waiver under `.docs/release-waivers/` (these verbs are additive; no existing CLI/hook/schema behavior
changes).

## Task Dependency Graph

```
1 ─▶ 2 ─▶ 9
1 ─▶ 5 ─▶ 6
     5 ─▶ 7
1 ─▶ 8 ─▶ 9,10
3 ─▶ 4 ─▶ 5
4 ─▶ 11
1,8 ─▶ 11 ─▶ 12 ─▶ 13
8,11 ─▶ 14
8,11,12 ─▶ 15
(16 CHANGELOG: last)
```

## Tasks

### Task 1: Ledger gains `requeueClaimed` (claimed → pending, preserve capturedAt, bump attempts)
**Story:** Story 1/2/3 — the core recovery transition (FR-1, FR-4, FR-11)
**Type:** happy-path

**Steps:**
1. Write failing tests: a `claimed` entry → `requeueClaimed` → status `pending`, `capturedAt`
   unchanged, `attempts` incremented, `lastSeenAt` refreshed.
2. Verify RED.
3. Add `requeueClaimed` to the `Ledger` interface and the `createLedger` factory (load-then-save,
   atomic write, like sibling methods).
4. Verify GREEN.
5. Commit: "ledger: add requeueClaimed (claimed→pending, keep capturedAt)"

**Files likely touched:**
- src/conductor/src/engine/engineer/intake/ledger.ts — interface + factory method
- src/conductor/test/engine/engineer/intake/ledger.test.ts (or nearest ledger test) — happy tests

**Wired-into:** src/conductor/src/engine/engineer/intake/ledger.ts (Ledger interface)
**Dependencies:** none

### Task 2: `requeueClaimed` is a no-op/refusal on non-`claimed` status (ADR-2)
**Story:** Story 4 — refuse-on-terminal (FR-6)
**Type:** negative-path

**Steps:**
1. Write failing tests: `done`, `routed`, `deciding`, and absent entries → `requeueClaimed` leaves
   the entry unchanged and returns a "did-not-act" result.
2. Verify RED.
3. Implement the status guard + result signal.
4. Verify GREEN.
5. Commit: "ledger: requeueClaimed only acts on claimed entries"

**Files likely touched:**
- src/conductor/src/engine/engineer/intake/ledger.ts — status guard + return signal
- src/conductor/test/engine/engineer/intake/ledger.test.ts — negative tests

**Wired-into:** none (constrains Task 1 surface)
**Dependencies:** 1

### Task 3: Staleness-window config default (24h)
**Story:** Story 1 — configurable window (FR-3, ADR-1)
**Type:** happy-path

**Steps:**
1. Write failing test: resolved config exposes a stale-claim window defaulting to 24h; an override
   is honored.
2. Verify RED.
3. Add the tunable to the engine config resolver with a 24h default.
4. Verify GREEN.
5. Commit: "config: stale-claim auto-heal window (default 24h)"

**Files likely touched:**
- src/conductor/src/engine/resolved-config.ts (and/or config.ts) — new tunable + default
- src/conductor/test/engine/resolved-config.test.ts — default + override tests

**Wired-into:** src/conductor/src/engine/resolved-config.ts (config surface)
**Dependencies:** none

### Task 4: Shared `isStaleClaim` predicate
**Story:** Story 1 (negative), Story 6 — age-past-window predicate (FR-2, FR-3)
**Type:** happy-path

**Steps:**
1. Write failing tests: `claimed` + age > window → true; `claimed` + age ≤ window → false;
   non-`claimed` → false; missing/invalid `lastSeenAt` → false (never reap on an unparseable age).
2. Verify RED.
3. Implement `isStaleClaim(entry, nowMs, windowMs)` in a new `stale-claim.ts`.
4. Verify GREEN.
5. Commit: "intake: shared isStaleClaim predicate"

**Files likely touched:**
- src/conductor/src/engine/engineer/intake/stale-claim.ts — new predicate
- src/conductor/test/engine/engineer/intake/stale-claim.test.ts — boundary tests

**Wired-into:** src/conductor/src/engine/engineer/intake/stale-claim.ts
**Dependencies:** 3

### Task 5: Delivery-guard reaps stale claimed → pending at claim time
**Story:** Story 1 — auto-heal happy path (FR-1, FR-2, FR-12)
**Type:** happy-path

**Steps:**
1. Write failing test: guarded queue over a store with a stale `claimed` entry → on claim, entry is
   `requeueClaimed`ed to `pending` and `logger.info` announces it; delivered-heal (→ done) still runs
   first (precedence, conflict item 1).
2. Verify RED.
3. Add the stale-`claimed` reap rule to the guard pass after the delivered-heal, calling
   `requeueClaimed` for each stale entry; announce each.
4. Verify GREEN.
5. Commit: "delivery-guard: auto-heal stale claimed entries to pending"

**Files likely touched:**
- src/conductor/src/engine/engineer/intake/delivery-guard.ts — reap rule
- src/conductor/test/engine/engineer/intake/delivery-guard.test.ts — reap + precedence tests

**Wired-into:** src/conductor/src/engine/engineer/intake/delivery-guard.ts (claim-time pass)
**Dependencies:** 1, 4

### Task 6: Reap respects the window and never touches non-claimed entries
**Story:** Story 1 (negative), Story 8 — safety boundaries (FR-3, FR-6, FR-10)
**Type:** negative-path

**Steps:**
1. Write failing tests: a fresh `claimed` entry (age ≤ window) is NOT reaped and NOT announced;
   an old `done` entry is never reaped by the stale-claim rule.
2. Verify RED/GREEN as appropriate.
3. Tighten the guard predicate if needed.
4. Verify GREEN.
5. Commit: "delivery-guard: reap only stale claimed, never fresh or terminal"

**Files likely touched:**
- src/conductor/test/engine/engineer/intake/delivery-guard.test.ts — negative fixtures
- src/conductor/src/engine/engineer/intake/delivery-guard.ts — only if tightening needed

**Wired-into:** none (constrains Task 5)
**Dependencies:** 5

### Task 7: Reaped entry is claimable on the same pull, oldest-first
**Story:** Story 2 — FIFO + same-pull eligibility (FR-4, conflict items 2–3)
**Type:** happy-path

**Steps:**
1. Write failing test: store with only a stale `claimed` entry (older `capturedAt`) and one newer
   `pending` → a single claim returns the reaped (older) entry first.
2. Verify RED.
3. Ensure the reap persists before the queue selects the oldest `pending` (ordering by `capturedAt`).
4. Verify GREEN.
5. Commit: "delivery-guard: reaped entry is claimable in the same pull (FIFO)"

**Files likely touched:**
- src/conductor/test/engine/engineer/intake/delivery-guard.test.ts — same-pull ordering test
- src/conductor/src/engine/engineer/intake/delivery-guard.ts — sequencing if needed

**Wired-into:** none
**Dependencies:** 5

### Task 8: `engineer unclaim <ref>` verb — happy path
**Story:** Story 3 — single-idea recovery (FR-5)
**Type:** happy-path

**Steps:**
1. Write failing test: dispatch `engineer unclaim owner/repo#N` on a `claimed` entry → entry becomes
   `pending`, `capturedAt` preserved, success reported.
2. Verify RED.
3. Add the `unclaim` case to `engineer-cli.ts` (parse ref → `requeueClaimed` → print result).
4. Verify GREEN.
5. Commit: "engineer-cli: add unclaim verb (single-idea recovery)"

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — unclaim case + dispatch parse
- src/conductor/test/engine/engineer/… (cli test) — happy test

**Wired-into:** src/conductor/src/engine/engineer-cli.ts (subcommand switch)
**Dependencies:** 1

### Task 9: `unclaim` refuses a terminal/non-claimed entry
**Story:** Story 4 — refuse-on-terminal (FR-6)
**Type:** negative-path

**Steps:**
1. Write failing test: `unclaim` on a `done` entry → refusal message directing to resolve/forget,
   entry unchanged, non-zero-or-reported result per CLI convention.
2. Verify RED.
3. Use Task 2's "did-not-act" signal to emit the refusal.
4. Verify GREEN.
5. Commit: "engineer-cli: unclaim refuses non-claimed entries"

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — refusal branch
- (cli test) — negative test

**Wired-into:** none
**Dependencies:** 2, 8

### Task 10: `unclaim` on an unknown ref reports not-found (non-error)
**Story:** Story 5 — unknown ref (FR-7)
**Type:** negative-path

**Steps:**
1. Write failing test: `unclaim` on a ref with no ledger entry → clear "not found" line, success exit,
   nothing changed.
2. Verify RED.
3. Implement the not-found branch (found:false, non-error).
4. Verify GREEN.
5. Commit: "engineer-cli: unclaim reports not-found as non-error"

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — not-found branch
- (cli test) — unknown-ref test

**Wired-into:** none
**Dependencies:** 8

### Task 11: `engineer requeue --stale [--older-than <dur>]` bulk verb — happy path
**Story:** Story 6 — bulk recovery (FR-8)
**Type:** happy-path

**Steps:**
1. Write failing test: store with several `claimed` entries (some older than `--older-than`, some
   newer) → bulk requeue moves the eligible ones to `pending`, leaves newer ones, prints a summary.
2. Verify RED.
3. Add the `requeue` case: parse `--stale`/`--older-than <duration>`, list `claimed` entries, filter
   via `isStaleClaim`, `requeueClaimed` each, print summary.
4. Verify GREEN.
5. Commit: "engineer-cli: add requeue --stale bulk verb"

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — requeue case + duration parse
- (cli test) — bulk happy test

**Wired-into:** src/conductor/src/engine/engineer-cli.ts (subcommand switch)
**Dependencies:** 1, 4, 8

### Task 12: Bulk requeue liveness — closed issue is dropped, not requeued
**Story:** Story 7 — liveness rule (FR-9, #279)
**Type:** happy-path

**Steps:**
1. Write failing test (stubbed `gh`): a stale `claimed` entry whose issue is closed → `forget`;
   one whose issue is open → `requeueClaimed`; summary distinguishes requeued vs dropped.
2. Verify RED.
3. Add the per-entry liveness read + closed→`forget` / open→`requeueClaimed` branch.
4. Verify GREEN.
5. Commit: "engineer-cli: requeue drops closed-issue entries (liveness)"

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — liveness branch
- (cli test) — liveness fixtures with stubbed gh

**Wired-into:** none
**Dependencies:** 11

### Task 13: Bulk requeue liveness is fail-safe on an unreadable issue state
**Story:** Story 7 (negative) — never forget on unconfirmed-closed (FR-9)
**Type:** negative-path

**Steps:**
1. Write failing test: `gh` errors/times out for an entry → it is NEVER `forget`ten; the error is
   surfaced for that entry and the run continues for the rest.
2. Verify RED.
3. Implement fail-safe: only a confirmed-closed signal triggers `forget`.
4. Verify GREEN.
5. Commit: "engineer-cli: requeue liveness fail-safe on gh error"

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — fail-safe branch
- (cli test) — gh-error fixture

**Wired-into:** none
**Dependencies:** 12

### Task 14: Register `unclaim` + `requeue` in CLI verb metadata / help
**Story:** Story 3/6 — discoverability of the new verbs
**Type:** happy-path

**Steps:**
1. Write failing test: the verb metadata/help output lists `unclaim` and `requeue` with loop-fit
   descriptions (out-of-band maintenance ops).
2. Verify RED.
3. Add both to the verb metadata table + `--help` text in `engineer-cli.ts`.
4. Verify GREEN.
5. Commit: "engineer-cli: register unclaim/requeue in verb metadata + help"

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — verb metadata + help
- (cli test) — help/metadata assertions

**Wired-into:** none
**Dependencies:** 8, 11

### Task 15: Documentation — README + conductor README
**Story:** Documentation Upkeep — docs track features
**Type:** happy-path

**Steps:**
1. Document the auto-heal behavior, the staleness window config (default 24h), and the `unclaim` /
   `requeue --stale [--older-than]` verbs in `README.md` and `src/conductor/README.md`.
2. Verify the engineer loop/verb list reflects the two new maintenance verbs.
3. Commit: "docs: document stale-claim auto-heal + unclaim/requeue verbs"

**Files likely touched:**
- README.md — engineer verbs + auto-heal
- src/conductor/README.md — engineer intake verbs + config tunable

**Wired-into:** none
**Dependencies:** 8, 11, 12

### Task 16: CHANGELOG [Unreleased] entry (+ release-waiver if the gate flags CLI)
**Story:** Release & Update Gates — changelog on every PR
**Type:** happy-path

**Steps:**
1. Add a `CHANGELOG.md [Unreleased] → Added` entry for stale-claim auto-heal + the unclaim/requeue
   verbs. Do NOT bump `VERSION` (locked pre-v1).
2. If the self-host release gate flags the `bin/conduct CLI` surface as breaking, add an internal-only
   waiver under `.docs/release-waivers/engineer-unclaim-requeue-verb-stale-claimed-ledger.md`
   (additive verbs; no existing CLI/hook/schema behavior changed).
3. Commit: "changelog: stale-claim recovery (unclaim/requeue + auto-heal)"

**Files likely touched:**
- CHANGELOG.md — [Unreleased] Added
- .docs/release-waivers/…md — only if the gate flags the CLI surface

**Wired-into:** none
**Dependencies:** none (land last)
