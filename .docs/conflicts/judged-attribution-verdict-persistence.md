# Conflict-check: judged-attribution-verdict-persistence

**Source:** jstoup111/ai-conductor#581 · **Track:** technical · **Tier:** M
**Result:** PASS (with sequencing notes)

This fix edits the attribution/completion hot path shared by an active cluster of
attribution work. Conflicts are structural (same functions) and semantic (same
invariants). None are contradictory; each has a resolution or sequencing note.

## Stories analyzed

Stories 1-5 (this spec). No internal contradictions: Story 1 (advance on satisfied)
and Story 2 (refuse on non-satisfied) partition on the verdict value; Story 4 guards the
re-check so it only fires on real stamps; Story 3 and Story 5 are orthogonal derivation
rules. State transitions are monotonic (a task moves pending→completed only via a real
stamp; never demoted by this change).

## Cross-feature conflicts

| # | Overlapping work | Surface | Nature | Resolution |
|---|---|---|---|---|
| C1 | **#570** isZeroWork suppression | `attribution-lane.ts:377`, `conductor.ts:1935-1948` | Adjacent: #570 gates *whether* the judge runs; this gates *what happens to its output*. | No conflict — complementary. This change lives after the dispatch/zero-work guard. Keep the `!isZeroWork` condition intact; do not stamp when the lane was suppressed. |
| C2 | **#576** wrong `Task:` trailers | `deriveCompletionInternal` path-corroboration (`autoheal.ts:709`) | Semantic: #576 produces the mis-attributed trailers that make the precedence rule (Story 3) necessary. | Depend-on, not conflict. Story 3's precedence fix is correct regardless of #576's outcome; if #576 lands first and fixes trailers, Story 3 becomes a belt-and-suspenders guard (still valid). Do not remove the precedence rule assuming #576 fixes all cases. |
| C3 | **#530 / #529** finish-step machinery | `conductor.ts` gate/finish flow | Structural: edits near the same completion block. | Sequencing. This change is confined to the build gate-miss branch (1863-2012); it must not alter the finish-step path. Rebase on latest main; re-assert the 2012 decision site after merge of #530/#529. |
| C4 | **#520** judge lane (base) | `attribution-lane.ts`, `task-evidence.ts`, `conductor.ts:1953` | Extends #520 without changing its contract. | No conflict — additive. `runAttributionLane` already returns `stampedTaskIds`; this change consumes that existing return value. `writeJudgedStamps` unchanged. |
| C5 | Spot-audit advisory path | `attribution-audit.ts`, `conductor.ts:3437` | Boundary: must stay observational. | Explicit non-goal. This change must NOT make the spot-audit stamp. Assert the audit boundary is untouched. |

## Resource / state contention

- **`.pipeline/task-evidence.json`** — written by the lane (`writeJudgedStamps`) and by
  `deriveCompletion`. The in-cycle re-check reads task-status *after* the lane's reconcile,
  so ordering is: derive (1893) → lane stamp+reconcile (1953) → re-check (new, before 2012).
  No new writer added; no torn-read risk beyond the existing atomic sidecar write.
- **`.pipeline/task-status.json`** — advanced form-agnostically by
  `reconcileStatusFromStamps` (already called inside `writeJudgedStamps`). The re-check
  reads it; no concurrent writer within the single-threaded gate loop.

## Sequencing recommendation

Safe to build independently. If #576 or #530/#529 merge first, rebase and re-verify the
`conductor.ts:2012` decision site and the `autoheal.ts:709` path-corroboration branch are
still at the anchors named in the plan before applying edits.
