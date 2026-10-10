**Status:** Accepted

# Stories: Malformed Covers token routes back to BUILD instead of exhausting the build_review fault allowance

Source: jstoup111/ai-conductor#2540. Track: technical (no PRD). Tier: S.

Today a changed test whose only marker is a near-miss such as `// Covers: Task: 32` reaches the
`testQuality` reviewer as an unbound candidate, the reviewer resolves it `indeterminate`, the derived
`scope-incomplete` fault is charged as a mechanical fault, and `build_review` re-runs against the
identical tree until the three-fault allowance is exhausted and the feature halts needs-human. These
stories make the engine catch the malformed token itself and hand it back to BUILD.

Terms used below:
- **Malformed token** — a non-empty, trimmed `Covers:` token that matches none of the reference
  grammars `task:<id>`, `S<story>.<n>`, or `FR-<n>` (`parseCoversMarkers` returns kind `unresolved`).
- **Introduced** — the marker association exists on the HEAD side of a changed test declaration and
  did not exist at the merge-base (the same introduced-association rule the test scope already uses).
- **Unbound** — the changed declaration carries no Covers reference that resolves in the active
  feature's stories or plan.

## Story 1: A malformed token on an unbound changed test is routed to BUILD before any review lap

**Requirement:** #2540 desired outcomes 1, 4

As the daemon operator, I want `build_review` to recognise a malformed Covers token itself and send
the feature straight back to BUILD with the file, line, and token named, so that one typo costs one
BUILD fix instead of three wasted review laps and a halt.

### Acceptance Criteria

#### Happy Path
- Given `testQuality` is enabled and a changed test declaration whose only Covers marker, introduced by this feature, is `// Covers: Task: 32`, when `build_review` runs, then it returns a failed step result carrying the malformed-marker list with that test file's repo-relative path, the marker's 1-based line, and the token `Task: 32`, and no rubric reviewer or coordinator is dispatched.
- Given two changed test files each carrying one introduced malformed token on an unbound changed declaration, when `build_review` runs, then the failed result names both files with their lines and tokens.

#### Negative Paths
- Given a changed test declaration whose only introduced marker is the well-formed `// Covers: task:99` and the active plan has no Task 99, when `build_review` runs, then no malformed-marker list is produced, the rubric dispatch runs, and the candidate continues to the existing reviewer and `scope-incomplete` path.
- Given a changed test declaration carrying an introduced malformed token and also a Covers reference that resolves in the active feature, when `build_review` runs, then no malformed-marker list is produced and the rubric dispatch runs.
- Given a changed test declaration whose malformed token was already present at the merge-base (not introduced by this feature), when `build_review` runs, then no malformed-marker list is produced.
- Given a changed test whose marker line yields only empty tokens (for example `// Covers:` followed by nothing, or a trailing comma), when `build_review` runs, then no malformed-marker list is produced.
- Given `testQuality` is disabled and a changed test carries an introduced malformed token, when `build_review` runs, then no malformed-marker list is produced and the step behaves exactly as before.

### Done When
- [ ] A detector unit test proves `Task: 32` on an unbound changed declaration is reported with path, line, and token, and that the well-formed-absent, bound-sibling, merge-base-present, and empty-token fixtures report nothing.
- [ ] A `build_review` step test proves the malformed case returns a failed result with the list and never invokes the coordinator, and the `testQuality`-disabled case does not short-circuit.
- [ ] The frozen source snapshot and the `testQuality` projection carry no new field.

## Story 2: The malformed-token route never spends the mechanical fault allowance and stays bounded

**Requirement:** #2540 desired outcomes 1, 2, 3

As the daemon operator, I want a malformed Covers token handled as BUILD rework under the existing
bounded `build_review` kickback cap, so that it never burns the mechanical-fault allowance, never
re-runs `build_review` against an unchanged tree, and still halts with the token named if BUILD
cannot fix it.

### Acceptance Criteria

#### Happy Path
- Given an auto-mode run whose `build_review` step returns the malformed-marker result and the `build_review` kickback budget is not exhausted, when the conductor handles the result, then it emits one `kickback` event from `build_review` to `build` whose evidence names each file, line, and token, sets the BUILD retry hint to that evidence plus the accepted grammars, restages `build_review` and `manual_test` as stale, and navigates to `build` without dispatching `build_review` a second time.
- Given the same run, when the conductor handles the result, then `.pipeline/kickback-ledger.json` `gates.build_review.mechanicalFaults` and `lastMechanicalFault` are unchanged and the `build_review` gate kickback count increases by exactly one.
- Given the same run, when the step result is received, then no `step_retry` event is emitted for `build_review` and the step runner is invoked once for that lap.

#### Negative Paths
- Given the malformed-marker result arrives when the `build_review` kickback budget is already at its cap, when the conductor handles the result, then it writes a `needs-human` HALT whose reason names each file, line, and token and the kickback cap, emits no `kickback` event, and leaves `mechanicalFaults` unchanged.
- Given an uncovered infrastructure failure on the `testQuality` rubric (for example a malformed provider result), when the conductor handles the lap, then it takes the existing mechanical lane and `mechanicalFaults` increases by one exactly as before this change.
- Given a well-formed `task:<id>` naming a task absent from the active plan that the reviewer resolves `indeterminate`, when the conductor handles the lap, then it is recorded as `scope-incomplete` in the existing mechanical lane, not accepted.

### Done When
- [ ] A conductor test drives a `build_review` malformed-marker result through `Conductor.run` and asserts the kickback event, retry hint, restage, single runner invocation, and unchanged mechanical-fault fields.
- [ ] A conductor test asserts the capped case halts `needs-human` naming the tokens with no kickback event.
- [ ] The existing infrastructure-failure and indeterminate-only scope-fault mechanical-lane tests in `conductor-build-review-adjudication.test.ts` pass unchanged.
