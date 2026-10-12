# Implementation Plan: Retire /pipeline batch evaluators and closeout-obligation telemetry

**Date:** 2026-10-12
**Design:** `.docs/decisions/architecture-review-2026-10-12-pipeline-batch-evaluators-remain-an-unenforced-sec.md` (APPROVED), `.docs/decisions/adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry.md` (APPROVED)
**Stories:** `.docs/stories/pipeline-batch-evaluators-remain-an-unenforced-sec.md` (accepted stories)
**Conflict check:** Clean as of 2026-10-12 (`.docs/conflicts/2026-10-12-pipeline-batch-evaluators-remain-an-unenforced-sec.md`)

## Summary

This plan retires the `/pipeline` batch evaluator. It makes `build_review` the single post-build review authority and
flips the `security` rubric to default-on. It retires the closeout-obligation telemetry channel that only the
evaluator fed, and it makes the sibling-ledger tail admit only declared external kinds. The work is 19 tasks.

## Technical Approach

- **Engine first, union last.** The two `pipeline_closeout*` kinds are consumed in many places: the CLI (`index.ts`,
  `closeout-cli.ts`), OTel (`otel/metrics.ts`, `metrics-listener.ts`, `span-manager.ts`, `otel-visualizer.ts`),
  output (`ui/terminal-renderer.ts`, `daemon-cli.ts`), `build-tail-rollup.ts`, `build-tail-cli.ts`, and `event-sinks.ts`.
  Each consumer task removes its own handler while the union still compiles. Task 13 then narrows the
  `ConductorEvent` union and deletes `closeout-trust.ts`. The `satisfies Record<ConductorEvent['type'], …>` sink
  registry makes any stale arm a compile error.
- **Keep the sibling ledger** (ADR decision 2). `closeout-events.ts`, `closeout-tail.ts` (`CloseoutEventTail`), and
  `readMergedFeatureEvents` stay, with their names unchanged. Task 5 adds an exported admitted-kind list in
  `closeout-events.ts`, the four build-review external kinds plus `kickback_budget_adjustment_authorized`, and
  derives `ExternalPipelineEvent` from that same list. `CloseoutEventTail.pollOnce` refuses anything else with a
  `pipeline_tail_diagnostic` reason `unadmitted-type`. Task 13 removes the closeout aliases from the union.
- **Rollup reshape** (ADR decision 4). `BuildTailWindowRollup` loses `closeout`. `PartialBuildTailRollup` loses its
  closeout payload. A closeout segment is no longer a precondition for `measured`. A merged ledger with no build
  window is `unavailable`. The no-head-move tick label `closeout` stays.
- **Security default.** Flip `security` to `true` in the default-enabled map of `resolved-config.ts`. Fixtures that
  assume a default config dispatches only `implementationQuality` must move with it, following the #475 precedent,
  which opted the live e2e fixture out explicitly (`fixtures/live-e2e-run-body.ts`).
- **Instruction text.** The edits touch `skills/pipeline`, `skills/conduct`, `skills/architecture-review`,
  `skills/code-review`, `HARNESS.md`, four agent personas, three authoring skills, and `templates/AGENTS.md.template`.
  These are agent behavioral contracts, not ordinary documentation. Shell contract tests guard them:
  `test/test_skill_pipeline_contract.sh`, `test/test_harness_integrity.sh`, and `test/test_provider_skill_contracts.sh`.
- **Model table.** Only the generated region of `ARCHITECTURE.md` is regenerated, from `model-table-metadata.ts`, via
  `bin/generate-model-table`.
- **Release.** The `closeout-event` removal reaches the PR body's `## Migration` fence through the existing
  `release-disposition` step at SHIP (ADR decision 5). No plan task writes PR prose.
- **Local test pattern.** Shell contract checks in this repo define a predicate function. They assert it passes on the
  shipped file and fails on a `mktemp` fixture produced by a one-line `sed` mutation; see
  `code_review_routing_and_quality_scope_contract_holds` in `test/test_skill_pipeline_contract.sh`. New shell checks
  follow that shape. Variation in the predicate's grep set is allowed. Search hint: `mktemp "${TMPDIR:-/tmp}/` in
  `test/*.sh`.

## Prerequisites

- The on-main ADR and story amendments are committed on the spec branch (`spec: amend …` commits). There is no BUILD
  setup step.

## Tasks

### Task 1: Default-on security rubric resolves and dispatches under a default config
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `resolved-config.test.ts` and `step-runners.test.ts` for the default rubric set.
2. Verify they fail (RED): `security` currently resolves `enabled: false`.
3. Implement: change `security: false` to `security: true` in the default-enabled rubric map of
   `src/conductor/src/engine/resolved-config.ts`, leaving the effort default `high` unchanged.
4. Verify GREEN, then commit.

**Done when:**
- [test] `resolved-config.test.ts` asserts a config omitting `build_review.rubrics.security` resolves `security` to `enabled: true` with effort `high`, `implementationQuality` to `enabled: true`, and `testQuality` to `enabled: false`.
- [test] `step-runners.test.ts` asserts build_review classification of a config that mentions no rubric yields exactly the `implementationQuality` and `security` dispatchable branches and dispatches no `testQuality` grader.
- [test] `step-runners.test.ts` asserts `rubrics.security.enabled: false` with every other rubric at its default dispatches only the `implementationQuality` grader and runs no security judgement.

**Files likely touched:**
- `src/conductor/src/engine/resolved-config.ts` — default-enabled map
- `src/conductor/test/engine/resolved-config.test.ts` — default resolution assertions
- `src/conductor/test/engine/step-runners.test.ts` — default classification assertions

**Dependencies:** none

### Task 2: Security opt-outs and invalid security config behave under the new default
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write tests for the both-disabled empty container, a non-boolean `enabled`, and `build_review.enabled: false`.
2. Run them against Task 1's default (RED where the default matters).
3. Implement only if a test exposes a gap; otherwise the default flip from Task 1 is the implementation.
4. Verify GREEN, then commit.

**Done when:**
- [test] `step-runners.test.ts` asserts `rubrics.security.enabled: false` plus `rubrics.implementationQuality.enabled: false` with `testQuality` at its default yields verdict PASS with reason `build_review_no_rubrics` and zero grader dispatches.
- [test] `config.test.ts` asserts `build_review.rubrics.security.enabled: "no"` fails validation with a message naming `build_review.rubrics.security.enabled` and its expected boolean type, and no build_review lap is dispatched.
- [test] `step-runners.test.ts` asserts `build_review.enabled: false` under an otherwise default config dispatches no security grader and runs no security judgement.

**Files likely touched:**
- `src/conductor/test/engine/step-runners.test.ts` — opt-out and disabled-gate cases
- `src/conductor/test/engine/config.test.ts` — non-boolean validation case

**Dependencies:** Task 1

### Task 3: Default-on security keeps leaf-only grading in a stacked feature
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write a coordinator test with a non-leaf and a leaf child under a config that never mentions `security`.
2. Verify it fails with Task 1's default flip reverted and passes with it: `security` is skipped on the non-leaf child and graded once at the
   leaf.
3. Reuse the per-child fixtures already in `build-review-coordinator.test.ts`. Search hint: `leaf` in that file.
4. Commit.

