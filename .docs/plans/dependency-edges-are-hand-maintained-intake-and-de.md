# Implementation Plan: Machine-Authored and Machine-Verified Issue Dependency Edges

**Date:** 2026-10-09
**Design:** .docs/specs/2026-10-09-dependency-edges-are-hand-maintained-intake-and-de.md
**Stories:** .docs/stories/dependency-edges-are-hand-maintained-intake-and-de.md
**Conflict check:** Clean as of 2026-10-09 (.docs/conflicts/2026-10-09-dependency-edges-are-hand-maintained-intake-and-de.md)
**ADRs:** adr-2026-10-09-dependency-reconciler-and-edge-write-ownership, adr-2026-10-09-dependency-drift-sweep-on-intake-tick
**Source-Ref:** jstoup111/ai-conductor#536

## Summary

The plan adds one dependency reconciler and gives it four callers:
- the intake label-sync Action, which links prose on `opened`/`edited`;
- `compose land`, which runs a refuse-until-decided proposal gate and writes accepted edges after commit;
- a read-only `compose dep-audit` verb;
- an hourly-gated drift sweep on the intake loop's reconcile hook.

It also adds two new `ConductorEvent` variants and three new land-gate identifiers. 18 tasks.

## Technical Approach

### Reconciler
New module `src/conductor/src/engine/engineer/dependency-reconciler.ts`.
- `declaredEdges({ ref, body, formDependsOn? })` returns `{ edges, manualReview }`. It unions the structured Depends-on refs with `parseDependencyProse` (in `issue-dep-migration.ts`, unchanged) and dedupes by target. It drops self-references, and drops cross-repo, reverse-direction and task-list references into `manualReview`.
- `compareEdges(declared, actualBlockedBy)` returns `{ unlinked, satisfied }`.
- `sweepDependencyDrift({ repository, tracker, resolver })` returns a closed result:
  - `{ kind: 'swept', unlinked, stale, cycles, contradictions, indeterminate }`, or
  - `{ kind: 'repository-indeterminate', cause }`.
- Drift categories form a closed union. A stale finding is a blocker whose `state_reason` is `not_planned`. A blocker closed as `completed` is never a finding.
- Reads go only through `TrackerClient` (`getBlockedBy`, open-issue listing with bodies) and `BlockerResolver` (cycles). There are no `blocking`-list reads.
- Every read error or rate-limit response marks that issue indeterminate, with no retry.

### Action
The logic in `src/conductor/scripts/intake-label-sync-apply.mts` moves into an exported, testable `applyIssueEventSync(event, deps)` in `src/conductor/src/engine/engineer/intake/issue-event-sync.ts`. The script becomes a thin entry: it reads `GITHUB_EVENT_PATH`, calls the function, prints the report, and exits 0 whenever only link writes failed.
- Labels still run only for `isIssueFormSubmission` bodies.
- Dependency linking runs for every body. It uses `declaredEdges` over the raw event body, then `createDependencyLinks` through the existing guarded runner (`createGuardedGithubOperationRunner` + `createGithubIntakeAuthorization`).
- The guarded runner already enforces adr-2026-09-11 D2/D3 ownership, so a write to an issue the operator does not own is refused as `explicit-authorization-required`. That refusal is reported as a failed target.
- Linking is additive only: nothing in this path calls a remove operation.
- Prose is the declaration of record. A declared-but-absent link is re-created on every processed event.

### Land
New module `src/conductor/src/engine/engineer/land-dependency-gate.ts`.
- `computeLandDependencyProposals({ sourceRef, planText, gh, git, cwd })`:
  - reads the source issue's raw body and `blocked_by` through the tracker;
  - takes plan paths from `parsePlanTaskPaths` (`plan-task-parse.ts`);
  - runs the existing `collectOpenIssueOverlaps`, `collectInFlightOverlaps` and `buildSuggestions` (`intake/overlap-sources.ts`, `intake/overlap-suggestions.ts`).
- `buildSuggestions` already separates linkable `shown` overlaps from marker-less `advisory` branches. Only linkable overlaps become proposals, after closed, self and already-linked targets are dropped.
- Result: `{ kind: 'computed', proposals, satisfied, advisory }` or `{ kind: 'unavailable', cause }`.
  - It is `unavailable` exactly when a tracker read fails: the source body, the source `blocked_by`, or the open-issue overlap listing. A rate limit is named as a rate limit.
  - Local git skip notes for in-flight branch diffs stay advisory notes, as in the existing preflight.
- `decideLandDependencies(input)` is a pure function returning a closed union: `proceed | refused-undecided | refused-unavailable | invalid`.

`engineer-cli.ts` parses `--depends-on`, `--decline-dependency` and `--skip-dependency-check` on `land` and passes them into `landSpec`. `landSpec` runs the gate **after target resolution and before the commit**, and raises the land-gate error under the new identifiers. That error flows through the existing `land_gate_rejected` emission in `engineer-cli.ts`. After a successful commit, the CLI land path:
1. writes the accepted edges through the guarded runner;
2. emits one `land_dependency_decided` event to the existing `composer-events.jsonl` persister.

Land without `--source-ref` never calls the gate.

### Drift
- `compose dep-audit --project <name>` is registered in `ENGINEER_SUBCOMMANDS`. It resolves the project from the registry before any tracker call, then prints the sweep. It always exits 0 for a registered project and exits non-zero for an unknown project.
- `src/conductor/src/intake-loop-cli.ts` composes an interval-gated sweep into its existing `reconcile` closure, after `reconcileClosedIssues`.
  - The gate is `DRIFT_SWEEP_INTERVAL_MS = 3_600_000`, with the last-run time held per repository in memory and an injectable clock.
  - Each due sweep emits one `dependency_drift_swept` event per repository on the loop's event emitter.
  - Its failure is caught inside the closure, so `intakeTick` is unaffected.

### Events
- `types/events.ts` gains `land_dependency_decided` and `dependency_drift_swept`. The latter carries `status: 'swept' | 'repository-indeterminate'`, so a failed issue listing is never mistaken for a clean sweep.
- `event-sinks.ts` registers both (`persist: true`, `render: false`, `audit: false`, `otel: false`), matching the `land_gate_rejected` row.
- `LandGateIdentifier` gains `dependency-proposals-undecided`, `dependency-check-unavailable` and `dependency-decisions-invalid`.

### Sequencing
- Reconciler first (Tasks 1–2). Then three independent branches: Action (Tasks 3–7), land (Tasks 8–13) and drift (Tasks 14–17).
- Task 8 (types) is shared by land and drift.

### Test pattern
Tests inject recording gh/tracker doubles at the process boundary. This follows the existing pattern in `test/engine/engineer/issue-dep-migration.test.ts`, `test/engine/blocker-resolver.test.ts` and `test/engine/engineer/land-gate-rejection.test.ts`: fake `GhRunner` / `GithubOperationRunner` that record calls. Real GitHub is never reached. Search hints: `createDependencyLinks(` callers in tests, and `land_gate_rejected` assertions reading `composer-events.jsonl`.

## Prerequisites
- None. All reused primitives exist on main.

## Tasks

### Task 1: Reconciler declared-edge extraction
**Story:** Story 1
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing unit tests in `src/conductor/test/engine/engineer/dependency-reconciler.test.ts` for `declaredEdges`. Follow the recording-double-free pure style of `issue-dep-migration.test.ts`. Cover:
   - "blocked by #10", "Depends on: #10 / #11", "Gated on #10", and form field `#10` plus prose "blocked by #12";
   - a duplicate declaration;
   - the negative set: "related to #10", "see #10", "blocks #10", "blocker for #10", "blocked by other-owner/other-repo#10", the self ref "blocked by #20" on #20, and "blocked by" with no number.
2. Verify RED.
3. Implement `declaredEdges` in `src/conductor/src/engine/engineer/dependency-reconciler.ts`. It is a union of the form refs and `parseDependencyProse`, deduped by target. Self refs yield no edge and are returned in `manualReview`, per adr-2026-10-09-dependency-reconciler-and-edge-write-ownership D1. Manual-review items from the parser are passed through.
4. Verify GREEN. Commit.

