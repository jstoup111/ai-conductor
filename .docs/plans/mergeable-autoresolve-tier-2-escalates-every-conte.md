# Implementation Plan: Sweep tier-2 test-only supersession judgement and cause-keyed label clear

**Date:** 2026-09-20
**Stories:** .docs/stories/mergeable-autoresolve-tier-2-escalates-every-conte.md
**Conflict check:** Clean as of 2026-09-20

## Summary

Lets the mergeable sweep settle a rebase conflict confined to test code without the operator, under engine verification, records the choice for audit, and clears a conflict-caused `needs-remediation` label once the pull request no longer conflicts. 17 tasks. Source: jstoup111/ai-conductor#2607.

## Technical Approach

- Machinery does the bookkeeping; the resolver makes one judgement. The engine classifies the conflict set with the existing `isTestPath` convention, tells the resolver whether the exception is in force, validates the returned verdict against a closed schema, lets the commit-preservation guard excuse only declared, replayed, test-only commits, runs the existing suite gate, and only then publishes with the existing lease push.
- The signal travels as an option into the shared `resolveRebaseConflicts` loop, the single place a `ResolutionContext` is built. Only `runTier2` passes it. The finish-time rebase step and the daemon re-kick path call the same loop with no options, so they default off; Task 5 pins that.
- The verdict rides the resolver result (`ResolutionAttempt.verdict`), following the engine-stamped envelope pattern: the provider returns only the judgement payload, the engine validates and stamps everything else. No engine decision is re-derived from free text.
- Observation extends the existing event spine: one new `rebase_supersession_verdict` variant with a sink declaration, and the existing `rebase_citation_residue` event for excused commits. No sidecar file, watcher, or second channel.
- The audit comment and the label removal use the existing `upsertComment` and `removeLabel` seams and add no direct GitHub call. Those helpers swallow their own errors, so a failed label removal is observable only as the label still being present on the next read; the clear is therefore bounded at three issued removals per pull request.
- The escalation cause and the clear-attempt count are optional fields on the existing `WatchEntry`; entries without them mean no recorded cause and are never auto-cleared.
- Sequencing: Tasks 1, 2, 6, 13, 14 are independent and form the first frontier. The resolution wiring (Task 7) joins classification, verdict, signal, and guard. The label-clear lane (Tasks 13 to 16) is independent of the resolution lane.
- Tests mock the process boundary (git push, gh, suite) through the existing injected deps and assert refused paths never reach the push stub. Guard tests use a fixture-owned scratch repository.

## Prerequisites

- None. `mergeable_autoresolve` already exists and stays opt-in; no config key, CLI surface, or migration is added.

## Tasks

### Task 1: Classify a conflict set as test-only
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing test: `classifyConflictScope` returns `test-only` for a list of only test paths, `mixed` for one test and one non-test path, `mixed` for an empty list.
2. Verify test fails (RED)
3. Implement: export `classifyConflictScope(conflicts: string[])` in the autoresolve module, delegating each path to the existing `isTestPath` convention in the gate-invalidation module. Search hint: `isTestPath`, `isRuntimeSourcePath`. Do not add a second path convention.
4. Verify test passes (GREEN)
5. Commit

**Done when:**
- `classifyConflictScope` returns `test-only` only when the list is non-empty and every path satisfies `isTestPath`, asserted by the scope unit test over the three fixtures named in Steps.
- `classifyConflictScope` takes only the conflicted path list as input, so no resolver output can influence the result, asserted by its signature and the unit test calling it with paths alone.

**Files:** `src/conductor/src/engine/autoresolve.ts`; `src/conductor/test/engine/autoresolve-scope.test.ts`

**Dependencies:** none

### Task 2: Carry a schema-bound verdict on the resolver result
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: the step runner result parser returns a `verdict` object when the final JSON line carries `{"resolved": true, "verdict": {"choice": "superseded", "rationale": "...", "superseded": ["<sha>"]}}`, and returns no verdict for a bare `{"resolved": true}`.
2. Verify test fails (RED)
3. Implement: extend `ResolutionAttempt` with an optional `verdict` of shape `{ choice: "superseded" | "merged" | "source"; rationale: string; superseded: string[] }` and parse it in the existing final-line parser. Pattern: the provider returns only the judgement payload and the engine validates it (engine-stamped envelope precedent; search hint `ResolutionAttempt`, `rebase skill returned no parseable result`). Parsing here is shape-tolerant; rejection belongs to Task 3.
4. Verify test passes (GREEN)
5. Commit

**Done when:**
- The final-line parser in the step runner attaches `verdict` to a resolved `ResolutionAttempt` when the JSON line carries one, asserted by the parser unit test.
- A bare `{"resolved": true}` line still parses to a resolved attempt with `verdict` undefined, asserted by the same test, so finish-time results are unchanged.

**Files:** `src/conductor/src/engine/rebase.ts`; `src/conductor/src/engine/step-runners.ts`; `src/conductor/test/engine/step-runners-rebase-verdict.test.ts`

**Dependencies:** none

### Task 3: Validate the verdict in the engine
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests for `validateResolutionVerdict(verdict, { scope, replayedShas })`: missing `rationale` rejects; unknown `choice` rejects; non-empty `superseded` with scope `mixed` rejects; a `superseded` sha not in `replayedShas` rejects; a well-formed test-only verdict accepts.
2. Verify tests fail (RED)
3. Implement: export `validateResolutionVerdict` in the autoresolve module returning `{ ok: true, verdict } | { ok: false, reason }`, where each reason begins with `malformed verdict:`. The choice set is closed to the three values of Task 2.
4. Verify tests pass (GREEN)
5. Commit