**Done when:**
- [test] `build-review-coordinator.test.ts` asserts that under a default config `security` settles as skipped on the non-leaf child and is graded exactly once at the leaf over the whole-feature snapshot, matching the explicitly-enabled case.
- [test] `build-review-coordinator.test.ts` asserts the per-child branch settlements under the default config equal those under an explicit `rubrics.security.enabled: true` config, child for child.

**Files likely touched:**
- `src/conductor/test/engine/build-review-coordinator.test.ts` — default-config stacked case

**Dependencies:** Task 1

### Task 4: Default-config fixtures declare their security setting
**Story:** Story 4
**Type:** infrastructure

**Steps:**
1. In `src/conductor/test/fixtures/live-e2e-run-body.ts`, add `security: { enabled: false }` beside the existing
   `testQuality` and `implementationQuality` opt-outs. The fixture is not about security.
2. For any other build_review fixture whose expectations assume an `implementationQuality`-only default set, either
   stub the security grader or disable `security` explicitly, following the #475 precedent ("opt out default
   implementation-quality live rubric").
3. Commit.

**Done when:**
- The live e2e run-body fixture's build_review config sets `rubrics.security.enabled: false` alongside its `testQuality` and `implementationQuality` opt-outs.
- [test] `live-daemon-e2e-build-step-never-runs-a-real-agent.acceptance.test.ts` passes with the fixture dispatching no security grader.

**Files likely touched:**
- `src/conductor/test/fixtures/live-e2e-run-body.ts` — explicit security opt-out

**Dependencies:** Task 1

### Task 5: The sibling-ledger tail re-emits only admitted external kinds
**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Write failing `closeout-tail.test.ts` cases for admitted re-emission and for unadmitted well-formed records.
2. Verify RED: today every parsed record is re-emitted.
3. Implement:
   - In `closeout-events.ts`, export one admitted-kind list holding the four build-review external kinds and
     `kickback_budget_adjustment_authorized`, and derive the admitted part of `ExternalPipelineEvent` from it.
   - Add `unadmitted-type` to `pipeline_tail_diagnostic.reason` in `types/events.ts`.
   - In `CloseoutEventTail.pollOnce`, emit one `pipeline_tail_diagnostic` with reason `unadmitted-type`,
     `path: .pipeline/pipeline-events.jsonl`, and the record's byte offset for any well-formed record outside the
     list, and do not re-emit that record.
   - The reader already advances its offset, so a record is diagnosed once.
   - Update existing cases in `closeout-tail.test.ts` and `closeout-event.test.ts` that expect a `pipeline_closeout*` record to be re-emitted, so they expect the `unadmitted-type` diagnostic instead.
4. Verify GREEN, then commit.

**Done when:**
- [test] `closeout-tail.test.ts` asserts a ledger holding a `build_review_outer_verdict` record then a `kickback_budget_adjustment_authorized` record re-emits both onto the bus exactly once each, in ledger order.
- [test] `closeout-tail.test.ts` asserts a well-formed `pipeline_closeout` record followed by a `build_review_outer_verdict` record re-emits no closeout event, emits exactly one `pipeline_tail_diagnostic` with reason `unadmitted-type`, path `.pipeline/pipeline-events.jsonl`, and that record's byte offset, and still re-emits the verdict record.
- [test] `closeout-tail.test.ts` asserts a well-formed `step_started` record is not re-emitted and yields one `unadmitted-type` diagnostic, and a second poll over the unchanged ledger emits no further diagnostic for it.
- [test] `closeout-tail.test.ts` asserts a malformed line still yields one `pipeline_tail_diagnostic` with reason `malformed-line` and the following admitted record is re-emitted.
- `CloseoutEventTail.pollOnce` tests `record.event.type` against the admitted-kind list exported from `closeout-events.ts`, the same list `ExternalPipelineEvent` is derived from, and `pipeline_tail_diagnostic.reason` in `types/events.ts` admits `unadmitted-type`.

**Files likely touched:**
- `src/conductor/src/engine/closeout-events.ts` — admitted-kind list
- `src/conductor/src/engine/closeout-tail.ts` — admitted-type check
- `src/conductor/src/types/events.ts` — diagnostic reason literal
- `src/conductor/test/closeout-tail.test.ts` — tail cases
- `src/conductor/test/closeout-event.test.ts` — closeout re-emission expectations

**Dependencies:** none

### Task 6: An operator disposition written without a conductor reaches the bus and the merged reader
**Story:** Story 7
**Type:** happy-path

**Steps:**
1. In `src/conductor/test/closeout-event.test.ts`, which already exercises `dispatchBuildReviewAccept`,
   `CloseoutEventTail`, and `EventPersister`, add a case:
   - Run the build-review accept command with no tail running.
   - Start a tail, drain it, and assert the disposition event is re-emitted.
   - Assert `readMergedFeatureEvents` returns it in timestamp order with the engine events.
2. Commit.

**Done when:**
- [test] `closeout-event.test.ts` asserts a build-review disposition written by `dispatchBuildReviewAccept` with no conductor tail running is re-emitted onto the live bus when a `CloseoutEventTail` later drains the ledger.
- [test] `closeout-event.test.ts` asserts `readMergedFeatureEvents` returns that disposition event between the engine events whose timestamps bracket it.

**Files likely touched:**
- `src/conductor/test/closeout-event.test.ts` — external-event integration case

**Dependencies:** Task 5

### Task 7: The `closeout-event` subcommand is no longer dispatched
**Story:** Story 2
**Type:** refactor

**Steps:**
1. Write failing `cli/index.test.ts` cases next to the existing `validate-wired-into` unknown-command cases. Search hint:
   `names a bare unknown command`.
2. Verify RED: the subcommand still dispatches.
3. Implement: remove the `detectCloseoutEventCommand`/`dispatchCloseoutEventCommand` import and dispatch from
   `src/conductor/src/index.ts`. Delete `src/conductor/src/engine/closeout-cli.ts` and
   `src/conductor/test/closeout-cli.test.ts`. The invocation then falls through to the generic
   `error: unknown command '<cmd>'` path.
4. Verify GREEN, then commit.

**Done when:**
- [test] `cli/index.test.ts` asserts `ai-conductor closeout-event start simplify` run in a temp project prints `error: unknown command 'closeout-event'`, exits non-zero, and leaves `.pipeline/pipeline-events.jsonl` byte-for-byte unchanged.
- [test] `cli/index.test.ts` asserts `ai-conductor closeout-event start evaluator` run where the sibling ledger holds an open evaluator start exits non-zero, appends nothing to `.pipeline/pipeline-events.jsonl` or `.pipeline/events.jsonl`, and raises no uncaught error.
- `src/conductor/src/index.ts` imports nothing from `closeout-cli`, and `closeout-cli.ts` and `closeout-cli.test.ts` are deleted with no remaining importer in `src/` or `test/`.

**Files likely touched:**
- `src/conductor/src/index.ts` — dispatch removal
- `src/conductor/src/engine/closeout-cli.ts` — deleted
- `src/conductor/test/closeout-cli.test.ts` — deleted
- `src/conductor/test/cli/index.test.ts` — unknown-command cases

**Dependencies:** none

### Task 8: Daemon sessions no longer allowlist `closeout-event`
**Story:** Story 2
**Type:** refactor

