**Status:** Accepted

# Stories: Retire /pipeline batch evaluators (#3056)

Technical track, deletion, comprehensive scope. These stories come from the track scope boundary
(`.docs/track/pipeline-batch-evaluators-remain-an-unenforced-sec.md`), the approved architecture review
`.docs/decisions/architecture-review-2026-10-12-pipeline-batch-evaluators-remain-an-unenforced-sec.md`, and the amended ADRs
`adr-2026-08-22-one-owner-per-review-question` (D1) and `adr-2026-08-22-build-review-opt-in-rubric-container` (decision 1).
`build_review` becomes the single post-build review authority. Its `security` rubric becomes enabled by default, so a
default-configured build keeps a security review. The standalone `/code-review` skill and the `agents/evaluator.md` persona
it dispatches survive unchanged in behavior.

## Story 1: A /pipeline batch boundary advances on simplify, lint, and affected tests alone

As a harness operator, I want a `/pipeline` BUILD to cross every batch boundary once its `/simplify`, lint, and affected-test checks are satisfied, so that no build pays for or silently skips a second, unenforced review layer.

### Acceptance Criteria

#### Happy Path

- Given a Medium-tier plan with 16 tasks run through `/pipeline`, when the build reaches each batch boundary, then the `/pipeline` skill instructs the orchestrator to run the `simplify` workflow, the linter, and the `BATCH_AFFECTED_TESTS` inspection and then advance, and it instructs no subagent dispatch for review at that boundary.
- Given a Large-tier plan or a batch touching concurrency, auth, security, or money, when the build reaches a batch boundary, then the `/pipeline` skill applies the same simplify, lint, and affected-test checks with no tier- or risk-dependent review dispatch, model escalation, or 15-second review cooldown.
- Given a task that replaces an old symbol, when the task closes, then the `/pipeline` skill still requires the orphaned-caller grep over non-test production source and still reports the task FAIL with the surviving call sites.

#### Negative Paths

- Given a batch boundary with no `.pipeline/audit-trail/batch-N/review.json` file, when the orchestrator checks whether it may advance, then the `/pipeline` skill does not treat the missing file as a blocker and does not instruct a halt, a re-dispatch, or a `Batch N blocked` message for it.
- Given a pipeline session whose `.pipeline/pipeline-events.jsonl` holds no closeout record of any kind, when the orchestrator reaches the batch boundary, then the `/pipeline` skill names no closeout record or `closeout-event` call as a precondition and instructs no `closeout-event` invocation.
- Given a batch whose `BATCH_AFFECTED_TESTS` result set contains a failing test that is not an expected RED test, when the orchestrator evaluates the boundary, then the `/pipeline` skill still instructs it to stop and fix before the next batch.
- Given an implementer that edits lines unrelated to its assigned task, when the `/pipeline` skill describes scope discipline, then it names `prd_audit`'s "nothing more" acceptance check as the owner of that violation and does not name a batch reviewer.

### Done When

- [ ] `skills/pipeline/SKILL.md` contains no instruction to dispatch an evaluator, no evaluator frequency or model-scaling table, no risk-domain evaluator override, and no `review.json` or `code-review-satisfied.md` write or check.
- [ ] `skills/pipeline/SKILL.md` still contains the batch-boundary `simplify` instruction, the linter step, the `BATCH_AFFECTED_TESTS` union, and the orphaned-caller grep gate, and contains no `closeout-event` invocation.
- [ ] `test/test_skill_pipeline_contract.sh` and `test/test_harness_integrity.sh` assert the surviving batch-boundary contract and fail against a fixture that reintroduces a mandatory evaluator dispatch at a batch boundary.
- [ ] The pipeline summary schema in `skills/pipeline/SKILL.md` no longer carries a `batches_with_evaluator` field.

## Story 2: Pipeline closeout-obligation telemetry is retired end to end

As a harness maintainer, I want the closeout-obligation event kinds, the `closeout-event` CLI, and every consumer of them gone, so that no command, event, metric, or log line advertises a closeout role that nothing performs.

### Acceptance Criteria

#### Happy Path

- Given a project root with a `.pipeline/` directory, when `ai-conductor closeout-event start simplify` runs, then the CLI prints `error: unknown command 'closeout-event'` through its ordinary unknown-command fallthrough, exits non-zero, and leaves `.pipeline/pipeline-events.jsonl` byte-for-byte unchanged.
- Given a running conductor whose feature emits step, gate, and build-review events, when the OTel metrics exporter and span manager process that stream, then no `conductor.pipeline.closeout.duration` instrument is created and no span carries a `pipeline_closeout` event.
- Given the terminal renderer and the daemon log render a feature's event stream, when the stream completes a build, then neither prints a `closeout <obligation>` line.
- Given the `daemon-session` CLI-dispatch allowlist, when a daemon-managed session invokes an `ai-conductor` subcommand, then `closeout-event` is not an allowlisted command and every other allowlisted command still dispatches.