**Done when:**
- `validateResolutionVerdict` returns `ok: false` with a reason starting `malformed verdict:` for a missing required field and for a choice outside the closed three-value set, asserted by the validation unit tests, and `resolveConflictingPr` given such a verdict returns `escalated` at stage `tier2-verdict` with that reason and never calls the push stub, asserted by the malformed-verdict integration test.
- `validateResolutionVerdict` returns `ok: false` when `superseded` is non-empty and the scope is `mixed`, asserted by the non-test-scope unit test, and `resolveConflictingPr` given that verdict returns `escalated` at stage `tier2-verdict` with the push stub and comment upsert never called, asserted by the mixed-scope integration test.
- `validateResolutionVerdict` returns `ok: false` when a `superseded` sha is absent from `replayedShas`, asserted by the never-replayed unit test, and `resolveConflictingPr` given that verdict publishes nothing (push stub and comment upsert never called) and returns `escalated`, asserted by the never-replayed integration test.

**Files:** `src/conductor/src/engine/autoresolve.ts`; `src/conductor/test/engine/autoresolve-verdict.test.ts`

**Dependencies:** Task 1, Task 2

### Task 4: Pass the judgement signal through the shared resolution loop
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing tests: `resolveRebaseConflicts` called with `{ supersessionJudgement: true }` hands the resolver a context whose `supersessionJudgement` is true; called with no options hands a context where it is false; `runTier2` passes true only when given scope `test-only`.
2. Verify tests fail (RED)
3. Implement: add `supersessionJudgement: boolean` to `ResolutionContext`; add an optional options parameter to `resolveRebaseConflicts` and set the field at the single place the context is built; add a `scope` parameter to `runTier2`. In the step runner `resolveRebaseConflict`, append the sweep-judgement prompt paragraph (naming the skill section heading `Sweep Test-Only Judgement` and the verdict JSON shape) only when the field is true; otherwise the prompt text is unchanged.
4. Verify tests pass (GREEN)
5. Commit

**Done when:**
- `runTier2` passes `supersessionJudgement: true` into `resolveRebaseConflicts` only for scope `test-only`, a `mixed` scope yields a resolver context with the field false, and a `mixed` scope whose stub resolver reports an intent conflict in either file returns `unresolved` and escalates without any push, asserted by the tier-2 unit test.
- The step runner `resolveRebaseConflict` prompt contains the text `Sweep Test-Only Judgement` only when the context field is true, and is byte-identical to the current prompt when false, asserted by the prompt unit test.

**Files:** `src/conductor/src/engine/rebase.ts`; `src/conductor/src/engine/autoresolve.ts`; `src/conductor/src/engine/step-runners.ts`; `src/conductor/test/engine/autoresolve-tier2-signal.test.ts`

**Dependencies:** Task 1

### Task 5: Prove finish-time and re-kick dispatch never carry the signal
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write tests that drive the finish-time rebase step and the daemon re-kick resume path with a stub resolver over a test-only conflict fixture and capture the context each hands the resolver.
2. Verify the tests fail if the default in Task 4 is flipped to true (RED by mutation of the default in a scratch edit, then restore).
3. Implement: no production change is expected beyond Task 4; if either path constructs its own options, make it pass none.
4. Verify tests pass (GREEN)
5. Commit

**Done when:**
- The finish-time rebase step hands its resolver a context with `supersessionJudgement` false for a test-only conflict fixture, and a stub resolver reporting a semantic intent conflict in that fixture halts the feature with the same halt reason as before this change, asserted by the finish-time boundary test capturing the stub resolver argument and the halt.
- The daemon re-kick resume path hands its resolver a context with `supersessionJudgement` false for a test-only conflict fixture, asserted by the re-kick boundary test capturing the stub resolver argument.

**Files:** `src/conductor/test/engine/rebase-judgement-boundary.test.ts`; `src/conductor/src/engine/daemon-rekick.ts`; `src/conductor/src/engine/rebase.ts`

**Dependencies:** Task 4

### Task 6: Excuse only declared, replayed, test-only drops in the preservation guard
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests against a scratch repository: a missing subject whose sha is declared and whose touched paths are all test paths passes; an undeclared missing subject fails naming the subject; a declared commit touching one test and one non-test path fails; with every feature commit declared and one of them non-test, the guard fails; with no declarations argument the results equal the current guard results for the existing fixtures.
2. Verify tests fail (RED)
3. Implement: add an optional `declaredSuperseded: string[]` parameter to `runAcceptanceGuards` and thread it to the commit-preservation check. For each missing subject, excuse it only when its pre-rebase sha is declared and `git show --name-only` of that sha lists only `isTestPath` paths; evaluate each declaration on its own. Return the excused shas on the ok result as `excused: Array<{ sha, subject }>`. Use a private scratch repository fixture; do not mock git for these cases (search hint: existing scratch-repo tests in the autoresolve guards test file).
4. Verify tests pass (GREEN)
5. Commit

**Done when:**
- `runAcceptanceGuards` returns ok with the commit listed in `excused` when its sha is in `declaredSuperseded` and every path it touched satisfies `isTestPath`, asserted by the declared-drop scratch-repository test.
- `runAcceptanceGuards` returns a `featureCommitsPreserved` failure naming the subject when the missing commit is not declared, asserted by the undeclared-drop test, and `resolveConflictingPr` returns `escalated` at stage `acceptance-guards` with the push stub never called on that failure, asserted by the undeclared-drop integration test.
- `runAcceptanceGuards` refuses a declaration whose commit touched any non-test path and evaluates every declaration individually, asserted by the mixed-path and all-declared tests.
- Called without `declaredSuperseded`, `runAcceptanceGuards` returns the same results as before for the existing guard fixtures, asserted by the unchanged existing guard tests plus the no-declarations test.

**Files:** `src/conductor/src/engine/autoresolve.ts`; `src/conductor/src/engine/rebase.ts`; `src/conductor/test/engine/autoresolve-guards.test.ts`

**Dependencies:** none

### Task 7: Wire classification, verdict, and declared drops into the sweep resolution flow
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing integration tests on `resolveConflictingPr` with injected git, gh, suite, and resolver stubs: (a) test-only conflict, resolver returns a `superseded` verdict naming the replayed sha, suite exits zero, expect outcome `refreshed`, one lease push, and a logged tier-2 outcome other than `conflict_halt`; (b) test-only conflict, resolver returns a `merged` verdict with empty `superseded`, expect outcome `refreshed` and an empty excused list.
2. Verify tests fail (RED)
3. Implement in `resolveConflictingPr`: after tier 1, call `classifyConflictScope` on the remaining conflicts and pass the scope to `runTier2`; capture the pre-rebase feature shas alongside the subjects already captured; after a resolved tier 2, run `validateResolutionVerdict` and escalate at stage `tier2-verdict` on rejection; pass the validated `superseded` list to `runAcceptanceGuards`. Mock the process boundary: every test asserts the push stub is reached only on the success cases.
4. Verify tests pass (GREEN)
5. Commit

