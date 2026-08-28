# Implementation Plan: a-kickback-restages-a-skipped-manual-test-as-stale

**Date:** 2026-08-27
**Stories:** .docs/stories/a-kickback-restages-a-skipped-manual-test-as-stale.md
**Conflict check:** Clean as of 2026-08-27

## Summary

Fixes #1987 in 8 tasks: a skip-preserving restage helper routed through the four explicit
kickback restage sites, a write-time skipped-to-stale refusal rule on the conduct-state
mutation port with a spine event, and skip-aware `--diagnose` reporting.

## Technical Approach

Three seams, in dependency order:

- **Helper (Story 1).** A pure function `filterRestageChanges(state, changes)` beside
  `markDownstreamStale` in `src/conductor/src/engine/state.ts` returns the subset of a
  stale-changes record whose fields' current status is not `skipped`. It mirrors
  `markDownstreamStale`'s existing guard shape (that function already stales only `done`
  steps and is unchanged). The four kickback sites in
  `src/conductor/src/engine/conductor.ts` — the manual_test FAIL kickback (~:5824), the
  validation-group kickback (~:7376), the validation-gaps kickback (~:7524), and the
  build_review kickback (~:10192, the incident's firing site, which hard-codes
  `manual_test: 'stale'`) — pass their stale set through it before `commitStateChanges`.
  The helper only filters the record: routing targets, retry hints, and the kickback
  ledger are untouched, and an emptied record produces no state write
  (`commitStateChanges` already no-ops on zero mutations).
- **Port invariant (Story 2).** A second domain rule in `evaluateConductStateMutation`
  (`src/conductor/src/engine/conduct-state-conflicts.ts`, beside the existing
  `feature_status`/`complete` rule): when the current value is `skipped` and the requested
  next is `stale`, return `resolved` (current wins) and emit the diagnostic. **Ordering
  matters:** the rule must run BEFORE the expected-matches-current `applied` branch,
  because a caller reading `skipped` sends expected=`skipped`, which today applies
  cleanly. No status ordering is introduced (adr-2026-08-01 forbids it) and no new status
  member (adr-2026-08-24). The conductor wires a `StateMutationDiagnostics` whose `emit`
  raises a new `ConductorEvent` member carrying field/expected/requested/intent, declared
  in the compile-time-exhaustive sink registry (render + persist + audit). Refusal is
  non-fatal, and `commitStateChanges`/`recordPersistedFields` must not adopt a
  refused field into in-memory state or the persisted snapshot — otherwise memory
  diverges from disk on the very write the rule refused.
