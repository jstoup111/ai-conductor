# Architecture Review: one-rubric-s-rejected-contract-discards-the-whole- (#1740)
**Date:** 2026-08-21
**Mode:** Lightweight (Medium tier) — §2 Feasibility and §4 Alignment in full
**Stories reviewed:** none yet (pre-stories run); input is `.docs/track/` + explore decision (approach A′)
**Verdict:** APPROVED

Scope boundary (binding, from `.docs/track/`): conform to `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` D3 — a below-cap mechanical fault still publishes no aggregate. Deliver (a) a stale-lapId guard in `build_review` completion, (b) a first-class ledger record of the last mechanical fault, (c) stale-aggregate observability on the existing event spine. Excludes publishing a FAIL aggregate on a mechanical fault, a new result kind for rejected candidates, per-rubric carry-forward (#1657), and daemon-status work.

## Why approach A (always publish) was rejected at review

Explore's first pick published the current lap's aggregate on every mechanical fault. The full ADR sweep (all 294 ADRs read) found that `adr-2026-08-18` D3 — APPROVED, operator-approved 2026-08-18 — decides the opposite verbatim: *"A lap with any mechanical fault and remaining mechanical allowance publishes **no** aggregate."* Non-publication is that ADR's budget-neutrality mechanism (`consumeKickbackBudget` is never reached because nothing is published), and its Alternatives section rejected a publish-and-special-case design for exactly the consumer-sprawl reason. Superseding it would reopen the kickback budget proof at every FAIL consumer. The operator chose to conform (2026-08-21).

The defect #1740 observed is a gap in D3's **premise**, not its decision: D3 says "completion classifies the verdict `absent`", which is only true when no aggregate is on disk. A prior lap's aggregate written in the same session is mtime-fresh and is read as the current verdict (`artifacts.ts`, `build_review` completion: freshness is `fileIsFreshSinceSession` on mtime, then a FAIL aggregate becomes `named-route`). Confidence **90%, basis: verified** by reading the completion predicate and the lap join; the exact 2026-08-20 engine predates #1734 so the precise retry ordering on that day is inferred, but the stale-read hazard exists on every non-publishing exit of the lap join regardless (contract rejection below cap, coordinator `refused`, an allowance-bearing `malformed` artifact).

## Feasibility

| Check | Finding | Basis |
|---|---|---|
| Stack | Pure TypeScript in `src/conductor/src/engine`; no new deps. | verified |
| Prerequisites | The lap id is `lap-${headSha}` of the frozen source snapshot (`step-runners.ts`, `parseBuildReviewLapId`); completion already has `ctx.git ?? makeGitRunner(dir)` and the conductor has `currentCommitSha`. Nothing new is needed to compute the current lap at completion time. | verified |
| Integration surface | `artifacts.ts` (`build_review` completion), `kickback-ledger.ts` (`KickbackGateEntry`, `bumpMechanicalFaults*`), `step-runners.ts` (the mechanical-fault return passes rubric/reason/detail into the bump), `types/events.ts` + `event-sinks.ts` (additive field or member), `conductor.ts` (renders the ledger record in the exhausted halt — already reads the ledger there). One domain, 5 modules. | verified |
| Data | `KickbackGateEntry` gains an optional `lastMechanicalFault: { rubric, reason, detail, lapId }`; ledger validator (`isLedgerEntry`) must accept absent-or-well-formed. No migration; old ledgers parse unchanged. | verified (validator rejects unknown malformed keys — memory: a bare key blocks every land, so the validator change is mandatory, not optional) |
| Performance | One `git rev-parse HEAD` per completion check. Negligible. | verified |
| Worktree isolation | All state is per-worktree `.pipeline/` and the feature-scoped ledger. | verified |

## Alignment

- **`adr-2026-08-18` D1/D3/D4** — routing stays on `result.kind`; no aggregate is published below cap; the allowance counter is the termination proof. D4 already states the counter "records the rubric and closed reason last seen" — the implementation only stores a count, so (b) is D4 as written, plus the bounded `detail` the issue needs. Additive, no amendment.
- **`adr-2026-07-13-retry-classify-rerun-vs-route`** — "Missing / stale / malformed → `absent`". A non-PASS aggregate whose `lapId` ≠ current lap is *stale* verbatim. A fresh FAIL with judged findings stays `named-route`.
- **`adr-2026-07-22-gate-evidence-code-validity-on-redispatch`** — a PASS with a code stamp whose delta misses the gate surface is preserved even though HEAD moved. The guard therefore applies **only to non-PASS aggregates**; the PASS/code-stamp path is untouched and runs first, exactly as it does today. No second sha field is added — `lapId` is already on the aggregate.
- **`adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch`** — build_review is *not* joining the pre-dispatch re-check set; the guard is inside the existing completion predicate only.
- **`adr-2026-08-13-engine-managed-build-review-rubric-branches`** §7 — "never reuses a prior aggregate verdict". The guard enforces that sentence.
- **`adr-2026-07-26-event-sink-registry-exhaustiveness` / `adr-2026-08-11`** — the stale condition is emitted on the spine: prefer an additive `staleLapId`/`currentLapId` field on the existing occurrence if one-to-one; otherwise one new member declared in `EVENT_SINKS` with `persist: true`. Telemetry only (`adr-2026-08-12`: never control). Not a `kickback` event (`adr-2026-07-04`).
- **`adr-2026-08-12`, `adr-2026-08-18-rebase-invalidation-refunds`** — no counter is cleared on PASS; the new record is refunded/cleared with the mechanical allowance by the existing rebase-invalidation path only.
- **Event-spine principle (CLAUDE.md)** — no sidecar file; the record lives in the existing ledger and the existing spine.

**Focused local pattern basis (ledger field):** follow `bumpMechanicalFaults` (`kickback-ledger.ts`, symbols `bumpMechanicalFaults`, `bumpMechanicalFaultsInLedger`, `isLedgerEntry`) — traits: pure entry→entry update, atomic persist, validator accepts absent-or-valid optional fields. Variation allowed: field name/shape. **Event precedent:** `build_review_rubric_infrastructure_failure` (`types/events.ts`, already carries `rubric, lapId, reason, excerpt?`) — the bounded excerpt on the spine already exists; the ledger record is the durable, operator-readable copy.

## Domain Integrity
Handled per-cycle by TDD (Medium tier). Note for stories: `lapId` is already a branded `BuildReviewLapId`; the ledger record must store the parsed value, not free text, and `reason` is the closed `BuildReviewInfrastructureFailureReason` member.

## Wiring Surface
| New/changed surface | Called from (design-time) |
|---|---|
| stale-lapId branch in `build_review` completion (`artifacts.ts`) | the conductor's existing completion check after every `build_review` attempt and the gate re-evaluation that decides kickbacks |
| `lastMechanicalFault` on `KickbackGateEntry` | written by `bumpMechanicalFaultsInLedger` from the lap join's mechanical-fault return in `step-runners.ts`; read by `renderExhaustedMechanicalBuildReviewHalt` in `conductor.ts` and `conduct-ts build-review findings`/status rendering |
| stale-aggregate event field/member | emitted by the completion caller in `conductor.ts`; persisted via `EVENT_SINKS` to `.pipeline/events.jsonl` |

Overlap scan (advisory): `artifacts.ts` overlaps 14 unmerged spec branches (all pre-existing, unrelated regions); `step-runners.ts`, `kickback-ledger.ts` no overlap reported. No collision expected in the `build_review` completion block.

## Risks
| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Guard mis-orders before code-stamp preservation and invalidates a valid PASS | Technical | Low | Medium | Guard only non-PASS aggregates; unit test a stamped PASS with moved HEAD still preserves |
| Ledger validator rejects the new optional field on old/hand-edited ledgers | Data | Low | Medium | absent-or-valid validation; fixture with a legacy entry |
| Current lap cannot be derived at completion (detached/unborn) | Technical | Low | Low | fall through to existing mtime logic; never a PASS |

## ADRs Created
None. No structural decision is made: every seam already exists and every rule applied is an APPROVED ADR cited above. D3's premise gap is recorded here, not as an amendment, because D3's decision text is unchanged.

## Conditions
None.
