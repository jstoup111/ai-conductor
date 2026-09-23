# Implementation Plan: Claude weekly-limit message bypasses rate-limit recovery

**Date:** 2026-09-22
**Stories:** .docs/stories/claude-weekly-limit-message-bypasses-rate-limit-re.md
**Conflict check:** Not required (Tier S)
**Source:** jstoup111/ai-conductor#1006

## Summary

Generalize the Claude provider's session-limit classifier so any `you've hit your <qualifier>
limit` notice classifies as a rate limit, and make a period-qualified notice's `deadline` resolve to
the actual reset time, proven by provider-level tests. 8 tasks.

## Technical Approach

- The only production change is `SESSION_LIMIT_RE` in `src/conductor/src/execution/claude-provider.ts`.
  Replace the `you've hit your (?:session|usage) limit` alternate with
  `you've hit your \S+ limit` (exactly one non-space qualifier word), and widen the
  `(?:session|usage) limit\s+·\s+resets` alternate to `\S+ limit\s+·\s+resets`. Keep the
  `session limit reached` / `usage limit reached` alternates verbatim.
- The single-word qualifier is deliberate: the out-of-credits notice `You've hit your monthly spend
  limit.` has two words before `limit`, so it must not match. `OUT_OF_CREDITS_RE` continues to
  own it and the existing precedence in `invoke()` (out-of-credits → modelUnavailable) is untouched.
- Deadline (amendment, PG-1): `calculateDeadlineInTimezone` caps every timezone-aware wait at
  3600s, so a weekly notice resolves to `now + 1h`, not the next 9pm. Add
  `PERIOD_LIMIT_RE = /you've hit your (?!session\b|usage\b)\S+ limit/i` in `claude-provider.ts`;
  `parseRateLimitWaitSeconds` passes a cap of 86400s to `calculateDeadlineInTimezone` when the
  output matches it, and keeps the 3600s cap otherwise. Session/usage notices keep their hourly
  re-probe. The 86400s bound is the parser's own next-occurrence rollover ceiling, so a mis-parse
  still cannot wedge the daemon beyond one day (`adr-2026-07-05-daemon-rate-limit-episode-coordinator`
  Decision 6: the deadline IS the parsed reset, capped at a sane maximum).
- No change to `conductor.ts`: once `rateLimited` is set, the existing rate-limit branch already
  waits to `deadline` and decrements `attempt` so no retry budget is consumed.
- Test pattern: the existing session-limit family in
  `src/conductor/test/execution/claude-provider.test.ts` mocks `execa` (`mockExeca.mockResolvedValue({ stdout, stderr, exitCode, failed })`)
  and asserts on `provider.invoke(baseOptions)` result fields. New tests follow that shape and sit in
  the same `describe` block; search hint: `detects LITERAL session-limit message`.

## Prerequisites

- None.

## Tasks

### Task 1: Classify the verbatim weekly-limit notice as a rate limit
**Story:** Story 1, happy path 1
**Type:** happy-path

