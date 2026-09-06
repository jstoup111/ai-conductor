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

## Story 1: A planner output with no recognized disposition halts naming the rejected word

As the operator reading a halt, I want the halt to name the disposition word the engine rejected, the finding it was attached to, and the vocabulary the engine accepts, so that I investigate the rejection instead of a verdict that was never the cause.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/remediation.json` whose every gap carries a disposition word outside the accepted vocabulary (for example `unsupported-disposition` on AB-1 and AB-2), when remediation routing reads it, then the feature halts needs-human with a message that names each rejected word, the gap id it was attached to, and the full accepted vocabulary list.
- Given the same input, when the halt is written, then the halt text does not contain the generic "as-built review verdict is BLOCKED" reason.

#### Negative Paths
- Given a gap whose `disposition` field is missing or is not a string, when remediation routing reads it, then the halt names that gap id with the rejected value rendered as `<missing>` or the JSON-stringified value, and the accepted vocabulary, rather than crashing or reporting the generic verdict.
- Given a rejected gap whose `id` is missing, when the halt is composed, then the halt names the gap by its position in the `dispositions` array (`#3`) and still lists the rejected word.

### Done When
- [ ] `readRemediationPlan` returns a `rejected` list — one entry per dropped disposition carrying `gapId`, `disposition` (the rejected value), and `accepted` (the vocabulary) — alongside `gaps`, and returns non-null when `rejected` is non-empty even with zero surviving gaps.
- [ ] `planRemediation` returns `{ kind: 'halt', haltClass: 'needs-human' }` for a zero-survivor plan, with `detail` containing every rejected word, its gap id, and the accepted vocabulary.
- [ ] A unit test with two unrecognized gaps asserts the halt detail names both words, both gap ids, and the vocabulary, and does not contain "verdict is BLOCKED".

## Story 2: Every rejected disposition is recorded on the event spine

As the operator following a feature in daemon output, I want each dropped disposition to appear as an event in `.pipeline/events.jsonl` and in the rendered daemon log, so that a discarded planner judgement is visible without reading the halt file.

### Acceptance Criteria

#### Happy Path
- Given a planner output with one or more unrecognized dispositions, when remediation routing reads it, then one `remediation_disposition_rejected` `ConductorEvent` is emitted per rejected gap carrying the gap id, the rejected word, and the accepted vocabulary, and each is persisted to `.pipeline/events.jsonl` and rendered in daemon output.
- Given the halt from Story 1, when the operator reads `events.jsonl` for the remediate window, then the rejection events precede the halt event and the halt's detail agrees with them.

#### Negative Paths
- Given a planner output whose every disposition is recognized, when remediation routing reads it, then zero `remediation_disposition_rejected` events are emitted and `events.jsonl` is byte-identical to the current behavior for that input.
- Given the event emitter throws while persisting a rejection event, when routing continues, then the halt from Story 1 is still written with the full detail (the halt does not depend on the event succeeding).

### Done When
- [ ] `remediation_disposition_rejected` is a member of the `ConductorEvent` union and registered in `event-sinks.ts` with `render: true, persist: true, audit: true`.
- [ ] A test asserts that a two-rejection plan emits exactly two events with the expected `gapId`, `disposition`, and `accepted` fields, and that a fully-recognized plan emits none.

## Story 3: Recognized dispositions still route when others are rejected

As the daemon, I want a planner output that mixes recognized and unrecognized dispositions to route the recognized gaps normally, so that one drifted word does not discard the whole judgement.

### Acceptance Criteria

#### Happy Path
- Given a planner output with AB-1 → `build` (with tasks) and AB-2 → `unsupported-disposition`, when remediation routing reads it, then AB-1 routes to `build` with its tasks appended exactly as it does today, one `remediation_disposition_rejected` event is emitted for AB-2, and the route's `evidence`/hint text mentions AB-2 as dropped.
- Given a planner output whose every disposition is recognized, when remediation routing reads it, then the route, hint, evidence, appended tasks, and halt behavior are unchanged from current behavior.

#### Negative Paths
- Given a mixed output where the only recognized gap is a taskless ordinary `build`, when remediation routing reads it, then the existing "no dispatchable build work" halt is returned and its detail additionally names the rejected gap ids and words.
- Given a mixed output where the recognized gap is a `halt` with a valid category, when remediation routing reads it, then the existing category halt is returned and its detail additionally names the rejected gap ids and words.

### Done When
- [ ] A test with one `build` gap and one unrecognized gap asserts `kind: 'route'`, `target: 'build'`, and one rejection event.
- [ ] Existing `readRemediationPlan` and `planRemediation` tests pass unchanged for fully-recognized inputs.
- [ ] Tests cover the taskless-build and category-halt mixed cases asserting the rejected ids appear in `detail`.
