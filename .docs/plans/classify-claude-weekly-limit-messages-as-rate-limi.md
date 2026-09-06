# Implementation Plan: Classify Claude weekly-limit messages as rate limits

**Date:** 2026-09-06
**Stories:** .docs/stories/classify-claude-weekly-limit-messages-as-rate-limi.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent stays inside the Claude adapter's classification predicate and leaves the wait derivation, the reset-time deadline contract, the episode coordinator, and the retry policy exactly as the shipped rate-limit episode behaviour requires.

## Summary

Four bounded tasks deliver the remaining gap in #1006: the Claude adapter's quota-limit pattern recognizes a bounded vocabulary of period words instead of only session and usage, the anchors that keep ordinary prose from matching stay exactly as they are, and the corrected classification is pinned at the invoke boundary and through the real conductor step loop.

## Technical Approach

The adapter's quota-limit predicate has three shapes and each hard-codes the same two period words: a "you've hit your <period> limit" shape, a "<period> limit reached" shape, and a "<period> limit · resets" shape. The observed message states a weekly period, so it matches none of the three and falls through to the ordinary-failure path, where it burns the step's retry budget. Nothing downstream is wrong: once the predicate says yes, the existing code already sets the rate-limited flag regardless of exit code, already refuses to report the notice as a success, and already derives the wait and the timezone deadline from the stated reset time.

The fix is therefore confined to the period alternation. Extract the period fragment into one module-level pattern source beside the predicate and widen it to a bounded vocabulary: session, usage, weekly, monthly, daily, hourly, and a fixed-hour window written as digits followed by a hyphen and the word hour. Allow at most one optional qualifier word of letters, digits, and hyphens immediately before the period word and at most one immediately after it, so a limit named for a specific model is recognized in either word order. Compose the three existing shapes from that fragment with the regular-expression constructor, keeping the case-insensitive flag, and keep each shape's anchor text byte-for-byte as it is today. The anchors are what prevent a bare mention of a limit in prose from matching, so widening only the period alternation cannot loosen them.

Deliberately unchanged: the constant's existing name and the exported classification helper's existing name stay as they are, because renaming them would touch call sites and coverage outside this slice for no behavioural gain; a corrected comment above the constant carries the widened meaning instead. The non-quota rate-limit pattern, the out-of-credits pattern, the authentication pattern, the stale-session patterns, and the classification precedence order are untouched, so a combined message keeps being routed to the quota branch ahead of the authentication branch by the same precedence that exists today.

Test design follows the repository's test-authoring skill. Classification is a pure predicate, so the vocabulary and the false-positive cases are proved as unit cases against the exported classification helper, which is the narrowest seam that owns the behaviour and today has no callers. The invoke boundary is proved in the adapter's own test file, which already mocks the subprocess boundary and drives the provider's invoke method, so the corrected classification is shown reaching a real invoke result with its rate-limited flag, its non-success verdict, its wait, and its deadline. The observable outcome the issue asks for — no halt, no burnt budget — is proved in the existing rate-limit episode acceptance file, which already drives the real classification call site through the real conductor step loop for the session-limit message with an injected sleep, an injected step runner, and only the subprocess boundary faked. No test reaches a real provider, a network, or a real subprocess, and no new conductor fixture is introduced beyond the second message case in that existing bounded file.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, both stories, and the bounded-vocabulary approach over a single literal period word on 2026-09-06 (delegated).
- Verified: the adapter's quota-limit constant is a single case-insensitive pattern whose period alternation is exactly the two words session and usage, repeated across its three shapes.
- Verified: the observed message states a weekly period, so it matches none of the three shapes, and the non-quota rate-limit pattern is consulted only for a non-zero exit code and matches none of that message's words either.
- Verified: the classification site tests the quota-limit constant regardless of exit code, folds the result into the rate-limited flag, subtracts it from the success computation, and gates the wait-and-deadline derivation on it.
- Verified: the wait derivation's bare-hour-with-timezone path already parses the reset clause of the observed message, so the deadline works the moment the message is recognized.
- Verified: the exported classification helper has no callers anywhere in the engine or its tests, so unit cases may adopt it without disturbing existing coverage.
- Verified: the adapter's test file mocks the subprocess boundary and constructs the provider directly, so an invoke-level case needs no new seam, and its existing quota-limit block already contains the prose false-positive case and the classification-precedence case this plan extends.
- Verified: the rate-limit episode acceptance file already drives the real classification call site through the real conductor step loop with an injected sleep and an injected episode coordinator, and asserts both the absence of a halt marker and the episode entry.
- Verified: no page under the documentation tree, the harness rules file, or the skill catalog names the recognized limit wording, so this change leaves no stale reader-visible documentation.
- Verified: the concurrently specced wait-duration feature edits the duration branch of the same adapter file and adds a separate duration module; it does not touch the classification constant, so the two diffs meet only as an ordinary same-file merge.
- Scope check: consumer-facing engine behaviour; no new skill; the equivalent Codex seam already recognizes that host's own usage-cap wording, so no host is left silently degraded. Event spine: no event, metric, span, log line, or report is added or changed.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavioural claim above was read in the worktree; no unconfirmed assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Widen the recognized quota-period vocabulary
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/execution/claude-provider.ts, src/conductor/test/execution/claude-provider.test.ts
**Dependencies:** none