**Steps:**
1. Update `daemon-session-enforcement.test.ts` so `closeout-event` is expected to be refused (RED).
2. Remove `closeout-event` and its comment from `SESSION_SANCTIONED_SUBCOMMANDS` in `src/conductor/src/execution/daemon-session.ts`, and export the list for the test.
3. Verify GREEN, then commit.

**Done when:**
- [test] `daemon-session-enforcement.test.ts` asserts `guardDaemonSessionInvocation` refuses `closeout-event` in a daemon-managed session.
- [test] `daemon-session-enforcement.test.ts` asserts `SESSION_SANCTIONED_SUBCOMMANDS` in `daemon-session.ts` (exported for the test) equals exactly `scoped-run`, `task`, `overlap-scan`, `plan-protected-targets`, `manual-test-record`, `derive-feedback`, `scope-check`, `task-membership-check`, and `github-operation` (every pre-change entry except `closeout-event`) and that each of them is still allowed.
- The allowlist in `daemon-session.ts` has no `closeout-event` entry and no evaluator closeout comment.

**Files likely touched:**
- `src/conductor/src/execution/daemon-session.ts` — allowlist entry and comment
- `src/conductor/test/execution/daemon-session-enforcement.test.ts` — expectations

**Dependencies:** none

### Task 9: OTel exports no closeout histogram or span event
**Story:** Story 2
**Type:** refactor

**Steps:**
1. Update `metrics.test.ts`, `span-manager.test.ts`, and the `daemon-otel-parity` acceptance test so they expect no
   closeout instrument or span event (RED where they assert one today).
2. Implement:
   - Remove `onPipelineCloseout` and the `conductor.pipeline.closeout.duration` histogram from `otel/metrics.ts`.
   - Remove the `pipeline_closeout` route from `metrics-listener.ts` and `otel-visualizer.ts`.
   - Remove `onPipelineCloseout` from `span-manager.ts`.
   - Drop the `closeout-trust.js` imports.
3. Verify GREEN, then commit.

**Done when:**
- [test] `metrics.test.ts` asserts a recorder that processes a feature stream of step, gate, and build-review events creates no `conductor.pipeline.closeout.duration` instrument.
- [test] `span-manager.test.ts` asserts a build span processed through the visualizer carries no `pipeline_closeout` span event.
- `otel/metrics.ts`, `metrics-listener.ts`, `span-manager.ts`, and `otel-visualizer.ts` contain no `pipeline_closeout` handler or route and import nothing from `closeout-trust`.

**Files likely touched:**
- `src/conductor/src/engine/otel/metrics.ts` — histogram and handler removal
- `src/conductor/src/engine/otel/metrics-listener.ts` — route removal
- `src/conductor/src/engine/otel/span-manager.ts` — handler removal
- `src/conductor/src/engine/otel/otel-visualizer.ts` — route removal
- `src/conductor/test/engine/otel/metrics.test.ts` — expectations
- `src/conductor/test/engine/otel/span-manager.test.ts` — expectations
- `src/conductor/test/acceptance/daemon-otel-parity.acceptance.test.ts` — expectations

**Dependencies:** none

### Task 10: Renderer and daemon log print no closeout lines
**Story:** Story 2
**Type:** refactor

**Steps:**
1. Update `ui/terminal-renderer.test.ts` and `engine/daemon-cli.test.ts` to expect no `closeout <obligation>` line
   (RED where they assert one).
2. Remove the `pipeline_closeout` cases and `closeout-trust.js` imports from `src/conductor/src/ui/terminal-renderer.ts`
   and `src/conductor/src/daemon-cli.ts`.
3. Verify GREEN, then commit.

**Done when:**
- [test] `terminal-renderer.test.ts` asserts rendering a completed build event stream prints no `closeout <obligation>` line.
- [test] `daemon-cli.test.ts` asserts the daemon log for a completed build event stream contains no `closeout <obligation>` line.
- `terminal-renderer.ts` and `daemon-cli.ts` have no `pipeline_closeout` case and import nothing from `closeout-trust`.

**Files likely touched:**
- `src/conductor/src/ui/terminal-renderer.ts` — case removal
- `src/conductor/src/daemon-cli.ts` — case removal
- `src/conductor/test/ui/terminal-renderer.test.ts` — expectations
- `src/conductor/test/engine/daemon-cli.test.ts` — expectations

**Dependencies:** none

### Task 11: The build-tail rollup measures task execution and post-resolution ticks only
**Story:** Story 8
**Type:** refactor