#### Negative Paths

- Given an engine that loaded old `/pipeline` text before the rebuild, when that session runs `ai-conductor closeout-event start evaluator`, then the command exits non-zero, appends nothing to either ledger, and the engine raises no uncaught error.
- Given a `ConductorEvent` literal with `type: 'pipeline_closeout'` in TypeScript source, when the conductor package is type-checked, then compilation fails because the kind is not in the union.
- Given an `.pipeline/events.jsonl` replayed by session-event replay that contains no closeout kinds, when it is replayed after this change, then replay output is identical to replay before this change for every remaining event kind.

### Done When

- [ ] The `ConductorEvent` union, the event-sink registry, and the OTel metrics listener contain no `pipeline_closeout_started` or `pipeline_closeout` entry, and the TypeScript build passes.
- [ ] `ai-conductor closeout-event` is not dispatched by the CLI entry, and a CLI test proves the invocation exits non-zero and writes nothing.
- [ ] `closeout-cli.ts` and `closeout-trust.ts` and their dedicated tests are removed, and no source file imports them.
- [ ] `src/conductor/test/engine/otel/metrics.test.ts`, `span-manager.test.ts`, `ui/terminal-renderer.test.ts`, and `engine/daemon-cli.test.ts` assert the live behavior with no closeout instrument, span event, or log line.
- [ ] The implementation PR body carries a `## Migration` bash fence stating that the `closeout-event` subcommand is retired and requires no consumer action.

## Story 3: build_review is the single post-build review authority in every harness instruction

As an agent following harness instructions, I want every skill and harness contract to name `build_review` as the post-build review authority, so that no instruction tells me an evaluator verdict satisfies a code-review gate.

### Acceptance Criteria

#### Happy Path

- Given `skills/conduct/SKILL.md`, when an agent reads the BUILD step and the build-step gate table, then BUILD's completion is gated by task completion and the affected-test result set, and the post-build review is attributed to the engine's `build_review` step.
- Given `skills/architecture-review/SKILL.md`, when an agent reads which gates may cite APPROVED ADRs and how APPROVED WITH CONDITIONS conditions are checked, then the named gates are `build_review`, the as-built review, and `/finish`, with no pipeline evaluator.
- Given `HARNESS.md`, when an agent reads the test-evidence and subagent rules, then the subagent list names the generator and the domain reviewer, and the test-evidence rule names `build_review` and `/code-review` reviewers as consumers of supplied results.
- Given `skills/code-review/SKILL.md`, when an operator invokes `/code-review` outside a pipeline, then it still dispatches `agents/evaluator.md` in a fresh context and still produces its three-stage structured verdict.

#### Negative Paths

- Given the shipped skills, agents, templates, and `HARNESS.md`, when the harness integrity suite scans them, then no file states that a pipeline or batch evaluator verdict satisfies the code-review gate, and a fixture that reintroduces that claim into `skills/conduct/SKILL.md` makes the scan fail.
- Given `skills/code-review/SKILL.md`, when an agent reads its batch-scoping guidance, then it does not tell the reviewer that earlier batches already passed their own evaluator gate.
- Given `skills/conduct/SKILL.md`'s BUILD gate row, when a build completes with zero evaluator records, then the documented gate gives no reason to treat the build as unreviewed.

### Done When

- [ ] `skills/conduct/SKILL.md`, `skills/architecture-review/SKILL.md`, `skills/code-review/SKILL.md`, and `HARNESS.md` carry no claim that a pipeline or batch evaluator satisfies or substitutes for a code-review gate.
- [ ] `test/test_harness_integrity.sh` replaces its pipeline evaluator-closeout boundary contract with a check that fails when a shipped skill, agent, template, or `HARNESS.md` claims an evaluator verdict satisfies the code-review gate.
- [ ] `test/test_provider_skill_contracts.sh` still passes its `code review retains fresh-context evaluator review` assertions against `skills/code-review/SKILL.md`.

## Story 4: A default-configured build_review runs the security rubric

As a project operator, I want the build_review `security` rubric to run unless I turn it off, so that retiring the batch evaluator does not leave a default build with no security review.

### Acceptance Criteria

#### Happy Path

