# Complexity: Test files outside test/-style paths are silently out of testQuality scope (#2807)

**Issue:** #2807
**Plan stem:** `test-files-outside-test-style-paths-are-silently-o`

Tier: S

## Signals

| Signal | Reading |
|--------|---------|
| New models / schemas | One optional field on the in-memory `BuildReviewTestQualityScope` (`src/conductor/src/engine/build-review-inputs.ts:212`) and one additive optional field on the existing `build_review_scope_summary` event (`src/conductor/src/types/events.ts:691`). No new event variant, ledger, or persisted artifact. |
| Integrations | None external. Internal call sites: `build-review-inputs.ts` (scope assembly), `build-review-test-quality-preflight.ts` (path classification), `step-runners.ts` (preflight entry), `build-review-coordinator.ts` (scope summary), `gate-invalidation.ts` (shared predicate re-export used by `rebase.ts` and `autoresolve.ts`). |
| Auth / secrets | None. |
| State machines | None. |
| Story count | 3. Within the S ceiling of 5. |

## Rationale

**Small.** One subsystem (build_review testQuality scope) plus a predicate consolidation; 4 plan
tasks. No architecture decision beyond reusing the existing analyzer, preflight seam, and event
spine variant, so no ADR, diagram, conflict-check, or coherence artifact is required.

Not Medium: no new component or seam, no cross-spec reconciliation, and the event change is an
additive optional field on an existing variant (the event-spine skill's sanctioned extension form).
