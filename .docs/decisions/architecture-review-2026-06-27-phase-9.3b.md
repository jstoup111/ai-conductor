# Architecture Review: Phase 9.3b — GitHub-Issues Intake + Write-Back

**Date:** 2026-06-27
**Mode:** Lightweight (Medium tier — feasibility + alignment only)
**Stories reviewed:** Stories 1–16 (`.docs/stories/phase-9.3b-github-intake-writeback.md`)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | ✅ Pure conduct-ts/TypeScript + `gh` CLI (already a daemon/PR dependency). No new runtime deps. |
| Prerequisites | ✅ 9.3 intake port/Envelope (merged #85), 9.2 registry reader, authenticated `gh`. All present. |
| Integration surface | ⚠️ One external API (GitHub via `gh`) confined to the github-issues adapter; the core touches interfaces only. Acceptable. |
| Data implications | ✅ No DB. New on-disk state under `.engineer/` (inbox + ledger), disjoint from `.daemon/`. |
| Performance risk | ✅ Poll is N registry-repos × one `gh` call; bounded. No hot path. |
| Worktree isolation | ✅ `.engineer/` is per-repo; no shared ports/services. Build runs in this worktree. |

## Alignment

- **Purely additive on ADR-009 port:** ✅ new `IntakeSource` + `IntakeQueue` interfaces; core
  depends on interfaces only. Routing and the DECIDE skills are unchanged.
- **Daemon untouched (FR-20/ADR-010):** ✅ the queue's atomic claim uses its own primitive and
  must not import `daemon-lock.ts` (Story 6 + ADR-011 carry a static no-import guard). **Condition C1.**
- **Single dedup authority:** ✅ ledger supersedes the in-memory guard (ADR-012); `idempotency.ts`
  removed and call sites repointed, grep-zero gate. **Condition C2** (orphaned-primitive guard).
- **Cross-repo safety:** ✅ capture reads many repos read-only; authoring still confined to the
  routed target via the existing `AuthoringGuard` (Story 16). **Condition C3.**
- **Non-autonomy (ADR-005):** ✅ no path to build without a human-merged spec PR; write-back is
  advisory and never gates delivery.
- **Diagram accuracy:** ✅ `components-engineer-intake.md` + the lifecycle sequence reflect the design.

## Domain Integrity (spot-check only — Medium defers to TDD domain reviewer)

- Envelope `status` is an enum (`pending|routed|deciding|done`) — invalid states unrepresentable. ✅
- Ledger lifecycle is an explicit state machine, not boolean flags. ✅
- `sourceRef` is a semantic composite key (`owner/repo#n`); dedup keys on it, not on text. ✅
- **Watch:** model `EnvelopeStatus` + the ledger's extra states (`needs-manual`) as a single
  exhaustive union; no catch-all `default`. (TDD domain reviewer to enforce.)

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Claim accidentally couples to daemon lock | Integration | Low | High | C1 static no-import guard (Story 6) |
| `idempotency.ts` left half-wired (orphaned primitive) | Technical | Medium | High | C2 remove + repoint + grep-zero (Story 8/ADR-012) |
| Auto-reopen churn loop on repeated rejects | Technical | Low | Medium | FR-40 cap at 2 + `needs-manual` + `forget` (Story 15) |
| Write-back failure reverts/blocks delivery | Integration | Low | Medium | FR-37 non-fatal (Story 11) |
| Lost/corrupt `ledger.json` reprocesses handled issues | Data | Low | Medium | GitHub `engineer:handled` label as fallback skip signal (ADR-012) |

## ADRs Created (DRAFT — require approval before BUILD)

- **adr-011** — Async intake queue + github-issues source (IntakeQueue seam, claim isolated from
  daemon lock, poll-on-launch + `poll` subcommand). Extends adr-009.
- **adr-012** — Durable intake ledger as sole dedup authority; removes in-memory guard; write-back
  idempotency via check-before-write; `engineer:handled` label as distributed-ready anchor.
  Amends adr-009.

## Conditions (tracked into BUILD; unmet at /finish = blocking)

- **C1:** intake/queue code contains **no import of `daemon-lock.ts`**; claim uses its own atomic
  primitive (verified by static guard test).
- **C2:** `intake/idempotency.ts` is removed and all callers repointed to the ledger; grep finds
  zero references to the removed guard.
- **C3:** all authored artifacts/PRs land only in the routed target repo (`AuthoringGuard` reused;
  integration test asserts other polled repos are byte-for-byte unchanged).

## Verdict

**APPROVED WITH CONDITIONS** — design is feasible and aligned with the locked 9.3 constraints.
Two DRAFT ADRs must be APPROVED before `/writing-system-tests`. Conditions C1–C3 carry into BUILD.
