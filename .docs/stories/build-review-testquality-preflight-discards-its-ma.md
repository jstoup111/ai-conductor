**Status:** Accepted

## Story 1: Materialization catch captures the underlying error text

As an operator diagnosing a `needs-human` build_review halt, I want the testQuality preflight's materialization failure to record what actually threw so that I can tell a transient environment blip from a deterministic failure without reproducing it by hand.

### Acceptance Criteria

#### Happy Path
- Given `deps.createCheckout` (or any `deps.readMergeBaseFile` / `deps.writeFile` inside the materialization `try`) throws an `Error` with a message, when `runTautologyPreflight` handles the throw at the catch that today produces `materialization-failed`, then the returned infrastructure-failure result carries `reason: 'materialization-failed'` and a `failureExcerpt` containing that error's message, bounded by `boundedHeadTailExcerpt`
- Given `deps.runScoped` throws (the sibling catch that produces `scoped-run-failed`), when the preflight handles the throw, then the returned result carries `reason: 'scoped-run-failed'` and a `failureExcerpt` containing the thrown error's message

#### Negative Paths
- Given a non-`Error` value is thrown (for example a string or `undefined`), when either catch handles it, then the preflight still returns its failure result with a `failureExcerpt` from `String()`-coercing the thrown value — capture never throws or masks the original cause name
- Given the run is aborted (signal fired) and the throw races the abort, when the catch handles it, then the result keeps `reason: 'aborted'` exactly as today
- Given an error whose text exceeds `TAUTOLOGY_EXCERPT_CAP_BYTES`, when it is captured, then the persisted `failureExcerpt` is capped with the `[...truncated N bytes...]` marker

### Done When
- [ ] Both catches at `build-review-test-quality-preflight.ts` (currently lines 458 and 462) bind the caught value and pass a `boundedHeadTailExcerpt` of its text (message plus stack when available) as `failure()`'s `failureExcerpt` argument
- [ ] Unit tests assert `failureExcerpt` contains the injected error message for a throwing `createCheckout`, a throwing `readMergeBaseFile`, a throwing `writeFile`, and a throwing `runScoped`
- [ ] A unit test asserts a non-`Error` thrown value still yields a non-empty `failureExcerpt`

## Story 2: The error text reaches the persisted artifact, the event, and the HALT body

As an operator reading `.pipeline/build-review.json`, `.pipeline/events.jsonl`, or the `needs-human` HALT, I want the captured error text visible in all three so that the documented recovery choice (re-dispatch vs `record-reduced-coverage`) can be made from the halt alone.

### Acceptance Criteria

#### Happy Path
- Given a testQuality preflight infrastructure failure whose result carries a `failureExcerpt`, when the build_review coordinator resolves the rubric branch, then the emitted `build_review_rubric_infrastructure_failure` event carries the excerpt (existing behavior at `build-review-coordinator.ts:334-339`) and the persisted rubric branch's `detail` includes the excerpt text rather than only the cause name
- Given that persisted branch feeds the `needs-human` HALT, when the HALT body is rendered, then it contains the captured error text alongside the existing cause/reason

#### Negative Paths
- Given a preflight that succeeds (stayed-green or red classification), when the result is persisted and events are emitted, then no error text appears anywhere — `failureExcerpt` on the scoped run remains empty on green exactly as today
- Given an infrastructure failure with no `failureExcerpt` (a cause that never had one, e.g. `no-changed-tests`), when the branch is persisted and the HALT rendered, then output is byte-identical to today's — no `undefined`, empty string, or placeholder text is introduced

### Done When
- [ ] A test asserts the persisted `.pipeline/build-review.json` testQuality branch for a materialization failure contains the injected error message in its `detail`
- [ ] A test asserts the `build_review_rubric_infrastructure_failure` event payload carries the excerpt for a materialization failure
- [ ] A test asserts the `needs-human` HALT body for an exhausted-allowance testQuality failure contains the captured error text
- [ ] A test asserts a green preflight and an excerpt-less infrastructure failure produce unchanged output (no new fields, no error text)
