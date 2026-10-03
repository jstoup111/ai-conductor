# Architecture Review: Interrupted intake claim still strands high-priority issues (#2733)
**Date:** 2026-10-02
**Mode:** Lightweight (Tier M) — Feasibility + Alignment only
**Input:** `.docs/track/interrupted-intake-claim-still-strands-high-priori.md` (technical, minimal scope), issue #2733, diagrams `.docs/architecture/interrupted-intake-claim-still-strands-high-priori.md` and `.docs/architecture/sequences/interrupted-intake-claim-still-strands-high-priori.md`
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

Design: `compose claim` holds a dedicated intake claim lease for its whole walk; under the lease and before walking, it releases every `.claimed` envelope whose ledger entry is `pending`; a concurrent claim waits (bounded) or fails "claim in progress".

Load-bearing claims:

| Claim | Confidence | Basis |
|---|---|---|
| A successful claim acks (deletes) the winner's envelope *before* the ledger moves to `claimed`, so a `pending` ledger + `.claimed` envelope pair exists only while a walk holds it | 95% | verified — `engineer-cli.ts` claim case: `queue.ack(envelope)` then `ledger.transition(..., 'claimed')` |
| The claim walk is the only producer of `.claimed` envelopes | 95% | verified — `queue.claim()` callers are only `delivery-guard.ts` `innerClaim` and `dependency-claim.ts` `claimUnblocked`, both reached only from the `claim` case |
| Strands come from a walker dying before `claimUnblocked`'s `finally` | 85% | inferred — drain-all at `dependency-claim.ts` banded branch + same-millisecond batch mtimes in #2733 |
| `createConductStateLease` gives pid ownership, dead-owner recovery and a bounded wait reusable for a second store | 85% | verified API (`conduct-state-lease.ts` options `pid`, `waitTimeoutMs`, `processIsLive`; `occupied`/`timeout` blockers); recovery path inferred from the ledger's production use |
| The walk can run for minutes (one sequential label read per pending entry, plus per-candidate issue-state and dependency reads) | 80% | verified sequential loop in `backlog-priority.ts` `ghIssueLabelReader`; duration inferred from 167 claimable entries |

| Check | Result |
|---|---|
| Stack compatibility | No new packages; reuses `conduct-state-lease.ts`. |
| Prerequisites | None. |
| Integration surface | One module boundary: engineer CLI claim case + intake queue/ledger. No external API change. |
| Data implications | No schema change. Reconciliation renames `.claimed` → `.json` via the queue's existing `release` mapping; old strands heal on first post-upgrade claim. |
| Performance risk | Claims serialize. A waiting claim pays at most the bound; operator-frequency, acceptable. |
| Worktree isolation | Lease lives beside the inbox under the engineer dir (`~/.ai-conductor/engineer/`), host-global like the inbox itself; no port/DB/worktree resource. |

## Alignment

- **ADR-011 (`adr-011-async-intake-queue-and-github-source`)** decision 4 made the claim lock-free (atomic rename only) and forbade `daemon-lock.ts`. This design adds a lease *above* the rename primitive; the rename stays the per-envelope single-winner mechanism and `daemon-lock.ts` is untouched. This changes the claim's concurrency/state-transition design, so it is recorded as an additive amendment adding decision 6 to ADR-011 (operator preference: amend the governing ADR rather than add a new one).
- **`adr-2026-07-10-intake-claim-priority-banding`** — its Consequences assertion that a claim "momentarily" holds every pending envelope is falsified (holds for the whole sequential read; a death strands the batch). Amended in place with an additive note; its decisions 1–4 are unchanged.
- **`adr-2026-08-12-fail-closed-intake-ledger-durability`** — the ledger lease stays short-held per operation and is only acquired *inside* the claim lease, never the reverse: no lock-order inversion.
- **Pattern consistency** — a second named `createConductStateLease` instance follows the ledger's own precedent (`ledger.ts` `createLedger` → `withLedgerLease`). Preserve: pid owner, transient owner-metadata retry, release in `finally`, fail-closed on `recovery_refused`. Allowed variation: a longer wait bound sized to a full walk.
- **Delivery guard** (`delivery-guard.ts`) and `claimUnblocked` ranking are unchanged; they simply run under the lease.
- **Event spine** — no new observation channel; reconciliation reports through the claim command's existing stderr logger (scope excludes a `brain status` count).
- **Security** — no new input surface; reconciliation only renames files whose ledger entry is `pending`.

## Wiring Surface

- **Intake claim lease + orphan reconciliation** (new helper in `src/conductor/src/engine/engineer/intake/`) — invoked from the `claim` case of `engineer-cli.ts` (reached by `ai-conductor compose claim` command dispatch), wrapping the existing `createDeliveryGuardedQueue` + `claimUnblocked` call and the winner's ack/ledger transition.
- No new config key, event, hook, CLI subcommand, or scheduled job.

Early overlap scan (advisory): run over `src/conductor/src/engine/engineer-cli.ts`, `src/conductor/src/engine/engineer/intake/queue.ts`, `src/conductor/src/engine/engineer/intake/dependency-claim.ts`.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A live-but-hung claimer holds the lease, so every later claim fails "claim in progress" | Technical | Low | Medium | Error names the owner pid; operator kills it; dead-owner recovery then proceeds. Visible, never silent. |
| PID reuse makes a dead owner look live | Technical | Low | Low | Fails safe (refuse, not double-handout); same exposure as the ledger lease. |
| Wait bound shorter than a long walk fails a concurrent claim | Performance | Medium | Low | Bound sized to a full walk; failure is an explicit retryable error. |
| Reconciliation releases an envelope a live walk holds (double handout, #862) | Data | Very low | High | Reconciliation runs only while the claim lease is held, and the walk is the sole `.claimed` producer; story criteria must prove a held lease blocks a second walker. |

## ADRs Created

None. Amended (additive, pending operator approval): `adr-011-async-intake-queue-and-github-source` (adds decision 6), `adr-2026-07-10-intake-claim-priority-banding` (Consequences note).

## Conditions

1. Reconciliation must run only after the claim lease is acquired and before the walk; no code path may reconcile without holding it.
2. A claim that cannot acquire the lease within the bound exits non-zero with a "claim in progress" message naming the owner pid, and performs no queue mutation.
3. Only `.claimed` envelopes whose ledger entry is `pending` are released; `done`/absent pairings are untouched.
4. The ledger lease is never held while acquiring the claim lease.
