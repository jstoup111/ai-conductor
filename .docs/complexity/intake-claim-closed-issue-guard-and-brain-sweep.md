# Complexity: intake claim closed-issue guard + brain reconciliation sweep

Tier: M

## Signals

- **Surfaces:** two coordinated changes — (1) a claim-time issue-state guard inside
  `createDeliveryGuardedQueue` (`delivery-guard.ts`), and (2) a periodic ledger/inbox
  reconciliation sweep wired into the brain intake-loop tick (`intake-loop.ts`).
- **External integration:** live GitHub issue-state reads via the existing
  `GhAbstraction.getIssueState` (`open|closed|null`) — network + failure-mode handling
  (null/unknown must fail safe, never drop a still-open issue).
- **State reconciliation:** consistent mutation of two durable stores (ledger.json +
  inbox/ envelopes) under the brain single-writer gate; interaction with existing
  re-eligibility (`maybeReopen`) and dedup (`ledger.known`) semantics.
- **Models / auth / migrations:** none. No new data model (disposition = existing
  `forget` primitive, no new LedgerStatus), no schema/CLI-breaking change, no auth.

## Why M (not S or L)

- Not **S**: more than a single-file change — two subsystems (claim path + brain loop),
  live-state integration with fail-safe semantics, and cross-store (ledger + inbox)
  consistency with existing reopen/dedup edge cases.
- Not **L**: no new data model, no auth, no state machine, no multi-service coordination;
  closely mirrors established patterns (`halt-issues/sweep.ts`, delivery-guard PR probe).
  Story count is modest.

## DECIDE consequence (Medium, technical)

Runs: explore → complexity → (skip PRD, technical) → architecture-diagram →
architecture-review (lightweight) → stories → conflict-check → plan.
