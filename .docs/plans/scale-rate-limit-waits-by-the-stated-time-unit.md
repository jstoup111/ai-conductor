# Implementation Plan: Scale rate-limit waits by the stated time unit

**Date:** 2026-09-06
**Stories:** .docs/stories/scale-rate-limit-waits-by-the-stated-time-unit.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent stays inside the duration branch of each provider adapter and leaves the reset-time deadline contract, the classification predicates, and the episode coordinator's escalation ladder exactly as the governing rate-limit episode decision requires.

## Summary

Four bounded tasks deliver #2168: a shared duration-unit module, the Claude adapter's explicit-unit scaling, the Claude adapter's bounded inference for an absent or unrecognized unit, and the Codex adapter's acceptance of minute and hour units. Reset-time parsing, timezone deadlines, classification, and the wait machinery downstream of the derived number are untouched.

## Technical Approach

Both adapters already locate a duration phrase and read one integer out of it. The Claude adapter drops the unit entirely and then guesses: a value under sixty is multiplied by sixty, a value at or above sixty is taken as seconds. That guess is the defect — an hour-phrased message collapses to two minutes and a ninety-minute message collapses to ninety seconds. The Codex adapter makes the opposite error: its pattern requires a seconds token, so a minute-phrased or hour-phrased message never matches and silently becomes that call's fallback wait.

The only logic genuinely shared by the two fixes is the set of accepted unit tokens and their seconds multiplier, so those go in a new small module beside the two adapters, `src/conductor/src/execution/rate-limit-duration.ts`. It exports three things: a unit alternation source string ordered longest-first so a plural or abbreviated form wins before a single-letter form; a function that scales a value and a matched unit token into seconds; and a function that turns a value with no recognized unit into a bounded inferred wait. The scaling function selects its multiplier from the lowercased unit token's first letter, which is unambiguous because the alternation admits only s-initial, m-initial, and h-initial tokens. It returns nothing for a value that is not a positive number, leaving each caller to apply its own existing default rather than inventing one. The module performs no matching itself, so neither adapter's phrase pattern has to change shape.

The Claude adapter keeps its existing phrase pattern verbatim and appends an optional unit group built from the shared alternation, followed by a word boundary so a stray leading letter cannot be mistaken for a unit. Keeping the leading portion greedy preserves today's match selection on messages that contain several candidate connectors, which matters because the connector alternation can also match inside ordinary words. When the unit group matched, the scaled value is returned exactly, with no ceiling, so a legitimately long stated wait keeps working and the existing very-large-seconds fixture is unaffected. When it did not match, the value is read as minutes and clamped between the module's floor of 300 seconds and its ceiling of 3600 seconds: the floor is the adapter's own long-standing default wait, so an inferred reading can never be faster than an unparseable message, and the ceiling keeps a mis-read number from wedging a run for hours.

The Codex adapter keeps its unit token required rather than optional. Its phrase pattern makes the connector optional and would otherwise match a stray number anywhere after the word "retry", so requiring a unit is what keeps that pattern honest; a message with no unit or an unrecognized unit continues to fall through to the caller-supplied fallback, which is 300 seconds for a transient throttle and 3600 seconds for usage exhaustion. Only the token set widens.

Test design follows the repository's test-authoring skill. The shared module is pure and is proved by table-driven unit cases. Each adapter's derivation is proved at its existing exported seam, and each adapter additionally proves the corrected number reaches its invoke result through the file's existing third-party subprocess fake, which is the entry point the conductor actually calls. No test starts a conductor, contacts a provider, or performs any network or process work. One pre-existing Claude fixture encodes the defect itself by asserting that a message stating fifty-nine seconds waits fifty-nine minutes; that fixture is corrected in the task that owns the behaviour, and its corrected form is the regression pin for the filed defect.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, both stories, and the honour-exactly plus bound-the-inference rule on 2026-09-06 (delegated).
- Verified: the Claude adapter's duration branch captures only the number and applies an under-sixty minutes guess, which is the mis-scaling the issue reports.
- Verified: the Claude adapter calls that derivation only when the message is already classified rate-limited, and assigns the result to the invoke result's wait field alongside the optional deadline.
- Verified: the Codex adapter's duration parse requires a seconds token and returns the caller-supplied fallback otherwise, with 3600 passed for usage exhaustion and 300 for a transient throttle.
- Verified: the Codex adapter's five existing usage-cap and throttle fixtures all state their durations in seconds or state none at all, so widening the accepted unit set leaves every one of them at its current expected value.
- Verified: the Claude adapter test file mocks the subprocess boundary and the provider constructor also accepts an injected subprocess factory, so an invoke-level fixture needs no new seam.
- Verified: the execution source directory has no barrel module, so a new file there requires no export registration.
- Verified: no page under the documentation tree describes the minutes guess or the derivation's unit handling, so this change leaves no stale reader-visible documentation.
- Scope check: consumer-facing engine behaviour; no new skill; both supported provider adapters are corrected together rather than leaving one host's waits mis-derived. Event spine: no event, metric, span, log line, or report is added or changed.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavioural claim above was read in the worktree; no unconfirmed assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Add the shared duration-unit module
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/execution/rate-limit-duration.ts, src/conductor/test/execution/rate-limit-duration.test.ts
**Dependencies:** none

