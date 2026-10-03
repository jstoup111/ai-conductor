# Implementation Plan: Audited operator halt clear for in-place halts

**Date:** 2026-10-02
**Design:** none (Tier S, technical track — `.docs/track/needs-human-halt-auto-resumed-at-dispatch-rewind-c.md`)
**Stories:** .docs/stories/needs-human-halt-auto-resumed-at-dispatch-rewind-c.md
**Conflict check:** Not required (Tier S)

## Summary

Adds an audited `ai-conductor halt clear --feature <slug> --rationale <text>` operator command that clears a live halt of any class in place, keeps the build-stall remediation halt's chosen class, and stops attributing the build-stall path's own marker clear to the operator. Seven tasks.

## Technical Approach

- **Event spine, not a side channel.** Add one `ConductorEvent` variant, `halt_clear_authorized` (`feature`, `operator`, `rationale`, `haltClass`, `step`, `ts`), declared in `src/conductor/src/engine/event-sinks.ts` with `persist: true, audit: true` and mapped in `src/conductor/src/engine/audit-trail.ts` with origin `operator`. Widen the existing `halt_cleared` `cause` union in `src/conductor/src/types/events.ts` with `'stall-remediation'`. The daemon's existing HALT watcher (`daemon-deps.ts` `fireIfCleared`) keeps recording the resulting `halt_cleared` record unchanged.
- **Pattern to follow: `kickback-budget` operator CLI.** Model the new command on `src/conductor/src/engine/kickback-budget-cli.ts` and its parser `detectKickbackBudgetCommand` in `src/conductor/src/cli.ts`, wired in `src/conductor/src/index.ts` before the pipeline boots. Relevant traits: argv-pair flag parsing that returns `null` on any unknown/duplicate flag; `resolveCliFeatureWorktree` for `--feature`; `isAcceptableOperatorRationale` for the bounded rationale; `resolveMachineOperatorIdentity` for identity; an injectable `isInteractive` (defaulting to `process.stdin.isTTY`) refusing non-interactive callers; and the append-then-project event write (`EventPersister` + `AuditTrailWriter` over `<worktree>/.pipeline/events.jsonl`). Allowed variation: no ledger, no park, no gate argument — this command has nothing to reconcile. Search hints: `appendAuthorizationEvent`, `mutations require an interactive local operator terminal`.
- **New module `src/conductor/src/engine/halt-clear-cli.ts`** exporting `dispatchHaltClearCommand(command, deps)`. Order of operations: resolve worktree → interactive check → rationale check → HALT present check (read class via the raw `.pipeline/HALT.class` sidecar, `HALT_CLASS_MARKER` in `halt-marker.ts`, defaulting to `unclassified` when absent) → resolve operator identity → append `halt_clear_authorized` (failure refuses, markers untouched) → unlink `HALT.class` then `HALT` → `supersedeHaltRecord(worktree, slug, 'operator')` (non-`written`/`noop` results print a warning, exit stays 0). `conduct-state.json` is never written, so `last_step` is preserved and the daemon resumes through its existing HALT-absent dispatch.
- **Build-stall path (`src/conductor/src/engine/conductor.ts`).** `writeStallHalt` in `src/conductor/src/engine/task-progress.ts` gains an optional trailing `haltClass` parameter defaulting to `'needs-human'`; the `outcome.kind === 'halt'` branch passes `outcome.haltClass` through. The pre-remediation `clearHaltMarker` site emits `halt_cleared` with cause `'stall-remediation'` and supersedes the halt record with cause `'stall-remediation'`.
- **`rewind` is untouched**; Task 7 verifies its strictly-earlier guard is unchanged.
- Tests follow `.agents/skills/write-tests/SKILL.md`: isolated temporary worktree roots, injected operator/interactive/event-append seams, no real GitHub or network calls.

## Prerequisites

- Stories carry `**Status:** Accepted`.

## Tasks

### Task 1: Declare the halt-clear authorization event and the stall-remediation cause