**Steps:**
1. Rewrite `build-tail-rollup.test.ts` cases for the reduced shape (RED against today's closeout precondition).
2. Implement in `src/conductor/src/engine/build-tail-rollup.ts`:
   - Remove `closeout` from `BuildTailWindowRollup` and the payload from `PartialBuildTailRollup`.
   - Remove `closeoutDurations`, and stop requiring it for `measured`.
   - Make `readBuildWindows` return `unavailable` when no build window completes.
   - Ignore `pipeline_closeout*` records.
   - Drop the `closeout-trust.js` import.
   - Keep the `closeout` tick label for no-head-move ticks.
3. Verify GREEN, then commit.

**Done when:**
- [test] `build-tail-rollup.test.ts` asserts a window whose ticks resolve all tasks followed by one head-moved and one no-head-move tick is `measured` with a `taskExecution` segment, post-resolution ticks classified `remediation` and `closeout`, and no closeout duration field on the window.
- [test] `build-tail-rollup.test.ts` asserts a merged ledger with no completed `build` window yields state `unavailable` carrying no closeout data, including when the sibling ledger holds only `pipeline_closeout` records.
- [test] `build-tail-rollup.test.ts` asserts historical `pipeline_closeout` records inside a completed window leave its `taskExecution` and `postResolutionTicks` identical to the same ledger without them.
- [test] `build-tail-rollup.test.ts` asserts a completed window with no progress ticks yields state `partial` with no closeout payload.
- `BuildTailWindowRollup` has no `closeout` field, `PartialBuildTailRollup` has no `closeout` payload, and `build-tail-rollup.ts` imports nothing from `closeout-trust`.

**Files likely touched:**
- `src/conductor/src/engine/build-tail-rollup.ts` — type and state-machine reshape
- `src/conductor/test/build-tail-rollup.test.ts` — rollup cases

**Dependencies:** none

### Task 12: `ai-conductor build-tail` reports no closeout duration
**Story:** Story 8
**Type:** refactor

**Steps:**
1. Update `build-tail-cli.test.ts` and the `build-post-task-tail-telemetry` acceptance test for the reduced report
   (RED).
2. Remove closeout duration lines and the closeout-only `partial` branch from
   `src/conductor/src/engine/build-tail-cli.ts`. Keep the remediation and closeout tick counts.
3. Verify GREEN, then commit.

**Done when:**
- [test] `build-tail-cli.test.ts` asserts the report for a measured window prints the task-execution segment and post-resolution tick counts and contains no `Closeout:` duration line.
- [test] `build-post-task-tail-telemetry.acceptance.test.ts` runs the `build-tail` command entry over a fixture worktree and asserts the printed rollup has task-execution and tick segments and no closeout segment.

**Files likely touched:**
- `src/conductor/src/engine/build-tail-cli.ts` — report reshape
- `src/conductor/test/build-tail-cli.test.ts` — report expectations
- `src/conductor/test/acceptance/build-post-task-tail-telemetry.acceptance.test.ts` — entry-point expectations

**Dependencies:** Task 11

### Task 13: The closeout event kinds and trust helper are retired from the event union
**Story:** Story 2
**Type:** refactor

**Steps:**
1. Add a `// @ts-expect-error` assertion in `event-sinks.test.ts` that a `ConductorEvent` literal with
   `type: 'pipeline_closeout'` does not compile (RED while the kind exists).
2. Implement:
   - Remove `pipeline_closeout_started` and `pipeline_closeout` from `ConductorEvent` in `types/events.ts` and from the
     `event-sinks.ts` registry.
   - Remove the `PipelineCloseoutEvent`/`PipelineCloseoutStartedEvent` aliases and the `appendCloseoutEvent` closeout
     overloads from `closeout-events.ts`, keeping the external-event writer.
   - Delete `closeout-trust.ts` and `test/closeout-trust.test.ts`.
   - Remove closeout-only cases from `closeout-events.test.ts`, `session-event-replay.test.ts`,
     `engine/conductor.test.ts`, and `integration/audit-trail-completeness.integration.test.ts`.
3. Verify GREEN with `npx tsc --noEmit`, then commit.

**Done when:**
- `ConductorEvent` in `types/events.ts` and the registry in `event-sinks.ts` contain no `pipeline_closeout_started` or `pipeline_closeout` member, and `npx tsc --noEmit` in `src/conductor` exits 0.
- [test] `event-sinks.test.ts` carries a `// @ts-expect-error` assertion proving a `ConductorEvent` literal with `type: 'pipeline_closeout'` fails type-checking.
- [test] `session-event-replay.test.ts` replays a committed fixture events ledger containing no closeout kinds and asserts with `toStrictEqual` that the full replay output is identical to an expected-output fixture recorded from the pre-change replay, and its assertions for every remaining event kind pass unchanged from before this task.
- `closeout-trust.ts` and `closeout-trust.test.ts` are deleted with no remaining importer, and `ExternalPipelineEvent` in `closeout-events.ts` is exactly the admitted-kind list from Task 5.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — union narrowing
- `src/conductor/src/engine/event-sinks.ts` — registry rows
- `src/conductor/src/engine/closeout-events.ts` — closeout aliases removed
- `src/conductor/src/engine/closeout-trust.ts` — deleted
- `src/conductor/test/closeout-trust.test.ts` — deleted
- `src/conductor/test/closeout-events.test.ts` — closeout cases removed
- `src/conductor/test/engine/event-sinks.test.ts` — type-level assertion
- `src/conductor/test/engine/session-event-replay.test.ts` — closeout cases removed
- `src/conductor/test/engine/conductor.test.ts` — closeout cases removed
- `src/conductor/test/integration/audit-trail-completeness.integration.test.ts` — closeout cases removed

**Dependencies:** Tasks 5, 6, 7, 9, 10, 11, 12

### Task 14: `/pipeline` batch boundaries advance on simplify, lint, and affected tests
**Story:** Story 1
**Type:** refactor

**Steps:**
1. Edit `skills/pipeline/SKILL.md`. Delete:
   - the "HARD GATE: Evaluator dispatch is mandatory" section and the 15-second cooldown;
   - the evaluator dispatch prompt and inputs, and the `closeout-event start`/`end evaluator` instructions;
   - the tier frequency and model-scaling table, the risk-domain override, and the evaluator diff-scope paragraph;
   - the orchestrator-writes enforcement block (`review.json` stat-check, closeout record check, `Batch N blocked`
     message), the evaluator stages, the security check list, and the verdict table;
   - the "Code-review gate satisfaction" `code-review-satisfied.md` marker;
   - the `batches_with_evaluator` summary field.
2. Keep the `BATCH_AFFECTED_TESTS` union paragraph, without the evaluator sentence, and the pre-batch verification
   and post-batch `/simplify` and linter checks. Keep the orphaned-caller grep gate, rewording only "before the
   expensive batch-evaluator dispatch".
3. Rewrite the scope-discipline sentence so unrelated-line edits are owned by `prd_audit`'s "nothing more" acceptance
   check.
4. Commit.

**Done when:**
- `skills/pipeline/SKILL.md`'s batch-boundary sections instruct running the `simplify` workflow, the linter, and inspection of `BATCH_AFFECTED_TESTS` before advancing, and contain no subagent dispatch for review at a batch boundary, no evaluator dispatch, no tier-dependent or risk-dependent review dispatch or model escalation, no 15-second review cooldown, no `review.json` or `code-review-satisfied.md` write or check, no `Batch N blocked` message, and no `closeout-event` invocation or closeout-record precondition.
- `skills/pipeline/SKILL.md` still instructs stopping to fix a `BATCH_AFFECTED_TESTS` failure that is not an expected RED test before the next batch, and still requires the orphaned-caller grep over non-test production source with the task reported FAIL listing the surviving call sites.
- The scope-discipline paragraph of `skills/pipeline/SKILL.md` names `prd_audit`'s "nothing more" acceptance check as the owner of edits to lines unrelated to the assigned task and names no batch reviewer.
- The pipeline summary schema in `skills/pipeline/SKILL.md` has no `batches_with_evaluator` field.

**Files likely touched:**
- `skills/pipeline/SKILL.md` — batch-boundary rewrite

**Dependencies:** none

### Task 15: Pipeline contract tests guard the evaluator-free batch boundary
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. In `test/test_skill_pipeline_contract.sh`:
   - Drop the "The evaluator MUST receive that same `BATCH_AFFECTED_TESTS` union" requirement.
   - Add a predicate that holds for the batch-boundary contract (simplify, linter, `BATCH_AFFECTED_TESTS`,
     orphaned-caller grep).
   - Prove the predicate fails on a `mktemp` fixture that reintroduces "HARD GATE: Evaluator dispatch is mandatory at
     required batch boundaries." Follow the local predicate-plus-sed-mutation pattern in Technical Approach.
2. In `test/test_harness_integrity.sh`, replace the "Pipeline evaluator-closeout boundary contract" block and its four
   fixtures. The new check passes on the shipped skill and fails on a fixture that reintroduces
   `ai-conductor closeout-event start evaluator`.
3. Commit.

**Done when:**
- [test] `test/test_skill_pipeline_contract.sh` passes its batch-boundary predicate on `skills/pipeline/SKILL.md` and reports the predicate failing on a fixture copy that reintroduces "HARD GATE: Evaluator dispatch is mandatory at required batch boundaries."
- [test] `test/test_harness_integrity.sh` passes its replacement pipeline batch-boundary check on the shipped skill and reports it failing on one fixture copy that reintroduces "HARD GATE: Evaluator dispatch is mandatory at required batch boundaries." and on another that reintroduces `ai-conductor closeout-event start evaluator`.
- `test/test_skill_pipeline_contract.sh` no longer requires the sentence "The evaluator MUST receive that same `BATCH_AFFECTED_TESTS` union and its result set."

**Files likely touched:**
- `test/test_skill_pipeline_contract.sh` — predicate and fixture
- `test/test_harness_integrity.sh` — replaced boundary contract

**Dependencies:** Task 14

### Task 16: Harness instructions name build_review as the post-build review authority
**Story:** Story 3
**Type:** refactor

**Steps:**
1. Edit `skills/conduct/SKILL.md`. In the Step 12 line and the build-step gate row, BUILD completion is gated by task
   completion and the affected-test result set, and post-build review is the engine's `build_review` step.
2. Edit `skills/architecture-review/SKILL.md`:
   - §7b: DRAFT ADRs cannot be cited in `build_review` verdicts.
   - §7b: `build_review`, the as-built review, and `/finish` may cite APPROVED ADRs.
   - §9: conditions are checked by `build_review` and the as-built review.
3. Edit `HARNESS.md`. The subagent rules name the generator and the domain reviewer. The test-evidence rule names
   `build_review` and `/code-review` reviewers.
4. Edit `skills/code-review/SKILL.md`: remove "they already passed their own evaluator gate", and leave the
   `agents/evaluator.md` fresh-context dispatch and three-stage verdict untouched.
5. Commit.

**Done when:**
- `skills/conduct/SKILL.md`'s BUILD step line and build gate row state that BUILD completion is gated by task completion and the affected-test result set and that post-build review is the engine's `build_review` step, and contain no claim that a pipeline evaluator satisfies the code-review gate.
- `skills/architecture-review/SKILL.md` names `build_review`, the as-built review, and `/finish` as the gates that may cite APPROVED ADRs and that check APPROVED WITH CONDITIONS conditions, and names no pipeline evaluator.
- `HARNESS.md`'s subagent rules list the generator and the domain reviewer, and its test-evidence rule names `build_review` and `/code-review` reviewers as consumers of supplied results.
- `skills/code-review/SKILL.md` no longer says earlier batches passed their own evaluator gate, while its `agents/evaluator.md` fresh-context dispatch instructions and three-stage structured verdict sections are byte-unchanged.

**Files likely touched:**
- `skills/conduct/SKILL.md` — build step and gate row
- `skills/architecture-review/SKILL.md` — §7b and §9
- `HARNESS.md` — subagent and test-evidence rules
- `skills/code-review/SKILL.md` — batch-scoping sentence

**Dependencies:** none

### Task 17: Integrity scan rejects evaluator gate-satisfaction claims
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Add a check to `test/test_harness_integrity.sh`. It greps `skills/*/SKILL.md`, `agents/*.md`, `templates/*.template`,
   and `HARNESS.md` for a pipeline or batch evaluator verdict satisfying the code-review gate, or a batch or pipeline
   evaluator catching a defect. Use one predicate and prove it with a `mktemp` fixture copy of
   `skills/conduct/SKILL.md` that reintroduces "pipeline evaluator satisfies code-review gate". Follow the local
   predicate-plus-sed-mutation pattern.
2. Confirm `test/test_provider_skill_contracts.sh`'s "code review retains fresh-context evaluator review" assertions
   still pass unchanged.
3. Commit.

**Done when:**
- [test] `test/test_harness_integrity.sh` scans `skills/*/SKILL.md`, `agents/*.md`, `templates/*.template`, and `HARNESS.md` and passes on the shipped tree, where no file states that a pipeline or batch evaluator verdict satisfies the code-review gate or that a batch or pipeline evaluator will catch a defect.
- [test] `test/test_harness_integrity.sh` reports the scan failing on a fixture copy of `skills/conduct/SKILL.md` that reintroduces "pipeline evaluator satisfies code-review gate".
- [test] `test/test_provider_skill_contracts.sh` still passes its "code review retains fresh-context evaluator review" assertions against `skills/code-review/SKILL.md`.

**Files likely touched:**
- `test/test_harness_integrity.sh` — gate-claim scan

**Dependencies:** Tasks 14, 16, 19

### Task 18: The evaluator model-table row describes only `/code-review`
**Story:** Story 5
**Type:** refactor

**Steps:**
1. In `src/conductor/src/engine/model-table-metadata.ts`, keep the `evaluator` row's Claude cell (default plus the
   risk-domain top tier) and rewrite `why` so it names `/code-review` as the dispatcher. Leave `PIN_EXEMPT_SKILLS`'
   `code-review` comment as is.