**Steps:**
1. Write table-driven unit tests in a new test file for the two exported functions. Cover every accepted token form for each of the three units, including the plural, abbreviated, and single-letter forms, in mixed case. Cover a zero value, a negative value, and a non-finite value. Cover the inferred reading below its floor, inside its band, and above its ceiling.
2. Verify the new tests fail because the module does not exist yet.
3. Create the new module beside the two provider adapters. Export the unit alternation source string ordered longest-first, a scaling function that multiplies by one, sixty, or thirty-six hundred according to the lowercased token's first letter and yields nothing for a value that is not a positive finite number, and an inference function that multiplies by sixty and clamps between 300 and 3600.
4. Verify the new tests pass, run the repository typecheck target that includes test files, and commit the focused change.

**Done when:**
1. The unit table asserts one second per second token, sixty seconds per minute token, and thirty-six hundred seconds per hour token, across the plural, abbreviated, and single-letter spellings in mixed case.
2. The scaling function yields no value for zero, for a negative number, and for a non-finite number, so no caller can receive a zero-length or negative wait from it.
3. The inference function returns 300 for any value whose minute reading is below 300, the exact minute reading for any value inside the band, and 3600 for any value whose minute reading exceeds 3600.
4. The repository typecheck target that covers test files passes with the new module and its test file present.

### Task 2: Honour an explicitly stated unit in the Claude adapter
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/execution/claude-provider.ts, src/conductor/test/execution/parse-rate-limit-wait.test.ts, src/conductor/test/execution/claude-provider.test.ts
**Dependencies:** 1

**Steps:**
1. Add failing derivation cases to the existing duration test file for an hour-phrased message expecting 7200, a minute-phrased message expecting 5400, and a message stating a non-positive duration in minutes expecting the adapter's 300-second default. Correct the pre-existing case that asserts a message stating fifty-nine seconds waits three thousand five hundred forty seconds so it expects fifty-nine, and leave every other pre-existing case untouched.
2. Add a failing invoke-level case to the adapter's own test file: an hour-phrased rate-limit message on the file's existing third-party subprocess fake must produce a rate-limited invoke result whose wait field is 7200.
3. Verify both sets of new expectations fail against the current guess.
4. Append an optional unit group built from the shared alternation to the existing duration pattern, followed by a word boundary, keeping the leading portion of the pattern exactly as it is today. When the group matched, return the shared scaling function's value unchanged with no ceiling. Update the function's documentation comment so it describes unit-aware scaling rather than the removed under-sixty guess.
5. Verify the new and pre-existing cases pass, run the repository typecheck target that includes test files, and commit the focused change.

**Done when:**
1. Derivation cases return 450 for a message stating 450 seconds, 5400 for one stating 90 minutes, and 7200 for one stating 2 hours.
2. The corrected regression case asserts that a message stating 59 seconds derives 59 seconds, and the case asserting 999999999 seconds still derives that exact value with no ceiling applied.
3. An invoke-level case on the adapter's existing subprocess fake reports a rate-limited result whose wait field is 7200 for an hour-phrased message.
4. A message stating a non-positive duration in minutes still derives the adapter's 300-second default, and every pre-existing case in the duration test file other than the corrected 59-seconds case passes unmodified.

### Task 3: Bound the Claude adapter's inferred unit
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/execution/claude-provider.ts, src/conductor/test/execution/parse-rate-limit-wait.test.ts
**Dependencies:** 2

**Steps:**
1. Add failing derivation cases for a bare number with no unit whose minute reading sits inside the band, a bare number whose minute reading falls below the floor, a bare number whose minute reading exceeds the ceiling, and a number followed by a word that is not an accepted unit token.
2. Verify those cases fail while the unmatched-unit path still multiplies by sixty without bounds.
3. Route the unmatched-unit path through the shared inference function so it is read as minutes and clamped between 300 and 3600. Extend the function's documentation comment with the floor and the ceiling and the reason each exists.
4. Verify the new and pre-existing cases pass, run the repository typecheck target that includes test files, and commit the focused change.

**Done when:**
1. A message stating a bare 45 with no unit derives 2700, one stating a bare 2 derives 300, and one stating a bare 450 derives 3600.
2. A message stating a number followed by an unrecognized unit word derives 300 rather than a scaled reading of that number.
3. No message reaching the unmatched-unit path can derive a wait below 300 seconds or above 3600 seconds, because that path's only return is the clamped inference function.
4. A message carrying no duration phrase at all still derives the adapter's 300-second default, and the reset-time cases in the duration test file pass unmodified.

### Task 4: Accept minute and hour units in the Codex adapter
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/execution/codex-provider.ts, src/conductor/test/execution/codex-provider.test.ts
**Dependencies:** 1