**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests: emitting a `halt_clear_authorized` event through a `ConductorEventEmitter` with an `EventPersister` on a temp `.pipeline/events.jsonl` persists it with `feature`, `operator`, `rationale`, `haltClass`, `step`; `AuditTrailWriter` maps it to an audit record with origin `operator`; `AuditTrailWriter` maps a `halt_cleared` event with cause `stall-remediation` to an audit record carrying cause `stall-remediation`.
2. Verify the tests fail (RED).
3. Add the `halt_clear_authorized` variant to the `ConductorEvent` union, widen `halt_cleared.cause` with `'stall-remediation'`, add the event-sinks entry (`render: false, persist: true, audit: true, otel: false`), and add the audit-trail mapping.
4. Verify the tests pass (GREEN).
5. Commit with message: "feat(events): add halt_clear_authorized and stall-remediation cause"

**Done when:**
- An `EventPersister` test asserts a emitted `halt_clear_authorized` event is written to `.pipeline/events.jsonl` with its `feature`, `operator`, `rationale`, `haltClass`, and `step` fields intact.
- An `AuditTrailWriter` test asserts `halt_clear_authorized` maps to an audit record with origin `operator` and `halt_cleared` with cause `stall-remediation` maps to an audit record with cause `stall-remediation`.

**Files:** `src/conductor/src/types/events.ts`, `src/conductor/src/engine/event-sinks.ts`, `src/conductor/src/engine/audit-trail.ts`, `src/conductor/test/engine/halt-clear-events.test.ts`

**Dependencies:** none

### Task 2: `halt clear` clears a live halt in place through the CLI entry point

**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests driving `detectHaltClearCommand(['node','ai-conductor','halt','clear','--feature',slug,'--rationale','plan amended and resealed'])` into `dispatchHaltClearCommand` with injected `resolveMainRoot`, `resolveOperator` (returns `op`), and `isInteractive` (returns true), over a temp root with `.worktrees/<slug>/.pipeline/HALT`, `HALT.class` = `needs-human`, and `conduct-state.json` `last_step: "build"`, plus a committed `.docs/halted/<slug>.md` with status halted in a temp git repo. Assert exit 0; both markers absent; `conduct-state.json` byte-identical; `.pipeline/events.jsonl` holds exactly one `halt_clear_authorized` with `operator: "op"`, the trimmed rationale, `haltClass: "needs-human"`, `feature: slug`; the halt record committed as resolved with cause `operator`. Parameterize the clear over `kickback-cap`, `plan-gap`, `over-scope`, `protected-artifact` asserting the event's `haltClass` equals the seeded class. Add an ordering assertion: an injected `appendEvent` spy observes both `.pipeline/HALT` and `.pipeline/HALT.class` still present at call time.
2. Verify the tests fail (RED).
3. Implement `detectHaltClearCommand` in `cli.ts` (flags `--feature` and optional `--rationale` — a missing rationale is refused by the dispatcher, not the parser; unknown/duplicate flags → `null`; same feature-name validation as `detectKickbackBudgetCommand`), `src/conductor/src/engine/halt-clear-cli.ts` with the order of operations in Technical Approach, and the `index.ts` dispatch before pipeline boot, following the `kickback-budget` pattern traits listed in Technical Approach (`resolveCliFeatureWorktree`, `resolveMachineOperatorIdentity`, append-then-project event write).
4. Verify the tests pass (GREEN).
5. Commit with message: "feat(cli): add audited halt clear operator command"

**Done when:**
- The CLI test drives `detectHaltClearCommand` into `dispatchHaltClearCommand` on a `needs-human` halt with `last_step` `build` and asserts exit 0, `.pipeline/HALT` and `.pipeline/HALT.class` both absent, and `conduct-state.json` byte-identical so `last_step` is still `build`.
- The same test asserts `.pipeline/events.jsonl` contains exactly one `halt_clear_authorized` event with the resolved operator identity, the trimmed rationale, `haltClass` `needs-human`, and the feature slug, and the `appendEvent` spy observed both `.pipeline/HALT` and `.pipeline/HALT.class` still present when the event was appended.
- The same test asserts `.docs/halted/<slug>.md` is committed with status resolved and cause `operator` by `supersedeHaltRecord`.
- A parameterized test seeds `HALT.class` as each of `kickback-cap`, `plan-gap`, `over-scope`, `protected-artifact` and asserts exit 0, both markers absent, and the `halt_clear_authorized` event's `haltClass` equals the seeded class.

**Files:** `src/conductor/src/cli.ts`, `src/conductor/src/engine/halt-clear-cli.ts`, `src/conductor/src/index.ts`, `src/conductor/test/engine/halt-clear-cli.test.ts`