- Given a project config that never mentions `security`, when configuration is resolved, then `build_review.rubrics.security` resolves to `enabled: true` with its unchanged default effort `high`, and the build_review step classifies it as a dispatchable branch.
- Given a project config that never mentions any rubric, when configuration is resolved, then `implementationQuality` and `security` resolve to `enabled: true`, `testQuality` resolves to `enabled: false`, and only `implementationQuality` and `security` are dispatched.
- Given a stacked feature with a non-leaf child and a leaf child under a default config, when build_review runs, then `security` is skipped on the non-leaf child and graded once at the leaf, exactly as for an explicitly enabled `security` rubric.

#### Negative Paths

- Given `build_review.rubrics.security.enabled: false` with every other rubric at its default, when the lap runs, then only `implementationQuality` is dispatched and no security judgement runs.
- Given `build_review.rubrics.security.enabled: false` and `build_review.rubrics.implementationQuality.enabled: false` with `testQuality` at its default, when the lap runs, then the verdict is PASS with reason `build_review_no_rubrics` and no grader is dispatched.
- Given `build_review.rubrics.security.enabled: "no"`, when configuration is validated, then validation fails naming `build_review.rubrics.security.enabled` and its expected boolean type, and no lap is dispatched.
- Given `build_review.enabled: false`, when the build reaches build_review, then no security judgement runs, even though the rubric defaults to enabled.

### Done When

- [ ] Resolved configuration for a project that omits `security` reports `enabled: true` and `effort: high`, while `testQuality` still reports `enabled: false`.
- [ ] Classification under a fully default config yields exactly the `implementationQuality` and `security` branches.
- [ ] Classification with `security` and `implementationQuality` disabled and `testQuality` at its default yields the `build_review_no_rubrics` PASS with zero dispatches.
- [ ] Existing default-config build_review and daemon end-to-end fixtures pass with the security default, either by stubbing the security grader or by opting out explicitly where the fixture is not about security.

## Story 5: Model routing advertises the evaluator only for /code-review

As an operator reading the model table, I want the `evaluator` row to describe only the `/code-review` dispatch that still runs, so that routing documentation matches what actually executes.

### Acceptance Criteria

#### Happy Path

- Given the model-table metadata, when the generated model table is rendered, then the `evaluator` row attributes its model to the `/code-review` dispatch and carries a rationale that names `/code-review`.
- Given `skills/code-review/SKILL.md`'s model-selection block, when the evaluator routing test reads it, then the Claude evaluator model selection and its provider scoping are unchanged.

#### Negative Paths

- Given the generated model-selection region in `ARCHITECTURE.md`, when the model-table drift check compares it with metadata, then a hand edit to the `evaluator` row that diverges from the regenerated row fails the check.
- Given the evaluator routing tests, when they run against `skills/pipeline/SKILL.md`, then no test requires a pipeline evaluator scaling table or risk-domain override to be present.
- Given the `PIN_EXEMPT_SKILLS` list, when an agent reads the `code-review` entry, then its comment still states that the skill dispatches an evaluator agent directly and is not an engine step.

### Done When

- [ ] The `evaluator` entry in `src/conductor/src/engine/model-table-metadata.ts` describes the `/code-review` dispatch, and the regenerated model-selection region in `ARCHITECTURE.md` matches it.
- [ ] `src/conductor/test/evaluator-model-routing.test.ts` keeps its code-review routing and provider-scoping assertions and holds no pipeline-evaluator scaling assertions.
- [ ] `src/conductor/test/model-table-metadata.test.ts` and the generate-model-table acceptance test pass.

## Story 6: Agent personas and authoring skills describe the reviewers that actually run

As an agent loaded with a harness persona or authoring skill, I want its references to "the evaluator" to name a reviewer that runs, so that I do not defer quality or security concerns to a batch review that never happens.

### Acceptance Criteria

#### Happy Path

- Given `agents/generator.md` and `agents/domain-reviewer.md`, when an agent reads its non-responsibilities, then code-quality review is attributed to build_review's `implementationQuality` rubric or `/code-review`.
- Given `agents/cto-testing.md` and `agents/cto-architecture.md`, when an agent reads what it must not review, then code style and domain integrity are attributed to build_review or `/code-review`.
- Given `skills/writing-system-tests/SKILL.md` and `skills/stories/SKILL.md`, when an author reads why a defect class was caught late or who checks Done When, then the named reviewer is a build_review rubric, `prd_audit`, or `/code-review`.
- Given `templates/AGENTS.md.template`, when a consumer project scaffolds AGENTS.md, then the evaluator persona is listed as the `/code-review` reviewer and the generator/evaluator section describes `/code-review` rather than a pipeline batch loop.

