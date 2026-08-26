# Implementation Plan: A committed, pushed halt record

**Date:** 2026-08-23
**Design:** .docs/decisions/adr-2026-08-23-committed-halt-record.md
**Stories:** .docs/stories/a-halt-leaves-no-committed-pushed-record-for-the-o.md
**Conflict check:** .docs/conflicts/a-halt-leaves-no-committed-pushed-record-for-the-o.md
**Tier:** M
**Source:** jstoup111/ai-conductor#1809

## Summary

Adds `.docs/halted/<slug>.md`, a git-tracked halt record produced at the single `writeHaltMarker`
seam for every non-`mechanical` halt, committed path-scoped under the engine-commit exemption and
pushed best-effort, superseded to `Status: resolved` at the existing halt-clear call site, with
three additive `ConductorEvent` members for its own write and push outcomes. 11 tasks.

## Technical Approach

- **New module `halt-record.ts`.** Holds the path constant `HALT_RECORD_DIR = '.docs/halted'`, a
  pure `renderHaltRecord(input): string`, a pure `supersedeHaltRecordText(text, resolution): string`,
  and the two effectful entry points `recordHalt()` / `supersedeHaltRecord()`. Shaped after
  `halt-marker.ts` (single source of truth for its path constant) and after
  `shipped-record-cli.ts` for its git discipline.
- **Result type, never an exception.** Both entry points return a discriminated result
  (`written` / `noop` / `skipped` / `failed` / `pushFailed`) and catch everything, mirroring
  `HaltMarkerWriteResult`. `writeHaltMarker` ignores the value except to emit.
- **Git discipline, copied not reinvented.** `git add -- <relPath>`, then
  `git diff --cached --quiet -- <relPath>` to decide whether a commit is owed, then
  `git commit --no-verify` spawned with `withEngineCommitEnv()`, then `git push`. Every `execa`
  call is wrapped; a non-zero exit becomes a result, never a throw.
- **Recording precondition.** `recordHalt` returns `skipped` unless the halt class is not
  `mechanical` AND the resolved root's current branch differs from the repository's default branch
  (conflict C1 — the live root checkout must never gain a commit).
- **Supersession seam.** `appendHaltClearedRecord(worktreePath, cause)` in `daemon-deps.ts:335` is
  the one place that already observes a cleared halt and already carries `cause: 'operator' |
  'rekick'`. It calls `supersedeHaltRecord` with that cause. No new watcher (conflict C2).
- **Events.** Three additive members on the `ConductorEvent` union in `src/conductor/src/types/events.ts`,
  beside the existing `halt_marker_write_failed`: `halt_record_written`, `halt_record_write_failed`,
  `halt_record_push_failed`, each with a sink policy row in `event-sinks.ts`.

## Non-goals

- No new CLI verb. The record is a markdown file on the branch; reading it needs no tooling.
- No change to `.pipeline/HALT` or `.pipeline/HALT.class` content, semantics, or writers.
- No change to halt classification, the re-kick sweep, or operator park.
- `.docs/halted/` is deliberately NOT added to `PROTECTED_ARTIFACT_DIRECTORIES`.

## Tasks