**Dependencies:** Task 1

### Task 3: `halt clear` refuses invalid invocations without touching state

**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests over the same fixture shape as Task 2, snapshotting `.pipeline/HALT`, `.pipeline/HALT.class`, and `.pipeline/events.jsonl` bytes before each case: (a) no `.pipeline/HALT`; (b) `--rationale` missing (the parser accepts the command with no rationale so the dispatcher refuses it), whitespace-only, and over `MAX_OPERATOR_RATIONALE_BYTES`; (c) `isInteractive` returns false; (d) `resolveOperator` returns undefined; (e) `--feature` naming no directory under `.worktrees/`.
2. Verify the tests fail (RED).
3. Implement each refusal in `dispatchHaltClearCommand` ahead of any write, with messages: `not halted`, the rationale problem, `requires an interactive local operator terminal`, `no approved operator identity`, and `feature '<slug>' is unavailable`.
4. Verify the tests pass (GREEN).
5. Commit with message: "feat(cli): halt clear refusals leave halt state untouched"

**Done when:**
- The no-HALT test asserts a non-zero exit, output containing `not halted`, and no `halt_clear_authorized` line in `.pipeline/events.jsonl`.
- The rationale tests assert, for a missing, whitespace-only, and over-bound rationale, a non-zero exit naming the rationale problem and `.pipeline/HALT`, `.pipeline/HALT.class`, and `.pipeline/events.jsonl` byte-for-byte unchanged.
- The non-interactive test asserts a non-zero exit with output stating an interactive local operator terminal is required, and the halt markers and `.pipeline/events.jsonl` byte-for-byte unchanged.
- The unresolved-identity test asserts a non-zero exit naming the missing operator identity, and the halt markers and `.pipeline/events.jsonl` byte-for-byte unchanged.
- The unknown-feature test asserts a non-zero exit naming the unknown feature and that no file was created or modified under the temp root.

**Files:** `src/conductor/src/engine/halt-clear-cli.ts`, `src/conductor/src/cli.ts`, `src/conductor/test/engine/halt-clear-cli.test.ts`

**Dependencies:** Task 2

### Task 4: `halt clear` orders its audit before its effect and tolerates a record failure

**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) injected `appendEvent` throws → assert non-zero exit and both `.pipeline/HALT` and `.pipeline/HALT.class` still present; (b) injected `supersedeRecord` returns `{ kind: 'pushFailed', reason: 'remote down' }` → assert exit 0, both markers absent, one `halt_clear_authorized` event appended, and output containing a warning naming `remote down`.
2. Verify the tests fail (RED).
3. Implement: append failure returns non-zero before any unlink; a non-`written`/`noop` supersession result prints a warning and keeps exit 0.
4. Verify the tests pass (GREEN).
5. Commit with message: "fix(cli): halt clear audits before clearing and warns on record failure"

**Done when:**
- The append-failure test asserts `dispatchHaltClearCommand` exits non-zero and `.pipeline/HALT` and `.pipeline/HALT.class` are both still present.
- The record-failure test asserts exit 0, `.pipeline/HALT` and `.pipeline/HALT.class` both absent, exactly one `halt_clear_authorized` event in `.pipeline/events.jsonl`, and printed warning text naming the record failure reason.

**Files:** `src/conductor/src/engine/halt-clear-cli.ts`, `src/conductor/test/engine/halt-clear-cli.test.ts`

**Dependencies:** Task 2

### Task 5: Build-stall remediation halt keeps the remediation outcome's class

**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests: `writeStallHalt(root, question, detail, events, 'kickback-cap')` writes `HALT.class` `kickback-cap` and a `HALT` body beginning with the question followed by the detail; calling it without a class writes `needs-human`. In the existing conductor remediation-routing test harness (`src/conductor/test/engine/conductor-remediation-authority-routing.test.ts`), drive a daemon build stall whose remediation outcome is `{ kind: 'halt', haltClass: 'kickback-cap' }` and assert `.pipeline/HALT.class` is `kickback-cap`; drive outcomes with no `haltClass`, a misroute to a non-build step, and no valid dispositions, and assert `needs-human` for each.
2. Verify the tests fail (RED).
3. Add an optional trailing `haltClass` parameter (default `'needs-human'`) to `writeStallHalt` and pass `outcome.haltClass` from the `outcome.kind === 'halt'` branch of the build-stall path in `conductor.ts`; leave the misroute and `none` branches unchanged.
4. Verify the tests pass (GREEN).
5. Commit with message: "fix(conductor): keep remediation halt class on build-stall halts"

