# Architecture Review: intake claim closed-issue guard + brain reconciliation sweep

**Date:** 2026-07-22
**Mode:** Lightweight (tier M, technical track) — Section 2 (Feasibility) + Section 4 (Alignment)
**Reviewed:** explore output + technical intent (stories/plan not yet authored)
**Verdict:** APPROVED

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | ✅ No new deps. Reuses `gh` CLI, existing `GhRunner`/`GhAbstraction.getIssueState`, and existing ledger/queue primitives. |
| Prerequisites | None. No migration, no config, no external account. |
| Integration surface | Two seams: `createDeliveryGuardedQueue` (claim path) and `intakeTick` (brain loop). Both already exist; the sweep is a new function mirroring `halt-issues/sweep.ts`. |
| Data implications | None. No schema change; disposition uses the existing `ledger.forget` primitive — no new `LedgerStatus`. |
| Performance risk | One `gh issue view` per `github-issues` head candidate at claim (bounded); sweep does N `gh` reads per tick over `pending` entries — small N, 5-min interval. Acceptable. |
| Worktree isolation | Unaffected — intake stores live under `«engineerDir»` (host-wide), not per-worktree; no new ports/services. |

**Verified claims (correctness gate):**
- Guard passthrough at `delivery-guard.ts:136` returns `pending` candidates with no probe — the exact defect seam. (verified)
- `getIssueState → 'open'|'closed'|null`, null on any `gh` failure (`halt-issues-cli.ts:148`). (verified)
- Ledger is load-modify-save + atomic rename, no lock; `forget` is a no-op on absent key (`ledger.ts:84,94,170`). (verified)

## Alignment

- **Domain boundaries:** respected. The guard stays within the intake decorator; the sweep stays within the brain intake loop. No cross-domain reach.
- **Pattern consistency:** the sweep follows the established `halt-issues/sweep.ts` shape (load → per-entry try/catch → external-state check → atomic write → summary + dry-run). The guard extension mirrors the existing `verifyPrState` probe pattern already in the same file. No new pattern introduced → the single ADR documents the reconciliation design.
- **State management:** disposition is the existing `forget` (removal), not a new flag/status — invalid states are not introduced. Fail-safe-on-null keeps an unknown state from ever being treated as closed.
- **Diagram accuracy:** `.docs/architecture/components.md` and `sequences/claim-closed-issue-guard.md` reflect the two control points (added this DECIDE pass).
- **Security boundaries:** no new endpoint/input; `gh` reads are read-only issue state.
- **maybeReopen interaction:** existing re-eligibility (`github-issues.ts`) keys off **PR** state, not issue state — orthogonal to this issue-state reconciliation. No conflict.
- **Brain single-writer gate:** `brainLoopAlive` gates the interactive **pre-poll** only; the claim guard is not the pre-poll, so guard + sweep are two concurrent ledger writers (see Risk R1).

## Wiring Surface

- **Claim-guard issue-state probe** → inside `createDeliveryGuardedQueue` (`delivery-guard.ts`), already reachable from `engineer claim` (`engineer-cli.ts:1015`). Extends an existing decorator branch; no new call site.
- **`reconcileClosedIssues` brain sweep** → invoked from `intakeTick` (`intake-loop.ts`), run each tick by the brain singleton (`brain-supervisor-cli.ts` → `conduct-ts intake-loop --continuous`). `gh` issue-state capability supplied via intake deps, as `halt-issues/sweep.ts` receives `GhAbstraction`.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1: sweep + claim-guard concurrent un-locked ledger writes (last-writer-wins) | Data | Low | Medium | `forget` is idempotent + convergent — a lost update at worst re-surfaces a closed entry the next tick/claim re-forgets; no durable corruption. Scope sweep to `pending` only; claim path tolerates an already-absent entry. Ledger locking is out of scope (pre-existing property). |
| R2: transient `gh` failure misread as closed → wrongful drop | Integration | Low | High | Fail-safe: only explicit `closed` drops; `null` (any failure) is treated as still-open. |
| R3: `sourceRef` parse (`owner/repo#n` → repo + number) wrong for edge refs | Technical | Low | Low | Parse defensively; non-`github-issues` sources skip the probe entirely. |

## ADRs Created

- `adr-2026-07-22-intake-closed-issue-reconciliation.md` — **Status: APPROVED**. Dual control-point reconciliation, forget disposition, fail-safe-on-null, concurrency scoping.

## Conditions

None blocking. Design-time constraints carried into the plan:
1. Sweep reconciles **`pending`** entries only.
2. Only explicit `closed` triggers a drop; `null`/`open` never do (fail-safe).
3. Non-`github-issues` envelopes bypass the issue-state probe (unchanged behavior).
4. Both writers tolerate an already-absent ledger entry / already-deleted inbox file (ENOENT benign, as the guard already does).