### Task 1: Render a halt record deterministically
**Story:** 1 (happy path)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/halt-record.test.ts`: a fully-populated input renders a document containing the slug, `Status: halted`, the halt class, the halting step, the phase, the branch, the head SHA, the ISO-8601 UTC timestamp, and the HALT body reproduced verbatim inside a fenced block; a body containing a fence delimiter still round-trips; two calls with identical input render byte-identical output.
2. Verify RED.
3. Implement `HALT_RECORD_DIR`, `haltRecordPath(slug)`, and the pure `renderHaltRecord(input)` in a new `src/conductor/src/engine/halt-record.ts`.
4. Verify GREEN; commit "feat(halt-record): render a deterministic halt record".

**Done when:**
- `renderHaltRecord` and `HALT_RECORD_DIR` are exported from `src/conductor/src/engine/halt-record.ts` and the new cases in `src/conductor/test/engine/halt-record.test.ts` pass.
- Two `renderHaltRecord` calls on the same input produce identical strings in a test assertion.

**Files:**
- src/conductor/src/engine/halt-record.ts
- src/conductor/test/engine/halt-record.test.ts

**Dependencies:** none

### Task 2: Decide when a halt is recordable
**Story:** 1 (negative path)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `halt-record.test.ts`: class `mechanical` is not recordable; classes `needs-human`, `plan-gap` and `protected-artifact` are recordable; a root whose current branch equals the repository default branch is not recordable regardless of class; a root whose branch cannot be resolved is not recordable.
2. Verify RED.
3. Implement `isRecordableHaltClass(class)` (pure) and `resolveRecordability(root, class)` (reads the current branch and the default branch) in `halt-record.ts`, both failing closed to not-recordable.
4. Verify GREEN; commit "feat(halt-record): record only operator-actionable halts off the default branch".

**Done when:**
- A test asserts `isRecordableHaltClass('mechanical')` is false and is true for each of `needs-human`, `plan-gap`, `protected-artifact`.
- A test with a temporary repository checked out on its default branch asserts `resolveRecordability` returns not-recordable for a `needs-human` halt.
- A test whose branch resolution throws asserts `resolveRecordability` returns not-recordable rather than propagating.

**Files:**
- src/conductor/src/engine/halt-record.ts
- src/conductor/test/engine/halt-record.test.ts

**Dependencies:** 1

### Task 3: Add the three record events to the spine
**Story:** 2 (happy path)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/event-sinks.test.ts` asserting each of `halt_record_written`, `halt_record_write_failed`, `halt_record_push_failed` has a sink-policy row.
2. Verify RED.
3. Add the three members to the `ConductorEvent` union in `src/conductor/src/types/events.ts`, immediately after `halt_marker_write_failed`, carrying `path` plus `slug`/`haltClass` (written), `reason` (write failed), and `reason` (push failed).
4. Add the three rows to `EVENT_SINK_POLICY` in `src/conductor/src/engine/event-sinks.ts`.
5. Verify GREEN; commit "feat(events): halt-record write and push outcomes".

**Done when:**
- The three event type names appear in the `ConductorEvent` union in `src/conductor/src/types/events.ts`.
- The new cases in `src/conductor/test/engine/event-sinks.test.ts` pass, asserting a sink-policy row exists for each of the three.

**Files:**
- src/conductor/src/types/events.ts
- src/conductor/src/engine/event-sinks.ts
- src/conductor/test/engine/event-sinks.test.ts

**Dependencies:** none

### Task 4: Write and commit the record, path-scoped and idempotent
**Story:** 1 (happy path)
**Story:** 4 (negative path)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/halt-record-commit.test.ts` against a temporary git repository on a feature branch: a first `recordHalt` creates the file and exactly one commit whose changed-path set is exactly `.docs/halted/<slug>.md`; a second call with identical input creates no second commit and returns `noop`; a call made while an unrelated file is modified in the working tree leaves that file modified and uncommitted.
2. Verify RED.
3. Implement `recordHalt()` in `halt-record.ts`: guard on `resolveRecordability`, `mkdir` the directory, write the rendered bytes, `git add -- <relPath>`, `git diff --cached --quiet -- <relPath>` to decide, then `git commit --no-verify -m "halt record: <slug>"` spawned with `withEngineCommitEnv()`.
4. Verify GREEN; commit "feat(halt-record): commit the record path-scoped and idempotently".

**Done when:**
- A test asserts the record commit's `git show --name-only` output lists exactly `.docs/halted/<slug>.md` and nothing else.
- A test asserts a second identical `recordHalt` leaves `git rev-list --count HEAD` unchanged and returns `noop`.
- A test asserts a modified unrelated file is still reported by `git status --porcelain` after `recordHalt` returns.

**Files:**
- src/conductor/src/engine/halt-record.ts
- src/conductor/test/engine/halt-record-commit.test.ts

**Dependencies:** 1, 2

### Task 5: Push best-effort, and never lose the halt to a push failure
**Story:** 2 (happy path)
**Story:** 2 (negative path)
**Type:** happy-path

**Steps:**
1. Write failing tests in `halt-record-commit.test.ts`: with a temporary bare remote configured, `recordHalt` leaves the record present on the remote branch; with no remote configured, the local commit survives and the result is `pushFailed` naming the reason; with a remote whose push is rejected, the local commit survives, the result is `pushFailed`, and no exception escapes.
2. Verify RED.
3. Implement the push arm in `recordHalt`, strictly after the commit arm, catching every failure into a `pushFailed` result carrying the captured stderr as `reason`.
4. Verify GREEN; commit "feat(halt-record): push the record best-effort".

**Done when:**
- A test asserts the record file is readable from the bare remote's branch after `recordHalt` returns.
- A test with no remote asserts the result is `pushFailed`, `git rev-list --count HEAD` includes the record commit, and the call did not throw.
- A test with a rejected push asserts the returned `reason` is non-empty and the local commit is still present.

**Files:**
- src/conductor/src/engine/halt-record.ts
- src/conductor/test/engine/halt-record-commit.test.ts

**Dependencies:** 4

### Task 6: State the push status inside the record itself
**Story:** 2 (negative path)
**Type:** happy-path

**Steps:**
1. Write a failing test in `halt-record.test.ts` asserting the rendered document carries a line stating that the record may be ahead of the remote, so an operator reading only the file can tell that a push is not guaranteed.
2. Verify RED.
3. Add that line to `renderHaltRecord`'s output.
4. Verify GREEN; commit "feat(halt-record): state the push caveat in the record".

**Done when:**
- A test asserts the rendered record contains the ahead-of-remote caveat line.
- The determinism assertion from Task 1 still passes with the added line.

**Files:**
- src/conductor/src/engine/halt-record.ts
- src/conductor/test/engine/halt-record.test.ts

**Dependencies:** 1, 5

### Task 7: Produce the record from the single halt seam
**Story:** 1 (happy path)
**Story:** 4 (happy path)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/halt-marker.test.ts`: a `needs-human` `writeHaltMarker` in a temporary feature-branch repository produces the record and emits `halt_record_written`; a `mechanical` one produces neither; a record-path failure emits `halt_record_write_failed` while `writeHaltMarker` still returns `{status: 'written'}`; the bytes of `.pipeline/HALT` and `.pipeline/HALT.class` are unchanged from the pre-change expectations in every case.
2. Verify RED.
3. Call `recordHalt` from `writeHaltMarker` after both markers are written, mapping its result onto the three events; wrap the call so no failure can alter `writeHaltMarker`'s existing return value.
4. Verify GREEN; commit "feat(halt-marker): produce a committed halt record at the seam".

