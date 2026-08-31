**Status:** Accepted

# Stories: coverage claims bound to `Done when` (#2088)

Technical track — acceptance criteria derive from `adr-2026-08-31-coverage-binding-judge-step`
(D1–D9). Scope boundary: both claim carriers at every tier — coherence `criterion` rows (M/L) and
the plan's own `## Coverage Check` criterion-level rows (S) — plus a config-gated, default-off
pre-BUILD binding judge. Post-land amendment re-validation is a side effect of the judge re-running,
not a primary target.

## Story 1: Land grounds a criterion quote in the cited task's Done when

As a spec author, I want land to reject a coverage claim whose quote is not one of the cited task's `Done when` checks, so that every claim points at a completion check the builder is obliged to satisfy.

### Acceptance Criteria

#### Happy Path
- Given a coherence `criterion` row citing `task-3` whose quote is a whitespace-normalized substring of one of task 3's `Done when` checks, when the spec lands, then the criterion layer reports no gap for that row
- Given a criterion row citing `task-3, task-5` whose quote appears only in task 5's `Done when` checks, when the spec lands, then the row is grounded (any cited task's `Done when` suffices)

#### Negative Paths
- Given a criterion row citing `task-14` whose quote appears in task 14's Steps prose but in none of its `Done when` checks, when the spec lands, then land rejects with gap id `criterion:quote-not-done-when:<n>` and the message names the criterion text, `task-14`, and every `Done when` check of task 14 verbatim
- Given a criterion row whose quote appears nowhere in the cited task, when the spec lands, then the rejection is still `criterion:quote-ungrounded:<n>` (existing id unchanged, not the new id)
- Given a rejected `criterion:quote-not-done-when:<n>` gap and a coherence waiver citing that exact id, when the spec lands, then the waiver is honored the same way as any other coverage gap
- Given the `coherence-check` skill text, when its criterion-row rule is read, then it states the quote MUST be a check from the cited task's `Done when` block, not Steps or Files prose

### Done When
- [ ] `checkCriterionCoverage` in `src/conductor/src/engine/engineer/coherence-validator.ts` matches the quote against the union of the cited tasks' `parsePlanTaskDoneWhen` checks and emits `criterion:quote-not-done-when:<n>` when the quote is in the body but not in `Done when`
- [ ] The rejection detail includes the criterion, the cited task id(s), and each cited task's `Done when` checks verbatim
- [ ] `criterion:quote-not-done-when:<n>` is accepted by the coherence-waiver parser as a coverage gap; the four evidentiary refusals are unchanged
- [ ] Unit tests for both rejections and the multi-task grounding case fail against pre-change code and pass after
- [ ] `skills/coherence-check/SKILL.md` §4a row class 6 states the `Done when` quote rule

## Story 2: The plan's Coverage Check table carries criterion-level claims

As a spec author, I want the plan's `## Coverage Check` table to accept a criterion-level row form parsed into the same claim shape as a coherence criterion row, so that a Small spec has a checkable claim surface.

### Acceptance Criteria

#### Happy Path
- Given a plan `## Coverage Check` table row whose four cells are the exact criterion text `Story 2 happy: Given …, when …, then …`, the task id `4`, a quote, and `diff-local`, when the table is parsed, then it yields one criterion claim with that criterion text, cited task `4`, that quote, and disposition `diff-local`
- Given a table mixing legacy two-cell story→task rows and four-cell criterion rows, when the table is parsed, then each row is classified by cell count and the legacy rows produce exactly the `claim-<row>` reconciliation results they produce today
- Given a criterion row citing `4 (landed)`, when the task id is resolved, then it resolves to `4` (the trailing parenthesized annotation is stripped before the membership check)

#### Negative Paths
- Given a criterion row citing task `9` when the plan's task tree has no task 9, when the spec lands, then land rejects with `criterion:task-missing:<n>:9` naming the criterion
- Given a criterion row whose criterion cell matches no criterion extracted from the stories file, when the spec lands, then land rejects with `criterion:invented:<n>`
- Given a four-cell criterion row whose disposition cell is empty or `outside-diff`, when the spec lands, then land rejects with the existing `criterion:disposition-missing:<n>` or `criterion:disposition-negative:<n>` gap naming the criterion
- Given every merged plan under `.docs/plans/` on the base branch, when each plan's `## Coverage Check` table is parsed with the new parser, then every plan yields the identical `claim-<row>` result set the retired parse produced (pinned corpus test)
- Given the `plan` skill text, when its §7 Coverage Check is read, then it prescribes the four-cell criterion row form with the `Done when` quote rule and the diff-locality disposition

### Done When
- [ ] The shared coherence parser (`src/conductor/src/engine/coherence-parse.ts`) exposes a plan-table criterion-row parse producing `CriterionCoherenceRow` values, disposition included
- [ ] `parseCoverageCheckTableRows` keeps returning legacy story→task pairs for two-cell rows; a corpus test over `.docs/plans/*.md` asserts identical `claim-<row>` output before and after
- [ ] Task ids in criterion rows strip a trailing parenthesized annotation and are checked against the plan's real task-id set, matching the rule in `adr-2026-08-30-shared-plan-task-reference-resolver`
- [ ] `skills/plan/SKILL.md` §7 documents the criterion row form