2. Regenerate the `ARCHITECTURE.md` model-selection region with `bin/generate-model-table`.
3. In `src/conductor/test/evaluator-model-routing.test.ts`, remove `pipelineEvaluatorScalingTable` and the pipeline
   "Task 4" describe block. Keep the code-review routing and provider-scoping assertions.
4. Add a drift case to the generate-model-table acceptance test that edits the `evaluator` row in a temp copy and
   expects `--check` to fail.
5. Commit.

**Done when:**
- The `evaluator` entry in `model-table-metadata.ts` keeps its default-plus-risk-domain Claude cell and its `why` names `/code-review` as the dispatcher, and the `PIN_EXEMPT_SKILLS` `code-review` comment still states the skill dispatches an evaluator agent directly and is not an engine step.
- `bin/generate-model-table --check` exits 0 against the regenerated `ARCHITECTURE.md` model-selection region.
- [test] `evaluator-model-routing.test.ts` keeps its code-review model-selection and provider-scoping assertions unchanged and contains no assertion that requires a pipeline evaluator scaling table or risk-domain override in `skills/pipeline/SKILL.md`.
- [test] `generate-model-table.acceptance.test.ts` asserts that a hand edit to the `evaluator` row in a copy of the generated region makes the drift check fail.

**Files likely touched:**
- `src/conductor/src/engine/model-table-metadata.ts` — evaluator row
- `ARCHITECTURE.md` — regenerated model-selection region
- `src/conductor/test/evaluator-model-routing.test.ts` — pipeline assertions removed
- `src/conductor/test/acceptance/generate-model-table.acceptance.test.ts` — evaluator drift case

**Dependencies:** Task 14

### Task 19: Agent personas, authoring skills, and the AGENTS template name reviewers that run
**Story:** Story 6
**Type:** refactor

**Steps:**
1. Edit the personas:
   - `agents/generator.md` and `agents/domain-reviewer.md`: code-quality review belongs to build_review's
     `implementationQuality` rubric or `/code-review`.
   - `agents/cto-testing.md` and `agents/cto-architecture.md`: code style and domain integrity belong to build_review
     or `/code-review`.
2. Edit the authoring skills. In `skills/writing-system-tests/SKILL.md` and `skills/stories/SKILL.md`, the late catcher
   or Done When checker is a build_review rubric, `prd_audit`, or `/code-review`. Replace the
   `skills/conflict-check/SKILL.md` oscillating example with two stories about a gate that still exists.
3. Edit `templates/AGENTS.md.template`. The evaluator persona is the `/code-review` reviewer, and the generator/evaluator
   section describes `/code-review` with no pipeline batch loop.
4. Leave `agents/evaluator.md` untouched, then commit.