**Steps:**
1. Add failing unit cases against the exported classification helper in the adapter's test file: the exact message from the 2026-07-26 daemon log, one message per remaining recognized period word including the fixed-hour-window form, one message whose model qualifier precedes the period word, and one whose qualifier follows it.
2. Add unit cases pinning the pre-existing session and usage forms of all three shapes against the same helper, so the widening is shown not to disturb them.
3. Verify the new period cases fail while the pre-existing ones pass.
4. Extract the period fragment into one module-level pattern source beside the quota-limit constant, widen its alternation to session, usage, weekly, monthly, daily, hourly, and the digits-hyphen-hour form, and allow at most one optional qualifier word of letters, digits, and hyphens on each side of the period word.
5. Rebuild the quota-limit constant from that fragment with the regular-expression constructor, keeping the case-insensitive flag and each shape's anchor text unchanged, and rewrite the comment above it to describe the widened vocabulary and the anchors that bound it.
6. Verify all cases pass, run the repository typecheck target that covers test files, and commit the focused change.

**Done when:**
1. The classification helper returns true for the exact weekly message from the 2026-07-26 daemon log.
2. The classification helper returns true for a monthly, a daily, an hourly, and a fixed-hour-window limit message, in mixed case.
3. The classification helper returns true for a limit message whose model qualifier precedes the period word and for one whose qualifier follows it.
4. The classification helper still returns true for every pre-existing session and usage form across all three shapes, and the repository typecheck target that covers test files passes.

### Task 2: Keep the widened pattern anchored against false positives
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/execution/claude-provider.test.ts
**Dependencies:** 1

**Steps:**
1. Add failing-if-wrong unit cases against the exported classification helper: prose that mentions limit policies with none of the three anchors, a message naming a period word outside the recognized vocabulary, and a message whose only limit word stands alone with no period word at all.
2. Add an invoke-level case on the file's existing subprocess fake asserting that a zero-exit run whose output only discusses limit policies is still reported as a success and is not rate-limited.
3. Add an invoke-level case on the same fake for a message carrying both weekly-limit wording and authentication-failure wording, asserting the rate-limited flag is set and the authentication flag is not.
4. Verify every case passes against the widened pattern, run the repository typecheck target that covers test files, and commit the focused change.

**Done when:**
1. The classification helper returns false for prose mentioning limit policies, for an unrecognized period word, and for a bare limit word with no period word.
2. A zero-exit invoke result for prose mentioning limit policies is reported as a success with no rate-limited flag.
3. An invoke result for a message carrying both weekly-limit and authentication-failure wording is rate-limited and carries no authentication-failure flag.
4. The pre-existing prose and precedence cases in the file pass unmodified, and the repository typecheck target that covers test files passes.

### Task 3: Prove the corrected classification at the invoke boundary
**Story:** Story 1
**Story:** Story 2 (negative path)
**Type:** happy-path
**Files:** src/conductor/test/execution/claude-provider.test.ts
**Dependencies:** 1

**Steps:**
1. Add a failing invoke-level case on the file's existing subprocess fake: the exact weekly message from the 2026-07-26 daemon log delivered on exit code zero must yield a rate-limited result that is not a success and that carries both a wait greater than zero and a deadline.
2. Add a second invoke-level case delivering the same message on a non-zero exit code, asserting the same rate-limited and non-success verdict.
3. Add an invoke-level case for a weekly-limit message with no reset time, asserting it is still rate-limited and derives the adapter's existing default wait.
4. Verify the cases fail before Task 1's change is present and pass with it, run the repository typecheck target that covers test files, and commit the focused change.

**Done when:**
1. A zero-exit weekly-limit notice yields an invoke result whose rate-limited flag is set, whose success verdict is false, whose wait is greater than zero, and whose deadline is defined.
2. A non-zero-exit weekly-limit message yields the same rate-limited and non-success verdict.
3. A weekly-limit message with no reset time yields a rate-limited result whose wait equals the adapter's existing default of 300 seconds.
4. The repository typecheck target that covers test files passes and the adapter test file passes in full.

### Task 4: Pin the observable outcome through the real conductor step loop
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/test/acceptance/daemon-rate-limit-episode-coordinator.acceptance.test.ts
**Dependencies:** 1