**Done when:**
- [test] `declaredEdges` returns target sets {#10}, {#10, #11}, {#10} and {#10, #12} for the four positive fixtures, and exactly one #10 edge for the duplicate-declaration fixture.
- [test] `declaredEdges` returns zero edges for each of the seven negative fixtures (related-to, see, blocks, blocker for, cross-repo, self ref, number-less "blocked by").
- [test] For the same references, the form-field input and the prose input produce identical edge lists.

**Files likely touched:**
- src/conductor/src/engine/engineer/dependency-reconciler.ts — new module, `declaredEdges`
- src/conductor/test/engine/engineer/dependency-reconciler.test.ts — new tests

**Dependencies:** none

### Task 2: Reconciler declared-vs-actual comparison
**Story:** Story 5
**Story:** Story 10
**Type:** infrastructure

**Steps:**
1. Write failing tests for `compareEdges(declared, actualBlockedBy)`, covering an unlinked target, an already-linked target, and a mix.
2. Verify RED.
3. Implement in `dependency-reconciler.ts`.
4. Verify GREEN. Commit.

**Done when:**
- [test] `compareEdges` places a declared target with no matching `blocked_by` entry in `unlinked` and a matching one in `satisfied`, and never places a target in both.
- [test] `compareEdges` with an empty declared list returns empty `unlinked` and `satisfied` regardless of actual links.

**Files likely touched:**
- src/conductor/src/engine/engineer/dependency-reconciler.ts — `compareEdges`
- src/conductor/test/engine/engineer/dependency-reconciler.test.ts — tests

**Dependencies:** Task 1

### Task 3: Action links prose on opened issues
**Story:** Story 1
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/intake/issue-event-sync.test.ts` for `applyIssueEventSync` with `opened` event fixtures and a recording guarded-runner double. Follow the `createDependencyLinks` recording-double pattern from `issue-dep-migration.test.ts`. Cover:
   - non-form bodies "This is blocked by #10.", "Depends on: #10 / #11", "Gated on #10";
   - a form submission with Depends-on `#10` and free text "blocked by #12";
   - re-processing with #20→#10 already present;
   - a duplicate declaration; a body with no recognized phrasing; "blocked by #10" plus "related to #11".
2. Verify RED.
3. Create `src/conductor/src/engine/engineer/intake/issue-event-sync.ts`, exporting `applyIssueEventSync(event, deps)`:
   - labels run only when `isIssueFormSubmission(body)`;
   - dependency linking runs for every body via `declaredEdges` and `createDependencyLinks`;
   - it returns a report `{ links: DependencyLinkResult[], failures: { target, reason }[], labels }`.
4. Verify GREEN. Commit.

**Done when:**
- [test] `applyIssueEventSync` on an `opened` non-form #20 fixture issues blocked_by writes #20→#10 for "This is blocked by #10.", #20→#10 and #20→#11 for "Depends on: #10 / #11", and #20→#10 for "Gated on #10".
- [test] A form-submission #20 fixture with Depends-on `#10` and free text "blocked by #12" issues blocked_by writes for both #10 and #12, and still applies the priority/size labels.
- [test] Re-processing the same `opened` event when #20→#10 already exists issues no POST, leaves exactly one #10 link, and reports #10 as `already-present` with an empty failures list.
- [test] A body declaring "blocked by #10" twice issues exactly one #10 write. A body with no recognized phrasing issues zero dependency writes, and the function resolves with an empty failures list.
- [test] A body with "blocked by #10" and "related to #11" issues a blocked_by write for #10 only.

**Files likely touched:**
- src/conductor/src/engine/engineer/intake/issue-event-sync.ts — new, `applyIssueEventSync`
- src/conductor/test/engine/engineer/intake/issue-event-sync.test.ts — new tests

**Dependencies:** Task 1

### Task 4: Action creates no edge for ambiguous, reverse, cross-repo or self references
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `issue-event-sync.test.ts`: `opened` fixtures for "related to #10", "see #10", "blocks #10", "blocker for #10", "blocked by other-owner/other-repo#10", "blocked by #20" on #20, and "blocked by" with no number. The recording runner asserts on every write call.
2. Verify RED (if the Task 3 implementation already passes, record the evidence and keep the test).
3. Adjust `applyIssueEventSync` so manual-review items never reach `createDependencyLinks`.
4. Verify GREEN. Commit.

**Done when:**
- [test] For each fixture on #20, `applyIssueEventSync` issues zero blocked_by writes: "related to #10", "see #10", "blocks #10", "blocker for #10", "blocked by other-owner/other-repo#10", "blocked by #20", and "blocked by" with no issue number.
- [test] For "blocks #10" and "blocker for #10", neither #20→#10 nor #10→#20 is written.
- [test] For the self-reference fixture "blocked by #20" on #20, the recording runner observes zero tracker write attempts of any kind.

**Files likely touched:**
- src/conductor/src/engine/engineer/intake/issue-event-sync.ts — guard
- src/conductor/test/engine/engineer/intake/issue-event-sync.test.ts — tests

**Dependencies:** Task 3

### Task 5: Action processes edited issues additively, with prose as the declaration of record
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests with `edited` fixtures:
   - "blocked by #10" added to unlinked #20;
   - "depends on #11" added while #10 is linked;
   - "blocked by #10" removed; "blocked by #10" replaced by "blocked by #12";
   - a title-only edit whose body still declares the already-linked #10;
   - the body still declares #10 but the #20→#10 link is absent.
   The recording runner records any remove calls (DELETE / `removeIssueDependency`).
2. Verify RED.
3. Ensure `applyIssueEventSync` handles `edited` identically to `opened`: compute declared edges from the current body and link additively, never removing anything.
4. Verify GREEN. Commit.

**Done when:**
- [test] An `edited` fixture adding "blocked by #10" to unlinked #20 writes #20→#10. An edit adding "depends on #11" while #10 is linked writes #20→#11 only, leaving #20 blocked by both #10 and #11.
- [test] Edits that remove "blocked by #10", or replace it with "blocked by #12", issue zero remove calls (DELETE or `removeIssueDependency`) on the recording runner, so #10 stays linked. The replacement edit also writes #20→#12.
- [test] A title-only `edited` event whose body declares only the already-linked #10 issues zero POSTs and leaves #20's links unchanged. A title-only edit whose body declares an unlinked #10 writes #20→#10, because prose is the declaration of record.
- [test] When the body still says "blocked by #10" but the #20→#10 link is absent, processing the next `edited` event writes #20→#10 again.

**Files likely touched:**
- src/conductor/src/engine/engineer/intake/issue-event-sync.ts — edited handling
- src/conductor/test/engine/engineer/intake/issue-event-sync.test.ts — tests

**Dependencies:** Task 3

### Task 6: Action reports unlinkable targets without failing the rest of the issue
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests:
   - an operator-assigned form #20 declaring "blocked by #10 / #99999", where #99999 does not exist;
   - the guarded runner refusing #10 with a cycle-rejection response;
   - every dependency call failing with a network error, on a form-submission #20 so that label sync applies;
   - #20 not assigned exclusively to the resolved operator, so `createGithubIntakeAuthorization` refuses `explicit-authorization-required`. Authorization is resolved afresh for every event, `edited` included, and never inherited from an earlier run.
2. Verify RED.
3. Catch each per-target failure and refusal into `failures` with its reason. Always run label sync for form bodies. Never throw from `applyIssueEventSync` for link failures.
4. Verify GREEN. Commit.

**Done when:**
- [test] For an operator-assigned form #20 declaring "blocked by #10 / #99999", where #99999 does not exist, the #10 link is written, the priority/size labels are applied, the report lists #99999 as failed with its reason, and `applyIssueEventSync` resolves without throwing.
- [test] When the guarded runner refuses #10 with a cycle-rejection response, no #10 link is written, the report names #10 with that refusal reason, and the function resolves.
- [test] When every dependency call fails with a network error, zero links are written, every declared target appears in `failures`, and the label-sync step is still invoked.
- [test] For a #20 not assigned exclusively to the resolved operator, no #10 link is written, the report names #10 with reason `explicit-authorization-required`, and the function resolves.

**Files likely touched:**
- src/conductor/src/engine/engineer/intake/issue-event-sync.ts — failure capture
- src/conductor/test/engine/engineer/intake/issue-event-sync.test.ts — tests

**Dependencies:** Task 3

### Task 7: Wire the intake Action entry point to the issue-event sync
**Story:** Story 1
**Story:** Story 2
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Extend `src/conductor/test/acceptance/intake-form-label-sync.test.ts` with failing cases that run the script entry with a `GITHUB_EVENT_PATH` fixture and a stub gh:
   - a non-form `opened` event with "blocked by #10";
   - an `edited` event;
   - a run where only link writes fail.
   Also assert that `.github/workflows/intake-label-sync.yml` lists `issues` types `opened` and `edited`.
2. Verify RED.
3. Make `src/conductor/scripts/intake-label-sync-apply.mts` a thin entry: export `runIntakeLabelSyncApply(env)`, call `applyIssueEventSync`, print each failure with its reason, exit 0 when only link writes failed, and guard the top-level `main()` call. Remove the non-form early return that skipped dependency linking.
4. Verify GREEN. Commit.

**Done when:**
- [test] Running `runIntakeLabelSyncApply` with a `GITHUB_EVENT_PATH` non-form `opened` fixture containing "blocked by #10" issues a blocked_by POST for #10 on the stub gh and exits 0.
- [test] Running it with an `edited` fixture that adds "depends on #11" issues a blocked_by POST for #11.
- [test] Running it where only link writes fail exits 0 and prints each failed target with its reason.
- [test] The parsed `.github/workflows/intake-label-sync.yml` triggers on `issues` with types including `opened` and `edited`.

**Files likely touched:**
- src/conductor/scripts/intake-label-sync-apply.mts — thin entry delegating to `applyIssueEventSync`
- src/conductor/test/acceptance/intake-form-label-sync.test.ts — entry-point cases

**Dependencies:** Task 3

### Task 8: Event variants and land-gate identifiers
**Story:** Story 9
**Story:** Story 12
**Type:** infrastructure

**Steps:**
1. Write failing tests:
   - in `src/conductor/test/engine/event-sinks.test.ts`, the exhaustiveness check over `land_dependency_decided` and `dependency_drift_swept`;
   - in `src/conductor/test/engine/engineer/land-gate-rejection.test.ts`, building a rejection event for each of `dependency-proposals-undecided`, `dependency-check-unavailable` and `dependency-decisions-invalid`.
2. Verify RED.
3. Make the changes:
   - add the variants to the `ConductorEvent` union in `src/conductor/src/types/events.ts`:
     - `land_dependency_decided { repository, sourceRef, proposals, accepted, declined, skipped: { reason } | null, writes: { target, status, reason? }[] }`;
     - `dependency_drift_swept { repository, status: 'swept' | 'repository-indeterminate', unlinked, stale, cycles, contradictions, indeterminate }`;
   - register both in `src/conductor/src/engine/event-sinks.ts` with `persist: true, render: false, audit: false, otel: false`;
   - add the three ids to `LandGateIdentifier` in `src/conductor/src/engine/engineer/land-spec.ts`.
4. Verify GREEN. Commit.

**Done when:**
- [test] The event-sinks exhaustiveness test passes with `land_dependency_decided` and `dependency_drift_swept` registered as `persist: true`.
- [test] The land-gate-rejection test builds a `land_gate_rejected` event carrying each of `dependency-proposals-undecided`, `dependency-check-unavailable` and `dependency-decisions-invalid`, and none of them falls back to `unclassified`.

**Files likely touched:**
- src/conductor/src/types/events.ts — two variants
- src/conductor/src/engine/event-sinks.ts — two sink rows
- src/conductor/src/engine/engineer/land-spec.ts — three `LandGateIdentifier` members
- src/conductor/test/engine/event-sinks.test.ts — exhaustiveness
- src/conductor/test/engine/engineer/land-gate-rejection.test.ts — identifiers

**Dependencies:** none

### Task 9: Compute land dependency proposals
**Story:** Story 5
**Story:** Story 8
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/land-dependency-gate.test.ts` with recording gh/git doubles. Follow the injected-`openIssues`/`git` pattern of `test/engine/intake-overlap-sources-factory.test.ts`. Cover:
   - a declared, unlinked #520;
   - an open issue #600 sharing a plan path, and an intake-marked in-flight branch for #610 sharing a plan path;
   - an already-linked #520; "related to #520"; an overlap equal to #536; a closed overlap issue; a marker-less branch;
   - each tracker read failing (body, blocked_by, open-issue listing), as a network error and as a rate limit.
2. Verify RED.
3. Implement `computeLandDependencyProposals` in `src/conductor/src/engine/engineer/land-dependency-gate.ts`. It uses `declaredEdges` and `compareEdges` over the raw body, plan paths from `parsePlanTaskPaths`, and overlaps from `collectOpenIssueOverlaps`, `collectInFlightOverlaps` and `buildSuggestions`. It does not change the behaviour of the shared overlap helpers for the existing advisory `overlap-scan` and `intake-file` callers. It drops self, closed and already-linked targets; puts `advisory` branches into `advisory`; and returns `unavailable` on any tracker read failure. This fail-closed posture applies only to this land-gate caller, under adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 6; the shared helpers keep degrading to advisory notes for their existing callers.
4. Verify GREEN. Commit.

**Done when:**
- [test] For source #536 whose raw body says "depends on #520" with no #520 link, `computeLandDependencyProposals` returns `computed` with proposal {target #520, source `declared`}.
- [test] With open issue #600 sharing a plan files-likely-touched path, and an intake-marked in-flight branch for issue #610 changing a plan path, the proposals include #600 and #610 with source `overlap`.
- [test] An already-linked #520 is returned in `satisfied` and not in proposals. A "related to #520" body yields no declared proposal. Overlap candidates equal to #536, or that are closed issues, are absent from proposals, and the closed-issue overlap is listed in `advisory`.
- [test] A marker-less in-flight branch sharing a plan path appears only in `advisory` and never in proposals.
- [test] When the source body read, the source blocked_by read, or the open-issue overlap listing fails, the result is `unavailable` with a cause naming the failure, and a rate-limit response's cause names the rate limit. The result is never `computed` with zero proposals.

**Files likely touched:**
- src/conductor/src/engine/engineer/land-dependency-gate.ts — new, `computeLandDependencyProposals`
- src/conductor/test/engine/engineer/land-dependency-gate.test.ts — new tests

**Dependencies:** Task 1, Task 2

### Task 10: Decide land dependency outcomes
**Story:** Story 6
**Story:** Story 7
**Story:** Story 8
**Type:** negative-path

**Steps:**
1. Write failing tests in `land-dependency-gate.test.ts` for `decideLandDependencies`. Cover:
   - accept #520 with decline #600; both declined; no proposals;
   - partial decisions; a contradictory decision; a decline of the never-proposed #777;
   - a decision without source-ref; an empty skip reason;
   - unavailable with and without a skip; computed with a skip.
2. Verify RED.
3. Implement the pure `decideLandDependencies` returning `proceed | refused-undecided | refused-unavailable | invalid`. The outcome is an exhaustive switch over the proposal-result union, with no default arm.
4. Verify GREEN. Commit.

**Done when:**
- [test] `decideLandDependencies` returns `proceed` with accepted [#520] and declined [#600] when #520 is accepted and #600 declined. It returns `proceed` with empty accepted when both are declined, and `proceed` when there are no proposals and no decisions.
- [test] With only #520 decided out of proposals {#520, #600}, it returns `refused-undecided`, listing #600 with accept/decline instruction text naming `--depends-on` and `--decline-dependency`.
- [test] It returns `invalid` naming #520 as contradictory when #520 is both accepted and declined. It returns `invalid` naming #777 as an invalid decline when #777 was never proposed. It returns `invalid` stating that dependency decisions require an intake source-ref when decisions are given without one. It returns `invalid` requiring a reason for an empty skip reason.
- [test] `unavailable` with skip reason "GitHub outage" returns `proceed` with skipped {reason "GitHub outage"}. `unavailable` without a skip returns `refused-unavailable`, naming the cause and `--skip-dependency-check`. `computed` with a skip and an undecided proposal returns `refused-undecided` carrying a skip-unused note.

**Files likely touched:**
- src/conductor/src/engine/engineer/land-dependency-gate.ts — `decideLandDependencies`
- src/conductor/test/engine/engineer/land-dependency-gate.test.ts — tests

**Dependencies:** Task 9

### Task 11: Wire the land dependency gate into compose land (refusal path)
**Story:** Story 6
**Story:** Story 7
**Story:** Story 8
**Story:** Story 9
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/engineer-cli-land-dependencies.test.ts`. They drive `compose land` through the CLI land case against a fixture worktree, with a recording gh, and read `<target>/.pipeline/composer-events.jsonl`. Follow `engineer-cli-land-owner.test.ts` and `land-gate-rejection.test.ts`. Cover:
   - undecided #600;
   - tracker unreachable without a skip; a rate-limit response;
   - a contradictory decision, a never-proposed #777, a decision without `--source-ref`, an empty skip reason;
   - land without `--source-ref` with an unreachable tracker stub.
2. Verify RED.
3. Implement:
   - parse repeatable `--depends-on`, `--decline-dependency` and the single `--skip-dependency-check <reason>` in the `land` case (the parser passes an empty reason through unchanged, so `landSpec` rejects it and the rejection is recorded) of `src/conductor/src/engine/engineer-cli.ts`, and pass them to `landSpec`;
   - in `src/conductor/src/engine/engineer/land-spec.ts`, after target resolution and before the commit, call `computeLandDependencyProposals` and `decideLandDependencies` only when a source-ref is present, still validating decisions when it is absent;
   - throw the land-gate error with `dependency-proposals-undecided`, `dependency-check-unavailable` or `dependency-decisions-invalid`, so the existing `land_gate_rejected` emission records it;
   - print the decision output (proposals with source, satisfied targets, advisory notes, instructions).
4. Verify GREEN. Commit.

**Done when:**
- [test] `compose land --source-ref owner/repo#536` with undecided #600 exits non-zero, leaves the worktree HEAD unchanged, writes no link, prints #600 with how to accept or decline it, and persists exactly one `land_gate_rejected` event with gate `dependency-proposals-undecided` naming #600, and no `land_dependency_decided` event, to composer-events.jsonl.
- [test] With the tracker unreachable and no skip, land exits non-zero, leaves HEAD unchanged, prints the cause and `--skip-dependency-check`, and persists exactly one `land_gate_rejected` with gate `dependency-check-unavailable` and no `land_dependency_decided` event. A rate-limit response's printed cause names the rate limit.
- [test] A contradictory accept-and-decline of #520, a decline of the never-proposed #777, a dependency decision without `--source-ref`, and an empty skip reason each exit non-zero naming the problem, leave HEAD unchanged, write no link, and persist one `land_gate_rejected` with gate `dependency-decisions-invalid`.
- [test] `compose land` without `--source-ref` performs zero tracker dependency reads on the recording gh, emits no `land_dependency_decided` event, and commits the spec as before even when the tracker stub is unreachable.

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — land flag parsing, decision output
- src/conductor/src/engine/engineer/land-spec.ts — gate call before commit
- src/conductor/test/engine/engineer/engineer-cli-land-dependencies.test.ts — new CLI tests

**Dependencies:** Task 8, Task 9, Task 10

### Task 12: Write accepted edges after commit and record the decision
**Story:** Story 6
**Story:** Story 8
**Story:** Story 9
**Type:** happy-path

**Steps:**
1. Write failing tests in `engineer-cli-land-dependencies.test.ts`. Cover:
   - accept #520 with decline #600; both declined; no proposals;
   - a later land gate rejecting the commit with #520 accepted;
   - tracker unreachable with skip "GitHub outage";
   - a #520 write failing after commit.
2. Verify RED.
3. In the CLI land path, only when `--source-ref` is present, after `landSpec` commits successfully:
   - write the accepted edges via `createDependencyLinks` through the guarded GitHub operation runner;
   - collect each write result, recording a refusal or failure without throwing; the whole write-and-emit path catches every error, so a post-commit failure can neither skip the `land_dependency_decided` event nor raise a `land_gate_rejected` event;
   - emit exactly one `land_dependency_decided` event to the existing composer-events persister, with `skipped: null` whenever proposals were computed (an unused skip only adds the printed skip-unused note);
   - print any failed write.
4. Verify GREEN. Commit.

**Done when:**
- [test] `compose land --source-ref owner/repo#536 --depends-on owner/repo#520 --decline-dependency owner/repo#600` commits the spec, then writes exactly one blocked_by link #536→#520 through the guarded runner and none for #600. With both declined it commits and writes zero links. With no proposals it commits with zero dependency writes.
- [test] When a later land gate rejects the commit with #520 accepted, zero dependency writes are issued.
- [test] With the tracker unreachable and `--skip-dependency-check "GitHub outage"`, land commits, writes no link, and persists a `land_dependency_decided` event with skipped reason "GitHub outage" and empty proposals, accepted and declined lists.
- [test] A successful land with proposals [#520, #600] persists exactly one `land_dependency_decided` event to composer-events.jsonl with proposals [#520, #600], accepted [#520], declined [#600], and write status `created` for #520.
- [test] When the #520 write fails after commit, the spec commit stays at HEAD, land prints the failed write, and the persisted `land_dependency_decided` event records the failure for #520.

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — post-commit writes and event emission
- src/conductor/test/engine/engineer/engineer-cli-land-dependencies.test.ts — tests

**Dependencies:** Task 11

### Task 13: Composer skill instructions answer the dependency gate
**Story:** Story 6
**Type:** infrastructure

**Steps:**
1. Edit `skills/composer/SKILL.md` Step 4 ("Land the authored spec"):
   - add `--depends-on <owner/repo#N>`, `--decline-dependency <owner/repo#N>` and `--skip-dependency-check "<reason>"`;
   - state that land refuses until every proposal is decided, and that each decision goes to the operator for confirmation, never auto-answered;
   - state the two-step drop: remove the dependency prose from the issue, then delete the link.
2. Run the targeted integrity checks for skill text.
3. Commit.

**Done when:**
- `skills/composer/SKILL.md` Step 4 names `--depends-on`, `--decline-dependency` and `--skip-dependency-check "<reason>"`, and states that land refuses until every proposal is decided by the operator.
- `skills/composer/SKILL.md` Step 4 states that dropping a dependency means removing the prose and then deleting the link.

**Files likely touched:**
- skills/composer/SKILL.md — land dependency gate instructions

**Dependencies:** Task 11

### Task 14: Drift sweep classification (read-only)
**Story:** Story 10
**Story:** Story 11
**Type:** happy-path

**Steps:**
1. Write failing tests in `dependency-reconciler.test.ts` for `sweepDependencyDrift`, using a fixture tracker double that records every call. Cover:
   - open #30 "blocked by #31" unlinked; #32 blocked by #33 (`not_planned`); #34↔#35 cycle; #36 "blocks #37" while blocked by #37;
   - #38 blocked by #39 (`completed`); closed #40 "blocked by #41"; #42 "related to #43";
   - a clean fixture.
2. Verify RED.
3. Implement `sweepDependencyDrift`:
   - list open issues with bodies;
   - for each, compute `declaredEdges`, read `blocked_by` once, and classify;
   - detect cycles with `BlockerResolver` semantics over the `blocked_by` lists already read in this sweep, so each issue still costs exactly one read;
   - detect direction contradictions from manual-review reverse items matched against the issue's own `blocked_by`;
   - issue no write calls.
4. Verify GREEN. Commit.

**Done when:**
- [test] `sweepDependencyDrift` over the four-category fixture returns unlinked [#30→#31], stale [#32→#33], cycles [{#34, #35}] and contradictions [#36/#37], with no other findings.
- [test] Blockers closed as `completed` (#38→#39), closed issues (#40) and "related to #43" (#42) produce no finding in any category. A clean fixture returns empty lists in every category, with indeterminate empty.
- [test] The recording tracker double observes zero write operations (no POST, DELETE, label or comment call) across the four-category sweep, and the #32→#33 and #34/#35 links remain present in the double afterwards.

**Files likely touched:**
- src/conductor/src/engine/engineer/dependency-reconciler.ts — `sweepDependencyDrift`
- src/conductor/test/engine/engineer/dependency-reconciler.test.ts — tests

**Dependencies:** Task 1, Task 2

### Task 15: Drift sweep reports indeterminate state, never clean
**Story:** Story 13
**Type:** negative-path

**Steps:**
1. Write failing tests:
   - a 500 on #44's `blocked_by` read; a rate-limit response for #45;
   - the open-issue listing failing;
   - a blocker read failing during the cycle check.
2. Verify RED.
3. Map each failure to an indeterminate issue (or `repository-indeterminate` for a listing failure), with exactly one attempt per read.
4. Verify GREEN. Commit.

**Done when:**
- [test] A 500 on #44's blocked_by read puts #44 in `indeterminate`, while #30's unlinked finding is still reported in the same sweep result.
- [test] A rate-limit response for #45 puts #45 in `indeterminate`, and the recording double shows #45's blocked_by read invoked exactly once.
- [test] When the open-issue listing fails, the sweep returns `repository-indeterminate` with all category lists empty, not `swept` with empty lists.
- [test] When a blocker's read fails during cycle checking, the affected issue is present in `indeterminate` and absent from `cycles`.

**Files likely touched:**
- src/conductor/src/engine/engineer/dependency-reconciler.ts — indeterminate mapping
- src/conductor/test/engine/engineer/dependency-reconciler.test.ts — tests

**Dependencies:** Task 14

### Task 16: compose dep-audit verb
**Story:** Story 10
**Story:** Story 11
**Story:** Story 13
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/engineer-cli-dep-audit.test.ts` that drive `compose dep-audit --project <name>` through the engineer CLI. Use a registry fixture and a recording gh. Cover the four-category fixture, a clean fixture, an unregistered project, and indeterminate cases.
2. Verify RED.
3. Add `dep-audit` to `ENGINEER_SUBCOMMANDS` and its help record in `src/conductor/src/engine/engineer-cli.ts`. Resolve the project from the registry before any tracker call, run `sweepDependencyDrift`, and render per-category findings, distinguishing "0 findings" from "indeterminate".
4. Verify GREEN. Commit.

**Done when:**
- [test] `compose dep-audit --project <name>` on the four-category fixture prints the #30→#31 unlinked, #32→#33 stale, {#34, #35} cycle and #36/#37 contradiction findings, and exits 0.
- [test] On a clean fixture it prints "0 findings" for each category and exits 0. On the all-categories fixture the recording gh observes only read requests.
- [test] For an unregistered project it exits non-zero naming the project, and the recording gh observes zero tracker calls.
- [test] An indeterminate issue or repository is printed as "indeterminate", distinct from "0 findings".

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — `dep-audit` subcommand
- src/conductor/test/engine/engineer/engineer-cli-dep-audit.test.ts — new CLI tests

**Dependencies:** Task 15

### Task 17: Hourly drift sweep on the intake loop with one summary event
**Story:** Story 11
**Story:** Story 12
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/intake-loop-cli-drift.test.ts`. They drive `dispatchIntakeLoop`'s composed `reconcile` closure through `intakeTick`, using an injected clock, a recording tracker, an event emitter spy, and a log spy. Cover:
   - a due tick; a clean repo;
   - a tick 10 minutes later; a tick 61 minutes later;
   - the sweep throwing;
   - two registered repositories.
2. Verify RED.
3. In `src/conductor/src/intake-loop-cli.ts`, after `reconcileClosedIssues` inside the `reconcile` closure, run an interval-gated sweep per repository (`DRIFT_SWEEP_INTERVAL_MS = 3_600_000`, with the last-run time held per repository in memory and stamped before the sweep runs, so a throwing sweep still waits a full interval). Emit one `dependency_drift_swept` event per repository on the loop's event emitter, mapping the sweep's `repository-indeterminate` result to `status: 'repository-indeterminate'`, and catch and log sweep failures inside the closure.
4. Verify GREEN. Commit.

**Done when:**
- [test] A due tick runs one sweep and emits exactly one `dependency_drift_swept` event for the repository, carrying the fixture's unlinked, stale, cycles, contradictions and indeterminate lists. A clean repository's due tick emits one event with every list empty.
- [test] A tick 10 minutes after a sweep performs zero blocked_by reads and emits no drift event for that repository. A tick 61 minutes after the sweep sweeps again.
- [test] When the sweep throws, the same tick still completes poll, enqueue and `reconcileClosedIssues`, and the log spy receives the sweep failure message.
- [test] With two registered repositories due, exactly one `dependency_drift_swept` event is emitted for each repository, and the recording tracker observes only read requests, with zero writes.
- [test] When a due repository's open-issue listing fails, the emitted `dependency_drift_swept` event has `status: 'repository-indeterminate'` with all category lists empty, while a clean repository's event has `status: 'swept'`.

**Files likely touched:**
- src/conductor/src/intake-loop-cli.ts — interval-gated drift sweep in the reconcile closure
- src/conductor/test/intake-loop-cli-drift.test.ts — new tests

**Dependencies:** Task 8, Task 14

### Task 18: compose land shows proposals, satisfied links, advisory notes and skip notes
**Story:** Story 5
**Story:** Story 8
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/engineer-cli-land-dependencies.test.ts` that drive `compose land` through the CLI with a recording gh. Cover:
   - #536 declaring unlinked #520, plus an open issue #600 and an intake-marked in-flight branch for #610 that share a plan path;
   - #536 already blocked by #520;
   - a marker-less in-flight branch as the only overlap;
   - computed proposals with `--skip-dependency-check` and an undecided #600.
2. Verify RED.
3. In the `land` case of `src/conductor/src/engine/engineer-cli.ts`, render the decision output: each proposal with its source label, satisfied targets, advisory notes, and the skip-unused note.
4. Verify GREEN. Commit.

**Done when:**
- [test] `compose land --source-ref owner/repo#536` prints #520 as a proposal labelled with source `declared`, and #600 and #610 each as a proposal labelled with source `overlap`, for the fixture where #536 declares unlinked #520 and #600/#610 share a plan path.
- [test] Land for #536 already blocked by #520 prints #520 as satisfied rather than undecided, does not refuse on #520, and the recording gh observes zero dependency writes for #520.
- [test] Land whose only overlap is a marker-less in-flight branch sharing a plan path prints the branch as an advisory note, exits 0 and commits the spec.
- [test] Land with computed proposals, `--skip-dependency-check "unused"` and an undecided #600 exits non-zero and prints that the skip was unused.

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — land decision output rendering
- src/conductor/test/engine/engineer/engineer-cli-land-dependencies.test.ts — CLI output tests

**Dependencies:** Task 11

## Task Dependency Graph

```
Task 1 ─┬─ Task 2 ─┬─ Task 9 ── Task 10 ─┐
        │          └─ Task 14 ── Task 15 ── Task 16
        │                 └────────────────────────── Task 17 (also Task 8)
        └─ Task 3 ─┬─ Task 4
                   ├─ Task 5
                   ├─ Task 6
                   └─ Task 7
Task 8 ───────────────────────────────── Task 11 (also Tasks 9, 10) ─┬─ Task 12
                                                                     ├─ Task 13
                                                                     └─ Task 18
```

## Integration Points
- After Task 7: a non-form issue's opened/edited event through the Action entry creates blocked_by links end to end.
- After Task 12: `compose land --source-ref …` gates, commits, writes accepted edges and records the decision.
- After Task 16: `compose dep-audit` prints a drift report for a registered project.
- After Task 17: the running intake loop publishes `dependency_drift_swept` hourly.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given open issue #10 exists in the same repository, when a non-form issue #20 is opened with body "This is blocked by #10.", then #20's blocked-by list contains #10. | 3, 7 | "issues blocked_by writes #20→#10 for "This is blocked by #10."" | diff-local |
| Story 1 happy: Given issues #10 and #11 exist, when issue #20 is opened with body "Depends on: #10 / #11", then #20's blocked-by list contains both #10 and #11. | 3 | "#20→#10 and #20→#11 for "Depends on: #10 / #11"" | diff-local |
| Story 1 happy: Given issue #10 exists, when issue #20 is opened with body "Gated on #10", then #20's blocked-by list contains #10. | 3 | "#20→#10 for "Gated on #10"" | diff-local |
| Story 1 happy: Given issue #20 was filed through the structured intake form with "#10" in its Depends-on field and "blocked by #12" in its free-text section, when it is opened, then #20's blocked-by list contains both #10 and #12. | 3 | "issues blocked_by writes for both #10 and #12" | diff-local |
| Story 1 negative: Given #20 is already blocked by #10, when the same opened event for #20 is processed a second time, then exactly one #10 link exists and the run reports #10 as already present, not as an error. | 3 | "leaves exactly one #10 link, and reports #10 as `already-present` with an empty failures list" | diff-local |
| Story 1 negative: Given a body that declares "blocked by #10" twice, when #20 is opened, then exactly one link to #10 is created. | 3 | "A body declaring "blocked by #10" twice issues exactly one #10 write" | diff-local |
| Story 1 negative: Given a body containing no recognized phrasing, when #20 is opened, then no link is created and the run completes successfully without reporting any failure. | 3 | "A body with no recognized phrasing issues zero dependency writes, and the function resolves with an empty failures list" | diff-local |
| Story 2 happy: Given issue #20 with no blocked-by links, when its body is edited to add "blocked by #10", then #20's blocked-by list contains #10. | 5 | "An `edited` fixture adding "blocked by #10" to unlinked #20 writes #20→#10" | diff-local |
| Story 2 happy: Given #20 is blocked by #10 and its body says "blocked by #10", when the body is edited to also say "depends on #11", then #20 is blocked by both #10 and #11. | 5 | "leaving #20 blocked by both #10 and #11" | diff-local |
| Story 2 negative: Given #20 is blocked by #10, when its body is edited to remove "blocked by #10", then #20 is still blocked by #10. | 5 | "issue zero remove calls (DELETE or `removeIssueDependency`) on the recording runner, so #10 stays linked" | diff-local |
| Story 2 negative: Given #20 is blocked by #10, when its body is edited to say "blocked by #12" instead, then #20 is blocked by both #10 and #12 and no link is removed. | 5 | "The replacement edit also writes #20→#12" | diff-local |
| Story 2 negative: Given an edit that changes only the title and every target declared in #20's body is already linked, when the edited event is processed, then the existing links are unchanged and no link is created. | 5 | "issues zero POSTs and leaves #20's links unchanged" | diff-local |
| Story 2 negative: Given #20's body still says "blocked by #10" and an operator has manually deleted the #20→#10 link, when #20's body is next edited, then the #20→#10 link exists again, because prose is the declaration of record. | 5 | "processing the next `edited` event writes #20→#10 again" | diff-local |
| Story 3 happy: Given a body that says "blocked by #10" and also "related to #11", when #20 is opened, then #20 is blocked by #10 only. | 3 | "A body with "blocked by #10" and "related to #11" issues a blocked_by write for #10 only" | diff-local |
| Story 3 negative: Given a body containing "related to #10" or "see #10", when #20 is opened, then no link is created. | 4 | "For each fixture on #20, `applyIssueEventSync` issues zero blocked_by writes" | diff-local |
| Story 3 negative: Given a body containing "blocks #10" or "blocker for #10", when #20 is opened, then no link is created in either direction. | 4 | "For "blocks #10" and "blocker for #10", neither #20→#10 nor #10→#20 is written" | diff-local |
| Story 3 negative: Given a body containing "blocked by other-owner/other-repo#10", when #20 is opened, then no link is created. | 4 | "For each fixture on #20, `applyIssueEventSync` issues zero blocked_by writes" | diff-local |
| Story 3 negative: Given issue #20's body says "blocked by #20", when it is opened, then no link is created and no tracker write is attempted. | 4 | "the recording runner observes zero tracker write attempts of any kind" | diff-local |
| Story 3 negative: Given a body that says "blocked by" followed by no issue number, when #20 is opened, then no link is created. | 4 | "For each fixture on #20, `applyIssueEventSync` issues zero blocked_by writes" | diff-local |
| Story 4 happy: Given an operator-assigned, form-filed issue #20 that declares "blocked by #10 / #99999", where #99999 does not exist, when it is opened, then #20 is blocked by #10, its priority/size labels are applied, and the run output names #99999 as a failed link. | 6 | "the #10 link is written, the priority/size labels are applied, the report lists #99999 as failed with its reason" | diff-local |
| Story 4 negative: Given the tracker refuses the link write for #10 (for example, the cycle-rejection response), when #20 is opened, then no link to #10 exists, the run output names #10 with the refusal reason, and the workflow run still succeeds. | 6, 7 | "no #10 link is written, the report names #10 with that refusal reason, and the function resolves" | diff-local |
| Story 4 negative: Given the tracker is unreachable for every dependency call, when #20 is opened, then no link is created, every declared target is reported as failed, and label syncing is still attempted. | 6 | "zero links are written, every declared target appears in `failures`, and the label-sync step is still invoked" | diff-local |
| Story 4 negative: Given issue #20 is not assigned exclusively to the operator (unassigned, or assigned to someone else) and declares "blocked by #10", when it is opened, then no link is created, the run output names #10 with reason `explicit-authorization-required`, and the workflow run still succeeds. | 6, 7 | "the report names #10 with reason `explicit-authorization-required`, and the function resolves" | diff-local |
| Story 5 happy: Given intake issue #536's body says "depends on #520" and #536 is not linked to #520, when the spec is landed with source-ref `owner/repo#536`, then #520 is shown as a proposal sourced from the issue's declaration. | 18, 9 | "prints #520 as a proposal labelled with source `declared`" | diff-local |
| Story 5 happy: Given an open issue #600 that cites a file listed in the plan's files-likely-touched, when the spec is landed, then #600 is shown as a proposal sourced from overlap. | 18, 9 | "#600 and #610 each as a proposal labelled with source `overlap`" | diff-local |
| Story 5 happy: Given an unmerged branch for another feature that changes a file listed in the plan, when the spec is landed, then that branch's originating issue is shown as an overlap proposal. | 18, 9 | "#600 and #610 each as a proposal labelled with source `overlap`" | diff-local |
| Story 5 negative: Given #536 is already blocked by #520, when the spec is landed, then #520 is not shown as undecided and no write for #520 is attempted. | 18, 9 | "Land for #536 already blocked by #520 prints #520 as satisfied rather than undecided, does not refuse on #520, and the recording gh observes zero dependency writes for #520" | diff-local |
| Story 5 negative: Given the issue's body references #520 only as "related to #520", when the spec is landed, then #520 is not proposed from the declaration source. | 9 | "A "related to #520" body yields no declared proposal" | diff-local |
| Story 5 negative: Given an overlap candidate that is the originating issue #536 itself, when the spec is landed, then it is not proposed. | 9 | "Overlap candidates equal to #536, or that are closed issues, are absent from proposals" | diff-local |
| Story 5 negative: Given an overlap candidate that is a closed issue, when the spec is landed, then it is not proposed. | 9 | "Overlap candidates equal to #536, or that are closed issues, are absent from proposals" | diff-local |
| Story 5 negative: Given an in-flight branch with no intake marker that changes a file listed in the plan, when the spec is landed, then the branch is printed as an advisory note, is not an undecided proposal, and does not cause land to refuse. | 18, 9 | "Land whose only overlap is a marker-less in-flight branch sharing a plan path prints the branch as an advisory note, exits 0 and commits the spec" | diff-local |
| Story 6 happy: Given proposals #520 and #600, when land runs with #520 accepted and #600 declined, then the spec commits, #536 becomes blocked by #520, and no link to #600 is created. | 12 | "commits the spec, then writes exactly one blocked_by link #536→#520 through the guarded runner and none for #600" | diff-local |
| Story 6 happy: Given proposals #520 and #600, when land runs with both declined, then the spec commits and no link is created. | 12 | "With both declined it commits and writes zero links" | diff-local |
| Story 6 happy: Given there are no proposals, when land runs with no dependency decisions, then the spec commits as it does today. | 12 | "With no proposals it commits with zero dependency writes" | diff-local |
| Story 6 negative: Given proposals #520 and #600, when land runs with only #520 decided, then land exits non-zero, nothing is committed, no link is written, and the output names #600 and states how to accept or decline it. | 11 | "with undecided #600 exits non-zero, leaves the worktree HEAD unchanged, writes no link, prints #600 with how to accept or decline it" | diff-local |
| Story 6 negative: Given proposal #520, when land runs with #520 both accepted and declined, then land exits non-zero naming the contradictory decision, and nothing is committed or linked. | 11 | "A contradictory accept-and-decline of #520, a decline of the never-proposed #777, a dependency decision without `--source-ref`, and an empty skip reason each exit non-zero naming the problem, leave HEAD unchanged, write no link" | diff-local |
| Story 6 negative: Given proposal #520, when land runs declining #777, which was never proposed, then land exits non-zero naming #777 as an invalid decline, and nothing is committed. | 11 | "A contradictory accept-and-decline of #520, a decline of the never-proposed #777, a dependency decision without `--source-ref`, and an empty skip reason each exit non-zero naming the problem, leave HEAD unchanged, write no link" | diff-local |
| Story 6 negative: Given #520 is accepted, when land runs and the spec commit then fails (for example, a land gate rejection), then no link to #520 is written. | 12 | "When a later land gate rejects the commit with #520 accepted, zero dependency writes are issued" | diff-local |
| Story 7 happy: Given land is invoked without a source-ref, when it runs, then no proposals are computed, no tracker dependency reads occur, and the spec commits as before. | 11 | "`compose land` without `--source-ref` performs zero tracker dependency reads on the recording gh, emits no `land_dependency_decided` event, and commits the spec as before" | diff-local |
| Story 7 negative: Given land is invoked without a source-ref but with a dependency accept or decline decision, when it runs, then land exits non-zero stating that dependency decisions require an intake source-ref, and nothing is committed. | 11, 10 | "a dependency decision without `--source-ref`, and an empty skip reason each exit non-zero naming the problem, leave HEAD unchanged" | diff-local |
| Story 7 negative: Given the tracker is unreachable and there is no source-ref, when land runs, then land succeeds; the dependency check is not attempted. | 11 | "commits the spec as before even when the tracker stub is unreachable" | diff-local |
| Story 8 happy: Given the tracker is unreachable, when land runs with an explicit skip acknowledgement carrying the reason "GitHub outage", then the spec commits, no link is written, and the skip and its reason are recorded. | 12 | "land commits, writes no link, and persists a `land_dependency_decided` event with skipped reason "GitHub outage"" | diff-local |
| Story 8 negative: Given the tracker is unreachable, when land runs without a skip acknowledgement, then land exits non-zero, nothing is committed, and the output names the cause and how to acknowledge a skip. | 11 | "With the tracker unreachable and no skip, land exits non-zero, leaves HEAD unchanged, prints the cause and `--skip-dependency-check`" | diff-local |
| Story 8 negative: Given the tracker returns a rate-limit response while proposals are being computed, when land runs without a skip, then land refuses, naming the rate limit. | 11 | "A rate-limit response's printed cause names the rate limit" | diff-local |
| Story 8 negative: Given a skip acknowledgement with an empty reason, when land runs, then land exits non-zero requiring a reason, and nothing is committed. | 11 | "an empty skip reason each exit non-zero naming the problem, leave HEAD unchanged, write no link" | diff-local |
| Story 8 negative: Given proposals were computed successfully and a skip acknowledgement is also given, when land runs, then the skip is ignored for gating, undecided proposals still refuse, and the output notes that the skip was unused. | 18, 10 | "Land with computed proposals, `--skip-dependency-check "unused"` and an undecided #600 exits non-zero and prints that the skip was unused" | diff-local |
| Story 9 happy: Given proposals #520 (accepted) and #600 (declined), when land completes, then exactly one dependency-decision event is persisted to the composer event ledger, listing proposals [#520, #600], accepted [#520], declined [#600], and the write result for #520. | 12 | "persists exactly one `land_dependency_decided` event to composer-events.jsonl with proposals [#520, #600], accepted [#520], declined [#600], and write status `created` for #520" | diff-local |
| Story 9 happy: Given a skip acknowledgement with a reason, when land completes, then the event records the skip and its reason, with empty proposal lists. | 12 | "persists a `land_dependency_decided` event with skipped reason "GitHub outage" and empty proposals, accepted and declined lists" | diff-local |
| Story 9 negative: Given an accepted edge whose link write fails after commit, when land completes, then the spec stays committed, land reports the failed write, and the event records the failure for #520. | 12 | "When the #520 write fails after commit, the spec commit stays at HEAD, land prints the failed write, and the persisted `land_dependency_decided` event records the failure for #520" | diff-local |
| Story 9 negative: Given undecided proposals, when land refuses, then exactly one land-gate-rejection event with gate `dependency-proposals-undecided` is persisted, naming the undecided proposals, no dependency-decision event is emitted, and no link is written. | 11 | "persists exactly one `land_gate_rejected` event with gate `dependency-proposals-undecided` naming #600, and no `land_dependency_decided` event, to composer-events.jsonl" | diff-local |
| Story 9 negative: Given the tracker is unreachable and no skip was given, when land refuses, then exactly one land-gate-rejection event with gate `dependency-check-unavailable` is persisted, and no dependency-decision event is emitted. | 11 | "persists exactly one `land_gate_rejected` with gate `dependency-check-unavailable` and no `land_dependency_decided` event" | diff-local |
| Story 9 negative: Given a non-intake idea, when land runs, then no dependency-decision event is emitted. | 11 | "emits no `land_dependency_decided` event" | diff-local |
| Story 10 happy: Given open issue #30 whose body says "blocked by #31" with no link, when the drift report runs, then #30→#31 is listed as an unlinked declaration. | 16, 14 | "prints the #30→#31 unlinked, #32→#33 stale, {#34, #35} cycle and #36/#37 contradiction findings, and exits 0" | diff-local |
| Story 10 happy: Given open issue #32 blocked by #33, which was closed as not planned, when the report runs, then #32→#33 is listed as a stale link. | 16, 14 | "prints the #30→#31 unlinked, #32→#33 stale, {#34, #35} cycle and #36/#37 contradiction findings, and exits 0" | diff-local |
| Story 10 happy: Given open issues #34 and #35 blocked by each other, when the report runs, then the cycle {#34, #35} is listed as a contradiction. | 16, 14 | "prints the #30→#31 unlinked, #32→#33 stale, {#34, #35} cycle and #36/#37 contradiction findings, and exits 0" | diff-local |
| Story 10 happy: Given open issue #36 whose body says "blocks #37" while #36 is blocked by #37, when the report runs, then #36/#37 is listed as a direction contradiction. | 16, 14 | "prints the #30→#31 unlinked, #32→#33 stale, {#34, #35} cycle and #36/#37 contradiction findings, and exits 0" | diff-local |
| Story 10 happy: Given a repository with no drift, when the report runs, then it states that zero findings were found in each category and exits successfully. | 16 | "On a clean fixture it prints "0 findings" for each category and exits 0" | diff-local |
| Story 10 negative: Given open issue #38 blocked by #39, which was closed as completed, when the report runs, then #38→#39 is not listed in any category. | 14 | "Blockers closed as `completed` (#38→#39), closed issues (#40) and "related to #43" (#42) produce no finding in any category" | diff-local |
| Story 10 negative: Given closed issue #40 whose body says "blocked by #41" with no link, when the report runs, then #40 is not listed; only open issues are swept. | 14 | "Blockers closed as `completed` (#38→#39), closed issues (#40) and "related to #43" (#42) produce no finding in any category" | diff-local |
| Story 10 negative: Given open issue #42 whose body says "related to #43" with no link, when the report runs, then nothing is listed for #42. | 14 | "Blockers closed as `completed` (#38→#39), closed issues (#40) and "related to #43" (#42) produce no finding in any category" | diff-local |
| Story 10 negative: Given a project name that is not registered, when the drift report is requested for it, then it exits non-zero naming the unknown project and makes no tracker calls. | 16 | "For an unregistered project it exits non-zero naming the project, and the recording gh observes zero tracker calls" | diff-local |
| Story 11 happy: Given a repository with findings in every category, when the drift report runs (on demand or automatically), then the tracker receives only read requests. | 16, 17 | "On the all-categories fixture the recording gh observes only read requests" | diff-local |
| Story 11 negative: Given an unlinked declaration #30→#31, when the report runs, then no link from #30 to #31 is created. | 14 | "The recording tracker double observes zero write operations (no POST, DELETE, label or comment call) across the four-category sweep" | diff-local |
| Story 11 negative: Given a stale link #32→#33, when the report runs, then the link still exists afterwards. | 14 | "the #32→#33 and #34/#35 links remain present in the double afterwards" | diff-local |
| Story 11 negative: Given a cycle {#34, #35}, when the report runs, then both links still exist and no label or comment is added to either issue. | 14 | "The recording tracker double observes zero write operations (no POST, DELETE, label or comment call) across the four-category sweep, and the #32→#33 and #34/#35 links remain present in the double afterwards" | diff-local |
| Story 12 happy: Given the intake loop is running and no sweep has run for a repository this hour, when an intake tick fires, then one sweep runs and exactly one drift summary event is published for that repository, listing the issues in each category. | 17 | "A due tick runs one sweep and emits exactly one `dependency_drift_swept` event for the repository, carrying the fixture's unlinked, stale, cycles, contradictions and indeterminate lists" | diff-local |
| Story 12 happy: Given a sweep that finds no drift, when it completes, then one drift summary event is published with empty lists in every category. | 17 | "A clean repository's due tick emits one event with every list empty" | diff-local |
| Story 12 negative: Given a sweep ran for a repository 10 minutes ago, when the next intake tick fires, then no sweep runs and no drift event is published for that repository. | 17 | "A tick 10 minutes after a sweep performs zero blocked_by reads and emits no drift event for that repository" | diff-local |
| Story 12 negative: Given the sweep throws unexpectedly, when an intake tick fires, then the tick's polling, enqueue and closed-issue reconciliation still complete, and the failure is logged. | 17 | "When the sweep throws, the same tick still completes poll, enqueue and `reconcileClosedIssues`, and the log spy receives the sweep failure message" | diff-local |
| Story 12 negative: Given two registered repositories, when a due tick fires, then exactly one summary event is published for each repository. | 17 | "With two registered repositories due, exactly one `dependency_drift_swept` event is emitted for each repository" | diff-local |
| Story 13 happy: Given the blocked-by read for issue #44 fails with a server error, when a sweep runs, then #44 is listed as indeterminate, other issues are still classified, and the summary's indeterminate list contains #44. | 15 | "A 500 on #44's blocked_by read puts #44 in `indeterminate`, while #30's unlinked finding is still reported in the same sweep result" | diff-local |
| Story 13 negative: Given a rate-limit response on the blocked-by read for #45, when a sweep runs, then #45 is indeterminate, the sweep does not retry #45, and it does not retry in a loop. | 15 | "A rate-limit response for #45 puts #45 in `indeterminate`, and the recording double shows #45's blocked_by read invoked exactly once" | diff-local |
| Story 13 negative: Given the issue listing itself fails, when a sweep runs, then the report or summary states that the repository is indeterminate and lists zero findings in the other categories (not "clean"). | 15, 16, 17 | "When the open-issue listing fails, the sweep returns `repository-indeterminate` with all category lists empty, not `swept` with empty lists" | diff-local |
| Story 13 negative: Given a cycle check that cannot complete because a blocker's read fails, when a sweep runs, then the affected issue is indeterminate rather than reported as cycle-free. | 15 | "When a blocker's read fails during cycle checking, the affected issue is present in `indeterminate` and absent from `cycles`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-09-dependency-reconciler-and-edge-write-ownership#D1 | task | task-1, task-3 | the form-field input and the prose input produce identical edge lists |
| adr-2026-10-09-dependency-reconciler-and-edge-write-ownership#D2 | task | task-5, task-6, task-7 | issue zero remove calls (DELETE or `removeIssueDependency`) on the recording runner |
| adr-2026-10-09-dependency-reconciler-and-edge-write-ownership#D3 | task | task-9, task-11, task-12 | A marker-less in-flight branch sharing a plan path appears only in `advisory` and never in proposals |
| adr-2026-10-09-dependency-reconciler-and-edge-write-ownership#D4 | task | task-8, task-11, task-12 | persists exactly one `land_dependency_decided` event to composer-events.jsonl with proposals [#520, #600], accepted [#520], declined [#600] |
| adr-2026-10-09-dependency-reconciler-and-edge-write-ownership#D5 | task | task-13 | states that land refuses until every proposal is decided by the operator |
| adr-2026-10-09-dependency-reconciler-and-edge-write-ownership#D6 | task | task-11 | `compose land` without `--source-ref` performs zero tracker dependency reads on the recording gh |
| adr-2026-10-09-dependency-drift-sweep-on-intake-tick#D1 | task | task-14, task-16 | On the all-categories fixture the recording gh observes only read requests |
| adr-2026-10-09-dependency-drift-sweep-on-intake-tick#D2 | task | task-14, task-15 | Blockers closed as `completed` (#38→#39), closed issues (#40) and "related to #43" (#42) produce no finding in any category |
| adr-2026-10-09-dependency-drift-sweep-on-intake-tick#D3 | task | task-17 | A tick 10 minutes after a sweep performs zero blocked_by reads and emits no drift event for that repository |
| adr-2026-10-09-dependency-drift-sweep-on-intake-tick#D4 | task | task-8, task-17 | A clean repository's due tick emits one event with every list empty |
| adr-2026-07-22-coherence-waiver-and-duplicate-claim#D1 | no-change | none | This feature adds no coherence waiver and does not change the waiver file mechanism; only the ADR's Context gains an additive amendment note about offline land. |
| adr-2026-07-22-coherence-waiver-and-duplicate-claim#D2 | no-change | none | Gap-id vocabulary and validator identifiers are untouched by this feature. |
| adr-2026-07-22-coherence-waiver-and-duplicate-claim#D3 | no-change | none | The waiver change-set freshness rule is untouched; this feature authors no waiver. |
| adr-2026-07-22-coherence-waiver-and-duplicate-claim#D4 | no-change | none | Partial-coverage blocking is untouched; this feature changes no coherence validation. |
| adr-2026-07-22-coherence-waiver-and-duplicate-claim#D5 | no-change | none | Waived-land recording is untouched; this feature authors no waiver. |
| adr-2026-07-22-coherence-waiver-and-duplicate-claim#D6 | no-change | none | The duplicate-claim check keeps reading only local git state; the new dependency gate is a separate check scoped to `--source-ref` land, per adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 6. |
| adr-2026-07-22-coherence-waiver-and-duplicate-claim#D7 | no-change | none | The optional open-spec-PR warning scan is untouched. |
| adr-2026-07-03-prose-to-link-migration#D1 | existing | none | `parseDependencyProse` and `PATTERNS` in src/conductor/src/engine/engineer/issue-dep-migration.ts already implement the high-confidence patterns and manual-review flagging; Task 1 reuses them unchanged. |
| adr-2026-07-03-prose-to-link-migration#D2 | task | task-3 | Re-processing the same `opened` event when #20→#10 already exists issues no POST |
| adr-2026-07-03-prose-to-link-migration#D3 | task | task-5 | issue zero remove calls (DELETE or `removeIssueDependency`) on the recording runner |
| adr-2026-07-03-prose-to-link-migration#D4 | no-change | none | The `migrate-issue-deps` command stays a standalone operator-invoked command in src/conductor/src/engine/engineer-cli.ts; this feature reuses the parser and writer elsewhere but does not change the command. |
| adr-2026-07-03-prose-to-link-migration#D5 | no-change | none | The v1.0-program migration scope is historical and is not affected by this feature. |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks, and no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic

### Task rem-prd-audit-rem-s5-1: engineer-cli.ts land: render proposals with source labels, plus satisfied, advisory and skip notes, on the refused-undecided/refused-unavailable path too (not only after a successful landSpec). Carry the computed proposal result on the LandGateError. Add a test in engineer-cli-land-dependencies.test.ts that runs land with only --source-ref owner/repo#536 and asserts '#520 (declared)', '#600 (overlap)' and '#610 (overlap)' with no decision flags.
**Gate:** prd-audit
**Rationale:** Implementation gap within Task 18 (95%, verified against plan): Task 18 requires proposals with source labels and satisfied/advisory lines on `compose land --source-ref` alone, but rendering happens only after a successful land. The refusal path prints only the LandGateError message. Task 18 Step 3 already covers rendering the decision output in the land case, so no planning or architecture change is needed.
**Criterion:** S5.1
**Parent task:** 18
**Done when:**
- [test] S5.1 is satisfied by this task.
- The repair for task rem-prd-audit-rem-s5-1 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-s5-2: land-dependency-gate.ts: build proposals from every linkable overlap (shown + omitted, or call buildSuggestions uncapped), filtering self, closed and already-linked targets before any cap. Test in land-dependency-gate.test.ts: with 7 overlapping open issues, all 7 are proposals, and an undecided 7th refuses land.
**Gate:** prd-audit
**Rationale:** Verified defect in Task 9's computeLandDependencyProposals: only buildSuggestions' capped `shown` list (cap 5) is used, so the 6th and later overlaps are never proposed. The plan's Land approach makes every linkable overlap a proposal. Task 9 admits the fix. The label-rendering half is repaired under S5.1/Task 18.
**Criterion:** S5.2
**Parent task:** 9
**Done when:**
- [test] S5.2 is satisfied by this task.
- The repair for task rem-prd-audit-rem-s5-2 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-s5-3: engineer-cli-land-dependencies.test.ts: assert that the intake-marked in-flight branch overlap #610 prints with the '(overlap)' source label when land is refused for undecided proposals (covered by the rem-s5-1 rendering change).
**Gate:** prd-audit
**Rationale:** Same root cause as S5.1 (verified): #610 is computed with source overlap, but its label is rendered only on the success path. The Task 18 refusal-path rendering repair closes it. The rem-s5-1 test asserts '#610 (overlap)' on the refusal path.
**Criterion:** S5.3
**Parent task:** 18
**Done when:**
- [test] S5.3 is satisfied by this task.
- The repair for task rem-prd-audit-rem-s5-3 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-1: dependency-reconciler.ts: centralize raw-body Depends-on form-field extraction, so a field value like '#123, #456' and qualified same-repo refs (owner/repo#N) yield every edge. Route issue-event-sync.ts, land-dependency-gate.ts and the sweep through this one extractor. Add tests for the multi-ref field, the qualified same-repo field, and parity between form and body callers.
**Gate:** as-built
**Rationale:** Conforming implementation drift against ADR D1 (approved architecture stays authoritative). Task 1 owns declaredEdges and the parity requirement that form-field input and prose input produce identical edges. Tasks 3, 9 and 14 own the Action, land and drift callers. No architectural decision is needed, only centralized extraction.
**Governing clause:** adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 1
**Done when:**
- adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 1 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-1 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-2: dependency-reconciler.ts declaredEdges: drop any edge whose source text the parser flagged as a task-list reference, keeping it only in manualReview. Test: '- [ ] Phase 1 blocked by #10' yields zero edges and one manual-review item. Assert that the Action, land proposals and drift sweep produce nothing for it.
**Gate:** as-built
**Rationale:** Verified violation of D1 (task-list references must yield no edge). Task 1 Step 3 states that manual-review items, including task-list items, carry no edge. The fix is local to declaredEdges and admitted by Task 1.
**Governing clause:** adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 1
**Done when:**
- adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 1 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-2 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-3: Replace DependencyDriftTracker in dependency-reconciler.ts with the existing TrackerClient (getBlockedBy, open-issue listing) and use BlockerResolver for cycle detection, removing the private cycle code. Delete the duplicated adapters in engineer-cli.ts and intake-loop-cli.ts in favour of the shared TrackerClient/BlockerResolver wiring. Keep the existing Task 14–17 tests green, including the one-read-per-issue and zero-write assertions.
**Gate:** as-built
**Rationale:** The approved architecture (reconciler reads only through TrackerClient and BlockerResolver, ADR D1/drift D2, feature diagram REC→TRK/REC→RES) is unambiguous and stays authoritative. The code diverged by adding a parallel DependencyDriftTracker, duplicated adapters and private cycle detection. Restoring conformance is BUILD work under Tasks 14, 16 and 17, which name those seams; no architecture decision is needed.
**Governing clause:** adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 1
**Done when:**
- adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 1 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-3 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-4: land-dependency-gate.ts: filter self, closed and already-linked targets before any display cap, and include every eligible overlap in the decision set. Test: with 5 shown overlaps of which one is the source issue itself plus 1 omitted, all 5 eligible others become proposals.
**Gate:** as-built
**Rationale:** Same defect as S5.2 (verified): capped `shown` list, with self-filtering applied after the cap. Admitted by Task 9 and repaired by rem-s5-2. This repair additionally asserts the filter order.
**Governing clause:** adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 3
**Done when:**
- adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 3 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-4 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-5: Propagate issue-state lookup failures for intake-marked branches from intake/overlap-sources.ts (via an opt-in strict mode or a distinct failure result, so advisory preflight callers are unchanged) to computeLandDependencyProposals, which returns unavailable naming the cause. Test: a marked branch whose issue read fails gives `unavailable`, not computed/markerless. A local git diff failure stays an advisory note.
**Gate:** as-built
**Rationale:** Task 9 states the result is `unavailable` exactly when a tracker read fails, while local git skip notes stay advisory. A swallowed issue-state lookup error on a marked branch therefore contradicts the approved design. The fix is to propagate tracker failure to the land gate while keeping the advisory local-git behavior, within Task 9.
**Governing clause:** adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 3
**Done when:**
- adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 3 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-5 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-6: land-dependency-gate.ts decideLandDependencies: run the independently knowable validations (contradictory accept/decline, decisions without source-ref, empty skip reason) before branching on the computed/unavailable result. Test: `unavailable` + skip 'GitHub outage' + #520 both accepted and declined returns `invalid` naming #520.
**Gate:** as-built
**Rationale:** Verified ordering bug in decideLandDependencies: an unavailable check plus a skip returns proceed before contradictory accept/decline validation runs. Task 10 already requires `invalid` for contradictory decisions. Reordering the validation is admitted by Task 10.
**Governing clause:** adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 4
**Done when:**
- adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 4 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-6 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-7: dependency-reconciler.ts sweep: keep completed blockers for declaration satisfaction, but exclude them from the contradiction and stale/cycle findings. Test: #36 'blocks #37' while blocked by #37 closed as completed produces no contradiction finding.
**Gate:** as-built
**Rationale:** Task 14 (Done-when: blockers closed as completed produce no finding in any category) and drift ADR D2 are explicit. The contradiction check ignoring completion state is an implementation defect admitted by Task 14.
**Governing clause:** adr-2026-10-09-dependency-drift-sweep-on-intake-tick decision 2
**Done when:**
- adr-2026-10-09-dependency-drift-sweep-on-intake-tick decision 2 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-7 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-8: Make the sweep's open-issue listing complete (paginate past 1,000), or return `repository-indeterminate` naming truncation when completeness cannot be established. Remove the hard 1,000 limit in the engineer-cli.ts and intake-loop-cli.ts listings (shared via the rem-asb-3 TrackerClient wiring). Test: a listing reporting more results than fetched yields repository-indeterminate, never `swept`.
**Gate:** as-built
**Rationale:** D2 requires every open issue to be checked, and Task 15 already defines `repository-indeterminate` for listings that cannot be established. A silent 1,000-issue truncation is an implementation gap admitted by Tasks 15, 16 and 17, with no design choice needed: paginate fully, or report indeterminate when completeness is unknown.
**Governing clause:** adr-2026-10-09-dependency-drift-sweep-on-intake-tick decision 2
**Done when:**
- adr-2026-10-09-dependency-drift-sweep-on-intake-tick decision 2 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-8 is committed and its targeted tests pass.
