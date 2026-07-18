# Plan: no build dispatch without attribution state (issue #671)

Tier: S (see `.docs/complexity/build-dispatch-can-start-with-current-task-none-so.md`).
Stories: `.docs/stories/build-dispatch-can-start-with-current-task-none-so.md`.

Conductor code under `src/conductor/`; run vitest from that directory only
(`cd src/conductor && npx vitest run <file>`). Constraint from
`adr-2026-07-11-semantic-attribution-verification-lane.md`: prefer extending existing
markers/readers over adding new hook surfaces.

## Tasks

### Task 1 — RED: dispatch-count telemetry parser distinguishes attributed vs `Task: none`
**Dependencies:** none
In `src/conductor/test/engine/attribution-enforcement.test.ts`: add failing tests for a
new reader (e.g. `readDispatchAttribution(root)`) over `.pipeline/dispatch-count` that
returns `{ attributed: number, unattributed: number, taskIds: string[] }` — lines are the
verbatim `Task: <id>` / `Task: none` strings the PRE hook appends
(session-hook-assets.ts:68-75). Cover: absent file, empty file, all-none, mixed,
malformed lines (Story 2.1, 2.3).
**Files:** src/conductor/test/engine/attribution-enforcement.test.ts

### Task 2 — GREEN: implement the attribution-aware reader
**Dependencies:** Task 1
In `src/conductor/src/engine/attribution-enforcement.ts` (beside `readDispatchCount`,
~90-98): implement the parser. Keep `readDispatchCount` behavior unchanged for existing
callers.
**Files:** src/conductor/src/engine/attribution-enforcement.ts

### Task 3 — RED: unattributed streak surfaces as its own loud reason
**Dependencies:** Task 2
Failing tests (attribution-enforcement.test.ts + conductor wiring test
`src/conductor/test/engine/attribution-conductor-wiring.test.ts`): when a build dispatch
cycle's dispatch-count lines are all `Task: none` (or the unattributed streak meets the
threshold), the engine emits a distinct loud event/reason (e.g.
`unattributed_dispatch`) naming the streak — during/immediately after the dispatch, not
at the evidence gate (Story 1.2, 2.2). Mixed below-threshold cycles stay quiet
(Story 2.3).
**Files:** src/conductor/test/engine/attribution-enforcement.test.ts, src/conductor/test/engine/attribution-conductor-wiring.test.ts

### Task 4 — GREEN: emit the loud unattributed-dispatch signal at the seam
**Dependencies:** Task 3
Wire the check into the build-step dispatch seam in
`src/conductor/src/engine/conductor.ts` (post-dispatch evaluation near the existing
zero-work detection; seam anchors: marker write ~2674-2677, dispatch ~2699-2701,
`detectZeroWorkProduct` consumer). Add the event shape to
`src/conductor/src/types/events.ts` following existing event conventions. Deterministic
only — no LLM involvement.
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/src/types/events.ts

### Task 5 — RED: pre-dispatch attribution-machinery invariant
**Dependencies:** none
Failing tests in `src/conductor/test/engine/attribution-conductor-wiring.test.ts`: with
attribution enforcement configured, a build dispatch fails loudly (clear diagnostic
naming `.pipeline/current-task` / the attribution machinery) when its deterministic
preconditions are violated — task-status not seeded, hooks not installed, or stamp path
unwritable (Story 1.1). Non-build steps and healthy builds unaffected (Story 1.3, 1.4).
**Files:** src/conductor/test/engine/attribution-conductor-wiring.test.ts

### Task 6 — GREEN: enforce the invariant at the dispatch seam
**Dependencies:** Task 5
In `src/conductor/src/engine/conductor.ts` (~2674-2677, beside `writeBuildStepMarker`):
implement the pre-dispatch check. Scope: build step + `isEnforcementConfigured` only;
fail the dispatch (loud, retryable per existing step-retry semantics) rather than
proceeding unattributable. Do NOT change hook abstention behavior
(git-hook-assets.ts:43-56, session-hook-assets.ts abstain paths) — Story 3.
**Files:** src/conductor/src/engine/conductor.ts

### Task 7 — Regression: hook-lane contracts stay intact
**Dependencies:** Task 4, Task 6
Run and, where needed, extend `src/conductor/test/engine/git-hook-assets.test.ts` and
`src/conductor/test/engine/session-hook-assets.test.ts` to pin Story 3: abstention still
exits 0 with no trailer; no code path writes a guessed task id; stamp removal on
uncertainty unchanged.
**Files:** src/conductor/test/engine/git-hook-assets.test.ts, src/conductor/test/engine/session-hook-assets.test.ts

### Task 8 — Docs + CHANGELOG
**Dependencies:** Task 7
CHANGELOG `## [Unreleased]` entry (Fixed): build dispatches can no longer run
attribution-blind — pre-dispatch invariant + loud unattributed-dispatch telemetry;
`Task: none` is an error signal. Update `src/conductor/README.md` attribution section if
it documents dispatch-count.
**Files:** CHANGELOG.md, src/conductor/README.md

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──▶ Task 3 ──▶ Task 4 ──┐
                                          ├─▶ Task 7 ──▶ Task 8
Task 5 ──▶ Task 6 ─────────────────────────┘
```

## Verification

- `cd src/conductor && npx vitest run test/engine/attribution-enforcement.test.ts test/engine/attribution-conductor-wiring.test.ts test/engine/git-hook-assets.test.ts test/engine/session-hook-assets.test.ts`
- Full suite green; `test/test_harness_integrity.sh` passes.
