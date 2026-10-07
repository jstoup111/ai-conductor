# Unrecognized remediation dispositions are reported, not dropped

**Status:** Accepted

Source: https://github.com/jstoup111/ai-conductor/issues/2187
Track: technical. Tier: S.

## Context

`readRemediationPlan` (`src/conductor/src/engine/artifacts.ts`) drops any gap whose `disposition`
word is not in the engine's accepted vocabulary with a bare `continue`. When every gap is dropped
the parser returns `null`, `planRemediation` answers `{ kind: 'none' }`, and the caller falls
through to the generic "as-built review verdict is BLOCKED" halt. Nothing reaches the event spine.
Scope is reporting only: which side owns the vocabulary is a separate intake.

## Story 1: A planner output with no recognized disposition is rejected naming the rejected word

As the operator reading a halt, I want a rejected plan to name the disposition word the engine rejected, the finding reference it was attached to, and the vocabulary the engine accepts, so that I investigate the rejection instead of a verdict that was never the cause.

### Acceptance Criteria

#### Happy Path
- Given a structured remediation result whose every disposition carries a value outside the engine vocabulary (for example `unsupported-disposition` on two as-built finding references), when the engine validator checks it, then the whole plan is rejected with a diagnostic naming each rejected value, the reference it was attached to, and the full accepted set, and the attempt is retried within `remediate`'s retry allowance rather than halting immediately.
- Given every attempt within the retry allowance is rejected the same way, when the allowance is exhausted, then the as-built caller receives a no-plan result carrying that named fault and applies its existing no-plan handling, halting needs-human with a message that names the rejected values, their references, and the accepted set, and that does not contain the generic "as-built review verdict is BLOCKED" reason.

#### Negative Paths
- Given a disposition entry whose disposition field is missing or is not a string, when the engine validator checks it, then the whole plan is rejected with a diagnostic naming that entry's reference and the malformed field, rather than crashing or reporting the generic verdict.
- Given a disposition entry whose finding reference is missing, when the engine validator checks it, then the whole plan is rejected with a diagnostic naming the entry by its position in the dispositions list (`#3`) and the malformed reference field, and still lists the rejected disposition value.

### Done When
- [ ] A validator fixture with two unrecognized dispositions produces a whole-plan rejection whose diagnostic names both values, both references, and the accepted set.
- [ ] An exhaustion fixture with only unrecognized dispositions returns a no-plan result to the as-built caller, which halts needs-human with detail naming every rejected value, its reference, and the accepted set, and not containing "verdict is BLOCKED".
- [ ] Missing-field and non-string-field fixtures each produce a whole-plan rejection naming the field.

## Story 2: Every rejected disposition is recorded on the event spine

As the operator following a feature in daemon output, I want each rejected disposition to appear as an event in `.pipeline/events.jsonl` and in the rendered daemon log, so that a rejected planner judgement is visible without reading the halt file.

### Acceptance Criteria

#### Happy Path
- Given a planner output with one or more unrecognized dispositions, when the engine validator checks it, then one `remediation_disposition_rejected` `ConductorEvent` is emitted per rejected entry carrying the finding reference, the rejected word, and the accepted vocabulary, and each is persisted to `.pipeline/events.jsonl` and rendered in daemon output.
- Given the exhaustion halt from Story 1, when the operator reads `events.jsonl` for the remediate window, then each attempt's rejection events precede the halt event and the halt's detail agrees with them.

#### Negative Paths
- Given a planner output whose every disposition is recognized, when the engine validator checks it, then zero `remediation_disposition_rejected` events are emitted and `events.jsonl` is byte-identical to the current behavior for that input.
- Given the event emitter throws while persisting a rejection event, when validation continues, then the whole-plan rejection and, after exhaustion, the halt from Story 1 are still produced with the full detail (the halt does not depend on the event succeeding).

### Done When
- [ ] `remediation_disposition_rejected` is a member of the `ConductorEvent` union and registered in `event-sinks.ts` with `render: true, persist: true, audit: true`.
- [ ] A test asserts that a two-rejection plan emits exactly two events with the expected finding reference, `disposition`, and `accepted` fields, and that a fully-recognized plan emits none.

## Story 3: One unrecognized disposition rejects the whole plan

As the daemon, I want a planner output that mixes recognized and unrecognized dispositions to be rejected as a whole and retried, so that one drifted word is diagnosed and corrected instead of silently discarding a required finding.

### Acceptance Criteria

#### Happy Path
- Given a planner output with one as-built finding → `build` (with tasks) and another → `unsupported-disposition`, when the engine validator checks it, then the whole plan is rejected with a diagnostic naming `unsupported-disposition`, its reference, and the accepted set, no tasks are appended, one `remediation_disposition_rejected` event is emitted for the rejected entry, and the attempt is retried within `remediate`'s retry allowance.
- Given a retry that returns every disposition recognized, when it is validated, then the plan routes, hints, appends tasks, and halts exactly as current behavior for that input, and the rejected attempt's diagnostic is recorded.

#### Negative Paths
- Given a mixed output where the only recognized entry is a taskless ordinary `build`, when the engine validator checks it, then the whole plan is rejected with diagnostics naming both the unknown disposition value and the empty task list; neither entry is admitted.
- Given a mixed output where the recognized entry is a `halt` with a valid category, when the engine validator checks it, then the whole plan is rejected naming the unknown value rather than returning the category halt, and only after retry exhaustion does the caller apply its existing no-plan handling naming the fault.

### Done When
- [ ] A validator fixture with one `build` entry and one unrecognized entry asserts a whole-plan rejection, zero appended tasks, and one rejection event.
- [ ] Existing routing tests pass unchanged for fully-recognized validated plans.
- [ ] Fixtures cover the taskless-build and category-halt mixed cases asserting a whole-plan rejection whose diagnostic names the unknown value and its reference.