**Steps:**
1. Add failing rows to the adapter's existing usage-cap and throttle fixture table: a transient throttle whose message states 90 minutes expecting 5400, an exhaustion whose message states 2 hours expecting 7200, and a throttle whose message states an unrecognized unit word expecting the unchanged 300-second fallback.
2. Verify the two scaled rows fail because the current pattern matches only a seconds token.
3. Replace the pattern's hard-coded seconds token with the shared alternation, keeping the unit required rather than optional so a stray number after the word "retry" still cannot be captured, and pass the matched token to the shared scaling function. Keep returning the caller-supplied fallback whenever the pattern does not match or the scaling function yields nothing.
4. Verify the new rows and all five pre-existing rows pass, run the repository typecheck target that includes test files, and commit the focused change.

**Done when:**
1. An invoke result for a transient throttle stating 90 minutes reports a wait of 5400, and one for an exhaustion stating 2 hours reports 7200.
2. An invoke result for a throttle stating an unrecognized unit word reports the unchanged 300-second fallback, and an exhaustion with no stated duration still reports 3600.
3. All five pre-existing usage-cap and throttle rows report their current expected waits unchanged, including the 900-second exhaustion row and the 45-second throttle row.
4. A message that states a number with no unit token after the word "retry" is still not captured as a wait and reports the caller-supplied fallback.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a Claude rate-limit message states "Please retry after 450 seconds", when the provider derives its wait, then the wait is 450 seconds. | 2 | "Derivation cases return 450 for a message stating 450 seconds, 5400 for one stating 90 minutes, and 7200 for one stating 2 hours." | diff-local |
| Story 1 happy: Given a Claude rate-limit message states "try again in 2 hours", when the provider derives its wait, then the wait is 7200 seconds. | 1, 2 | "An invoke-level case on the adapter's existing subprocess fake reports a rate-limited result whose wait field is 7200 for an hour-phrased message." | diff-local |
| Story 1 happy: Given a Claude rate-limit message states "retry after 90 minutes", when the provider derives its wait, then the wait is 5400 seconds. | 1, 2 | "Derivation cases return 450 for a message stating 450 seconds, 5400 for one stating 90 minutes, and 7200 for one stating 2 hours." | diff-local |
| Story 1 happy: Given a Codex rate-limit message states "rate limit exceeded; retry after 90 minutes", when the provider invoke result reports its wait, then the wait is 5400 seconds. | 1, 4 | "An invoke result for a transient throttle stating 90 minutes reports a wait of 5400, and one for an exhaustion stating 2 hours reports 7200." | diff-local |
| Story 1 negative: Given a rate-limit message states a non-positive duration such as "retry after 0 minutes", when the provider derives its wait, then the wait is that call's existing default rather than a zero-length or negative wait. | 1, 2 | "The scaling function yields no value for zero, for a negative number, and for a non-finite number, so no caller can receive a zero-length or negative wait from it." | diff-local |
| Story 2 happy: Given a Claude rate-limit message states a bare number with no unit such as "retry after 45", when the provider derives its wait, then the number is read as minutes and the wait is 2700 seconds. | 3 | "A message stating a bare 45 with no unit derives 2700, one stating a bare 2 derives 300, and one stating a bare 450 derives 3600." | diff-local |
| Story 2 happy: Given a Claude rate-limit message states a bare number whose minute reading exceeds one hour such as "retry after 450", when the provider derives its wait, then the wait is capped at 3600 seconds. | 1, 3 | "The inference function returns 300 for any value whose minute reading is below 300, the exact minute reading for any value inside the band, and 3600 for any value whose minute reading exceeds 3600." | diff-local |
| Story 2 negative: Given a Claude rate-limit message states a bare number whose minute reading is below the existing default such as "retry after 2", when the provider derives its wait, then the wait is 300 seconds rather than 120 seconds. | 3 | "A message stating a bare 45 with no unit derives 2700, one stating a bare 2 derives 300, and one stating a bare 450 derives 3600." | diff-local |
| Story 2 negative: Given a Claude rate-limit message states an unrecognized unit such as "retry after 3 fortnights", when the provider derives its wait, then the wait is 300 seconds rather than a scaled reading of that number. | 3 | "A message stating a number followed by an unrecognized unit word derives 300 rather than a scaled reading of that number." | diff-local |
| Story 2 negative: Given a Codex rate-limit message states an unrecognized unit such as "retry after 3 fortnights", when the provider invoke result reports its wait, then it reports that call's existing fallback wait rather than a scaled reading of that number. | 4 | "An invoke result for a throttle stating an unrecognized unit word reports the unchanged 300-second fallback, and an exhaustion with no stated duration still reports 3600." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: each is decided entirely by the derivation code and the fixtures inside this diff, and no commit outside the feature can change whether it holds. Task 1 owns the pure unit-scaling and inference cases at unit level. Task 2 owns the Claude derivation cases for explicitly stated units and owns the Claude invoke-boundary integration proof through the adapter test file's existing third-party subprocess fake. Task 3 owns the Claude derivation cases for an absent or unrecognized unit; the invoke boundary for that adapter is already owned by Task 2, so Task 3 stays unit-scoped. Task 4 owns both the Codex derivation change and its invoke-boundary proof, because the adapter's existing fixture table already observes the invoke result. No test reaches a real provider, network, or subprocess, and no aggregate or terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3
Task 1 -> Task 4