**Done when:**
- A test asserts `writeHaltMarker` with class `needs-human` leaves `.docs/halted/<slug>.md` committed and emits `halt_record_written`.
- A test asserts `writeHaltMarker` with class `mechanical` leaves no `.docs/halted/` directory.
- A test asserts a forced record failure emits `halt_record_write_failed` and `writeHaltMarker` still returns `{status: 'written'}`.
- A test asserts the `.pipeline/HALT` and `.pipeline/HALT.class` bytes written for each class are identical to those asserted before this change.

**Files:**
- src/conductor/src/engine/halt-marker.ts
- src/conductor/test/engine/halt-marker.test.ts

**Dependencies:** 3, 4

### Task 8: Supersede the record in place, preserving the halt history
**Story:** 3 (happy path)
**Type:** happy-path

**Steps:**
1. Write failing tests in `halt-record.test.ts` for the pure `supersedeHaltRecordText`: a document with `Status: halted` becomes `Status: resolved` and gains the resolution cause and resolution timestamp; the original reason, class and halting step are still present in the output; a document already carrying `Status: resolved` is returned byte-identical.
2. Verify RED.
3. Implement `supersedeHaltRecordText` (pure) and `supersedeHaltRecord(root, slug, cause)` in `halt-record.ts`, reusing Task 4's add/diff/commit helper so the supersede commit is equally path-scoped and idempotent.
4. Verify GREEN; commit "feat(halt-record): supersede the record on resume".

**Done when:**
- A test asserts the superseded text contains `Status: resolved`, the cause, a resolution timestamp, and still contains the original reason text.
- A test asserts `supersedeHaltRecordText` on an already-resolved document returns the input unchanged.
- A test asserts a second `supersedeHaltRecord` call creates no additional commit.

**Files:**
- src/conductor/src/engine/halt-record.ts
- src/conductor/test/engine/halt-record.test.ts

**Dependencies:** 4

