# Architecture Review: Daemon merged-PR guard on step retry (#358)
**Date:** 2026-07-09
**Mode:** Lightweight (Tier M) — feasibility + alignment
**Input reviewed:** GitHub issue jstoup111/ai-conductor#358, approved Approach C, approved
architecture diagrams (`.docs/architecture/2026-07-09-daemon-merged-pr-guard-on-retry.md` + sequence)
**Verdict:** APPROVED

## Feasibility

- **Stack:** no new dependencies. Reuses `prMergeState` (`pr-labels.ts:277`), `makeProductionGh`
  (already consumed in-engine at `artifacts.ts:1180`), the `GhRunner` DI seam for tests, and the
  existing outcome-marker contract (`.pipeline/DONE`, `.pipeline/finish-choice`,
  `conduct-state.json` `pr_url` — `daemon-deps.ts:224-262`). All verified by inspection.
- **Prerequisites:** none — `state.pr_url` is already recorded by the finish/finish-record path;
  the guard simply no-ops when it is absent (first-pass runs that never reached finish).
- **Integration surface:** conductor step loop only (kickback routes + `runRebaseStep`) plus the
  daemon-runner's existing verified-ship path. No schema, CLI, hook, or settings changes —
  no migration block needed.
- **Performance:** one `gh pr view` per kickback re-entry / rebase entry, bounded by
  `MAX_KICKBACKS_PER_GATE`. No polling (complies with the ≥5-min GH cadence rule — these are
  event-driven one-shots).

## Alignment

- **Deterministic-first (CLAUDE.md/HARNESS.md):** the guard is pure engine machinery — no
  prompt discipline, no LLM step. Correct placement of enforcement.
- **Dedup architecture:** complements adr-2026-07-03-committed-shipped-record-dispatch-dedup —
  that ADR covers dispatch/rekick; this covers the mid-run window. The ledger marker
  (`markProcessed`) remains the single local dedup authority; no parallel mechanism added.
- **False-ship guard (#204/#205):** the synthetic verified-ship preserves `isVerifiedShip`
  semantics — `finishChoice='pr'` is only synthesized after a live `MERGED` verdict, so the
  guard strengthens rather than bypasses ship verification.
- **Side-effect ownership:** ship side-effects (`markProcessed`, cleanup, enroll) stay in the
  daemon-runner; the conductor only emits outcome markers. Matches the existing seam exactly.
- **Fail-open:** every non-MERGED verdict (incl. gh failure) proceeds unchanged — the guard can
  never introduce a new HALT class. Rebase HALT behavior for genuinely unmerged branches is
  untouched.
- **Worktree isolation:** no new shared resources, ports, or services; per-worktree markers only.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Local rework commits made after the out-of-band merge are dropped from the pipeline | Data | Low | Medium | Branch never deleted; guard logs `branch retained at <sha>`; operator owns the mid-run merge decision |
| gh outage/rate limit makes the guard silently no-op | Integration | Low | Low | Fail-open by design — behavior degrades to today's (pre-fix) behavior |
| Synthetic finish-choice marker misread as weakening ship verification | Technical | Low | High | ADR documents the invariant (marker only after live MERGED); tests must assert no marker on OPEN/CLOSED/NOTFOUND/UNKNOWN/error |

No High-likelihood risks; one High-impact risk registered above (mitigated, test-gated).

## ADRs Created

- `adr-2026-07-09-mid-run-merged-pr-guard.md` — APPROVED by the operator on 2026-07-09.

## Conditions

None — clean APPROVED once the ADR reaches APPROVED status.