- **Diagnose (Story 3).** `verifyCompleteState`
  (`src/conductor/src/engine/complete-verifier.ts`) short-circuits a step whose
  conduct-state status is `skipped` as satisfied before running its artifact-presence
  predicate. Reporting-only: `stepDone`/`stepSatisfied` in `state.ts` are untouched
  (deferred unification stays with ai-conductor#1587), and a ran step with missing
  evidence still fails closed with the existing reason text (adr-2026-07-25).

Test pattern: follow the existing unit tests beside each seam (search for the current
`evaluateConductStateMutation` and `verifyCompleteState` test files under
`src/conductor/test/`; match their fixture and naming style). Engine-level tests drive a
minimal state through the real store with a fake filesystem per the repo's
faithful-fakes policy.

## Prerequisites

None — all seams exist on main; no migrations, deps, or config.

## Tasks

### Task 1: Skip-preserving restage filter helper
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing unit tests for `filterRestageChanges(state, changes)` in the state test file: a record naming a `skipped` field drops that field; `done`, `failed`, `stale`, and absent (pending) fields pass through; an all-skipped record returns an empty record.
2. Verify tests fail (RED).
3. Implement `filterRestageChanges` in `src/conductor/src/engine/state.ts` beside `markDownstreamStale`, preserving only non-`skipped` fields; export it.
4. Verify tests pass (GREEN).
5. Commit: "feat(engine): add skip-preserving restage filter for kickback stale sets"

**Done when:**
- A named unit test proves a `skipped` field is dropped while `done` and `failed` fields survive in the same record (per-field, not all-or-none)
- A named unit test proves an all-skipped input returns `{}`
- `markDownstreamStale` is byte-identical to before this task

**Files likely touched:**
- src/conductor/src/engine/state.ts — new exported helper
- src/conductor/test/state.test.ts — unit tests

**Dependencies:** none

### Task 2: Route the manual_test FAIL kickback restage through the filter
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a failing engine test: state with `manual_test: 'failed'` takes the FAIL kickback restage and `manual_test` becomes `stale` (existing behavior pinned); state with `manual_test: 'skipped'` fed through the same restage path leaves it `skipped`.
2. Verify RED.
3. At the `'restage manual_test after BUILD kickback'` site in `src/conductor/src/engine/conductor.ts` (~:5824), build the stale record via `filterRestageChanges` before `commitStateChanges`.
4. Verify GREEN.
5. Commit: "fix(engine): manual_test FAIL kickback restage preserves skipped status"

**Done when:**
- A named test asserts a failed manual_test is still restaged `stale` by this site
- The site's stale set is produced by `filterRestageChanges`, verified by the diff
- The site's routing target, `pendingRetryHints`, and kickback counter code are unchanged in the diff

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — route site through helper
- src/conductor/test/conductor-kickback.test.ts — engine test

**Dependencies:** 1

### Task 3: Route the validation-group and validation-gaps restages through the filter
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a failing engine test: a consolidated validation-group kickback whose stale set names a `skipped` member (manual_test skipped by feature-type) and a `done` gap member leaves the skipped member `skipped` and stales the ran member.
2. Verify RED.
3. At the `'restage validation group after kickback'` (~:7376) and `'restage validation gaps after kickback'` (~:7524) sites in `src/conductor/src/engine/conductor.ts`, pass `staleChanges` through `filterRestageChanges` before `commitStateChanges`.
4. Verify GREEN.
5. Commit: "fix(engine): validation-group kickback restages preserve skipped members"

**Done when:**
- A named test asserts the mixed record outcome: skipped member untouched, ran member staled, in one restage
- Both sites' stale sets are produced by `filterRestageChanges`, verified by the diff
- A test or assertion proves an emptied stale set performs no state write and leaves the kickback ledger file unchanged

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — route both sites through helper
- src/conductor/test/conductor-kickback.test.ts — engine test

**Dependencies:** 1

### Task 4: Route the build_review kickback restage through the filter (incident site)
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a failing engine test reproducing #1985: `manual_test: 'skipped'` with a recorded skip gate verdict, a build_review kickback restages the tail, then the FINISH ship-evidence observer (`stepDone(manual_test) && stepDone(architecture_review_as_built)`) reports present.
2. Verify RED (today `manual_test` is overwritten to `stale` and evidence reports missing).
3. At the `'restage BUILD review after kickback'` site in `src/conductor/src/engine/conductor.ts` (~:10192), build `{ build_review: 'stale', manual_test: 'stale' }` via `filterRestageChanges`.
4. Verify GREEN.
5. Commit: "fix(engine): build_review kickback no longer restages a skipped manual_test (#1987)"

**Done when:**
- A named test drives a skipped-manual_test state through the build_review kickback restage and asserts `manual_test: 'skipped'` survives in the persisted state
- The same test asserts ship evidence evaluates present afterward via the `stepDone` predicate pair used by `observeShipEvidence`
- A named test asserts `build_review` itself is still restaged `stale` at this site
- A named test asserts two successive kickbacks leave `manual_test` still `skipped`

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — route site through helper
- src/conductor/test/conductor-kickback.test.ts — engine test

**Dependencies:** 1

### Task 5: Port domain rule refusing skipped-to-stale writes
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing unit tests for `evaluateConductStateMutation`: current `skipped` + next `stale` returns `resolved` and emits a diagnostic even when expected equals current (the ordering trap: today that shape returns `applied`); current `done` + next `stale` still applies; current `failed` + next `stale` still applies; current `skipped` + next `done` still applies; the existing `feature_status`/`complete` rule still resolves.
2. Verify RED.
3. In `src/conductor/src/engine/conduct-state-conflicts.ts`, add the rule BEFORE the expected-matches `applied` branch: if `currentValue === 'skipped'` and `mutation.next === 'stale'`, emit the `resolved` diagnostic and return `{ kind: 'resolved' }`. No status ranking, no new status value.
4. Verify GREEN.
5. Commit: "feat(engine): conduct-state port refuses skipped→stale step writes"

**Done when:**
- A named test proves expected=`skipped`, current=`skipped`, next=`stale` returns `resolved` (not `applied`) with a diagnostic naming field and intent
- Named tests prove `done`→`stale`, `failed`→`stale`, and `skipped`→`done` all still return `applied`
- The existing `feature_status` terminal rule's test still passes unmodified

**Files likely touched:**
- src/conductor/src/engine/conduct-state-conflicts.ts — new domain rule
- src/conductor/test/conduct-state-conflicts.test.ts — unit tests

**Dependencies:** none

### Task 6: Refusal event on the spine and diagnostics wiring
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write a failing test: forcing a skipped-to-stale mutation through the conductor's store lands one refusal event in `.pipeline/events.jsonl` carrying field, expected, requested, and intent; follow the `step_refused` member (`src/conductor/src/types/events.ts:299`) and its sink declarations as the pattern.
2. Verify RED (the type does not compile / no event emitted).
3. Add a `ConductorEvent` member (e.g. `step_status_write_refused` with `field`, `expected`, `requested`, `intent`), declare it in the render, persist, and audit sinks (`report-renderer.ts`, `event-persister.ts`, `audit-trail.ts` — the exhaustive registry makes a missing declaration a compile error), and wire a `StateMutationDiagnostics` into the conductor's store whose `emit` maps a `resolved` skipped-to-stale diagnostic to the event on the existing `ConductorEventEmitter`.
4. Verify GREEN.
5. Commit: "feat(engine): skipped→stale refusals are reported on the event spine"

**Done when:**
- A named test asserts the refusal event appears in `.pipeline/events.jsonl` with field, expected `skipped`, requested `stale`, and the mutation intent
- The event member compiles only with all sink declarations present (registry exhaustiveness), shown by the passing build
- No sidecar file, log, or channel outside the emitter is added, verified by the diff

**Files likely touched:**
- src/conductor/src/types/events.ts — new event member
- src/conductor/src/engine/report-renderer.ts — render sink
- src/conductor/src/engine/event-persister.ts — persist sink
- src/conductor/src/engine/audit-trail.ts — audit sink
- src/conductor/src/engine/conductor.ts — diagnostics wiring at store construction
- src/conductor/test/conduct-state-refusal-event.test.ts — test

**Dependencies:** 5

### Task 7: Refused fields stay skipped in memory and the run continues
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write a failing engine test: a `commitStateChanges` batch mixing an allowed field and a skipped-to-stale field persists the allowed field, keeps `skipped` on disk, keeps `skipped` in the conductor's in-memory state and persisted snapshot, and does not throw.
2. Verify RED (today `Object.assign(current, changes)` and `recordPersistedFields` adopt the refused `stale` into memory, diverging from disk).
3. Surface per-field dispositions from the batch result (or re-read refused fields) so `commitStateChanges` skips adopting any `resolved`-refused field into `state` and the snapshot.
4. Verify GREEN.
5. Commit: "fix(engine): a refused skipped→stale write is not adopted into in-memory state"

**Done when:**
- A named test asserts on-disk, in-memory, and snapshot values all read `skipped` after the refused write while the batch's other field persisted
- The same test asserts the conductor loop continues (no throw, no halt) after the refusal
- A named test proves a call site bypassing the helper (direct `commitStateChanges` with skipped→stale) is protected end to end

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — refusal-aware adoption in commitStateChanges
- src/conductor/src/engine/conduct-state-store.ts — expose per-field dispositions if absent
- src/conductor/test/conductor-state-adoption.test.ts — engine test

**Dependencies:** 5, 6

### Task 8: Skip-aware verifyCompleteState for --diagnose
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing unit tests for `verifyCompleteState`: state with `manual_test: 'skipped'` and `finish: 'skipped'` and no artifacts reports ok; a mixed worktree (one skipped step, one `done` step with missing evidence) reports only the done step as a gap with the existing reason text and the caller still exits non-zero; a step with no status (pending) and no evidence is still a gap.
2. Verify RED.
3. In `src/conductor/src/engine/complete-verifier.ts`, before calling `checkStepCompletion` for each `SHIP_GATING_STEPS` member, treat `getStepStatus(state, step) === 'skipped'` as satisfied and continue.
4. Verify GREEN.
5. Commit: "fix(engine): --diagnose reports legitimately skipped steps as skipped (#1987)"

**Done when:**
- A named test proves skipped steps produce no gap entries while the report stays ok
- A named test proves the mixed case still fails closed: the ran step's gap is reported with unchanged reason text
- `stepDone` and `stepSatisfied` in `src/conductor/src/engine/state.ts` are unchanged in the diff

**Files likely touched:**
- src/conductor/src/engine/complete-verifier.ts — skip short-circuit
- src/conductor/test/complete-verifier.test.ts — unit tests

**Dependencies:** none

## Task Dependency Graph

```
Task 1 ──> Task 2
      ├──> Task 3
      └──> Task 4
Task 5 ──> Task 6 ──> Task 7
Task 8 (independent)
```

## Integration Points

- After Task 4: the #1985 incident scenario is reproducible end to end — a skipped
  manual_test survives a build_review kickback and FINISH ship evidence reads present.
- After Task 7: the port protects every caller, helper-routed or not, with the refusal
  visible in `.pipeline/events.jsonl`.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