**Done when:**
- A conductor build-stall test with a remediation halt outcome of class `kickback-cap` asserts `.pipeline/HALT.class` reads `kickback-cap` and `.pipeline/HALT` begins with the stall question followed by the outcome detail.
- Conductor build-stall tests with a halt outcome carrying no class, a misroute to a non-build step, and a no-valid-dispositions outcome each assert `.pipeline/HALT.class` reads `needs-human`.

**Files:** `src/conductor/src/engine/task-progress.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/task-progress.test.ts`, `src/conductor/test/engine/conductor-remediation-authority-routing.test.ts`

**Dependencies:** none

### Task 6: Build-stall marker clear is attributed to stall remediation

**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in the conductor remediation-routing harness: a daemon build stall where the build agent wrote `.pipeline/HALT` and a committed `.docs/halted/<slug>.md` exists → assert the emitted `halt_cleared` event has cause `stall-remediation`, and the halt record's resolution cause is `stall-remediation`; with a remediation halt outcome, assert no `halt_cleared` event from that run has cause `operator` and no `halt_clear_authorized` event is emitted.
2. Verify the tests fail (RED).
3. Change the pre-remediation clear site in `conductor.ts` to emit `halt_cleared` with cause `'stall-remediation'` and call `supersedeHaltRecord(..., 'stall-remediation')`.
4. Verify the tests pass (GREEN).
5. Commit with message: "fix(conductor): attribute build-stall marker clear to stall remediation"

**Done when:**
- A conductor build-stall test asserts the `halt_cleared` event emitted when the conductor clears the build agent's `.pipeline/HALT` has cause `stall-remediation` and not `operator`.
- The same test asserts the committed halt record superseded by that clear names resolution cause `stall-remediation`.
- A conductor build-stall test with a remediation halt outcome asserts no emitted `halt_cleared` event has cause `operator` and no `halt_clear_authorized` event is emitted.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-remediation-authority-routing.test.ts`

**Dependencies:** Task 1

### Task 7: Rewind's strictly-earlier guard is unchanged

**Story:** 4
**Type:** verification

**Steps:**
1. Confirm `src/conductor/test/engine/rewind.test.ts` covers a successful rewind to an earlier step and a refusal of the current step; add a case if either is missing: a halted feature with `last_step` `build`, `HALT`, and `HALT.class` present → the `rewind --to build` command exits non-zero with `Rewind target "build" must be earlier than current step "build"` and leaves `conduct-state.json`, `HALT`, and `HALT.class` byte-identical; `last_step` `build_review` → `rewind --to build` succeeds.
2. Run the focused test; it must pass against current code without any change to `rewind.ts`.
3. Commit (empty commit with `Evidence: skipped` trailer if no test was added) with message: "test(rewind): pin strictly-earlier guard"

**Done when:**
- A `rewind` test with `last_step` `build_review` asserts `rewind --to build` succeeds.
- A `rewind` command test with a halted feature at `last_step` `build` asserts `ai-conductor rewind --to build` exits non-zero with the error `Rewind target "build" must be earlier than current step "build"` and that `conduct-state.json`, `.pipeline/HALT`, and `.pipeline/HALT.class` are byte-identical afterwards.
- `git diff` of this feature shows no change to `src/conductor/src/engine/rewind.ts`.

**Verify-only:** yes

**Files:** `src/conductor/test/engine/rewind.test.ts`

**Dependencies:** none

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──▶ Task 3
   │          └─────▶ Task 4
   └──────▶ Task 6
Task 5 (independent)
Task 7 (independent)
```

## Integration Points

