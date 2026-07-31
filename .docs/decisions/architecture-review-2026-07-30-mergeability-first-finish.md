# Architecture Review: Mergeability-first daemon finish

**Date:** 2026-07-30
**Tier:** Medium (lightweight review)
**Input reviewed:** `.docs/specs/2026-07-30-mergeability-first-finish.md`
**Verdict:** APPROVED

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | Feasible with the installed Git and existing injected Git runner; no package, service, schema, or account change. |
| Prerequisites | Existing shared base resolution, rebase outcome, verdict, event, and resolver seams are sufficient. |
| Integration surface | Bounded to the shared rebase engine, event type/formatter, tests, and daemon documentation. Both production callers already converge on the shared primitive. |
| Data implications | No schema, migration, backfill, or durable domain-data change. One additive outcome/event is required. |
| Performance | One local prospective-merge process only when the feature is behind its resolved base. Quiet mode permits early exit on conflict. |
| Worktree isolation | The assessment changes no branch ref, index, worktree, or commit history. Parallel feature worktrees remain isolated. |

## Alignment

- **Engine-native determinism:** aligned with the harness rule that Git classification stays
  mechanical. No LLM is introduced on the clean path.
- **Caller-specific intent:** finish owns mergeability skipping; re-kick retains mandatory
  play-forward. Actual rebase and conflict recovery remain shared.
- **Existing recovery boundary:** conflicts and unknown results reuse the current rebase/resolver
  flow, including protected-seal preflight, bounded resolution, commit-preservation checks, and
  HALT.
- **Publication safety:** the existing current-HEAD validation fence remains unchanged. The feature
  changes base-integration satisfaction, not validation freshness.
- **Protected artifacts:** a mergeable skip does not move history, so evidence translation and seal
  rebaselining must not run. Actual rebase behavior remains governed by the approved seal ADR.
- **Diagram accuracy:** the approved feature diagram correctly shows the active-rebase guard,
  shared tri-state decision, recovery branch, and no-rewrite continuation.
- **Provider neutrality:** the implementation is local Git machinery shared by all supported hosts.

## Wiring Surface

| Production surface | Design-time production caller |
|---|---|
| Prospective mergeability classifier | Called only by the finish-time integration policy after base resolution and before rebase preflight. |
| `mergeable_skip` integration outcome | Consumed by the existing verdict application, completion recorder, and outcome event emitter. |
| Mergeable-skip structured event | Emitted through the feature event bus and rendered by the daemon’s operator formatter. |
| Revised finish integration-gate predicate | Recomputed by the engine-native rebase step at normal finish; re-kick bypasses mergeability skip and retains mandatory play-forward rebase. |

Candidate implementation paths for overlap review:

- `src/conductor/src/engine/rebase.ts`
- `src/conductor/src/types/events.ts`
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/engine/rebase.test.ts`
- `src/conductor/test/integration/rebase-loop.test.ts`
- `src/conductor/test/engine/daemon-rekick.test.ts`
- `docs/guides/running-the-daemon.md`
- `docs/runbooks/daemon-rebase-conflict.md`

The advisory scan named the old unmerged branches `spec/647-kickback-evidence-invalidation` and
`spec/651-park-all-dispatch-paths`. The operator directed this plan to ignore both on 2026-07-30.
Neither is a live daemon feature: each lacks a main-branch plan and feature worktree and is hundreds
of commits behind `origin/main`. If either capability remains worthwhile, its spec must be revisited
and refreshed before merge; it should then be operator-parked before its first daemon dispatch.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A classifier error falsely reports a conflicting or indeterminate merge as clean. | Technical | Low | High | Use only documented exit statuses; any non-zero result enters existing recovery; real-Git negative tests cover conflict and error. |
| Finish-only policy leaks into re-kick and omits an unblocking base commit. | Integration | Low | High | Make caller intent explicit and test that re-kick never returns mergeable-skip. |
| A clean skip accidentally triggers rebase-only seal/evidence mutations. | Data integrity | Low | High | Return before rebase preflight/translation and assert those capabilities are not invoked. |
| A target-branch commit lands after the clean assessment. | Integration | Medium | Medium | Accept as normal branch drift; the hosted merge decision remains authoritative at merge time. |
| Merge-level conflict detection differs from per-commit replay conflicts. | Technical | Medium | Medium | Treat any merge conflict only as the trigger for the existing rebase flow; never infer replay details. |

## ADRs Created

- `adr-2026-07-30-mergeability-first-integration-gate` — superseded after conflict-check.
- `adr-2026-07-30-finish-only-mergeability-gate` — **APPROVED** by the operator.

## Verify-Claims Ledger

### Claims

- [verified] Both automatic integration callers currently use `performRebase`, but approved re-kick
  requirements make base inheritance—not mere mergeability—its recovery purpose.
- [verified] Installed Git documents exit `0` for clean prospective merge, `1` for conflicts, and
  another status for inability to complete.
- [verified] Current seal verification, history translation, and actual rebase occur after the
  already-current return seam.
- [verified] Current publication validation has an independent current-HEAD fence governed by the
  approved 2026-07-26 tail ADR.

### Assumptions

- [load-bearing] Mergeability replaces ancestry freshness as the automatic integration criterion.
  - **Status: APPROVED by operator 2026-07-30**
- [load-bearing] Conflicting and indeterminate classifications enter automatic rebase recovery.
  - **Status: APPROVED by operator 2026-07-30**
- [load-bearing] Mergeability skipping is finish-only; re-kick retains mandatory play-forward.
  - **Status: APPROVED by operator during conflict resolution on 2026-07-30**

### Verdict

CLEAR

## Amendment — re-kick play-forward conflict

Conflict-check found that the original shared-policy design would retry a halted gate without
incorporating the advanced-base commit intended to unblock it. The operator approved a finish-only
mergeability policy and the replacement ADR. Architecture remains feasible with an explicit caller
policy.

## Resolved Conditions

- `adr-2026-07-30-finish-only-mergeability-gate` is APPROVED.
- Plan Task 9 keeps re-kick’s mandatory rebase path explicit and independently tested.
