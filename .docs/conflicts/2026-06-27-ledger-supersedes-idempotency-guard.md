# Conflict Report — Phase 9.3b Stories

**Date:** 2026-06-27
**Stories checked:** `.docs/stories/phase-9.3b-github-intake-writeback.md` (Stories 1–16)
**Scope:** internal (16 stories pairwise, 5 conflict types) + cross-cutting vs shipped 9.3 code.

## Result: 1 degrading conflict (resolved), 2 design notes, 0 blocking.

---

## Conflict: Durable ledger vs in-memory idempotency guard

**Stories involved:** Story 8 (durable ledger + idempotent pull) vs shipped `intake/idempotency.ts` (9.3)
**Type:** resource-contention (two mechanisms own the same responsibility)
**Severity:** degrading

**Description:**
The 9.3 in-memory idempotency guard and the new 9.3b durable ledger both deduplicate on
`source + sourceRef`. Leaving both wired risks divergence and the *orphaned-primitive* failure
mode (the loop checks the forgetful in-memory guard while the durable ledger sits unwired), which
this harness has been bitten by before.

**Resolution Options:**
1. Ledger is sole authority; remove the in-memory guard, repoint all callers. *(least ambiguity)*
2. Ledger authoritative; guard demoted to a ledger-backed in-process cache. *(two layers to sync)*
3. Keep both independent. *(highest divergence risk — rejected)*

**Decision (operator, 2026-06-27): Option 1.**
The durable ledger becomes the **single dedup source of truth**. `intake/idempotency.ts` is
**removed**; every call site — including the synchronous claude-session path — is repointed to the
ledger. A grep gate confirms zero remaining references to the removed guard (no orphaned primitive).

**Story update:** Story 8 "Done When" now includes the removal + repoint + grep-zero gate.
**Architecture impact:** flagged for the lightweight architecture-review (this supersedes the
implicit 9.3 dedup mechanism; may warrant an ADR note that the ledger is authoritative).

---

## Design Notes (not conflicts — carry into `/plan`)

- **N1 (claim isolation, FR-30):** implement the queue's atomic claim with its **own** primitive
  (`O_EXCL` / atomic rename on `.engineer/`), never by importing `daemon-lock.ts`. FR-20 / the
  daemon `O_EXCL` pidfile lock stays byte-for-byte untouched. Story 6 carries the no-import guard.
- **N2 (`report()` signature, FR-36):** widen `IntakePort.report` to accept an optional
  `meta` (e.g. `{ repo }` for `routed`, `{ prUrl }` for `done`). Backward-compatible — the
  claude-session no-op still satisfies it. Touches the locked port interface minimally; the
  lightweight architecture-review will formalize.

---

## Disjoint-by-design (verified, no contention)

- `.engineer/` (inbox + ledger; intake idea→spec) vs `.daemon/` (pidfile + processed build markers;
  build spec→build) — disjoint paths, disjoint lifecycle stages.
- Story 8 ledger-skip and Story 9 label-skip are **complementary** skip signals (local authority +
  distributed-ready anchor), intentionally redundant — not a contradiction.
