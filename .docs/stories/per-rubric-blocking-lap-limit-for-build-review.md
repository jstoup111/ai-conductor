**Status:** Accepted

# Stories: Per-rubric blocking-lap limit for build_review

Technical track; no PRD. Acceptance criteria derive from the operator's direction ("default 2, but
configurable") and `adr-2026-10-19-build-review-finding-severity-advisory-threshold` D8 and D9 with
`adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D7 (all added 2026-11-21). A
"blocking lap" for a rubric is a build_review lap, identified by its lap id, whose effective verdict
carries at least one unresolved finding from that rubric. A rubric is "lap-limited" on a lap when its
limit is N and it already blocked N laps other than that lap. "The limit" is the resolved
`max_blocking_laps` value for a rubric.

## Story 1: Each rubric resolves a blocking-lap limit with a default and an override

As the operator, I want each build_review rubric to carry a blocking-lap limit that defaults sensibly and that I can override per rubric, so that a rubric that keeps re-raising findings cannot hold a feature indefinitely.

### Acceptance Criteria

#### Happy Path
- Given a config with no `max_blocking_laps` anywhere, when `resolveBuildReviewConfig` resolves it, then `implementationQuality` has limit 2 and `testQuality`, `security`, and every custom rubric have no limit.
- Given `build_review.rubrics.testQuality.max_blocking_laps: 3`, when the config is resolved, then `testQuality` has limit 3 and `implementationQuality` keeps limit 2.
- Given `build_review.rubrics.implementationQuality.max_blocking_laps: 0`, when the config is resolved, then `implementationQuality` has no limit.
- Given a custom rubric declared with `max_blocking_laps: 1`, when the config is resolved, then that custom rubric has limit 1.
- Given this repository's `.ai-conductor/config.yml`, when it is loaded and resolved, then `testQuality` has limit 3, `implementationQuality` has limit 2, and `security` has no limit.

#### Negative Paths
- Given `build_review.rubrics.implementationQuality.max_blocking_laps: -1`, when the config is loaded, then loading fails with a validation error containing `build_review.rubrics.implementationQuality.max_blocking_laps must be a non-negative integer`.
- Given `build_review.rubrics.security.max_blocking_laps: 1.5` or the string `"2"`, when the config is loaded, then loading fails with a validation error naming `build_review.rubrics.security.max_blocking_laps`.
- Given a custom rubric `portable` declared with `max_blocking_laps: -2`, when the config is loaded, then loading fails with a validation error containing `build_review.custom_rubrics.portable.max_blocking_laps must be a non-negative integer`.
- Given `implementationQuality.max_blocking_laps` changes from unset to 5, when the next build_review lap derives its review scope, then the lap-scope policy identity is unchanged and the lap reviews a delta rather than restarting at a full scope.

### Done When
- [ ] A `resolveBuildReviewConfig` test observes limit 2 for `implementationQuality`, no limit for `testQuality`, `security`, and a custom rubric, limit 3 for an overridden `testQuality`, and no limit for an explicit `0`.
- [ ] `loadConfig` tests observe validation errors naming the key path for `-1`, `1.5`, and `"2"` on a built-in rubric and `-2` on a custom rubric.
- [ ] A test loading this repository's `.ai-conductor/config.yml` observes `testQuality` limit 3, `implementationQuality` limit 2, and no `security` limit.
- [ ] A test observes the same lap-scope policy identity for `implementationQuality` with `max_blocking_laps` unset and set to 5.

## Story 2: A rubric past its limit stops blocking and its findings become advisory

As the operator, I want a rubric that has already blocked its allowed number of laps to report its later findings as advisory rather than blocking, so that the feature advances instead of cycling through repair laps or halting on recurrence.

### Acceptance Criteria

#### Happy Path
- Given `implementationQuality` with limit 2 that already blocked laps A and B, when lap C judges one `critical` `implementationQuality` finding and no other rubric has an unresolved finding, then lap C's effective verdict is PASS and that finding id is in the effective verdict's advisory findings.
- Given lap C was lap-limited for `implementationQuality`, when lap C's aggregate is read back from `.pipeline/build-review.json`, then it carries `blockingLapLimits` with one entry naming `implementationQuality`, blocking laps 2, and limit 2.
- Given lap C was lap-limited for `implementationQuality`, when its `build_review_outer_verdict` event is emitted, then the event carries `blockingLapLimits` with one entry naming `implementationQuality`, blocking laps 2, limit 2, and the demoted finding id.
- Given that `build_review_outer_verdict` event, when the daemon log renders it, then it prints one line containing `build_review lap-limited implementationQuality`, `1 finding advisory`, and `blocked 2 of 2 laps`.
- Given an aggregate stamped with `blockingLapLimits` for `implementationQuality`, when any reader derives the effective verdict from that aggregate alone, then the `implementationQuality` findings are advisory and absent from the unresolved findings, so the adjudication coordinator treats them as non-actionable.
- Given a lap-limited `implementationQuality` finding, when `build-review findings` reports the lap, then the finding is listed as advisory with origin `lap-limit`.

#### Negative Paths
- Given `implementationQuality` with limit 2 that blocked only lap A, when lap C judges one `implementationQuality` finding, then lap C's effective verdict is FAIL with that finding unresolved and the aggregate carries no `blockingLapLimits`.
- Given `implementationQuality` is lap-limited on lap C, when lap C also judges one `testQuality` finding and `testQuality` has no limit, then lap C's effective verdict is FAIL with only the `testQuality` finding unresolved.
- Given `implementationQuality` is lap-limited on lap C, when one of its findings has confidence below the rubric's `min_confidence`, then that finding is suppressed rather than advisory.
- Given `implementationQuality` is lap-limited on lap C, when its result for lap C is an infrastructure failure, then lap C's effective verdict is FAIL with `implementationQuality` an uncovered infrastructure failure.
- Given `implementationQuality.max_blocking_laps: 0` and ten recorded blocking laps, when another lap judges an `implementationQuality` finding, then that finding is unresolved and the effective verdict is FAIL.
- Given an aggregate whose `blockingLapLimits` entry has a limit of 0 or a blocking-lap count below its limit, when `parseBuildReviewAggregate` reads it, then the aggregate is rejected as malformed.

### Done When
- [ ] A build_review runner test with two recorded `implementationQuality` blocking laps observes lap C succeed with an effective PASS, the finding id among advisory findings, and `blockingLapLimits` on both the published aggregate and the `build_review_outer_verdict` event.
- [ ] A runner test with one recorded blocking lap observes lap C's effective verdict FAIL and no `blockingLapLimits` on the aggregate or event.
- [ ] Reducer tests over stamped aggregates observe advisory for the limited rubric, unresolved for an unlimited sibling, suppressed for a sub-floor finding, and FAIL for an infrastructure failure, for both built-in and custom rubrics.
- [ ] A daemon-log render test observes the `build_review lap-limited implementationQuality` line, and a `build-review findings` test observes origin `lap-limit`.
- [ ] A `parseBuildReviewAggregate` test rejects a `blockingLapLimits` entry with limit 0 and one whose count is below its limit.

## Story 3: Blocking laps are counted durably and exactly once per lap

As the operator, I want the engine to remember which laps each rubric blocked across restarts and re-evaluations, so that the limit applies to real review laps and never to a repeated read of the same lap.

### Acceptance Criteria

#### Happy Path
- Given a lap whose effective verdict has an unresolved `implementationQuality` finding and no unresolved `testQuality` finding, when the build_review step finishes that lap, then `.pipeline/engine-state.json` lists that lap id under `buildReviewBlockingLaps.feature.implementationQuality` and lists nothing for `testQuality`.
- Given the same lap id is reviewed again at the same HEAD, when the step finishes it again, then that lap id appears once under `implementationQuality`, and the lap is not lap-limited by its own earlier record.
- Given a stacked feature reviewing child 1, when a child-1 lap blocks on `implementationQuality`, then the lap id is listed under `buildReviewBlockingLaps.child-1.implementationQuality`, and a child-2 lap with no child-2 records is not lap-limited.
- Given `.pipeline/engine-state.json` already holds unrelated keys, when a blocking lap is recorded, then those keys are preserved unchanged.

#### Negative Paths
- Given `.pipeline/engine-state.json` is absent, when a lap with an `implementationQuality` finding is joined, then the rubric counts zero blocking laps and the finding is unresolved.
- Given `.pipeline/engine-state.json` holds malformed JSON, when a lap with an `implementationQuality` finding is joined, then the rubric counts zero blocking laps, the finding is unresolved, and the step reports `build_review blocking-lap persistence failed` rather than overwriting the file.
- Given `buildReviewBlockingLaps` holds a non-array or non-string entry for a rubric, when the count is read, then only the valid string lap ids are counted.

### Done When
- [ ] A blocking-lap state test records a lap for one rubric, preserves unrelated engine-state keys, and lists each lap id once after two records of the same id.
- [ ] A runner test observes the lap id under `child-1` for a child lap and a child-2 lap that is not lap-limited.
- [ ] State tests observe zero blocking laps for an absent file and for malformed entries, and a runner test with malformed engine-state JSON observes the finding unresolved, the persistence-failure output, and the malformed file bytes unchanged.
