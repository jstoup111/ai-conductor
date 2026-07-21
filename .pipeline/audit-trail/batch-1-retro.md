# Batch 1 Retro — build-progress-marker-stays-0-n-for-the-whole-buil (#757)

**Date:** 2026-07-21
**Tier:** Small (single batch, 13 tasks)
**Evaluator verdict:** APPROVE (0 critical/important, 2 minor non-blocking findings)

## Spec Compliance
All 13 acceptance criteria met. Evaluator confirmed the daemon build progress counter
now derives live from git instead of staying frozen at 0/N for the whole build.

## Duplication
2 minor findings, not blocking:
- Repeated inline fallback expression in `computeResolved`.
- Broad `catch {}` in `computeResolved` that could mask a genuine `deriveCompletion`
  regression as a silent fallback — judged acceptable since it's a best-effort probe.

## Complexity
Low — change is confined to the `computeResolved` helper plus its wiring into the
existing watcher/gate reconciliation path. No new abstractions introduced.

## Gate Accuracy
Evaluator caught real minor issues (see Duplication above) with no false positives
and no false negatives. Gate signal was trustworthy for this batch.

## Autonomy Friction
2 of 13 task dispatches (Task 3 and Task 11) stalled mid-run with no commit landed
on the first attempt and required a manual retry. Root cause: nested sub-agent
dispatches inside the TDD agent lost the line-1 `Task:` stamp and got blocked by the
mutation-gate hook. Both succeeded on retry.

**Recommendation for future runs:** instruct TDD subagents explicitly not to spawn
their own nested sub-agents for RED/GREEN steps — do the edits directly instead.

## Tests
179 vitest tests pass (`build-progress-watcher.test.ts` 38, `autoheal.test.ts` 141).
Harness integrity 177/177.