**Done when:**
- `resolveConflictingPr` returns `refreshed` and invokes the lease push stub exactly once for a test-only conflict whose resolver verdict declares the replayed commit superseded and whose suite stub exits zero, asserted by integration test (a).
- `resolveConflictingPr` returns `refreshed` with an empty excused list when the verdict choice is `merged` and no commit is dropped, with the suite stub exiting zero and the lease push stub invoked exactly once, asserted by integration test (b).
- The log stub receives a `tier2 outcome:` line whose kind is not `conflict_halt` in integration test (a).

**Files:** `src/conductor/src/engine/autoresolve.ts`; `src/conductor/test/engine/autoresolve-supersession.test.ts`

**Dependencies:** Task 3, Task 4, Task 6

### Task 8: Escalate without pushing when verification or resolution fails
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing integration tests on `resolveConflictingPr` for a test-only conflict: suite stub exits 2; resolver returns unresolved with a reason naming replay commit, file and region, both intents, and the missing decision; lease push stub reports rejection; suite stub reports not configured. Each asserts the push stub call count and the escalation stage and reason.
2. Verify tests fail (RED) where behavior is new, and record which already pass
3. Implement: ensure the verdict path added in Task 7 reaches the existing suite-gate, unresolved, lease, and not-configured escalations without an earlier push, and that the unresolved reason is forwarded verbatim into the escalation comment.
4. Verify tests pass (GREEN)
5. Commit

**Done when:**
- With the suite stub exiting non-zero, `resolveConflictingPr` escalates at stage `suite-gate` with the exit code in the reason and the push stub is never called, asserted by the suite-failure test.
- With an unresolved resolver result whose reason names the replay commit, the file and region, both intents, and the missing decision, the escalation comment body contains each of those five items and the push stub is never called, asserted by the unresolved test.
- With the lease push stub rejecting because the remote branch moved (its fixture reports a stale-info lease rejection), `resolveConflictingPr` returns `escalated` and the push stub is called exactly once with the lease flag and never with a bare force flag, asserted by the lease test.
- With the suite stub reporting not configured, `resolveConflictingPr` escalates with reason `no suite command configured`, the push stub is never called, and the comment stub receives no audit comment, asserted by the not-configured test.

**Files:** `src/conductor/src/engine/autoresolve.ts`; `src/conductor/test/engine/autoresolve-supersession.test.ts`

**Dependencies:** Task 7

### Task 9: Keep strict-path publication unchanged
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write an integration test on `resolveConflictingPr`: a conflict in a non-test file, resolver returns a bare resolved result, suite exits zero; expect `refreshed`, one lease push, no verdict event emitted, no audit comment.
2. Verify the test fails if Task 7 wrongly requires a verdict (RED against a scratch edit that requires one, then restore), otherwise record it as already passing
3. Implement: a resolved attempt with no verdict and scope `mixed` skips verdict validation and proceeds to the guards with no declarations.
4. Verify test passes (GREEN)
5. Commit

**Done when:**
- `resolveConflictingPr` returns `refreshed` for a non-test conflict resolved with no verdict, and neither the event stub nor the audit comment stub is called, asserted by the strict-path integration test.
- The verdict validation call is skipped when the scope is `mixed` and the attempt carries no verdict, asserted by the same test observing that no `tier2-verdict` escalation occurs.

**Files:** `src/conductor/src/engine/autoresolve.ts`; `src/conductor/test/engine/autoresolve-supersession.test.ts`

**Dependencies:** Task 7