## Story 3: Tier S engages the criterion layer at land

As an operator, I want a Small spec's plan-carried criterion claims checked at land with the same grounding rule as M/L, so that a Small spec cannot bind a criterion to a task whose `Done when` does not carry it.

### Acceptance Criteria

#### Happy Path
- Given a tier-S spec whose plan table carries one grounded criterion row per extracted story criterion and no coherence artifact, when the spec lands, then the coherence gate passes
- Given a tier-S spec, when the coherence gate runs, then only the `criterion` layer is evaluated — no coherence artifact is required and no outcome, fr, story, orphan-task, or adr check runs

#### Negative Paths
- Given a tier-S spec whose plan has no criterion-level rows, when the spec lands, then land rejects with one `criterion:omitted:<n>` gap per extracted criterion, each naming the criterion text
- Given a tier-S spec whose criterion row quote is absent from the cited task's `Done when`, when the spec lands, then land rejects with `criterion:quote-not-done-when:<n>` exactly as at M/L
- Given a tier-S spec whose criterion row carries disposition `outside-diff` and no waiver names the gap, when the spec lands, then land rejects with `criterion:disposition-negative:<n>` exactly as at M/L
- Given a tier-S spec whose stories file has no extractable Given/When/Then criteria, when the spec lands, then the refusal is the non-waivable `criterion:stories-unparseable`
- Given a merged tier-S spec on the base branch with no criterion-level rows, when daemon discovery scans it, then it is eligible and dispatches exactly as before

### Done When
- [ ] `runCoherenceGate` engages at tier S with required layers `{criterion}` only, reading claims from the plan table
- [ ] `resolveRequiredLayers` (or its S-tier path) is covered by a test asserting the exact layer set at S and the unchanged set at M/L
- [ ] A discovery test asserts a merged S plan without the table remains eligible
- [ ] Tests for the omitted, ungrounded, and unparseable rejections at S fail against pre-change code and pass after

## Story 4: coverage_binding is a registered BUILD-phase step, off by default

As an operator, I want a `coverage_binding` step between `coherence_check` and `acceptance_specs` that the daemon executes and that does nothing until I enable it, so that the judge ships with zero change to existing builds.

### Acceptance Criteria

#### Happy Path
- Given `ALL_STEPS`, when its order is read, then `coverage_binding` follows `coherence_check` and precedes `acceptance_specs`, with `phase: 'BUILD'`, `enforcement: 'gating'`, prerequisites `['plan']`, and no `skippableForTiers` or `skippableForTracks`
- Given the daemon's derived preseed set, when it is computed, then `coverage_binding` is not a member
- Given a config with no `coverage_binding` block, when the step runs, then it completes successfully with output `coverage_binding judge disabled` and writes `.pipeline/coverage-binding.json` recording `disabled`

#### Negative Paths
- Given `coverage_binding.judge.enabled: "yes"` (non-boolean), when the config is validated, then validation fails naming the key and the expected boolean type
- Given the disabled default, when the step runs on a spec with a `does-not-assert`-shaped claim, then no provider dispatch occurs and no halt is written
- Given a tier-S feature, when the step table's tier skips are evaluated, then `coverage_binding` is not skipped

### Done When
- [ ] `src/conductor/src/engine/steps.ts` registers the step in the stated position with the stated fields; the pinned `getSkippableSteps('S')` set test is updated in the same diff
- [ ] `coverage_binding.judge.enabled` is typed boolean in `src/conductor/src/types/config.ts`, validated in `config.ts`, resolved in `resolved-config.ts` with default `false`, and registered in the config-key consumer registry
- [ ] A test asserts the default is `false` and that the disabled path performs zero provider invocations
- [ ] `artifacts.ts` declares `.pipeline/coverage-binding.json` as the step's run-scoped completion artifact

## Story 5: The judge sees one scoped pair per claim and returns a closed verdict

As an operator, I want each coverage claim judged in a fresh session that receives only the criterion and the cited task's `Done when` checks and returns a closed-vocabulary verdict the engine stamps and persists, so that the judgement is independent, cheap, and auditable.

### Acceptance Criteria

#### Happy Path
- Given `coverage_binding.judge.enabled: true` and a spec with three grounded claims, when the step runs, then three fresh one-shot dispatches occur, each prompt containing exactly one criterion text and the cited task(s)' `Done when` checks and the judgement policy from `skills/coverage-binding/SKILL.md`
- Given a provider payload `{ verdict: 'asserts' }` for a claim, when the engine records it, then `.pipeline/coverage-binding.json` carries an engine-stamped entry with the feature slug, run identity, claim digest, criterion, task ids, the judged `Done when` checks, and the verdict
- Given a persisted verdict whose claim digest equals the digest of the current (criterion, `Done when` checks) pair, when the step re-runs, then that claim is a cache hit, is not re-dispatched, and the envelope is still rewritten so the completion artifact is fresh for this run

