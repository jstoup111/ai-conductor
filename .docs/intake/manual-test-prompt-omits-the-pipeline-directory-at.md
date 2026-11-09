# Intake origin: manual-test-prompt-omits-the-pipeline-directory-at

Source-Ref: jstoup111/ai-conductor#3642
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3642 digest=887ba9d32b671380296d1bffe4af23e13ce6db1b1f8fa2a64e8e4aead6a0f763 >>>
## Desired outcome

- Every manual_test attempt gets enough context to run the manual-test CLI and record results without guessing paths. Two agents following the skill literally on the same feature both record results.
- When an attempt ends without writing results, the retry reason says so (for example, "no results written this attempt"), not a stale-file message with identical run ids.
- When the agent reports a blocker instead of results, the reported blocker shows up in the retry/halt reason rather than being dropped.
- Negative path: an attempt that genuinely fails to test, for example because the app can't start, still fails the attempt. It's never counted as a pass.
<<< END INBOUND >>>