**Done when:**
- `agents/generator.md` and `agents/domain-reviewer.md` attribute code-quality review to build_review's `implementationQuality` rubric or `/code-review`, and `agents/cto-testing.md` and `agents/cto-architecture.md` attribute code style and domain integrity to build_review or `/code-review`.
- `skills/writing-system-tests/SKILL.md` and `skills/stories/SKILL.md` name a build_review rubric, `prd_audit`, or `/code-review` wherever they previously named the evaluator as the late catcher or the Done When checker.
- `templates/AGENTS.md.template` lists the evaluator persona as the `/code-review` reviewer and its generator/evaluator section describes `/code-review` with no pipeline batch loop.
- `skills/conflict-check/SKILL.md`'s oscillating-conflict example uses two stories about a gate that still exists, and `agents/evaluator.md` is byte-unchanged.

**Files likely touched:**
- `agents/generator.md` — reviewer attribution
- `agents/domain-reviewer.md` — reviewer attribution
- `agents/cto-testing.md` — reviewer attribution
- `agents/cto-architecture.md` — reviewer attribution
- `skills/writing-system-tests/SKILL.md` — late-catcher attribution
- `skills/stories/SKILL.md` — Done When checker attribution
- `skills/conflict-check/SKILL.md` — example replaced
- `templates/AGENTS.md.template` — evaluator section

**Dependencies:** none

## Task Dependency Graph

```
Task 1 ─┬─▶ Task 2
        ├─▶ Task 3
        └─▶ Task 4
Task 5 ──▶ Task 6 ─┐
Task 7 ────────────┤
Task 9 ────────────┤
Task 10 ───────────┼─▶ Task 13
Task 11 ─▶ Task 12 ┘
Task 8 (independent)
Task 14 ─┬─▶ Task 15
         ├─▶ Task 18
         └─▶ Task 17 ◀── Task 16, Task 19
```

## Integration Points

- After Task 1, a default-configured build_review lap dispatches `implementationQuality` and `security` through the
  real classification path.
- After Task 6, an operator-written build-review disposition reaches the live bus through the tail and the merged
  reader.