#### Negative Paths
- Given a provider payload whose `verdict` is neither `asserts` nor `does-not-assert`, when the engine validates it, then the attempt is a typed infrastructure failure retried under the ordinary step retry ladder, no verdict is recorded for that claim, and no `needs-human` halt is written
- Given every model in the fallback ladder unavailable, when the step runs, then the step reports failed — never done — and the completion artifact is not written as a pass
- Given a judge prompt, when its content is inspected, then it contains no diff, no transcript, no stories prose beyond the criterion text, and instructs the judge not to read files
- Given a `Done when` check edited after a verdict was persisted, when the step re-runs, then the claim's digest differs and it is re-dispatched

### Done When
- [ ] A `runCoverageBinding` branch in `src/conductor/src/engine/step-runners.ts` dispatches per claim through `executeAuxiliaryProviderCandidates` with a fresh session and `resume: false`
- [ ] The envelope schema and its validator live in an engine module; a test rejects an out-of-vocabulary payload and asserts no halt
- [ ] `skills/coverage-binding/SKILL.md` exists with frontmatter and a `model-table-metadata.ts` row so `test/test_harness_integrity.sh` passes
- [ ] Digest-cache tests cover hit (envelope rewritten, zero dispatches), miss after `Done when` edit, malformed-payload retry, and ladder exhaustion

## Story 6: A does-not-assert verdict halts before any build lap

As an operator, I want a claim whose cited `Done when` does not assert the criterion to halt the feature `needs-human` before `build` runs, with the halt naming what to fix, so that the plan is corrected in seconds instead of after a full lap.

### Acceptance Criteria

#### Happy Path
- Given every claim judged `asserts`, when the step completes, then it is `done` and `build` becomes dispatchable
- Given one claim judged `does-not-assert` with `missingAssertion` "no check requires the coordinator to emit the five occurrences", when the step completes, then the step status is `refused` with kind `needs-human`, a `needs-human` halt record is written through `writeHaltMarker`, and the rendered halt lists the criterion, the bound task id, that task's actual `Done when` checks verbatim, and the `missingAssertion` text

#### Negative Paths
- Given a `does-not-assert` verdict, when the halt is written, then no plan task is appended and no decide-grant or route to `plan` is recorded
- Given two failing claims, when the halt is written, then both are listed in one halt record, not two halts
- Given the halt is cleared after the operator amends the plan and reseals, when the feature re-dispatches, then the resume clamp re-admits `coverage_binding` and the amended pair is re-judged rather than the stale verdict reused

### Done When
- [ ] The step stamps `refused`/`needs-human` via the mutation port and writes the committed halt record with the existing `needs-human` `HaltClass`
- [ ] The halt rendering test asserts criterion, task id, `Done when` checks, and `missingAssertion` appear verbatim
- [ ] A test asserts zero plan mutation and zero routing on a failing verdict

## Story 7: A cited task without a Done when block is not judged

As an operator, I want claims against legacy tasks that have no `Done when` block recorded as not applicable rather than judged or halted, so that enabling the judge never halts the merged legacy corpus.

### Acceptance Criteria

#### Happy Path
- Given the judge enabled and a claim citing a task whose plan block has no `Done when`, when the step runs, then no dispatch occurs for that claim, the envelope records it `not-applicable`, and the step completes `done`

#### Negative Paths
- Given a spec mixing one legacy claim and one judgeable claim that returns `asserts`, when the step runs, then exactly one dispatch occurs and the step completes `done`
- Given a spec with zero criterion claims on any carrier, when the step runs, then it completes `done` with an envelope recording zero claims and no halt

### Done When
- [ ] Input assembly skips tasks lacking a `Done when` block and records `not-applicable` per claim
- [ ] Tests cover the legacy-only, mixed, and zero-claim cases and assert dispatch counts

## Story 8: Binding occurrences travel the event spine

As an operator, I want per-claim verdicts and the disabled outcome emitted as `ConductorEvent`s through the existing sinks, with start/refusal/halt riding the generic step events, so that dashboards and `.pipeline/events.jsonl` see them without a new channel.

### Acceptance Criteria

#### Happy Path
- Given the judge enabled, when the step runs to completion, then one `coverage_binding_judged` per claim (carrying a verdict of `asserts`, `does-not-assert`, or `not-applicable`, a claim digest, and task ids) is emitted and appears in `.pipeline/events.jsonl`, and a failing verdict is reported through the existing `step_refused` and `loop_halt` events with `step: coverage_binding`

#### Negative Paths
- Given a sink-registry fixture omitting either of the two new event types, when the sink exhaustiveness test runs, then it fails naming the missing type
- Given the disabled default, when the step runs, then exactly one `coverage_binding_disabled` event is emitted and no `coverage_binding_judged` event is emitted

### Done When
- [ ] `coverage_binding_judged` and `coverage_binding_disabled` are members of the `ConductorEvent` union with render/persist/audit/otel declarations; no `coverage_binding_started`/`_halted` variants exist
- [ ] An event-persister test observes the persisted occurrences in `.pipeline/events.jsonl`