**Steps:**
1. Write failing test in `src/conductor/test/execution/claude-provider.test.ts` next to `detects LITERAL session-limit message`: mock execa with stdout `You've hit your weekly limit · resets 9pm (America/New_York)`, exitCode 0, failed false; assert `result.rateLimited === true`, `result.success === false`, and `result.deadline` is a number greater than the fixed `now` (use `vi.setSystemTime` or the test file's existing clock injection).
2. Verify test fails (RED): `rateLimited` is undefined because `SESSION_LIMIT_RE` has no `weekly` alternate.
3. Implement: in `src/conductor/src/execution/claude-provider.ts` rewrite `SESSION_LIMIT_RE` to `/you've hit your \S+ limit|session limit reached|usage limit reached|\S+ limit\s+·\s+resets/i` and update the comment block above it to document the one-word-qualifier rule and why `monthly spend limit` must not match.
4. Verify test passes (GREEN).
5. Commit with message: "fix(claude-provider): classify period-qualified limit notices as rate limits"

**Done when:**
- `SESSION_LIMIT_RE` in `claude-provider.ts` matches `You've hit your weekly limit · resets 9pm (America/New_York)` and `provider.invoke` returns `rateLimited === true` and `success === false` for that exit-0 stdout, as asserted by the weekly-limit provider test.
- The same test asserts `result.deadline` is a future epoch-ms value resolved by `parseRateLimitWaitSeconds` from the `9pm (America/New_York)` fragment.
- `detectsSessionLimit("You've hit your weekly limit · resets 9pm (America/New_York)")` returns `true`.

**Files likely touched:**
- `src/conductor/src/execution/claude-provider.ts` — `SESSION_LIMIT_RE` and its comment
- `src/conductor/test/execution/claude-provider.test.ts` — new weekly-limit test

**Dependencies:** none

### Task 2: Daily, usage, and session qualifiers classify as a rate limit
**Story:** Story 1, happy path 2
**Type:** happy-path

**Steps:**
1. Write a parameterized test (`it.each`) over stdout values `You've hit your daily limit · resets 3:20pm (America/New_York)`, `You've hit your usage limit · resets 3:20pm (America/New_York)`, `You've hit your session limit · resets 3:20pm (America/New_York)`, each with exitCode 0; assert `result.rateLimited === true` and `result.success === false`.
2. Verify the test passes against Task 1's regex (this task proves coverage of the generalized qualifier; if any case fails, the regex from Task 1 is wrong and must be fixed there).
3. Commit with message: "test(claude-provider): cover daily/usage/session limit qualifiers"

**Done when:**
- An `it.each` provider test asserts `rateLimited === true` and `success === false` for the `daily`, `usage`, and `session` qualifier notices on exit 0, all satisfied by the single `\S+` qualifier in `SESSION_LIMIT_RE`.
- `detectsSessionLimit` returns `true` for each of the three qualifier notices, proving the match is in `SESSION_LIMIT_RE` rather than in `RATE_LIMIT_RE`'s exit-code-gated path.

**Files likely touched:**
- `src/conductor/test/execution/claude-provider.test.ts` — qualifier `it.each` test

**Dependencies:** Task 1

### Task 3: Rate-limit classification wins over auth-failure prose
**Story:** Story 1, happy path 3
**Type:** happy-path

**Steps:**
1. Write failing-or-passing test: stdout `You've hit your weekly limit · resets 9pm (America/New_York). Failed to authenticate. API Error: 401`, exitCode 1, failed true; assert `result.rateLimited === true` and `result.authFailure` is `undefined`.
2. Verify against Task 1's regex; the existing precedence (`authFailure` requires `!rateLimited`) makes it pass without further production change.
3. Commit with message: "test(claude-provider): weekly limit outranks auth-failure prose"

**Done when:**
- A provider test with the weekly-limit notice followed by `Failed to authenticate. API Error: 401` on exit 1 asserts `rateLimited === true` and `authFailure === undefined`, proven by the `!rateLimited` guard on `authFailure` in `invoke()`.
- The same test asserts `success === false` and `waitSeconds` is defined, showing the rate-limit branch computed a wait from the `9pm (America/New_York)` fragment despite the trailing auth prose.

**Files likely touched:**
- `src/conductor/test/execution/claude-provider.test.ts` — precedence test

**Dependencies:** Task 1

### Task 4: Ordinary non-zero-exit errors stay unclassified
**Story:** Story 1, negative path 1
**Type:** negative-path

**Steps:**
1. Write test: stdout `Error: ENOENT reading .docs/plans/x.md`, exitCode 1, failed true; assert `result.rateLimited` is `undefined` and `result.success === false`.
2. Verify it passes against Task 1's regex (guards against an over-wide pattern).
3. Commit with message: "test(claude-provider): ordinary errors are not rate limits"

**Done when:**
- A provider test with an ENOENT error on exit 1 asserts `rateLimited === undefined` and `success === false`, showing `SESSION_LIMIT_RE` and `RATE_LIMIT_RE` both miss ordinary error text.
- The same test asserts `waitSeconds === undefined` and `deadline === undefined`, showing `parseRateLimitWaitSeconds` is not invoked for an unclassified failure.

**Files likely touched:**
- `src/conductor/test/execution/claude-provider.test.ts` — ordinary-error test

**Dependencies:** Task 1

### Task 5: Prose mention of "weekly limit" is not a rate limit
**Story:** Story 1, negative path 2
**Type:** negative-path

**Steps:**
1. Write test: stdout `Discussion about weekly limit policies in documentation`, exitCode 0, failed false; assert `result.rateLimited` is `undefined` and `result.success === true`.
2. Verify it passes: the regex requires the `you've hit your` anchor or the `· resets` marker, neither present in prose.
3. Commit with message: "test(claude-provider): prose mention of weekly limit is not classified"

**Done when:**
- A provider test with `Discussion about weekly limit policies in documentation` on exit 0 asserts `rateLimited === undefined` and `success === true`, because `SESSION_LIMIT_RE` requires the `you've hit your` anchor or a `limit · resets` marker.
- `detectsSessionLimit("Discussion about weekly limit policies in documentation")` returns `false`.

**Files likely touched:**
- `src/conductor/test/execution/claude-provider.test.ts` — prose false-positive test

**Dependencies:** Task 1

### Task 6: Monthly spend limit stays out-of-credits; session-limit variants unchanged
**Story:** Story 2, happy paths 1 and 2
**Type:** happy-path

**Steps:**
1. Extend the existing monthly-spend-limit test (search hint: `monthly spend limit. /model to switch models`) or add a sibling: stdout `You've hit your monthly spend limit. /model to switch models.`, exitCode 0; assert `result.modelUnavailable === true`, `result.success === false`, and `result.rateLimited === undefined`.
2. Confirm the existing `detects "session limit reached" variant as rateLimited` test still passes unchanged (covers Story 2 happy path 2; no new test needed).
3. Verify all pass against Task 1's regex: `\S+` cannot span `monthly spend`.
4. Commit with message: "test(claude-provider): monthly spend limit remains out-of-credits"

**Done when:**
- A provider test with `You've hit your monthly spend limit. /model to switch models.` on exit 0 asserts `modelUnavailable === true`, `success === false`, and `rateLimited === undefined`, because the one-word `\S+` qualifier in `SESSION_LIMIT_RE` cannot match `monthly spend`.
- The existing `session limit reached · resets 5:45pm (America/New_York)` test asserts `rateLimited === true` and passes without modification.

**Files likely touched:**
- `src/conductor/test/execution/claude-provider.test.ts` — monthly-spend assertion

**Dependencies:** Task 1

### Task 7: Auth-failure classification unchanged
**Story:** Story 2, negative path 1
**Type:** negative-path

**Steps:**
1. Locate the existing auth-failure test for `Not logged in` / `Please run /login` (search hint: `AUTH_FAILURE_RE`, `not logged in`) and confirm it asserts `authFailure === true`; add `expect(result.rateLimited).toBeUndefined()` if absent.
2. Run it against Task 1's regex; it passes because the message has no `hit your` anchor and no `limit · resets` marker.
3. Commit with message: "test(claude-provider): auth failure stays unclassified as rate limit"

**Done when:**
- A provider test with `Not logged in. Please run /login` on exit 1 asserts `authFailure === true` and `rateLimited === undefined`, showing `AUTH_FAILURE_RE` still owns the message after the `SESSION_LIMIT_RE` change.
- `detectsSessionLimit("Not logged in. Please run /login")` returns `false`.

**Files likely touched:**
- `src/conductor/test/execution/claude-provider.test.ts` — auth-failure assertion

**Dependencies:** Task 1

### Task 8: Weekly-limit deadline resolves to the next 9pm in America/New_York
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test in `src/conductor/test/execution/claude-provider.test.ts` next to the Task 1 weekly-limit test: fix the clock with `vi.setSystemTime(new Date('2026-07-03T16:00:00Z'))` (12:00 EDT, 9h before 9pm), mock execa with stdout `You've hit your weekly limit · resets 9pm (America/New_York)`, exitCode 0, failed false; assert `result.rateLimited === true`, `result.success === false`, and `result.deadline === Date.parse('2026-07-04T01:00:00Z')`.
2. Add a direct `parseRateLimitWaitSeconds` case in the `parseRateLimitWaitSeconds - direct unit tests for timezone parsing` block with `now = 2026-07-04T02:30:00Z` (22:30 EDT, after 9pm) asserting `deadline === Date.parse('2026-07-05T01:00:00Z')`.
3. Verify both fail (RED): the deadline is `now + 3600000` because `calculateDeadlineInTimezone` caps at 3600s.
4. Implement: in `src/conductor/src/execution/claude-provider.ts` add `PERIOD_LIMIT_RE = /you've hit your (?!session\b|usage\b)\S+ limit/i`, give `calculateDeadlineInTimezone` a `capSeconds` parameter replacing the `CAP_SECONDS` constant, and have `parseRateLimitWaitSeconds` pass 86400 when `PERIOD_LIMIT_RE` matches the output and 3600 otherwise; update the JSDoc to document both caps.
5. Verify both pass (GREEN) and the existing session-limit clamp tests in that block pass unchanged.
6. Commit with message: "fix(claude-provider): period-qualified limit deadlines resolve to the actual reset"

**Done when:**
- A provider test with the clock fixed at `2026-07-03T16:00:00Z` and exit-0 stdout `You've hit your weekly limit · resets 9pm (America/New_York)` asserts `rateLimited === true`, `success === false`, and `deadline === Date.parse('2026-07-04T01:00:00Z')` (the next 9pm in America/New_York, 9h away).
- A `parseRateLimitWaitSeconds` test with `now = 2026-07-04T02:30:00Z` and the weekly notice asserts `deadline === Date.parse('2026-07-05T01:00:00Z')`, proving the after-9pm rollover resolves to the following day's 9pm.
- `calculateDeadlineInTimezone` applies an 86400s cap when `PERIOD_LIMIT_RE` matches and a 3600s cap otherwise, so the existing `clamping works correctly for very far future times` session-limit test still asserts a wait of at most 3600000 ms and passes unmodified.

**Files likely touched:**
- `src/conductor/src/execution/claude-provider.ts` — `PERIOD_LIMIT_RE`, `calculateDeadlineInTimezone` cap parameter, `parseRateLimitWaitSeconds`
- `src/conductor/test/execution/claude-provider.test.ts` — next-9pm deadline tests

**Dependencies:** Task 1

## Task Dependency Graph

```
Task 1 ─┬─ Task 2
        ├─ Task 3
        ├─ Task 4
        ├─ Task 5
        ├─ Task 6
        ├─ Task 7
        └─ Task 8
```

## Integration Points

- After Task 1: the daemon's retry loop receives `rateLimited: true` for a weekly-limit notice and takes the existing wait-to-deadline, no-budget-burn branch in `conductor.ts`.
- After Task 8: that branch waits once to the actual weekly reset instead of re-probing hourly.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the Claude CLI exits 0 with stdout `You've hit your weekly limit · resets 9pm (America/New_York)`, when the provider classifies the result, then `rateLimited` is `true`, `success` is `false`, and `deadline` resolves to the next 9pm in America/New_York | 1, 8 | "asserts `rateLimited === true`, `success === false`, and `deadline === Date.parse('2026-07-04T01:00:00Z')` (the next 9pm in America/New_York, 9h away)" | diff-local |
| Story 1 happy: Given the Claude CLI exits 0 with stdout `You've hit your daily limit · resets 3:20pm (America/New_York)` or `You've hit your usage limit · resets 3:20pm (America/New_York)`, when the provider classifies the result, then `rateLimited` is `true` for each qualifier | 2 | "asserts `rateLimited === true` and `success === false` for the `daily`, `usage`, and `session` qualifier notices" | diff-local |
| Story 1 happy: Given the Claude CLI exits 1 with stdout `You've hit your weekly limit · resets 9pm (America/New_York). Failed to authenticate. API Error: 401`, when the provider classifies the result, then `rateLimited` is `true` and `authFailure` is `undefined` | 3 | "asserts `rateLimited === true` and `authFailure === undefined`" | diff-local |
| Story 1 negative: Given the Claude CLI exits 1 with stdout `Error: ENOENT reading .docs/plans/x.md`, when the provider classifies the result, then `rateLimited` is `undefined` and `success` is `false` | 4 | "asserts `rateLimited === undefined` and `success === false`" | diff-local |
| Story 1 negative: Given the Claude CLI exits 0 with stdout `Discussion about weekly limit policies in documentation`, when the provider classifies the result, then `rateLimited` is `undefined` and `success` is `true` | 5 | "asserts `rateLimited === undefined` and `success === true`" | diff-local |
| Story 2 happy: Given the Claude CLI exits 0 with stdout `You've hit your monthly spend limit. /model to switch models.`, when the provider classifies the result, then `modelUnavailable` is `true` and `success` is `false`, exactly as before the change | 6 | "asserts `modelUnavailable === true`, `success === false`, and `rateLimited === undefined`" | diff-local |
| Story 2 happy: Given the Claude CLI exits 0 with stdout `session limit reached · resets 5:45pm (America/New_York)`, when the provider classifies the result, then `rateLimited` is `true` | 6 | "The existing `session limit reached · resets 5:45pm (America/New_York)` test asserts `rateLimited === true`" | diff-local |
| Story 2 negative: Given the Claude CLI exits 1 with stdout `Not logged in. Please run /login`, when the provider classifies the result, then `authFailure` is `true` and `rateLimited` is `undefined` | 7 | "asserts `authFailure === true` and `rateLimited === undefined`" | diff-local |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
