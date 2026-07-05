# Architecture Review: Engineer Claim Delivery Guard (#243)

**Date:** 2026-07-04
**Mode:** Lightweight (Medium tier) — feasibility + alignment
**Track:** technical (no PRD; review input = explore output + confirmed Approach C)
**Stories reviewed:** none yet (pre-stories review per adr-2026-06-29-architecture-before-stories-convergent-kickback)
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependencies. `gh pr view` is already an intake-layer pattern (blocker-resolver, `maybeReopen`); the guard reuses the injected `gh` runner. |
| Prerequisites | None — ledger schema already carries `branch`/`prUrl`/`attempts`; no migration. |
| Integration surface | Confined to `engineer/intake/` + the `claim`/`handoff`/new `resolve` cases in `engineer-cli.ts`. Daemon untouched. |
| Data implications | No schema change. New writes: auto-heal `claimed→done`, branch evidence on local-commit, `resolve` transition. All through the existing atomic tmp+rename store. |
| Performance | One ledger read per candidate; gh calls only for evidence-carrying candidates (rare by construction). Bounded by inbox size. |
| Worktree isolation | Ledger/inbox live under `~/.ai-conductor/engineer/` (host-global by design, ADR-011/012); no per-worktree resource added. |

**Concurrency note (binding on implementation):** the guard's `ack` of a duplicate
envelope can race a concurrent claim (`unlink` ENOENT) — must be tolerated as success.
Same tolerance as the queue's own ENOENT-race convention (ADR-011 §4).

## Alignment

- **ADR-012 (ledger = sole dedup authority):** strengthened, not violated — the guard
  finally enforces the declared authority at claim time. New ADR *amends* ADR-012.
- **ADR-011 (atomic file-queue claim, no engine lock):** preserved — the guard wraps the
  queue surface; the rename-based atomic claim primitive is unchanged and no lock is
  introduced.
- **adr-2026-07-03 dependency-ordered intake:** preserved — `claimUnblocked` is not
  modified; the guard is a queue decorator beneath it, so oldest-unblocked semantics and
  the all-blocked outcome are untouched.
- **FR-39/40 re-eligibility + churn cap:** closed-unmerged PRs route through the existing
  reopen path — the guard adds no bypass around the attempts cap.
- **Daemon-side dedup family (adr-2026-07-03-committed-shipped-record-dispatch-dedup):**
  related but disjoint layer (daemon dispatch vs engineer intake); no shared state, no
  contradiction.
- **Pattern consistency:** decorator-over-seam matches the existing `IntakeQueue`
  interface discipline; `resolve` mirrors `forget`'s CLI shape (JSON output,
  `found: false` non-error).
- **State management:** no new statuses, no boolean flags; `done` stays the single
  terminal delivered state; invalid "delivered but claimed" states become self-healing.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| gh outage wedges claim behind an evidence-carrying candidate | Integration | Low | Medium | Fail-safe skips only that candidate and walks on; healthy entries still serve |
| Guard ack races a concurrent claim's ack | Technical | Low | Low | Tolerate unlink ENOENT as success (ADR-011 convention) |
| Duplicate-envelope drop hides a crashed-session idea | Data | Low | Medium | Drop is logged with the sanctioned re-open path (`engineer forget`); entry state untouched |
| `resolve` typo'd to the wrong ref marks wrong entry done | Data | Low | Medium | `resolve` echoes the entry (source, prior status, evidence) in its JSON output for verification |

No High-impact risks registered.

## ADRs Created

- `adr-2026-07-04-claim-time-delivery-evidence-guard.md` (APPROVED 2026-07-04;
  amends ADR-012).

## Conditions

None. Verdict is APPROVED contingent only on the ADR reaching APPROVED status before
land (engineer skill hard gate).
