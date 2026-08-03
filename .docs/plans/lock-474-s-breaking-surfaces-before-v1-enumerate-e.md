# Implementation plan: v1 interface lock for parallel task-stream dispatch (#552)

**Feature:** lock-474-s-breaking-surfaces-before-v1-enumerate-e
**Tier:** L
**ADR:** `adr-2026-08-02-v1-parallel-dispatch-surface-lock` (APPROVED)
**Stories:** `.docs/stories/lock-474-s-breaking-surfaces-before-v1-enumerate-e.md`
**Scope:** ship the enforcement that makes each pinned surface real. This plan does **not**
implement #474 — no stream detection, no concurrent dispatch, no overlap veto engine.

---

### Task 1: Freeze the `current-task` stamp format and reserve the lanes path

**Story:** Story 1 — `.pipeline/current-task` format is frozen and means unique-or-absent

**Type:** infrastructure

**Steps:**
1. Add a test asserting the stamp written by `runTaskStart` is exactly `<id>` with no
   trailing byte, and a test asserting a stamp with surrounding whitespace is rejected rather
   than trimmed by the reader.
2. Add a test asserting `.pipeline/lanes/` does not exist after a full build run, and a test
   asserting `prepare-commit-msg` abstains (exit 0, no trailer) when the stamp is absent.
3. Run the focused tests and verify the whitespace-rejection assertion fails (RED).
4. Implement the exact-format reader guard; leave the writer byte-for-byte unchanged.
5. Document the unique-or-absent contract and the reserved `.pipeline/lanes/` path in
   `docs/reference/artifacts.md`.
6. Run the focused tests and verify they pass (GREEN).
7. Run `test/test_harness_integrity.sh`.
8. Commit with message: `test: freeze current-task stamp format and reserve lanes path`.

**Files:**
- `src/conductor/src/engine/task-cli.ts`
- `src/conductor/test/engine/task-cli.test.ts`
- `src/conductor/test/engine/git-hook-behavior.test.ts`
- `docs/reference/artifacts.md`

**Wired-into:** `runTaskStart` stamp writer and the `prepare-commit-msg` abstain path — both
already production-reachable; this task pins their format rather than adding a surface.

**Dependencies:** none

---

### Task 2: Reject parallel-branch names that make a synthetic state key ambiguous

**Story:** Story 2 — Parallel-branch names cannot make a synthetic state key ambiguous

**Type:** negative-path

**Steps:**
1. Add config tests asserting branch names `a__b`, empty, `a b`, and `a/b` are each rejected
   at load with the offending name and the permitted charset in the message; assert `alpha`,
   `lock-2`, `v1.2` load and yield keys `build__alpha`, `build__lock-2`, `build__v1.2`; assert
   a config with no `parallel` block is unaffected.
2. Run the focused config tests and verify the rejection assertions fail (RED).
3. Implement the `[A-Za-z0-9.-]+` validation for `ParallelBranch.name` inside the existing
   `steps.<name>` validation path, as a hard error consistent with the surrounding fail-closed
   rules.
4. Add the `CHANGELOG.md` `[Unreleased]` entry recording the tightening as a behavior change
   for existing configs, per the ADR's escalation section.
5. Document the charset on the `parallel` branch name in `docs/reference/configuration.md`.
6. Run the focused config tests and verify they pass (GREEN).
7. Run `test/test_harness_integrity.sh`.
8. Commit with message: `fix(config): validate parallel branch names against key ambiguity`.

**Files:**
- `src/conductor/src/engine/config.ts`
- `src/conductor/src/types/config.ts`
- `src/conductor/test/engine/config.test.ts`
- `docs/reference/configuration.md`
- `CHANGELOG.md`

**Wired-into:** `validateConfig`'s `steps.<name>` branch, which every config load already
traverses.

**Dependencies:** none

---

### Task 3: Pin task-status row tolerance for fields a future engine adds

**Story:** Story 3 — `task-status.json` rows tolerate fields a future engine adds

**Type:** happy-path

**Steps:**
1. Add a test seeding a `task-status.json` whose rows carry an unrecognized field, asserting
   the field survives a `seedTaskStatus` round-trip verbatim on every surviving row. Use a
   field name that is not `files` — spec PR #1262 makes `files` a known engine-written field
   (conflict-check C2).
2. Add a test asserting `normalizeTasks` ignores the unknown field while resolving known
   fields unchanged, and a test asserting a wrong-shaped file (not an object, or `tasks` not
   an array) still fails or abstains exactly as today.
3. Run the focused tests and verify the round-trip assertion fails if tolerance regresses (RED
   is established by temporarily asserting against the current behavior, then keeping the
   guard).
