# Conflict Check: Mid-loop `.pipeline` wipe fix (ai-conductor#549)

**Date:** 2026-07-11
**Stories checked:** `.docs/stories/mid-loop-pipeline-wipe-549.md` (Stories 1–7)
**Scope:** intra-story pairs + existing conductor behavior + in-flight/shipped specs that
touch `.pipeline`, the crash/HALT handler, session markers, task-status/evidence, or the
self-build sandbox.
**Verdict:** PASS (0 blocking, 1 degrading/coordination note accepted)

## Intra-story scan (all 21 pairs)

The 7 stories partition the fix by guarantee (D1 write / D1 crash-handler / D1 reads / Guard 3
regression / D2 scoped-delete / D3 loud-recreate / outcome-4 negative). They are layers of one
coherent policy, not competing behaviors. Checked for all five conflict types:

- **Contradiction:** none. No two stories require opposite behavior on the same marker/file.
  Story 1 (ensure-dir before write) and Story 7 (pre-run sweep clears 2 markers) act at
  different lifecycle points (mid-run write vs run-start sweep) — see coordination note below,
  confirmed non-contradictory.
- **Behavioral overlap:** Stories 1/3/6 all touch the `session-created` write/read/recreate
  neighborhood, but each owns a distinct verb (write-ensure / read-guard / mid-run-recreate-log)
  and they compose: recreate (6) → write succeeds (1) → later read guarded (3). Complementary.
- **State conflict:** none. Story 2's crash-handler reorder and Story 6's loud-recreate both
  aim at the same invariant (never crash, never silently proceed on empty state) and agree.
- **Resource contention:** the `.pipeline` root is the shared resource; Story 5 is precisely
  the rule that removes contention (no actor deletes the root). It reinforces, not conflicts
  with, every other story.
- **Sequencing:** none. No story assumes it runs before another; the regression test (Story 4)
  exercises the composed behavior of 1/2/5/6.

## Cross-surface scan (against existing/in-flight work)

| Surface | Story | Interaction | Verdict |
|---|---|---|---|
| #505 build-step-active clearing (`clearStaleMarker`, task-seed.ts) | 5, 6 | `clearStaleMarker` already scoped to the single `build-step-active` marker; Story 5's "no cleanup removes the root" rule *endorses* it. Story 6 recreates the root, never clears markers. | No conflict (reinforcing) |
| `resetSession` marker unlink (step-runners.ts:517-529) | 1, 3 | `resetSession` unlinks `session-created`/`conduct-session-id` with a guarded `.catch`. Story 1 (ensure-dir before write) and Story 3 (guarded reads) match its already-defensive style; no rewrite of resetSession semantics. | No conflict |
| daemon-cli pre-run sweep (daemon-cli.ts:621-627) | 1, 7 | The sweep runs at run START and removes the 2 marker *files* after the conductor `mkdir`s `.pipeline`. Story 1's ensure-dir is a MID-RUN guard (dir already exists at start). They never race: sweep clears files, ensure-dir creates the parent only if wiped later. Story 7 explicitly pins the sweep's behavior unchanged. | No conflict (Story 7 protects it) |
| Crash/HALT terminal-marker guarantee + sandbox teardown (conductor.ts:3211-3226 + finally) | 2 | Story 2 reorders `mkdir` before `writeState`; `HALT` is still written after the mkdir, so "HALT is the guaranteed terminal marker" holds. The `finally` sandbox teardown (`/tmp` configDir) runs after and is untouched. | No conflict (invariant preserved) |
| engine-owned task-status (adr-2026-07-05), session-hook-task-stamping (adr-2026-07-10) | 4 | Story 4 asserts `task-status.json`/`task-evidence.json` SURVIVE the kickback — it does not change WHO writes them. It *protects* the engine-owned files those ADRs established. | No conflict (complementary) |
| In-flight #520/#530/#532/#543 verdict-aware-resume / finish-engine-machinery | 4 | These change *which step* resume lands on across the finish→build kickback (#532 = backward-only clamp in selector.ts, PR #543). Story 4 pins *state-file survival* across that transition, which is orthogonal to step selection. | **Degrading/coordination note** (below) |

## Coordination note (degrading — accepted)

**Stories involved:** Story 4 (regression test) vs in-flight #532/#543 verdict-aware resume.
**Type:** overlap · **Severity:** degrading (non-blocking).
**Description:** Both ride the finish→build kickback transition. #532/#543 alter the resume
*target step* (backward-only clamp in `selector.ts`); Story 4 asserts `.pipeline` run-state
*survives* the transition. These do not contradict, but a naively-written Story-4 regression
test that asserts "resume lands on step X" could become brittle when #532/#543 merge and change
the landed step.
**Resolution (accepted):** Story 4's test MUST assert **state-file survival + no-ENOENT-crash**,
NOT a specific resume-target step. This keeps it decoupled from #532/#543's selector changes.
Recorded here and reflected in the plan's Story-4 task guidance; no story text change needed
(Story 4 already frames its assertions around state survival, not step selection). No ADR
supersession required.

## Recommendation

Proceed to `/plan`. Zero blocking conflicts. The one degrading item is a test-construction
constraint on Story 4 (assert state survival, not resume-target), already satisfied by the
story's framing and carried into the plan.
