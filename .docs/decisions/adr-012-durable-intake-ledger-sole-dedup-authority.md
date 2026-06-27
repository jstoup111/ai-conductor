---
status: DRAFT
date: 2026-06-27
supersedes: none
amends: adr-009-intake-adapter-port
deciders: James Stoup
phase: 9.3b
---

# ADR-012: Durable Intake Ledger as Sole Dedup Authority

## Status
DRAFT — awaiting operator approval. Not authoritative until APPROVED.

## Context
ADR-009's intake landed an **in-memory** idempotency guard (`intake/idempotency.ts`) keyed on
`source\x00sourceRef`. It resets every process, which is fine for the synchronous chat path but
**insufficient** for an async pull source: a GitHub issue stays open and assigned, so every poll
across sessions would re-capture it without durable memory.

Phase 9.3b introduces a durable ledger anyway (lifecycle + metadata). Conflict-check
(2026-06-27) found these two mechanisms both own "dedup on `source+sourceRef`" — a
resource-contention risk and the harness's known **orphaned-primitive** failure mode (the live
path checking the forgetful guard while the durable ledger sits unwired).

## Decision
1. **The durable intake ledger** (`.engineer/ledger.json`, keyed `source+sourceRef`) is the
   **single dedup source of truth**, recording lifecycle (`unseen→pending→claimed→routed→
   deciding→done`) plus `{branch, prUrl, attempts, timestamps}`.
2. **Remove `intake/idempotency.ts`**; repoint every call site — including the synchronous
   claude-session path — to the ledger. A grep gate asserts zero remaining references to the
   removed guard (no orphaned primitive).
3. **Pull is exactly-once:** poll skips any candidate already in the ledger in a non-resettable
   state. Dedup keys on `sourceRef` (not text) — re-filing under a new issue number is a new idea;
   re-stating the same issue is not.
4. **Write-back idempotency** is enforced by **check-before-write** keyed `(sourceRef, status)` —
   re-running `report()` posts no duplicate comment and re-applies no label.
5. **GitHub `engineer:handled` label** is a second, **globally-visible** skip signal (an *output*
   marker; intake remains assignee-based). The ledger is local authority; the label is the
   distributed-ready anchor a future worker pool reads across hosts.

## Consequences
- **Positive:** one dedup authority eliminates divergence; durable across sessions; distributed
  pool gets a host-independent anchor for free.
- **Negative / trade-off:** removing `idempotency.ts` touches ADR-009-era call sites and their
  tests (must be migrated, not left dangling). A lost/corrupt `ledger.json` falls back to the
  GitHub label to avoid reprocessing already-handled issues.
- This ADR **amends** ADR-009's dedup mechanism; the port/Envelope contract itself is unchanged.

## Alternatives Rejected
- **Guard as a ledger-backed cache** — two layers to keep in sync, more subtle-bug surface.
- **Keep both independent** — exactly the orphaned-primitive divergence this harness has been
  bitten by before.