4. Make no production change unless a test proves a gap; the index signatures already provide
   the tolerance. If a gap exists, close it in `task-seed.ts` without widening the accepted
   file shape.
5. Record in `docs/reference/artifacts.md` that unknown row fields are preserved across a seed.
6. Run the focused tests and verify they pass (GREEN).
7. Run `test/test_harness_integrity.sh`.
8. Commit with message: `test: pin task-status unknown-field tolerance`.

**Files:**
- `src/conductor/src/engine/task-seed.ts`
- `src/conductor/test/engine/task-seed.test.ts`
- `docs/reference/artifacts.md`

**Wired-into:** `seedTaskStatus`, invoked on every build-gate evaluation and build preflight.

**Dependencies:** none

---

### Task 4: Add the plural task-id telemetry field and correct the scalar's meaning

**Story:** Story 4 — Build-progress telemetry gains a plural without changing its scalar's type

**Type:** happy-path

**Steps:**
1. Add tests over `BuildProgressSnapshot` for the zero-row, one-row, and two-row cases,
   asserting `currentTaskId` is the id / absent / **absent**, and `currentTaskIds` is empty /
   one element / every in-flight id in file order.
2. Add a test asserting the renderer and OTEL span attributes are byte-identical to today in
   the single-task case.
3. Run the focused tests and verify the two-row assertion fails (RED) — today the first
   `in_progress` row wins.
4. Add `currentTaskIds?: string[]` to the snapshot and event types; change the scalar's
   derivation to unique-or-absent. Keep the scalar's type unchanged.
5. Surface `currentTaskIds` in the renderer and the daemon dashboard when more than one task
   is in flight, so the operator sees the in-flight set instead of a blank field.
6. Update `docs/reference/artifacts.md` and the events reference for both fields.
7. Run the focused tests and verify they pass (GREEN).
8. Run `test/test_harness_integrity.sh`.
9. Commit with message: `feat(telemetry): report in-flight task set alongside the scalar id`.