### Task 9: Wire supersession to the existing halt-clear call site
**Story:** 3 (happy path)
**Story:** 3 (negative path)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-deps.test.ts`: clearing a halt in a worktree carrying a `halted` record rewrites it to `resolved` with the observed cause; clearing with cause `rekick` records that cause verbatim; clearing in a worktree with no record creates no file and no commit; a supersede failure is caught and the existing `halt_cleared` audit append still happens.
2. Verify RED.
3. Call `supersedeHaltRecord` from `appendHaltClearedRecord` in `src/conductor/src/engine/daemon-deps.ts`, inside the existing try/catch discipline, passing the existing `cause` value through unchanged.
4. Verify GREEN; commit "feat(daemon): supersede the halt record when a halt clears".

**Done when:**
- A test asserts a cleared halt leaves the worktree's record at `Status: resolved` with cause `operator`.
- A test asserts cause `rekick` is written verbatim into the record.
- A test asserts a worktree with no record gains no `.docs/halted/` directory when a halt is cleared.
- A test asserts the `halt_cleared` audit-trail append still occurs when `supersedeHaltRecord` throws.

**Files:**
- src/conductor/src/engine/daemon-deps.ts
- src/conductor/test/engine/daemon-deps.test.ts

**Dependencies:** 8

### Task 10: Prove the operator pickup path end to end
**Story:** 1 (happy path)
**Story:** 3 (happy path)
**Type:** acceptance

**Steps:**
1. Write a failing acceptance test in `src/conductor/test/acceptance/halt-record-pickup.test.ts` driving the real flow against temporary repositories with a bare remote: raise a `needs-human` halt through `writeHaltMarker`, clone the remote into a second directory that has no access to the first, read the record there, then clear the halt in the original worktree and assert the second clone sees `Status: resolved` after fetching.
2. Verify RED.
3. Adjust only what the test proves missing; no new production behavior is expected to be required by this task.
4. Verify GREEN; commit "test(halt-record): prove the branch-only operator pickup path".

**Done when:**
- The acceptance test reads the halt reason, class and halting step from a clone that never touched the original worktree directory.
- The same test asserts the clone observes `Status: resolved` after the halt is cleared and the branch is re-fetched.

**Files:**
- src/conductor/test/acceptance/halt-record-pickup.test.ts

**Dependencies:** 7, 9

### Task 11: Document the halt record
**Story:** 4 (happy path)
**Type:** documentation

**Steps:**
1. Add `.docs/halted/<slug>.md` to the artifact reference in `docs/reference/` beside the shipped record, stating what it carries, when it is written, and that `mechanical` halts do not produce one.
2. Add a pickup section to `docs/runbooks/stalled-or-stuck-feature.md` telling the operator to read the record from the branch, including the case where the record's push failed and the record exists only on the daemon host.
3. Add the consumer-facing rule to `HARNESS.md` per the scope-check verdict in `.docs/track/a-halt-leaves-no-committed-pushed-record-for-the-o.md`.
4. Commit "docs(halt-record): document the committed halt record".

**Done when:**
- `docs/runbooks/stalled-or-stuck-feature.md` contains a section naming `.docs/halted/<slug>.md` as the first place to read a halt.
- `docs/reference/` documents the record's fields and the `mechanical` exclusion.
- `HARNESS.md` states that an operator-actionable halt lands a committed record on the feature branch.

**Files:**
- docs/reference/artifacts.md
- docs/runbooks/stalled-or-stuck-feature.md
- HARNESS.md

**Dependencies:** 7, 9

## Task Dependency Graph

```
1 ──┬── 2 ──┐
    │       ├── 4 ──┬── 5 ── 6
    │       │       ├── 8 ── 9 ──┬── 10
3 ──────────┴───────┴── 7 ───────┴── 11
```

## Coverage Check

| Story | Task(s) | Criterion |
|---|---|---|
| 1 | 1 | The record renders every field an operator needs and renders deterministically. |
| 1 | 4, 7 | An operator-actionable halt leaves the record committed on the feature branch. |
| 1 | 10 | The record is readable from a clone of the branch with no access to the daemon host. |
| 1 | 2 | A mechanical halt, and any halt on the default branch, produces no record. |
| 1 | 4 | A repeated halt with identical content creates no duplicate commit. |
| 2 | 3, 5 | The record reaches the remote and the write is announced on the event spine. |
| 2 | 5 | No remote and a rejected push both retain the local commit and report the reason. |
| 2 | 6 | The record itself states that it may be ahead of the remote. |
| 3 | 8, 9 | Clearing a halt supersedes the record to resolved with its cause and timestamp. |
| 3 | 8 | The original halt reason, class and step survive supersession. |
| 3 | 9 | A feature with no record gains none when a halt is cleared. |
| 3 | 8, 9 | A repeated supersede is idempotent and creates no second commit. |
| 3 | 10 | A clone observes the resolved status after the clear and a fetch. |
| 4 | 7 | The HALT and HALT.class marker bytes are unchanged for every class. |
| 4 | 7 | A record write or commit failure emits an event and never alters the halt outcome. |
| 4 | 4 | A halt over a dirty worktree commits only the record path. |
| 4 | 11 | The record, its fields and the mechanical exclusion are documented. |