**Steps:**
1. Extend the existing quota-limit acceptance scenario in that file so its message fixture is table-driven over two entries: the pre-existing session-limit message and the exact weekly-limit message from the 2026-07-26 daemon log.
2. Keep every existing bound of that scenario unchanged — the injected step runner, the injected sleep, the injected episode coordinator, the pre-resolved state that leaves only the build tail to run, and the single retry allowance that would be exhausted by one mis-classified limit.
3. Verify the weekly entry fails before Task 1's change is present, for the recorded reason that the message classified as an ordinary failure.
4. Verify both entries pass with the change, run the repository typecheck target that covers test files, and commit the focused change.

**Done when:**
1. The acceptance scenario runs once per message fixture and both entries end with no halt marker written.
2. Both entries record at least two provider invocations, so the attempt was retried rather than terminated.
3. Both entries record an entry into the injected shared rate-limit episode coordinator.
4. The scenario's injected runner, injected sleep, injected coordinator, pre-resolved state, and single retry allowance are unchanged from their current values.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the Claude CLI reports "You've hit your weekly limit · resets 9pm (America/New_York)", when the adapter classifies that output, then it is recognized as a quota limit rather than an ordinary failure. | 1 | "The classification helper returns true for the exact weekly message from the 2026-07-26 daemon log." | diff-local |
| Story 1 happy: Given the Claude CLI reports a limit for any other recognized quota period, such as a monthly, daily, hourly, or fixed-hour-window limit, when the adapter classifies that output, then it is recognized as a quota limit. | 1 | "The classification helper returns true for a monthly, a daily, an hourly, and a fixed-hour-window limit message, in mixed case." | diff-local |
| Story 1 happy: Given a recognized quota-period limit message carries one model qualifier word beside the period word, such as a weekly limit named for a specific model, when the adapter classifies that output, then it is recognized as a quota limit. | 1 | "The classification helper returns true for a limit message whose model qualifier precedes the period word and for one whose qualifier follows it." | diff-local |
| Story 1 happy: Given the weekly-limit message rides exit code zero as a soft notice, when the adapter returns its invoke result, then the result is rate-limited, is not reported as a success, and carries a wait derived from the stated reset time. | 3 | "A zero-exit weekly-limit notice yields an invoke result whose rate-limited flag is set, whose success verdict is false, whose wait is greater than zero, and whose deadline is defined." | diff-local |
| Story 1 negative: Given output only discusses limit policies in prose and carries none of the recognized anchors, when the adapter classifies that output, then it is not rate-limited and a zero-exit run is still reported as a success. | 2 | "A zero-exit invoke result for prose mentioning limit policies is reported as a success with no rate-limited flag." | diff-local |
| Story 1 negative: Given a limit message names a period word outside the recognized vocabulary, such as a fortnightly limit, when the adapter classifies that output, then it is not reported as rate-limited. | 2 | "The classification helper returns false for prose mentioning limit policies, for an unrecognized period word, and for a bare limit word with no period word." | diff-local |
| Story 1 negative: Given one message carries both weekly-limit wording and authentication-failure wording, when the adapter classifies that output, then it is reported as rate-limited and not as an authentication failure. | 2 | "An invoke result for a message carrying both weekly-limit and authentication-failure wording is rate-limited and carries no authentication-failure flag." | diff-local |
| Story 2 happy: Given a build step returns the exact weekly-limit message from the 2026-07-26 daemon log, when the conductor handles that step result, then the step is retried rather than failed, the shared rate-limit episode is entered, and no halt marker is written. | 4 | "The acceptance scenario runs once per message fixture and both entries end with no halt marker written." | diff-local |
| Story 2 negative: Given a weekly-limit message carries no parseable reset time, when the adapter derives its wait, then it reports the adapter's existing default wait rather than no wait at all. | 3 | "A weekly-limit message with no reset time yields a rate-limited result whose wait equals the adapter's existing default of 300 seconds." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: each is decided by the classification pattern and the fixtures inside this diff, and no commit outside the feature can change whether it holds. Task 1 owns the vocabulary at unit level against the exported classification helper, which is the narrowest seam that owns the predicate. Task 2 owns the false-positive and precedence negatives, at unit level where the predicate alone decides and at the invoke boundary where the surrounding classification order also participates. Task 3 owns the provider-adapter integration proof: the corrected classification is observed on a real invoke result through the test file's existing subprocess fake, which is the entry point the conductor actually calls. Task 4 owns the one further boundary this change crosses — the conductor's retry and episode handling — and proves it through the existing bounded acceptance scenario rather than a new fixture, keeping every gate, injection, and endpoint of that scenario as it stands. No test starts a real provider, performs network or process work, or adds a terminal validation task.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
Task 1 -> Task 4