#### Negative Paths

- Given `skills/conflict-check/SKILL.md`'s worked example, when an author reads it, then the example conflict uses two stories about a gate that still exists, not about batch-evaluator dispatch.
- Given `agents/evaluator.md`, when `/code-review` dispatches it, then its review stages and calibration are unchanged.
- Given the shipped agents, skills, and templates, when the integrity scan from Story 3 runs, then no persona or authoring skill says a batch or pipeline evaluator will catch a defect.

### Done When

- [ ] `agents/generator.md`, `agents/domain-reviewer.md`, `agents/cto-testing.md`, `agents/cto-architecture.md`, `skills/writing-system-tests/SKILL.md`, `skills/stories/SKILL.md`, `skills/conflict-check/SKILL.md`, and `templates/AGENTS.md.template` name only reviewers that run.
- [ ] `agents/evaluator.md` is unchanged.
- [ ] The Story 3 integrity scan passes over these files.

## Story 7: The sibling-ledger tail re-emits only admitted external event kinds

As the harness, I want the pipeline-events tail to re-emit only the external event kinds it is meant to carry, so that leftover or foreign records in `.pipeline/pipeline-events.jsonl` never reach the live bus as undeclared events.

### Acceptance Criteria

#### Happy Path

- Given a `.pipeline/pipeline-events.jsonl` with one `build_review_outer_verdict` record and one `kickback_budget_adjustment_authorized` record, when the tail polls, then both records are re-emitted onto the live bus exactly once, in ledger order.
- Given an operator runs a build-review disposition command with no conductor process active, when a conductor later starts and its tail drains the ledger, then the disposition event is re-emitted and the merged feature reader returns it in timestamp order with the engine events.

#### Negative Paths

- Given a `.pipeline/pipeline-events.jsonl` left from an older session holding a well-formed `pipeline_closeout` record followed by a `build_review_outer_verdict` record, when the tail polls, then the closeout record is not re-emitted, exactly one `pipeline_tail_diagnostic` with reason `unadmitted-type`, the ledger path, and that record's byte offset is emitted, and the verdict record is still re-emitted.
- Given a well-formed record whose `type` is `step_started`, when the tail polls, then it is not re-emitted and one `unadmitted-type` diagnostic is emitted for it.
- Given a malformed line in the ledger, when the tail polls, then it still emits one `pipeline_tail_diagnostic` with reason `malformed-line` and continues with the next line.
- Given the same unadmitted record, when the tail polls twice, then only one `unadmitted-type` diagnostic is emitted for it, because the tail's read offset has advanced past it.

### Done When

- [ ] `pipeline_tail_diagnostic.reason` admits `unadmitted-type` alongside `malformed-line` and `poll-failed`.
- [ ] `src/conductor/test/closeout-tail.test.ts` proves admitted kinds re-emit, an unadmitted well-formed record yields one `unadmitted-type` diagnostic with path and byte offset and no re-emission, and polling continues past it.
- [ ] The admitted set is derived from the external-event type list used by the ledger writer, so adding an external kind requires one edit.

## Story 8: The build-tail rollup reports task execution and post-resolution ticks only

As an operator running `ai-conductor build-tail`, I want the rollup to describe the build segments that are still measured, so that it never reports a closeout timeline that nothing records.

### Acceptance Criteria

#### Happy Path

- Given a merged ledger with one completed `build` window containing progress ticks that resolve all tasks and two later ticks, one with the head moved and one without, when the rollup is computed, then the window is `measured` with its task-execution segment and post-resolution ticks classified `remediation` and `closeout` respectively, and no closeout duration field.
- Given the same ledger, when `ai-conductor build-tail` prints its report, then it shows task-execution and post-resolution tick counts and prints no `Closeout:` duration line.

#### Negative Paths

- Given a merged ledger with no completed `build` window, when the rollup is computed, then the state is `unavailable` and carries no closeout data.
- Given a merged ledger whose sibling ledger still holds historical `pipeline_closeout` records inside a completed build window, when the rollup is computed, then those records are ignored and the window's measured segments equal those computed without them.
- Given a build window whose progress ticks are absent, when the rollup is computed, then the state is `partial` with no closeout payload.

### Done When

- [ ] The rollup types carry no `closeout` window field or closeout-bearing `partial` variant, and `build-tail-rollup.test.ts` covers the measured, no-window `unavailable`, historical-closeout-ignored, and no-tick `partial` cases.
- [ ] `build-tail-cli.test.ts` asserts the report prints no closeout duration lines.
- [ ] The `build-post-task-tail-telemetry` acceptance test asserts the reduced rollup shape.

