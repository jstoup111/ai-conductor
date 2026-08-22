# Architecture Review: cached-rubric-verdicts-survive-an-engine-change-so (#1759)
**Date:** 2026-08-21
**Mode:** Lightweight (Medium tier) — §2 Feasibility and §4 Alignment in full
**Stories reviewed:** none yet (pre-stories run); input is `.docs/track/` + explore decision (approach C)
**Verdict:** APPROVED

Scope boundary (binding, from `.docs/track/`): minimal fix plus observability — engine identity in the cache key, named miss reasons, a discard event. No operator clear command, no rollover bulk clear, no dashboard work.

## Feasibility

| Check | Finding | Basis |
|---|---|---|
| Stack | Pure TypeScript in `src/conductor/src/engine`; `node:crypto` already used. No new deps. | verified |
| Prerequisites | None. `versionIdFromEngineDir` (`engine-version-id.ts`) and `computeContentStamp` exist; skill path resolution exists (`skill-resolver.ts` → `skills/<name>/SKILL.md`). | verified |
| Integration surface | `build-review-cache.ts`, `build-review-coordinator.ts`, `step-runners.ts` (dispatch site ~L1788), `types/events.ts`, `event-sinks.ts`; optional read-side in `report-renderer.ts`/`build-tail-rollup.ts` counters. 5 modules, one domain. | verified |
| Data | Cache entry schema gains an optional-on-read, required-on-write `engineIdentity`. No migration; legacy misses closed with a named reason (D4). | verified |
| Performance | One sha256 of a ~10–30 KB file per rubric per dispatch. Negligible. | inferred, 95% |
| Worktree isolation | Cache lives under each worktree's `.pipeline/`; no shared state. | verified |

**Key engine facts verified for the plan:** `StepRunners` has no engine-dir/version plumbing today (0 refs); the only in-process sources are `dirname(fileURLToPath(import.meta.url))` (daemon-lock.ts, shipped-record-cli.ts) and `CONDUCT_ENGINE_SELF_VERSION` set by `selfGuardEnv()`. The engine never reads SKILL.md itself — the provider loads it via `renderAuxiliarySkillInvocation`. `parseBuildReviewCacheEntryCandidate` enforces an exact key set, so the staged parse in D4 is a deliberate change to that rule. No test pins the `policyFingerprint` input set.

**Focused local pattern basis:** for the new event, follow adr-2026-08-16 D7's shape — an additive `ConductorEvent` variant declared in `EVENT_SINKS` (`event-sinks.ts`, symbol `EVENT_SINKS`; precedent entry `build_review_disposition_version_invalidated`). Traits to preserve: typed payload on the union, total sink declaration, `audit: true`. Variation allowed: payload fields.

## Complexity
Done by explore: Tier M.

## Alignment

Full `.docs/decisions/` sweep (every ADR read). Governing decisions and disposition:

- **adr-2026-08-13 §7** (cache identity) — amended additively; note recorded beside §7 pointing at the new ADR.
- **adr-2026-08-19 D3** — cost reversal named in the new ADR; no supersession needed.
- **adr-2026-08-16 D4/D7** — complies: skill digest is a cache lever only; discards surface as an event.
- **adr-2026-08-18 D2/D7** — complies: distinct closed miss reasons; engine identity kept out of disposition keys.
- **adr-2026-07-26** — complies: `EVENT_SINKS` total record forces the declaration.
- **adr-2026-07-03** — complies via content-stamp-only keying.
- **adr-2026-07-25 D5 / operator ruling 2026-08-15** — engine stamp is not provenance under their own wording (identifies the verifier, not rebase/rerun-volatile); timestamp half excluded to honour "execution timing".
- **Event spine principle (CLAUDE.md / event-spine skill)** — a log line alone would be a parallel channel; D5 rides the spine.
- **Machinery principle** — deterministic invalidation at the cache seam, no prompt rule.

State: miss reasons remain a closed union (no boolean flags). Production DI: none introduced. Security: none.

## Domain Integrity
Skipped (Medium tier; TDD domain reviewer per cycle). Note for stories: `engineStamp` and `skillDigest` should be branded/validated strings, not bare `string`, parsed at the cache boundary.

## Wiring Surface
| New surface | Called from |
|---|---|
| `resolveBuildReviewEngineIdentity()` (new helper) | `step-runners.ts` build_review runner, immediately before `coordinateBuildReviewRubrics`; result passed as coordinator input (D6) |
| `engineIdentity` on `BuildReviewCacheLookup` / `BuildReviewCacheEntry` | `classifyBuildReviewCacheLookup` and `writeBuildReviewCacheEntry` via the coordinator's `readCache`/`writeCache` |
| Miss reasons `engine-version-mismatch`, `skill-digest-mismatch` | `classifyBuildReviewCacheLookup`; mapped in the coordinator's miss branch |
| `build_review_cache_discarded` event | emitted by the coordinator on those two reasons; declared in `EVENT_SINKS`; persisted by `EventPersister`; rendered to daemon log |
| Unreadable SKILL.md → existing reason `cache-read-failed` (detail names the path) | coordinator infrastructure-failure branch, existing `build_review_rubric_infrastructure_failure` event |

Early overlap scan: see `.pipeline/overlap-scan` output attached to the session (advisory).

## Risks
| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Skill path resolves to a different file than the provider actually loads (override dirs) | Integration | Low | Medium | Resolve through `skill-resolver.ts`, the same seam the provider invocation uses; story asserts the path |
| Staged parse accidentally accepts malformed `engineIdentity` | Data | Low | Medium | Optional-absent vs present-malformed are distinct branches with tests |
| Cache churn after every engine content change | Performance | Certain | Low | Accepted by operator; content-stamp keying avoids identical-republish churn |

## ADRs Created
- `adr-2026-08-21-engine-identity-in-build-review-cache-key` — **APPROVED** (operator ruled on all four load-bearing choices interactively: content-stamp-only key, `dev` sentinel, staged legacy parse, raw-bytes skill digest).
- Amendment note added to `adr-2026-08-13-engine-managed-build-review-rubric-branches` §7.

## Conditions
None.