- After Task 2: `ai-conductor halt clear` is reachable from the CLI entry and clears a live halt end to end.
- After Task 5: a remediation plan-growth halt is recoverable through `kickback-budget raise`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature worktree whose `.pipeline/HALT` exists, whose `.pipeline/HALT.class` reads `needs-human`, and whose `.pipeline/conduct-state.json` records `last_step` as `build`, when the operator runs `ai-conductor halt clear --feature <slug> --rationale "plan amended and resealed"` from an interactive terminal, then the command exits 0, both `.pipeline/HALT` and `.pipeline/HALT.class` are absent, and `last_step` is still `build`. | 2 | "The CLI test drives `detectHaltClearCommand` into `dispatchHaltClearCommand` on a `needs-human` halt with `last_step` `build` and asserts exit 0, `.pipeline/HALT` and `.pipeline/HALT.class` both absent, and `conduct-state.json` byte-identical so `last_step` is still `build`." | diff-local |
| Story 1 happy: Given the same successful clear, when the feature's `.pipeline/events.jsonl` is read, then it contains one `halt_clear_authorized` event carrying the resolved operator identity, the trimmed rationale, the cleared halt class `needs-human`, and the feature slug, appended before the halt markers were removed. | 2 | "The same test asserts `.pipeline/events.jsonl` contains exactly one `halt_clear_authorized` event with the resolved operator identity, the trimmed rationale, `haltClass` `needs-human`, and the feature slug, and the `appendEvent` spy observed both `.pipeline/HALT` and `.pipeline/HALT.class` still present when the event was appended." | diff-local |
| Story 1 happy: Given the feature has a committed halt record at `.docs/halted/<slug>.md` with status halted, when the clear succeeds, then that record is committed as resolved with cause `operator`. | 2 | "The same test asserts `.docs/halted/<slug>.md` is committed with status resolved and cause `operator` by `supersedeHaltRecord`." | diff-local |
| Story 1 happy: Given a live halt whose class is `kickback-cap`, `plan-gap`, `over-scope`, or `protected-artifact`, when the operator runs the same command with a rationale, then the halt is cleared and the `halt_clear_authorized` event names that class. | 2 | "A parameterized test seeds `HALT.class` as each of `kickback-cap`, `plan-gap`, `over-scope`, `protected-artifact` and asserts exit 0, both markers absent, and the `halt_clear_authorized` event's `haltClass` equals the seeded class." | diff-local |
| Story 1 negative: Given a feature worktree with no `.pipeline/HALT`, when the operator runs `ai-conductor halt clear --feature <slug> --rationale "x"`, then the command exits non-zero with a message stating the feature is not halted, and no `halt_clear_authorized` event is appended. | 3 | "The no-HALT test asserts a non-zero exit, output containing `not halted`, and no `halt_clear_authorized` line in `.pipeline/events.jsonl`." | diff-local |
| Story 1 negative: Given a live halt, when the operator runs the command with no `--rationale`, a whitespace-only rationale, or a rationale over the shared operator-rationale byte bound, then the command exits non-zero naming the rationale problem, and `.pipeline/HALT`, `.pipeline/HALT.class`, and `.pipeline/events.jsonl` are byte-for-byte unchanged. | 3 | "The rationale tests assert, for a missing, whitespace-only, and over-bound rationale, a non-zero exit naming the rationale problem and `.pipeline/HALT`, `.pipeline/HALT.class`, and `.pipeline/events.jsonl` byte-for-byte unchanged." | diff-local |
| Story 1 negative: Given a live halt and a non-interactive invocation such as a daemon-dispatched agent session with no TTY on stdin, when the command runs, then it exits non-zero stating that clearing a halt requires an interactive local operator terminal, and the halt markers and event log are unchanged. | 3 | "The non-interactive test asserts a non-zero exit with output stating an interactive local operator terminal is required, and the halt markers and `.pipeline/events.jsonl` byte-for-byte unchanged." | diff-local |
| Story 1 negative: Given a live halt and an operator identity that cannot be resolved through the shared operator-identity chain, when the command runs, then it exits non-zero naming the unresolved identity, and the halt markers and event log are unchanged. | 3 | "The unresolved-identity test asserts a non-zero exit naming the missing operator identity, and the halt markers and `.pipeline/events.jsonl` byte-for-byte unchanged." | diff-local |
| Story 1 negative: Given a `--feature` value that does not name a live directory under `.worktrees/`, when the command runs, then it exits non-zero naming the unknown feature and writes nothing. | 3 | "The unknown-feature test asserts a non-zero exit naming the unknown feature and that no file was created or modified under the temp root." | diff-local |
| Story 1 negative: Given a live halt where appending the `halt_clear_authorized` event fails, when the command runs, then it exits non-zero and `.pipeline/HALT` and `.pipeline/HALT.class` are still present. | 4 | "The append-failure test asserts `dispatchHaltClearCommand` exits non-zero and `.pipeline/HALT` and `.pipeline/HALT.class` are both still present." | diff-local |
| Story 1 negative: Given a live halt whose committed halt record cannot be committed or pushed, when the clear runs, then the halt markers are still cleared, the `halt_clear_authorized` event is still appended, and the command prints a warning naming the record failure while exiting 0. | 4 | "The record-failure test asserts exit 0, `.pipeline/HALT` and `.pipeline/HALT.class` both absent, exactly one `halt_clear_authorized` event in `.pipeline/events.jsonl`, and printed warning text naming the record failure reason." | diff-local |
| Story 2 happy: Given a daemon build stall whose remediation outcome is a halt with class `kickback-cap` because remediation requested plan tasks with no plan-growth allowance, when the build-stall path writes the halt, then `.pipeline/HALT.class` reads `kickback-cap` and `.pipeline/HALT` still begins with the stall question followed by the outcome detail. | 5 | "A conductor build-stall test with a remediation halt outcome of class `kickback-cap` asserts `.pipeline/HALT.class` reads `kickback-cap` and `.pipeline/HALT` begins with the stall question followed by the outcome detail." | diff-local |
| Story 2 negative: Given a daemon build stall whose remediation outcome is a halt carrying no halt class, when the build-stall path writes the halt, then `.pipeline/HALT.class` reads `needs-human`. | 5 | "Conductor build-stall tests with a halt outcome carrying no class, a misroute to a non-build step, and a no-valid-dispositions outcome each assert `.pipeline/HALT.class` reads `needs-human`." | diff-local |
| Story 2 negative: Given a daemon build stall whose remediation misroutes to a non-build step or produces no valid dispositions, when the build-stall path writes the halt, then `.pipeline/HALT.class` reads `needs-human`. | 5 | "Conductor build-stall tests with a halt outcome carrying no class, a misroute to a non-build step, and a no-valid-dispositions outcome each assert `.pipeline/HALT.class` reads `needs-human`." | diff-local |
| Story 3 happy: Given a daemon build stall where the build agent wrote `.pipeline/HALT`, when the conductor clears that marker before dispatching remediation, then the appended `halt_cleared` event has cause `stall-remediation`, not `operator`. | 6 | "A conductor build-stall test asserts the `halt_cleared` event emitted when the conductor clears the build agent's `.pipeline/HALT` has cause `stall-remediation` and not `operator`." | diff-local |
| Story 3 happy: Given the same clear and an existing committed halt record for the feature, when the conductor supersedes that record, then the record's resolution cause is `stall-remediation`. | 6 | "The same test asserts the committed halt record superseded by that clear names resolution cause `stall-remediation`." | diff-local |
| Story 3 negative: Given a daemon build stall whose remediation outcome is a halt, when the conductor clears the build agent's marker before remediation and later writes the remediation halt, then no `halt_cleared` event appended by that build-stall path has cause `operator` and no `halt_clear_authorized` event is appended. | 6 | "A conductor build-stall test with a remediation halt outcome asserts no emitted `halt_cleared` event has cause `operator` and no `halt_clear_authorized` event is emitted." | diff-local |
| Story 4 happy: Given a feature whose `last_step` is `build_review`, when the operator runs `ai-conductor rewind --to build`, then the rewind succeeds exactly as before this change. | 7 | "A `rewind` test with `last_step` `build_review` asserts `rewind --to build` succeeds." | diff-local |
| Story 4 negative: Given a halted feature whose `last_step` is `build`, when the operator runs `ai-conductor rewind --to build`, then the command exits non-zero with `Rewind target "build" must be earlier than current step "build"` and `conduct-state.json`, `.pipeline/HALT`, and `.pipeline/HALT.class` are unchanged. | 7 | "A `rewind` command test with a halted feature at `last_step` `build` asserts `ai-conductor rewind --to build` exits non-zero with the error `Rewind target "build" must be earlier than current step "build"` and that `conduct-state.json`, `.pipeline/HALT`, and `.pipeline/HALT.class` are byte-identical afterwards." | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