### Task 10: Record excused commits as rebase residue
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: after a successful resolution with one excused commit, the event stub receives one `rebase_citation_residue` event whose residue entry carries that sha and reason `declared-superseded`.
2. Verify test fails (RED)
3. Implement: in `resolveConflictingPr`, after the guards pass with a non-empty `excused` list, emit the existing `rebase_citation_residue` event through the injected emitter, one entry per excused sha with an empty citing task list. Extend the event spine only; add no file or second channel. Add an optional `events` dependency to the resolution deps and pass a feature-scoped persisted emitter from the sweep binding (started with `startFeatureEventPersistence(<feature worktree>, events, slug)`, so the event lands in the feature's `.pipeline/events.jsonl`, not the daemon ledger).
4. Verify test passes (GREEN)
5. Commit

**Done when:**
- `resolveConflictingPr` emits one `rebase_citation_residue` event containing each excused sha with reason `declared-superseded`, asserted by the residue test on the injected emitter stub.
- The sweep binding in the daemon command module passes its event emitter into the resolution deps, asserted by the daemon wiring test that the deps object carries the emitter.
- The sweep binding starts a feature-scoped persisted bus with `startFeatureEventPersistence` for the resolved feature's worktree, so each excused commit's residue event is appended to that worktree's `.pipeline/events.jsonl`, asserted by a test that reads the persisted line after resolution.

**Files:** `src/conductor/src/engine/autoresolve.ts`; `src/conductor/src/daemon-cli.ts`; `src/conductor/test/engine/autoresolve-supersession.test.ts`

**Dependencies:** Task 7

### Task 11: Post the resolution audit comment after publication
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests: after a judged publication the comment stub receives one upsert under marker `<!-- conductor:supersession-audit -->` whose body names the choice, the rationale, each superseded sha, and the literal suite command with `exit 0`; a second publication reuses the same marker; a throwing comment stub leaves the outcome `refreshed`, logs the failure, and the verdict event stub is still called; a publication with no verdict produces no upsert.
2. Verify tests fail (RED)
3. Implement: export `SUPERSESSION_AUDIT_MARKER` beside the existing comment markers and a `postSupersessionAudit` helper in the autoresolve module that calls the existing `upsertComment` seam. Call it only after `publishResolution` reports published and only when a validated verdict exists; wrap it so a failure is logged and never changes the outcome. Order: emit the verdict event (Task 12) before attempting the comment.
4. Verify tests pass (GREEN)
5. Commit

**Done when:**
- `postSupersessionAudit` upserts one comment under `SUPERSESSION_AUDIT_MARKER` whose body contains the verdict choice, rationale, each superseded sha, and the literal suite command with its zero exit, asserted by the audit body test.
- A second judged publication calls `upsertComment` with the same marker so the comment is edited in place, asserted by the repeat-publication test.
- When the comment stub throws, `resolveConflictingPr` still returns `refreshed`, logs the failure, the verdict event stub has been called, and the already-invoked lease push is not reverted (no further push, reset, or force-push call reaches the git stub), asserted by the comment-failure test.
- `postSupersessionAudit` is not called when the published attempt carried no verdict, and is never called before the suite stub has returned, asserted by the call-order assertions in the strict-path and audit tests.

**Files:** `src/conductor/src/engine/autoresolve.ts`; `src/conductor/src/engine/pr-labels.ts`; `src/conductor/test/engine/autoresolve-audit.test.ts`

**Dependencies:** Task 7, Task 12

### Task 12: Emit the supersession verdict on the event spine
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests: the `ConductorEvent` union accepts `{ type: "rebase_supersession_verdict", prUrl, choice, rationale, superseded, verification: { command, exitCode } }`; the sink registry declares it with persist on; `resolveConflictingPr` emits exactly one after a judged publication.
2. Verify tests fail (RED)
3. Implement: add the variant to the event union and its declaration to the event sink registry (render on, persist on, audit off), then emit it from `resolveConflictingPr` through the injected emitter after publication succeeds. Read the repository event-spine skill before editing; extend the union, add no sidecar.
4. Verify tests pass (GREEN)
5. Commit

**Done when:**
- `resolveConflictingPr` emits exactly one `rebase_supersession_verdict` event carrying the choice, rationale, superseded shas, and the verification command with exit code after a judged publication, asserted by the emitter stub test.
- The event sink registry declares `rebase_supersession_verdict` with persistence on, asserted by the registry exhaustiveness typecheck and the sink declaration test.
- The verdict event is appended to the feature's `.pipeline/events.jsonl` through that same feature-scoped persisted emitter, never the daemon ledger, asserted by a test that reads the persisted line after a judged publication.

**Files:** `src/conductor/src/types/events.ts`; `src/conductor/src/engine/event-sinks.ts`; `src/conductor/src/engine/autoresolve.ts`; `src/conductor/test/engine/autoresolve-audit.test.ts`

**Dependencies:** Task 10

### Task 13: Record the escalation cause on the watch entry
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests: a sweep tick whose autoresolve dispatch returns `escalated` for a conflicting pull request persists the entry with `escalationCause: "conflict-resolution"`; a registry line without the field loads with the field undefined and saves without adding it.
2. Verify tests fail (RED)
3. Implement: add optional `escalationCause?: "conflict-resolution"` and `labelClearAttempts?: number` to `WatchEntry`; set the cause where the sweep handles an `escalated` dispatch result. The cause type is a closed string union, not a boolean, so later causes extend the set.
4. Verify tests pass (GREEN)
5. Commit

**Done when:**
- The sweep writes `escalationCause: "conflict-resolution"` on the surviving watch entry when the autoresolve dispatch result kind is `escalated`, asserted by the sweep cause test reading the persisted registry.
- A registry line lacking `escalationCause` round-trips through load and save with the field still absent, and a sweep tick over that labeled, non-conflicting legacy entry treats it as having no recorded cause and issues no `removeLabel` call, asserted by the legacy-entry test.

**Files:** `src/conductor/src/engine/mergeable-sweep.ts`; `src/conductor/test/engine/mergeable-sweep-label-clear.test.ts`

**Dependencies:** none

### Task 14: Expose the halt body marker on the merge state read
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing test: `prMergeState` parsing a response whose body contains the needs-remediation body marker returns `hasHaltBodyMarker: true`, and false when the body lacks it or is absent.
2. Verify test fails (RED)
3. Implement: request the `body` field in the existing pull request read and derive `hasHaltBodyMarker` with the existing `NEEDS_REMEDIATION_BODY_MARKER` constant. Add no second gh call.
4. Verify test passes (GREEN)
5. Commit

**Done when:**
- `prMergeState` returns `hasHaltBodyMarker` true exactly when the pull request body contains `NEEDS_REMEDIATION_BODY_MARKER`, asserted by the merge-state parse test over the present, absent, and missing-body fixtures.
- The pull request read issues the same number of gh invocations as before, asserted by the gh stub call count in the same test.

**Files:** `src/conductor/src/engine/pr-labels.ts`; `src/conductor/test/engine/pr-labels-merge-state.test.ts`

**Dependencies:** none

### Task 15: Clear a conflict-caused label once the pull request no longer conflicts
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing sweep tests with a gh stub: labeled entry with conflict cause, mergeable state not conflicting, no halt marker, expect one `removeLabel` call for `needs-remediation`; on the following tick with the label gone expect the cause and attempt count cleared; then a conflicting tick passes the sticky-label eligibility gate. Negative fixtures: still conflicting; no recorded cause; halt marker present; merge state `UNKNOWN` or a read failure. Each negative asserts zero `removeLabel` calls for that label.
2. Verify tests fail (RED)
3. Implement: a `maybeClearConflictLabel(entry, state)` step in the sweep per-entry label pass, before autoresolve eligibility. Issue the removal only when the label is present, the cause is `conflict-resolution`, `state.mergeable` is `MERGEABLE`, no read failure is present, and `hasHaltBodyMarker` is false. When the cause is set and the label is absent, clear the cause and the attempt count. Use the existing `removeLabel` seam.
4. Verify tests pass (GREEN)
5. Commit

**Done when:**
- `maybeClearConflictLabel` calls `removeLabel` for `needs-remediation` exactly once when the entry cause is `conflict-resolution`, `state.mergeable` is `MERGEABLE`, and `hasHaltBodyMarker` is false, asserted by the clear test.
- On a tick where the cause is set and the label is absent, the sweep clears `escalationCause` and `labelClearAttempts`, and a later conflicting tick is not skipped by the sticky-label gate, asserted by the two-tick eligibility test.
- `maybeClearConflictLabel` issues no removal when the state is conflicting, when the entry has no recorded cause, when `hasHaltBodyMarker` is true, or when the merge state is unknown or unreadable, and the still-conflicting labeled entry is reported by eligibility as skipped by the sticky-label gate, asserted by the four negative sweep tests.

**Files:** `src/conductor/src/engine/mergeable-sweep.ts`; `src/conductor/test/engine/mergeable-sweep-label-clear.test.ts`

**Dependencies:** Task 13, Task 14

### Task 16: Bound label-clear retries at three
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing sweep tests: label still present after one issued removal, expect `labelClearAttempts` 1 then a second removal; after three issued removals with the label still present, expect the cause cleared, exactly one log line naming the pull request, and zero further removals on later ticks.
2. Verify tests fail (RED)
3. Implement: increment `labelClearAttempts` each time `maybeClearConflictLabel` issues a removal; when it is already 3 and the label is still present, clear the cause and the count and log once.
4. Verify tests pass (GREEN)
5. Commit

**Done when:**
- `maybeClearConflictLabel` re-issues the removal and increments `labelClearAttempts` while the count is below 3 and the label is still present, asserted by the retry test.
- When `labelClearAttempts` is 3 and the label is still present, the sweep clears the cause, writes one log line containing the pull request URL, and issues no removal on that or later ticks, asserted by the retry-cap test across five ticks.

**Files:** `src/conductor/src/engine/mergeable-sweep.ts`; `src/conductor/test/engine/mergeable-sweep-label-clear.test.ts`

**Dependencies:** Task 15

### Task 17: Add the sweep test-only judgement section to the rebase skill
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: the rebase skill file contains a heading `Sweep Test-Only Judgement`; that section states the verdict JSON shape with the three-value choice set; the Ambiguity Gate section states the exception applies only when the dispatch prompt says it is in force; the never-skip constraint names the declared-superseded exception.
2. Verify test fails (RED)
3. Implement: add the section to the shared rebase skill. Content: it applies only when the engine prompt says the exception is in force; full-replay inspection, staged-change attribution, and the post-continue recheck are unchanged; the resolver may keep source, keep upstream by declaring the replayed commit superseded (the one case where `git rebase --skip` is permitted, for that commit only), or merge both; it must return the verdict on its final line; if it cannot choose it returns unresolved in the existing shape. This is a provider-neutral shipped skill; run the repository scope-check first.
4. Verify test passes (GREEN)
5. Commit

**Done when:**
- The rebase skill file contains a `Sweep Test-Only Judgement` section that defines the verdict JSON with choice values `superseded`, `merged`, and `source`, asserted by the skill contract test reading the file.
- The skill constraint forbidding `git rebase --skip` names the declared-superseded commit under that section as its only exception, asserted by the same contract test.

**Files:** `skills/rebase/SKILL.md`; `src/conductor/test/skills/rebase-skill-sweep-judgement.test.ts`

**Dependencies:** Task 2

### Task 18: Distinguish judgement mode from legacy strict callers in the preservation guard
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests against the existing scratch-repository guard fixtures: with `declaredSuperseded` omitted (`undefined`) an undeclared missing commit that upstream superseded still passes through `supersededByBase` exactly as before; with `declaredSuperseded: []` the same undeclared missing commit fails naming the subject; with a non-empty array an undeclared missing commit fails even when upstream superseded it.
2. Verify tests fail (RED)
3. Implement: in `runAcceptanceGuards` treat `declaredSuperseded === undefined` as legacy strict mode (unchanged behavior, `supersededByBase` may excuse) and any array, including an empty one, as judgement mode where a missing commit is excused only by an explicit declaration. Make the sweep resolution flow in `resolveConflictingPr` always pass an array (empty when the verdict declares nothing) and leave finish-time and re-kick callers passing nothing. Do not default the parameter to `[]`.
4. Verify tests pass (GREEN)
5. Commit

**Done when:**
- `runAcceptanceGuards` called with `declaredSuperseded` omitted returns results identical to the pre-change guard for an undeclared missing commit that upstream superseded, asserted by the legacy-mode test reusing the existing supersededByBase fixture.
- `runAcceptanceGuards` called with `declaredSuperseded: []` returns a `featureCommitsPreserved` failure naming the subject for that same fixture, asserted by the judgement-mode empty-declarations test.
- `resolveConflictingPr` passes an array to `runAcceptanceGuards` on every sweep resolution, including one whose verdict declares nothing, asserted by a spy on the guard call in the sweep integration test, while the finish-time rebase step passes no `declaredSuperseded` argument, asserted by the finish-time boundary test.

**Files:** `src/conductor/src/engine/autoresolve.ts`; `src/conductor/src/engine/rebase.ts`; `src/conductor/test/engine/autoresolve-guards.test.ts`; `src/conductor/test/engine/autoresolve-supersession.test.ts`

**Dependencies:** Task 6, Task 7

### Task 19: Name why each excused commit was excused on the guard result
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write a failing test: for the declared-drop scratch-repository fixture, the ok guard result's `excused` entry carries `reason: "declared-superseded-test-only"` and a `paths` array equal to the test paths the commit touched.
2. Verify test fails (RED)
3. Implement: widen the `excused` element type on the ok result of `runAcceptanceGuards` to `{ sha, subject, reason, paths }` with `reason` a closed literal union whose only current member is `declared-superseded-test-only`; populate `paths` from the same `git show --name-only` listing the excuse check already reads. Make the residue event in Task 10 take its reason from the guard result instead of a hard-coded string.
4. Verify test passes (GREEN)
5. Commit

**Done when:**
- The ok result of `runAcceptanceGuards` lists each excused commit with `sha`, `subject`, `reason` equal to `declared-superseded-test-only`, and `paths` equal to the test paths that commit touched, asserted by the declared-drop scratch-repository test.
- The `rebase_citation_residue` event emitted for an excused commit carries the reason read from the guard result rather than a literal in the emitter, asserted by a test that substitutes a guard result with a different reason value and observes it on the event.

**Files:** `src/conductor/src/engine/autoresolve.ts`; `src/conductor/test/engine/autoresolve-guards.test.ts`; `src/conductor/test/engine/autoresolve-supersession.test.ts`

**Dependencies:** Task 6, Task 10

### Task 20: Drop any verdict returned on a strict-path resolution
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing integration tests on `resolveConflictingPr` with scope `mixed`: the resolver returns a resolved result carrying a schema-valid verdict with an empty `superseded` list, and separately a verdict with `choice: "merged"`; expect `refreshed`, one lease push, no `rebase_supersession_verdict` event, no audit comment, the guard called with no `declaredSuperseded` argument, and one log line stating the verdict was ignored because the exception was not in force.
2. Verify tests fail (RED)
3. Implement: in the strict path (scope `mixed`, or judgement not in force), discard any verdict on the resolved attempt before validation, guards, publication, audit, and event emission, and log one line naming the pull request; only a non-empty `superseded` list still escalates `tier2-verdict` per Task 3.
4. Verify tests pass (GREEN)
5. Commit

**Done when:**
- `resolveConflictingPr` returns `refreshed` for a non-test conflict whose resolved attempt carries a schema-valid empty verdict, with the event stub and audit comment stub never called and the guard spy receiving no `declaredSuperseded` argument, asserted by the strict-path empty-verdict integration test.
- The same holds for a strict-path attempt whose verdict has `choice` `merged` and no superseded commits, and exactly one log line containing the pull request URL and the word `ignored` is written, asserted by the strict-path merged-verdict integration test.
- A strict-path verdict whose `superseded` list is non-empty still escalates at `tier2-verdict`, asserted by the existing Task 3 mixed-scope rejection test continuing to pass.

**Files:** `src/conductor/src/engine/autoresolve.ts`; `src/conductor/test/engine/autoresolve-supersession.test.ts`

**Dependencies:** Task 9

## Task Dependency Graph

```text
Task 1 <- none
Task 2 <- none
Task 3 <- Task 1, Task 2
Task 4 <- Task 1
Task 5 <- Task 4
Task 6 <- none
Task 7 <- Task 3, Task 4, Task 6
Task 8 <- Task 7
Task 9 <- Task 7
Task 10 <- Task 7
Task 11 <- Task 7, Task 12
Task 12 <- Task 10
Task 13 <- none
Task 14 <- none
Task 15 <- Task 13, Task 14
Task 16 <- Task 15
Task 17 <- Task 2
Task 18 <- Task 6, Task 7
Task 19 <- Task 6, Task 10
Task 20 <- Task 9
```

## Integration Points

- After Task 7: a test-only supersession conflict resolves end to end through `resolveConflictingPr` with stubbed boundaries.
- After Task 12: a judged publication is visible on the pull request and in the persisted event log.
- After Task 16: a conflict-caused label clears itself across sweep ticks, with bounded retries.
- After Task 20: the strict path ignores unsolicited verdicts and judgement mode is distinguishable from legacy callers (as-built AB-2, AB-3, AB-4 amendments, 2026-09-22).

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a watched pull request whose only remaining conflicts after tier 1 are in test files, when the resolver declares the replayed commit superseded by upstream and the configured suite command exits zero, then the rebased branch is pushed with lease protection and the sweep outcome for that pull request is refreshed rather than escalated. | 7 | "`resolveConflictingPr` returns `refreshed` and invokes the lease push stub exactly once for a test-only conflict whose resolver verdict declares the replayed commit superseded and whose suite stub exits zero, asserted by integration test (a)." | diff-local |
| Story 1 happy: Given a watched pull request whose only remaining conflicts are in test files, when the resolver merges both sides' changes without dropping any commit and the suite command exits zero, then the branch is pushed and no commit is reported as superseded. | 7 | "`resolveConflictingPr` returns `refreshed` with an empty excused list when the verdict choice is `merged` and no commit is dropped, with the suite stub exiting zero and the lease push stub invoked exactly once, asserted by integration test (b)." | diff-local |
| Story 1 negative: Given a test-only conflict the resolver settled, when the configured suite command exits non-zero, then nothing is pushed and the pull request is escalated at the suite-gate stage with the exit code in the reason. | 8 | "With the suite stub exiting non-zero, `resolveConflictingPr` escalates at stage `suite-gate` with the exit code in the reason and the push stub is never called, asserted by the suite-failure test." | diff-local |
| Story 1 negative: Given a test-only conflict, when the resolver reports it cannot choose between the two intents, then nothing is pushed and the escalation comment names the replay commit, the file and region, both intents, and the missing decision. | 8 | "With an unresolved resolver result whose reason names the replay commit, the file and region, both intents, and the missing decision, the escalation comment body contains each of those five items and the push stub is never called, asserted by the unresolved test." | diff-local |
| Story 1 negative: Given a test-only conflict, when the resolver's verdict is missing a required field or names an unknown choice, then the verdict is rejected, nothing is pushed, and the pull request is escalated with a reason naming the malformed verdict. | 3 | "`validateResolutionVerdict` returns `ok: false` with a reason starting `malformed verdict:` for a missing required field and for a choice outside the closed three-value set, asserted by the validation unit tests, and `resolveConflictingPr` given such a verdict returns `escalated` at stage `tier2-verdict` with that reason and never calls the push stub, asserted by the malformed-verdict integration test." | diff-local |
| Story 1 negative: Given a test-only conflict resolved with a passing suite, when the lease-protected push is rejected because the remote branch moved, then the pull request is escalated and no retry force-pushes over the remote. | 8 | "With the lease push stub rejecting because the remote branch moved (its fixture reports a stale-info lease rejection), `resolveConflictingPr` returns `escalated` and the push stub is called exactly once with the lease flag and never with a bare force flag, asserted by the lease test." | diff-local |
| Story 2 happy: Given a watched pull request with a conflict in a non-test file that the resolver can settle without any intent ambiguity, when the suite passes, then it is published as it is today and no supersession verdict is recorded. | 9 | "`resolveConflictingPr` returns `refreshed` for a non-test conflict resolved with no verdict, and neither the event stub nor the audit comment stub is called, asserted by the strict-path integration test." | diff-local |
| Story 2 negative: Given a watched pull request whose conflicts include one test file and one non-test file, when tier 2 is dispatched, then the resolver is not told the exception is in force and an intent conflict in either file returns unresolved and escalates. | 4 | "`runTier2` passes `supersessionJudgement: true` into `resolveRebaseConflicts` only for scope `test-only`, a `mixed` scope yields a resolver context with the field false, and a `mixed` scope whose stub resolver reports an intent conflict in either file returns `unresolved` and escalates without any push, asserted by the tier-2 unit test." | diff-local |
| Story 2 negative: Given a watched pull request with a non-test conflict, when the resolver returns a verdict declaring a commit superseded anyway, then the engine rejects the verdict, publishes nothing, and escalates. | 3 | "`validateResolutionVerdict` returns `ok: false` when `superseded` is non-empty and the scope is `mixed`, asserted by the non-test-scope unit test, and `resolveConflictingPr` given that verdict returns `escalated` at stage `tier2-verdict` with the push stub and comment upsert never called, asserted by the mixed-scope integration test." | diff-local |
| Story 2 negative: Given a feature at finish time whose rebase conflict is confined to test files, when the resolver is dispatched, then the exception is not in force and a semantic intent conflict halts the feature exactly as before this change. | 5 | "The finish-time rebase step hands its resolver a context with `supersessionJudgement` false for a test-only conflict fixture, and a stub resolver reporting a semantic intent conflict in that fixture halts the feature with the same halt reason as before this change, asserted by the finish-time boundary test capturing the stub resolver argument and the halt." | diff-local |
| Story 2 negative: Given a daemon re-kick that resumes a paused rebase with a test-only conflict, when the resolver is dispatched, then the exception is not in force. | 5 | "The daemon re-kick resume path hands its resolver a context with `supersessionJudgement` false for a test-only conflict fixture, asserted by the re-kick boundary test capturing the stub resolver argument." | diff-local |
| Story 3 happy: Given a verdict declaring one commit superseded, when that commit was replayed by this rebase and every path it touched is a test path, then the work-preservation guard passes although the commit's subject is absent from the rebased branch. | 6 | "`runAcceptanceGuards` returns ok with the commit listed in `excused` when its sha is in `declaredSuperseded` and every path it touched satisfies `isTestPath`, asserted by the declared-drop scratch-repository test." | diff-local |
| Story 3 happy: Given a declared-superseded commit that passed the guard, when the resolution completes, then the commit is recorded as rebase residue on the existing residue event. | 10 | "`resolveConflictingPr` emits one `rebase_citation_residue` event containing each excused sha with reason `declared-superseded`, asserted by the residue test on the injected emitter stub." | diff-local |
| Story 3 negative: Given a rebased branch missing a feature commit the verdict did not declare, when the guard runs, then it fails naming the missing subject and the pull request is escalated at the acceptance-guards stage. | 18 | "`runAcceptanceGuards` called with `declaredSuperseded: []` returns a `featureCommitsPreserved` failure naming the subject for that same fixture, asserted by the judgement-mode empty-declarations test." | diff-local |
| Story 3 negative: Given a verdict declaring a commit that touched one test file and one non-test file, when the guard runs, then the declaration is refused and the guard fails. | 6 | "`runAcceptanceGuards` refuses a declaration whose commit touched any non-test path and evaluates every declaration individually, asserted by the mixed-path and all-declared tests." | diff-local |
| Story 3 negative: Given a verdict declaring a commit id that this rebase never replayed, when the verdict is validated, then it is rejected and nothing is published. | 3 | "`validateResolutionVerdict` returns `ok: false` when a `superseded` sha is absent from `replayedShas`, asserted by the never-replayed unit test, and `resolveConflictingPr` given that verdict publishes nothing (push stub and comment upsert never called) and returns `escalated`, asserted by the never-replayed integration test." | diff-local |
| Story 3 negative: Given a verdict declaring every feature commit superseded, when the guard runs, then each declaration is checked individually and any non-test commit among them fails the guard. | 6 | "`runAcceptanceGuards` refuses a declaration whose commit touched any non-test path and evaluates every declaration individually, asserted by the mixed-path and all-declared tests." | diff-local |
| Story 4 happy: Given a resolution published under the exception, when publication succeeds, then a comment on the pull request names the choice, the rationale, each superseded commit, and the verification command that ran with its passing result. | 11 | "`postSupersessionAudit` upserts one comment under `SUPERSESSION_AUDIT_MARKER` whose body contains the verdict choice, rationale, each superseded sha, and the literal suite command with its zero exit, asserted by the audit body test." | diff-local |
| Story 4 happy: Given a resolution published under the exception, when publication succeeds, then one verdict event carrying the same facts is persisted to the feature's event log through the existing emitter. | 12 | "`resolveConflictingPr` emits exactly one `rebase_supersession_verdict` event carrying the choice, rationale, superseded shas, and the verification command with exit code after a judged publication, asserted by the emitter stub test." | diff-local |
| Story 4 happy: Given a second judged resolution on the same pull request, when it is published, then the existing audit comment is updated in place rather than duplicated. | 11 | "A second judged publication calls `upsertComment` with the same marker so the comment is edited in place, asserted by the repeat-publication test." | diff-local |
| Story 4 negative: Given a resolution published under the exception, when posting the audit comment fails, then the push is not reverted, the failure is logged, and the verdict event is still persisted. | 11 | "When the comment stub throws, `resolveConflictingPr` still returns `refreshed`, logs the failure, the verdict event stub has been called, and the already-invoked lease push is not reverted (no further push, reset, or force-push call reaches the git stub), asserted by the comment-failure test." | diff-local |
| Story 4 negative: Given a repository with no suite command configured, when a test-only conflict is settled, then nothing is published and no audit comment claims a verification. | 8 | "With the suite stub reporting not configured, `resolveConflictingPr` escalates with reason `no suite command configured`, the push stub is never called, and the comment stub receives no audit comment, asserted by the not-configured test." | diff-local |
| Story 4 negative: Given a resolution published without the exception, when publication succeeds, then no supersession audit comment is posted. | 20 | "`resolveConflictingPr` returns `refreshed` for a non-test conflict whose resolved attempt carries a schema-valid empty verdict, with the event stub and audit comment stub never called and the guard spy receiving no `declaredSuperseded` argument, asserted by the strict-path empty-verdict integration test." | diff-local |
| Story 5 happy: Given autoresolve escalates a conflicting pull request, when the sweep records the outcome, then the watch entry stores conflict resolution as the escalation cause. | 13 | "The sweep writes `escalationCause: "conflict-resolution"` on the surviving watch entry when the autoresolve dispatch result kind is `escalated`, asserted by the sweep cause test reading the persisted registry." | diff-local |
| Story 5 happy: Given a pull request labeled needs-remediation with a recorded conflict cause, when a sweep tick finds it no longer conflicting and its body carries no halt marker, then the sweep issues the label removal, and once a later read shows the label gone the recorded cause is cleared. | 15 | "`maybeClearConflictLabel` calls `removeLabel` for `needs-remediation` exactly once when the entry cause is `conflict-resolution`, `state.mergeable` is `MERGEABLE`, and `hasHaltBodyMarker` is false, asserted by the clear test." | diff-local |
| Story 5 happy: Given a pull request whose label was cleared this way, when it later becomes conflicting again, then it passes the sticky-label eligibility gate. | 15 | "On a tick where the cause is set and the label is absent, the sweep clears `escalationCause` and `labelClearAttempts`, and a later conflicting tick is not skipped by the sticky-label gate, asserted by the two-tick eligibility test." | diff-local |
| Story 5 negative: Given a labeled pull request with a recorded conflict cause, when it is still conflicting, then the label stays and eligibility reports the sticky escalation skip. | 15 | "`maybeClearConflictLabel` issues no removal when the state is conflicting, when the entry has no recorded cause, when `hasHaltBodyMarker` is true, or when the merge state is unknown or unreadable, and the still-conflicting labeled entry is reported by eligibility as skipped by the sticky-label gate, asserted by the four negative sweep tests." | diff-local |
| Story 5 negative: Given a pull request labeled after ci-fix exhaustion with no recorded conflict cause, when it is not conflicting, then the sweep never removes the label. | 15 | "`maybeClearConflictLabel` issues no removal when the state is conflicting, when the entry has no recorded cause, when `hasHaltBodyMarker` is true, or when the merge state is unknown or unreadable, and the still-conflicting labeled entry is reported by eligibility as skipped by the sticky-label gate, asserted by the four negative sweep tests." | diff-local |
| Story 5 negative: Given a labeled pull request with a recorded conflict cause, when its body carries a halt marker, then the sweep does not remove the label. | 15 | "`maybeClearConflictLabel` issues no removal when the state is conflicting, when the entry has no recorded cause, when `hasHaltBodyMarker` is true, or when the merge state is unknown or unreadable, and the still-conflicting labeled entry is reported by eligibility as skipped by the sticky-label gate, asserted by the four negative sweep tests." | diff-local |
| Story 5 negative: Given a watch entry written before this change with no cause field, when the sweep reads it, then it is treated as having no recorded cause and the label is left alone. | 13 | "A registry line lacking `escalationCause` round-trips through load and save with the field still absent, and a sweep tick over that labeled, non-conflicting legacy entry treats it as having no recorded cause and issues no `removeLabel` call, asserted by the legacy-entry test." | diff-local |
| Story 5 negative: Given the sweep issued a label removal and the next read still shows the label, when fewer than three removals have been issued for that pull request, then the recorded cause is retained and the removal is issued again. | 16 | "`maybeClearConflictLabel` re-issues the removal and increments `labelClearAttempts` while the count is below 3 and the label is still present, asserted by the retry test." | diff-local |
| Story 5 negative: Given three label removals have been issued for a pull request and the label is still present, when the next tick runs, then the recorded cause is cleared, one log line names the pull request, the label is left in place, and no further removal is issued. | 16 | "When `labelClearAttempts` is 3 and the label is still present, the sweep clears the cause, writes one log line containing the pull request URL, and issues no removal on that or later ticks, asserted by the retry-cap test across five ticks." | diff-local |
| Story 5 negative: Given the pull request's merge state is unknown, when the sweep evaluates the clear, then the label is left alone. | 15 | "`maybeClearConflictLabel` issues no removal when the state is conflicting, when the entry has no recorded cause, when `hasHaltBodyMarker` is true, or when the merge state is unknown or unreadable, and the still-conflicting labeled entry is reported by eligibility as skipped by the sticky-label gate, asserted by the four negative sweep tests." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-01-rebase-full-replay-intent-validation#D1 | task | task-4, task-17 | The step runner `resolveRebaseConflict` prompt contains the text `Sweep Test-Only Judgement` only when the context field is true, and is byte-identical to the current prompt when false, asserted by the prompt unit test. |
| adr-2026-06-29-rebase-conflict-resolution-dispatch#D1 | task | task-6 | `runAcceptanceGuards` returns ok with the commit listed in `excused` when its sha is in `declaredSuperseded` and every path it touched satisfies `isTestPath`, asserted by the declared-drop scratch-repository test. |
| adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep#D1 | task | task-11, task-12 | `postSupersessionAudit` upserts one comment under `SUPERSESSION_AUDIT_MARKER` whose body contains the verdict choice, rationale, each superseded sha, and the literal suite command with its zero exit, asserted by the audit body test. |
| adr-2026-07-04-autoresolve-state-and-config#D1 | task | task-13, task-15 | `maybeClearConflictLabel` calls `removeLabel` for `needs-remediation` exactly once when the entry cause is `conflict-resolution`, `state.mergeable` is `MERGEABLE`, and `hasHaltBodyMarker` is false, asserted by the clear test. |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks naming a mechanism
- [x] Dependencies are explicit and acyclic
- [x] No terminal catch-all validation task
