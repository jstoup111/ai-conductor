**Status:** Accepted

# Stories: Classify Claude weekly-limit messages as rate limits (#1006)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the Claude adapter's rate-limit classification vocabulary and its regression coverage. The retry policy, the wait derivation, the reset-time deadline parsing, the episode coordinator, and the Codex adapter are outside this slice.

## Story 1: Recognize every Claude quota-period limit message as a rate limit

As a daemon operator, I want the Claude adapter to recognize a weekly limit the same way it recognizes a session limit, so that a limit that lasts for days does not read as an ordinary step failure.

### Acceptance Criteria

#### Happy Path

- Given the Claude CLI reports "You've hit your weekly limit · resets 9pm (America/New_York)", when the adapter classifies that output, then it is recognized as a quota limit rather than an ordinary failure.
- Given the Claude CLI reports a limit for any other recognized quota period, such as a monthly, daily, hourly, or fixed-hour-window limit, when the adapter classifies that output, then it is recognized as a quota limit.
- Given a recognized quota-period limit message carries one model qualifier word beside the period word, such as a weekly limit named for a specific model, when the adapter classifies that output, then it is recognized as a quota limit.
- Given the weekly-limit message rides exit code zero as a soft notice, when the adapter returns its invoke result, then the result is rate-limited, is not reported as a success, and carries a wait derived from the stated reset time.

#### Negative Paths

- Given output only discusses limit policies in prose and carries none of the recognized anchors, when the adapter classifies that output, then it is not rate-limited and a zero-exit run is still reported as a success.
- Given a limit message names a period word outside the recognized vocabulary, such as a fortnightly limit, when the adapter classifies that output, then it is not reported as rate-limited.
- Given one message carries both weekly-limit wording and authentication-failure wording, when the adapter classifies that output, then it is reported as rate-limited and not as an authentication failure.

### Done When

- [ ] The exact message from the 2026-07-26 daemon log is recognized by the adapter's classification helper.
- [ ] Each recognized period word, and one model-qualifier form, is recognized by the same helper.
- [ ] A zero-exit weekly-limit notice yields an invoke result that is rate-limited, not successful, and carries both a wait and a deadline.
- [ ] Prose mentioning limits, an unrecognized period word, and the pre-existing session and usage forms all keep their current classification.

## Story 2: Route a recognized weekly limit to a coordinated wait instead of a halt

As a daemon operator, I want a recognized weekly limit to reach the same coordinated wait the session limit already reaches, so that the step keeps its retry budget and the feature is not halted seconds after the limit appears.

### Acceptance Criteria

#### Happy Path

- Given a build step returns the exact weekly-limit message from the 2026-07-26 daemon log, when the conductor handles that step result, then the step is retried rather than failed, the shared rate-limit episode is entered, and no halt marker is written.

#### Negative Paths

- Given a weekly-limit message carries no parseable reset time, when the adapter derives its wait, then it reports the adapter's existing default wait rather than no wait at all.

### Done When

- [ ] A conductor fixture driving the real classification call site with the weekly message ends with no halt marker and a recorded episode entry.
- [ ] The same fixture shows the provider was invoked more than once, so the attempt was retried rather than terminated.
- [ ] A weekly-limit message with no reset time still classifies as rate-limited and derives the adapter's existing default wait.

## Negative-category review

Invalid-input and data-integrity categories are covered by the prose, unrecognized-period, and no-reset-time criteria, which are the three ways a wider pattern could go wrong: matching text it should not, missing text it should, and producing an unusable wait. The precedence criterion covers the classification-order category, where a combined message could be routed to the wrong recovery. Timeout, concurrency, resource-exhaustion, partial-failure, and cascade-deletion categories are inapplicable: the change is a pure predicate over a string already in hand, with no external call, no shared mutable state, no persistence, and no deletion. The requirement that an ordinary step failure still consumes its retry budget and still halts on exhaustion is unchanged by this slice and remains owned by the existing acceptance coverage that asserts the retries-exhausted halt for a non-limit failure; no criterion here weakens it, because every criterion here narrows to messages carrying a recognized limit anchor.
