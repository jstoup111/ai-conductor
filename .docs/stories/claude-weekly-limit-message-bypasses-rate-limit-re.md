**Status:** Accepted

# Stories: Claude weekly-limit message bypasses rate-limit recovery

Source: jstoup111/ai-conductor#1006. Track: technical, Tier S.

Scope boundary (from `.docs/track/`): detection only. The Claude provider's session-limit
classifier must recognize any `you've hit your <qualifier> limit` notice — weekly, daily, monthly,
session, usage — as a rate limit. The conductor's existing wait-to-deadline, no-budget-burn retry
policy is unchanged and out of scope.

## Story 1: Period-qualified limit notices classify as a rate limit

As the daemon, I want a Claude CLI notice such as "You've hit your weekly limit · resets 9pm
(America/New_York)" to be classified as a rate limit so that the step waits for the reset instead
of burning its retry budget and halting the feature.

### Acceptance Criteria

#### Happy Path
- Given the Claude CLI exits 0 with stdout `You've hit your weekly limit · resets 9pm (America/New_York)`, when the provider classifies the result, then `rateLimited` is `true`, `success` is `false`, and `deadline` resolves to the next 9pm in America/New_York
- Given the Claude CLI exits 0 with stdout `You've hit your daily limit · resets 3:20pm (America/New_York)` or `You've hit your usage limit · resets 3:20pm (America/New_York)`, when the provider classifies the result, then `rateLimited` is `true` for each qualifier
- Given the Claude CLI exits 1 with stdout `You've hit your weekly limit · resets 9pm (America/New_York). Failed to authenticate. API Error: 401`, when the provider classifies the result, then `rateLimited` is `true` and `authFailure` is `undefined`

#### Negative Paths
- Given the Claude CLI exits 1 with stdout `Error: ENOENT reading .docs/plans/x.md`, when the provider classifies the result, then `rateLimited` is `undefined` and `success` is `false`
- Given the Claude CLI exits 0 with stdout `Discussion about weekly limit policies in documentation`, when the provider classifies the result, then `rateLimited` is `undefined` and `success` is `true`

### Done When
- [ ] `detectsSessionLimit("You've hit your weekly limit · resets 9pm (America/New_York)")` returns `true`
- [ ] A provider test replaying the verbatim #1006 stdout asserts `rateLimited === true`, `success === false`, and a `deadline` in the future relative to the injected clock
- [ ] Provider tests for `daily`, `usage`, and `session` qualifiers assert `rateLimited === true`
- [ ] Provider tests assert an ordinary non-zero-exit error and a prose mention of "weekly limit" both leave `rateLimited` undefined

## Story 2: Existing limit classifications keep their precedence

As the daemon, I want the widened limit pattern to leave every other classification unchanged so
that out-of-credits notices still ladder to another model and the session-limit variants already
covered keep behaving as before.

### Acceptance Criteria

#### Happy Path
- Given the Claude CLI exits 0 with stdout `You've hit your monthly spend limit. /model to switch models.`, when the provider classifies the result, then `modelUnavailable` is `true` and `success` is `false`, exactly as before the change
- Given the Claude CLI exits 0 with stdout `session limit reached · resets 5:45pm (America/New_York)`, when the provider classifies the result, then `rateLimited` is `true`

#### Negative Paths
- Given the Claude CLI exits 1 with stdout `Not logged in. Please run /login`, when the provider classifies the result, then `authFailure` is `true` and `rateLimited` is `undefined`

### Done When
- [ ] The existing out-of-credits, session-limit-variant, and auth-failure tests in `src/conductor/test/execution/claude-provider.test.ts` pass unchanged
- [ ] The `monthly spend limit` notice is asserted to classify as `modelUnavailable` and not as `rateLimited`