**Files:**
- `src/conductor/src/engine/build-progress-watcher.ts`
- `src/conductor/src/types/events.ts`
- `src/conductor/src/ui/create-renderer.ts`
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/src/engine/otel/span-manager.ts`
- `src/conductor/test/engine/build-progress-watcher.test.ts`
- `docs/reference/artifacts.md`

**Wired-into:** `BuildProgressSnapshot` → the build-progress event stream, `create-renderer`,
the daemon dashboard, and OTEL span attributes — all four already consume the scalar.

**Dependencies:** Task 3

---

### Task 5: Make the evidence counters single-writer and pin them as build-scoped

**Story:** Story 5 — Evidence counters stay build-scoped and stop losing updates

**Type:** negative-path

**Steps:**
1. Add a test driving two concurrent `incrementNoEvidenceAttempts` calls and asserting the
   persisted count is 2; add a test asserting sequential increments still accumulate; add a
   test asserting the corrupt-sidecar path still warns and continues with empty state.
2. Run the focused tests and verify the concurrent assertion fails (RED) — today's
   read-modify-write loses one increment.
3. Serialize the counter mutations through a single writer, reusing the existing
   `.pipeline/.task-status.lock` mkdir-mutex pattern rather than introducing a second
   locking discipline.
4. Leave `evidenceStamps` and the file's shape untouched.
5. Record in `docs/reference/artifacts.md` that these counters are build-scoped and are never
   widened per lane.
6. Run the focused tests and verify they pass (GREEN).
7. Run `test/test_harness_integrity.sh`.
8. Commit with message: `fix(evidence): serialize no-evidence counter mutations`.

**Files:**
- `src/conductor/src/engine/task-evidence.ts`
- `src/conductor/test/engine/task-evidence.test.ts`
- `docs/reference/artifacts.md`

**Wired-into:** `incrementNoEvidenceAttempts` / `resetNoEvidenceAttempts`, called from the
conductor's build loop and the daemon auto-park evidence path.

**Dependencies:** none

---

### Task 6: Freeze the dispatch-count grammar and reserve the correlation sidecar

**Story:** Story 6 — `dispatch-count` line grammar is frozen; correlation goes to a reserved sidecar

**Type:** infrastructure

**Steps:**
1. Add a test asserting every line the pre-dispatch hook appends is exactly `Task: <id>` or
   `Task: none`, and that `readDispatchAttribution` classifies both cases as today.
2. Add a test asserting no engine code path produces a line carrying a trailing field beyond
   the id, and a test asserting `.pipeline/dispatch-log.jsonl` is absent after a full build.
3. Add a test asserting an unparseable hook payload appends no line at all.
4. Run the focused tests and verify the grammar-freeze assertions hold (RED established by
   asserting against a deliberately widened line in a fixture, which must be rejected).
5. Make no production change to the hook or reader; this task pins the contract.
6. Record the frozen grammar and the reserved `.pipeline/dispatch-log.jsonl` path in
   `docs/reference/artifacts.md`.
7. Run the focused tests and verify they pass (GREEN).
8. Run `test/test_harness_integrity.sh`.
9. Commit with message: `test: freeze dispatch-count grammar and reserve correlation sidecar`.

**Files:**
- `src/conductor/src/engine/attribution-telemetry.ts`
- `src/conductor/test/engine/attribution-conductor-wiring.test.ts`
- `src/conductor/test/engine/session-hook-behavior.test.ts`
- `docs/reference/artifacts.md`

**Wired-into:** the `PRE_DISPATCH_HOOK` writer and `readDispatchAttribution`, which the
conductor already calls after every build step to emit `unattributed_dispatch`.

**Dependencies:** none

---

### Task 7: Pin `phase-active` as worktree-global so the shipped hooks never change

**Story:** Story 7 — `.pipeline/phase-active` stays worktree-global so the shipped hooks never change

**Type:** infrastructure

**Steps:**
1. Add a test asserting the marker is a single line-oriented file with `step:`, `phase:`,
   `written:` and zero or more `allow:` lines, parseable without a JSON parser.
2. Add a test asserting multiple allow prefixes union rather than replace, and that
   `hooks/claude/docs-guard.sh` permits a path matching any of them.
3. Add a test asserting docs-guard still blocks a path matching no prefix, and permits when
   the marker is absent.
4. Run the focused tests and verify the union assertion fails if prefixes ever replace (RED).
5. Make no change to `hooks/claude/docs-guard.sh` — the test's purpose is to prove none is
   needed. Adjust `phase-marker.ts` only if the union behavior is not already exact.
6. Record in `docs/reference/settings-and-hooks.md` that the marker is worktree-global and
   never lane-scoped.
7. Run the focused tests and verify they pass (GREEN).
8. Run `test/test_harness_integrity.sh`.
9. Commit with message: `test: pin phase-active as worktree-global with union allow prefixes`.

**Files:**
- `src/conductor/src/engine/phase-marker.ts`
- `src/conductor/test/engine/phase-marker.test.ts`
- `docs/reference/settings-and-hooks.md`

**Wired-into:** `writePhaseMarker`, whose output `hooks/claude/docs-guard.sh` reads on every
`Edit`/`Write`/`NotebookEdit` during an active phase.

**Dependencies:** none

---

### Task 8: Parse `**Dependencies:**` values under a pinned grammar with a fail-safe

**Story:** Story 8 — `**Dependencies:**` values gain a pinned grammar with a fail-safe parser

**Type:** happy-path

**Steps:**
1. Add parser tests covering `none`, `Task 1, Task 3`, `T`-prefixed ids, free prose, a missing
   line, and a dependency naming an id absent from the plan — asserting the fail-safe
   "depends on every prior task" result in every non-conforming case.
2. Add a test asserting no plan input causes a parse error, and a test asserting
   `planHasDependencyTree` and daemon-backlog eligibility are unchanged for every existing
   fixture plan.
3. Run the focused tests and verify they fail (RED) — no value parser exists today.
4. Implement `parsePlanTaskDependencies` in `plan-task-parse.ts` beside the existing
   `parsePlanTaskPaths`, reusing `canonicalTaskId` so `T3` and `3` resolve identically. The
   function has no failing exit: non-conforming input yields the sequential fallback.
5. Emit a non-blocking lint warning for non-conforming values so plan authors converge on the
   grammar; it must never block a build or a land.
6. State the pinned grammar in `skills/plan/SKILL.md` and record it plus the fail-safe rule in
   `docs/reference/artifacts.md`.
7. Run the focused tests and verify they pass (GREEN).
8. Run `test/test_harness_integrity.sh`.
9. Commit with message: `feat(plan): parse dependency edges with a sequential fail-safe`.

**Files:**
- `src/conductor/src/engine/plan-task-parse.ts`
- `src/conductor/test/engine/plan-task-parse.test.ts`
- `skills/plan/SKILL.md`
- `docs/reference/artifacts.md`

**Wired-into:** `plan-task-parse.ts`'s exported parser surface, alongside `parsePlanTaskPaths`;
the lint warning surfaces through the existing plan-gate reason path.

**Dependencies:** none

---

### Task 9: Pin the undeclared-file-set veto rule

**Story:** Story 9 — An undeclared file set vetoes parallelism rather than permitting it

**Type:** negative-path

**Steps:**
1. Add tests asserting disjoint declared sets are non-overlapping, shared paths overlap, a
   task with no declared files overlaps every other task, and a plan where no task declares
   files is wholly sequential.
2. Add a test asserting `parsePlanTaskPaths` behavior and its four current consumers are
   unchanged.
3. Run the focused tests and verify the empty-set assertions fail (RED).
4. Implement the veto predicate as a pure function beside `parsePlanTaskPaths`, treating an
   empty declared set as overlapping everything. Do **not** make the `Files:` block mandatory
   and do not change the existing parser.
5. State in `skills/plan/SKILL.md` that omitting the Files block forfeits parallel eligibility.
6. Run the focused tests and verify they pass (GREEN).
7. Run `test/test_harness_integrity.sh`.
8. Commit with message: `feat(plan): pin undeclared file sets as overlap-vetoing`.

**Files:**
- `src/conductor/src/engine/plan-task-parse.ts`
- `src/conductor/test/engine/plan-task-parse.test.ts`
- `skills/plan/SKILL.md`

**Wired-into:** the same exported parser surface as Task 8; consumed by #474 post-v1 and by
the lint added in Task 8.

**Dependencies:** Task 8

---

### Task 10: Reserve `build_concurrency` and pin `validation_concurrency`

**Story:** Story 10 — The concurrency config surface is pinned and its successor key reserved

**Type:** infrastructure

**Steps:**
1. Add config tests asserting `build_concurrency: 3` validates and changes no behavior, that a
   non-number value is a hard type error, that a config setting neither key resolves defaults
   exactly as today, and that `validation_concurrency`'s name, default of 2, and resolver are
   unchanged.
2. Run the focused config tests and verify the `build_concurrency` assertions fail (RED) —
   unknown top-level keys are a hard load error today.
3. Add `build_concurrency` to `knownTopLevelKeys` with number type-validation and no consumer
   and no materialized default.
4. Document it in `docs/reference/configuration.md` as reserved for #474 with no current
   consumer, beside the existing `validation_concurrency` entry.
5. Run the focused config tests and verify they pass (GREEN).
6. Run `test/test_harness_integrity.sh`.
7. Commit with message: `feat(config): reserve build_concurrency for post-v1 dispatch`.

**Files:**
- `src/conductor/src/engine/config.ts`
- `src/conductor/src/types/config.ts`
- `src/conductor/test/engine/config.test.ts`
- `docs/reference/configuration.md`

**Wired-into:** `knownTopLevelKeys` and `validateConfig`, traversed on every config load.

**Dependencies:** Task 2

---

### Task 11: Pin the `conduct-ts task` CLI contract

**Story:** Story 11 — The `conduct-ts task` CLI contract is frozen

**Type:** negative-path

**Steps:**
1. Add tests pinning `task start <id>` (row flips to `in_progress`, stamp written, exit 0) and
   `task done <id>` (stamp removed, exit 0, `task-status.json` untouched).
2. Add tests pinning the mismatch case (`cannot clear task <id>; current stamp is <other>`,
   exit 1, stamp untouched), the absent-stamp idempotent exit 0, and the unknown-verb /
   missing-id guide-to-stderr exit 2.
3. Add a test asserting the id charset `[A-Za-z0-9._-]+` is enforced unchanged.
4. Run the focused tests and verify they pass against current behavior, then confirm each
   fails when its assertion is inverted (the pin is real, not vacuous).
5. Reconcile `docs/reference/cli.md`'s `conduct-ts task` section with the pinned behavior.
6. Run `test/test_harness_integrity.sh`.
7. Commit with message: `test: pin conduct-ts task CLI contract`.

**Files:**
- `src/conductor/src/engine/task-cli.ts`
- `src/conductor/test/engine/task-cli.test.ts`
- `docs/reference/cli.md`

**Wired-into:** the `conduct-ts task` CLI dispatch in `index.ts` — an existing production
entrypoint; this task adds no verb.

**Dependencies:** Task 1

---

## Task Dependency Graph

```
Task 1 ──▶ Task 11
Task 2 ──▶ Task 10
Task 3 ──▶ Task 4
Task 8 ──▶ Task 9
Task 5   (independent)
Task 6   (independent)
Task 7   (independent)
```

Independent streams: {1, 11}, {2, 10}, {3, 4}, {8, 9}, {5}, {6}, {7}.

## Verification checklist

- [ ] Every ADR surface S1–S14 has a task or is explicitly recorded as needing no v1 code.
- [ ] No task implements stream detection, concurrent dispatch, or an overlap veto engine.
- [ ] Dependencies are explicit and acyclic.
- [ ] The one breaking-in-v1 tightening (Task 2) carries its `CHANGELOG.md` entry.
- [ ] No task modifies any file under `hooks/`, `settings.json`, `bin/conduct`, or
      `bin/install` — so the release gate's canonical breaking surfaces stay untripped.