- After Task 7, the CLI entry rejects `closeout-event` through the generic unknown-command path.
- After Task 12, the `build-tail` command prints the reduced rollup end to end.
- After Task 13, the event union has no closeout kinds and every consumer still compiles.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a Medium-tier plan with 16 tasks run through `/pipeline`, when the build reaches each batch boundary, then the `/pipeline` skill instructs the orchestrator to run the `simplify` workflow, the linter, and the `BATCH_AFFECTED_TESTS` inspection and then advance, and it instructs no subagent dispatch for review at that boundary. | 14 | "instruct running the `simplify` workflow, the linter, and inspection of `BATCH_AFFECTED_TESTS` before advancing" | diff-local |
| Story 1 happy: Given a Large-tier plan or a batch touching concurrency, auth, security, or money, when the build reaches a batch boundary, then the `/pipeline` skill applies the same simplify, lint, and affected-test checks with no tier- or risk-dependent review dispatch, model escalation, or 15-second review cooldown. | 14 | "no tier-dependent or risk-dependent review dispatch or model escalation, no 15-second review cooldown" | diff-local |
| Story 1 happy: Given a task that replaces an old symbol, when the task closes, then the `/pipeline` skill still requires the orphaned-caller grep over non-test production source and still reports the task FAIL with the surviving call sites. | 14 | "still requires the orphaned-caller grep over non-test production source with the task reported FAIL listing the surviving call sites" | diff-local |
| Story 1 negative: Given a batch boundary with no `.pipeline/audit-trail/batch-N/review.json` file, when the orchestrator checks whether it may advance, then the `/pipeline` skill does not treat the missing file as a blocker and does not instruct a halt, a re-dispatch, or a `Batch N blocked` message for it. | 14 | "no `review.json` or `code-review-satisfied.md` write or check, no `Batch N blocked` message" | diff-local |
| Story 1 negative: Given a pipeline session whose `.pipeline/pipeline-events.jsonl` holds no closeout record of any kind, when the orchestrator reaches the batch boundary, then the `/pipeline` skill names no closeout record or `closeout-event` call as a precondition and instructs no `closeout-event` invocation. | 14 | "no `closeout-event` invocation or closeout-record precondition" | diff-local |
| Story 1 negative: Given a batch whose `BATCH_AFFECTED_TESTS` result set contains a failing test that is not an expected RED test, when the orchestrator evaluates the boundary, then the `/pipeline` skill still instructs it to stop and fix before the next batch. | 14 | "still instructs stopping to fix a `BATCH_AFFECTED_TESTS` failure that is not an expected RED test before the next batch" | diff-local |
| Story 1 negative: Given an implementer that edits lines unrelated to its assigned task, when the `/pipeline` skill describes scope discipline, then it names `prd_audit`'s "nothing more" acceptance check as the owner of that violation and does not name a batch reviewer. | 14 | "acceptance check as the owner of edits to lines unrelated to the assigned task and names no batch reviewer" | diff-local |
| Story 2 happy: Given a project root with a `.pipeline/` directory, when `ai-conductor closeout-event start simplify` runs, then the CLI prints `error: unknown command 'closeout-event'` through its ordinary unknown-command fallthrough, exits non-zero, and leaves `.pipeline/pipeline-events.jsonl` byte-for-byte unchanged. | 7 | "prints `error: unknown command 'closeout-event'`, exits non-zero, and leaves `.pipeline/pipeline-events.jsonl` byte-for-byte unchanged" | diff-local |
| Story 2 happy: Given a running conductor whose feature emits step, gate, and build-review events, when the OTel metrics exporter and span manager process that stream, then no `conductor.pipeline.closeout.duration` instrument is created and no span carries a `pipeline_closeout` event. | 9 | "creates no `conductor.pipeline.closeout.duration` instrument" | diff-local |
| Story 2 happy: Given the terminal renderer and the daemon log render a feature's event stream, when the stream completes a build, then neither prints a `closeout <obligation>` line. | 10 | "prints no `closeout <obligation>` line" | diff-local |
| Story 2 happy: Given the `daemon-session` CLI-dispatch allowlist, when a daemon-managed session invokes an `ai-conductor` subcommand, then `closeout-event` is not an allowlisted command and every other allowlisted command still dispatches. | 8 | "refuses `closeout-event` in a daemon-managed session" | diff-local |
| Story 2 negative: Given an engine that loaded old `/pipeline` text before the rebuild, when that session runs `ai-conductor closeout-event start evaluator`, then the command exits non-zero, appends nothing to either ledger, and the engine raises no uncaught error. | 7 | "appends nothing to `.pipeline/pipeline-events.jsonl` or `.pipeline/events.jsonl`, and raises no uncaught error" | diff-local |
| Story 2 negative: Given a `ConductorEvent` literal with `type: 'pipeline_closeout'` in TypeScript source, when the conductor package is type-checked, then compilation fails because the kind is not in the union. | 13 | "proving a `ConductorEvent` literal with `type: 'pipeline_closeout'` fails type-checking" | diff-local |
| Story 2 negative: Given an `.pipeline/events.jsonl` replayed by session-event replay that contains no closeout kinds, when it is replayed after this change, then replay output is identical to replay before this change for every remaining event kind. | 13 | "its assertions for every remaining event kind pass unchanged from before this task" | diff-local |
| Story 3 happy: Given `skills/conduct/SKILL.md`, when an agent reads the BUILD step and the build-step gate table, then BUILD's completion is gated by task completion and the affected-test result set, and the post-build review is attributed to the engine's `build_review` step. | 16 | "post-build review is the engine's `build_review` step" | diff-local |
| Story 3 happy: Given `skills/architecture-review/SKILL.md`, when an agent reads which gates may cite APPROVED ADRs and how APPROVED WITH CONDITIONS conditions are checked, then the named gates are `build_review`, the as-built review, and `/finish`, with no pipeline evaluator. | 16 | "names `build_review`, the as-built review, and `/finish` as the gates that may cite APPROVED ADRs" | diff-local |
| Story 3 happy: Given `HARNESS.md`, when an agent reads the test-evidence and subagent rules, then the subagent list names the generator and the domain reviewer, and the test-evidence rule names `build_review` and `/code-review` reviewers as consumers of supplied results. | 16 | "subagent rules list the generator and the domain reviewer" | diff-local |
| Story 3 happy: Given `skills/code-review/SKILL.md`, when an operator invokes `/code-review` outside a pipeline, then it still dispatches `agents/evaluator.md` in a fresh context and still produces its three-stage structured verdict. | 16, 17 | "three-stage structured verdict sections are byte-unchanged" | diff-local |
| Story 3 negative: Given the shipped skills, agents, templates, and `HARNESS.md`, when the harness integrity suite scans them, then no file states that a pipeline or batch evaluator verdict satisfies the code-review gate, and a fixture that reintroduces that claim into `skills/conduct/SKILL.md` makes the scan fail. | 17 | "reports the scan failing on a fixture copy of `skills/conduct/SKILL.md`" | diff-local |
| Story 3 negative: Given `skills/code-review/SKILL.md`, when an agent reads its batch-scoping guidance, then it does not tell the reviewer that earlier batches already passed their own evaluator gate. | 16 | "no longer says earlier batches passed their own evaluator gate" | diff-local |
| Story 3 negative: Given `skills/conduct/SKILL.md`'s BUILD gate row, when a build completes with zero evaluator records, then the documented gate gives no reason to treat the build as unreviewed. | 16 | "contain no claim that a pipeline evaluator satisfies the code-review gate" | diff-local |
| Story 4 happy: Given a project config that never mentions `security`, when configuration is resolved, then `build_review.rubrics.security` resolves to `enabled: true` with its unchanged default effort `high`, and the build_review step classifies it as a dispatchable branch. | 1 | "resolves `security` to `enabled: true` with effort `high`" | diff-local |
| Story 4 happy: Given a project config that never mentions any rubric, when configuration is resolved, then `implementationQuality` and `security` resolve to `enabled: true`, `testQuality` resolves to `enabled: false`, and only `implementationQuality` and `security` are dispatched. | 1 | "yields exactly the `implementationQuality` and `security` dispatchable branches" | diff-local |
| Story 4 happy: Given a stacked feature with a non-leaf child and a leaf child under a default config, when build_review runs, then `security` is skipped on the non-leaf child and graded once at the leaf, exactly as for an explicitly enabled `security` rubric. | 3 | "graded exactly once at the leaf" | diff-local |
| Story 4 negative: Given `build_review.rubrics.security.enabled: false` with every other rubric at its default, when the lap runs, then only `implementationQuality` is dispatched and no security judgement runs. | 1 | "dispatches only the `implementationQuality` grader and runs no security judgement" | diff-local |
| Story 4 negative: Given `build_review.rubrics.security.enabled: false` and `build_review.rubrics.implementationQuality.enabled: false` with `testQuality` at its default, when the lap runs, then the verdict is PASS with reason `build_review_no_rubrics` and no grader is dispatched. | 2 | "yields verdict PASS with reason `build_review_no_rubrics` and zero grader dispatches" | diff-local |
| Story 4 negative: Given `build_review.rubrics.security.enabled: "no"`, when configuration is validated, then validation fails naming `build_review.rubrics.security.enabled` and its expected boolean type, and no lap is dispatched. | 2 | "fails validation with a message naming `build_review.rubrics.security.enabled`" | diff-local |
| Story 4 negative: Given `build_review.enabled: false`, when the build reaches build_review, then no security judgement runs, even though the rubric defaults to enabled. | 2 | "dispatches no security grader and runs no security judgement" | diff-local |
| Story 5 happy: Given the model-table metadata, when the generated model table is rendered, then the `evaluator` row attributes its model to the `/code-review` dispatch and carries a rationale that names `/code-review`. | 18 | "its `why` names `/code-review` as the dispatcher" | diff-local |
| Story 5 happy: Given `skills/code-review/SKILL.md`'s model-selection block, when the evaluator routing test reads it, then the Claude evaluator model selection and its provider scoping are unchanged. | 18 | "keeps its code-review model-selection and provider-scoping assertions unchanged" | diff-local |
| Story 5 negative: Given the generated model-selection region in `ARCHITECTURE.md`, when the model-table drift check compares it with metadata, then a hand edit to the `evaluator` row that diverges from the regenerated row fails the check. | 18 | "makes the drift check fail" | diff-local |
| Story 5 negative: Given the evaluator routing tests, when they run against `skills/pipeline/SKILL.md`, then no test requires a pipeline evaluator scaling table or risk-domain override to be present. | 18 | "contains no assertion that requires a pipeline evaluator scaling table" | diff-local |
| Story 5 negative: Given the `PIN_EXEMPT_SKILLS` list, when an agent reads the `code-review` entry, then its comment still states that the skill dispatches an evaluator agent directly and is not an engine step. | 18 | "still states the skill dispatches an evaluator agent directly and is not an engine step" | diff-local |
| Story 6 happy: Given `agents/generator.md` and `agents/domain-reviewer.md`, when an agent reads its non-responsibilities, then code-quality review is attributed to build_review's `implementationQuality` rubric or `/code-review`. | 19 | "attribute code-quality review to build_review's `implementationQuality` rubric or `/code-review`" | diff-local |
| Story 6 happy: Given `agents/cto-testing.md` and `agents/cto-architecture.md`, when an agent reads what it must not review, then code style and domain integrity are attributed to build_review or `/code-review`. | 19 | "attribute code style and domain integrity to build_review or `/code-review`" | diff-local |
| Story 6 happy: Given `skills/writing-system-tests/SKILL.md` and `skills/stories/SKILL.md`, when an author reads why a defect class was caught late or who checks Done When, then the named reviewer is a build_review rubric, `prd_audit`, or `/code-review`. | 19 | "name a build_review rubric, `prd_audit`, or `/code-review` wherever they previously named the evaluator" | diff-local |
| Story 6 happy: Given `templates/AGENTS.md.template`, when a consumer project scaffolds AGENTS.md, then the evaluator persona is listed as the `/code-review` reviewer and the generator/evaluator section describes `/code-review` rather than a pipeline batch loop. | 19 | "lists the evaluator persona as the `/code-review` reviewer" | diff-local |
| Story 6 negative: Given `skills/conflict-check/SKILL.md`'s worked example, when an author reads it, then the example conflict uses two stories about a gate that still exists, not about batch-evaluator dispatch. | 19 | "oscillating-conflict example uses two stories about a gate that still exists" | diff-local |
| Story 6 negative: Given `agents/evaluator.md`, when `/code-review` dispatches it, then its review stages and calibration are unchanged. | 19 | "`agents/evaluator.md` is byte-unchanged" | diff-local |
| Story 6 negative: Given the shipped agents, skills, and templates, when the integrity scan from Story 3 runs, then no persona or authoring skill says a batch or pipeline evaluator will catch a defect. | 17 | "or that a batch or pipeline evaluator will catch a defect" | diff-local |
| Story 7 happy: Given a `.pipeline/pipeline-events.jsonl` with one `build_review_outer_verdict` record and one `kickback_budget_adjustment_authorized` record, when the tail polls, then both records are re-emitted onto the live bus exactly once, in ledger order. | 5 | "re-emits both onto the bus exactly once each, in ledger order" | diff-local |
| Story 7 happy: Given an operator runs a build-review disposition command with no conductor process active, when a conductor later starts and its tail drains the ledger, then the disposition event is re-emitted and the merged feature reader returns it in timestamp order with the engine events. | 6 | "is re-emitted onto the live bus when a `CloseoutEventTail` later drains the ledger" | diff-local |
| Story 7 negative: Given a `.pipeline/pipeline-events.jsonl` left from an older session holding a well-formed `pipeline_closeout` record followed by a `build_review_outer_verdict` record, when the tail polls, then the closeout record is not re-emitted, exactly one `pipeline_tail_diagnostic` with reason `unadmitted-type`, the ledger path, and that record's byte offset is emitted, and the verdict record is still re-emitted. | 5 | "emits exactly one `pipeline_tail_diagnostic` with reason `unadmitted-type`" | diff-local |
| Story 7 negative: Given a well-formed record whose `type` is `step_started`, when the tail polls, then it is not re-emitted and one `unadmitted-type` diagnostic is emitted for it. | 5 | "a well-formed `step_started` record is not re-emitted" | diff-local |
| Story 7 negative: Given a malformed line in the ledger, when the tail polls, then it still emits one `pipeline_tail_diagnostic` with reason `malformed-line` and continues with the next line. | 5 | "still yields one `pipeline_tail_diagnostic` with reason `malformed-line`" | diff-local |
| Story 7 negative: Given the same unadmitted record, when the tail polls twice, then only one `unadmitted-type` diagnostic is emitted for it, because the tail's read offset has advanced past it. | 5 | "a second poll over the unchanged ledger emits no further diagnostic for it" | diff-local |
| Story 8 happy: Given a merged ledger with one completed `build` window containing progress ticks that resolve all tasks and two later ticks, one with the head moved and one without, when the rollup is computed, then the window is `measured` with its task-execution segment and post-resolution ticks classified `remediation` and `closeout` respectively, and no closeout duration field. | 11 | "is `measured` with a `taskExecution` segment" | diff-local |
| Story 8 happy: Given the same ledger, when `ai-conductor build-tail` prints its report, then it shows task-execution and post-resolution tick counts and prints no `Closeout:` duration line. | 12 | "contains no `Closeout:` duration line" | diff-local |
| Story 8 negative: Given a merged ledger with no completed `build` window, when the rollup is computed, then the state is `unavailable` and carries no closeout data. | 11 | "yields state `unavailable` carrying no closeout data" | diff-local |
| Story 8 negative: Given a merged ledger whose sibling ledger still holds historical `pipeline_closeout` records inside a completed build window, when the rollup is computed, then those records are ignored and the window's measured segments equal those computed without them. | 11 | "leave its `taskExecution` and `postResolutionTicks` identical" | diff-local |
| Story 8 negative: Given a build window whose progress ticks are absent, when the rollup is computed, then the state is `partial` with no closeout payload. | 11 | "yields state `partial` with no closeout payload" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry#D1 | task | task-7, task-9, task-10, task-13, task-14 | `ConductorEvent` in `types/events.ts` and the registry in `event-sinks.ts` contain no `pipeline_closeout_started` or `pipeline_closeout` member |
| adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry#D2 | task | task-6 | is re-emitted onto the live bus when a `CloseoutEventTail` later drains the ledger |
| adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry#D3 | task | task-5 | emits exactly one `pipeline_tail_diagnostic` with reason `unadmitted-type`, path `.pipeline/pipeline-events.jsonl`, and that record's byte offset |
| adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry#D4 | task | task-11, task-12 | `BuildTailWindowRollup` has no `closeout` field, `PartialBuildTailRollup` has no `closeout` payload |
| adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry#D5 | no-change | none | The `## Migration` fence is authored in the implementation PR body by the existing `release-disposition` step at SHIP (`conductor.ts` reads the ship-draft release metadata into the self-host release gate); no BUILD file carries it. |
| adr-2026-08-08-pipeline-owned-closeout-timestamps#D1 | task | task-13 | `closeout-trust.ts` and `closeout-trust.test.ts` are deleted with no remaining importer |
| adr-2026-08-08-pipeline-owned-closeout-timestamps#D2 | existing | none | `.pipeline/pipeline-events.jsonl` remains the single pipeline-side ledger written through `closeout-events.ts` by `build-review-cli.ts` and `kickback-budget-cli.ts`, and `readMergedFeatureEvents` in `build-tail-rollup.ts` merges it with the engine ledger by `ts`. |
| adr-2026-08-08-pipeline-owned-closeout-timestamps#D3 | task | task-14 | no `closeout-event` invocation or closeout-record precondition |
| adr-2026-08-08-pipeline-owned-closeout-timestamps#D4 | task | task-11 | yields state `unavailable` carrying no closeout data |
| adr-2026-08-26-remove-retrospectives-one-shot#D1 | no-change | none | Removal of the full retrospective step is already shipped; this feature touches no retrospective surface. |
| adr-2026-08-26-remove-retrospectives-one-shot#D2 | no-change | none | The daemon-completion retro narrative removal is already shipped and untouched here. |
| adr-2026-08-26-remove-retrospectives-one-shot#D3 | task | task-7 | `closeout-cli.ts` and `closeout-cli.test.ts` are deleted with no remaining importer |
| adr-2026-08-26-remove-retrospectives-one-shot#D4 | no-change | none | `skills/retro/` deletion and its reference cleanup are already shipped; no task reintroduces a retro reference. |
| adr-2026-08-26-remove-retrospectives-one-shot#D5 | no-change | none | Historical `.docs/retros/` records and the `retro-last` tag are not touched by this feature. |
| adr-2026-08-22-build-review-opt-in-rubric-container#D1 | task | task-1 | resolves `security` to `enabled: true` with effort `high` |
| adr-2026-08-22-build-review-opt-in-rubric-container#D2 | no-change | none | Retired rubric keys and their deprecation warning are unaffected; no task edits the accepted-key list. |
| adr-2026-08-22-build-review-opt-in-rubric-container#D3 | no-change | none | The test-quality rubric's question, input, and default-off status are unchanged by this feature. |
| adr-2026-08-22-build-review-opt-in-rubric-container#D4 | no-change | none | The judged envelope, anchors, finding identity, cache key, and mechanical-fault lane are untouched; only the security member's default changes. |
| adr-2026-08-22-build-review-opt-in-rubric-container#D5 | task | task-2 | yields verdict PASS with reason `build_review_no_rubrics` and zero grader dispatches |
| adr-2026-08-22-one-owner-per-review-question#D1 | task | task-14, task-16 | acceptance check as the owner of edits to lines unrelated to the assigned task and names no batch reviewer |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
