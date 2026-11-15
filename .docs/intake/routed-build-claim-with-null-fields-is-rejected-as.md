# Intake origin: routed-build-claim-with-null-fields-is-rejected-as

Source-Ref: jstoup111/ai-conductor#3643
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3643 digest=4e66757031b2d73a4ea4e03ea6a88cb9b5455e1b608ffdeb41ff687d0dcead1f >>>
## Desired outcome

- A builder result that providers with strict nullable schemas emit (unused fields as `null`) is read the same as the same result with those fields left out.
- When a claim is rejected as malformed, the retry reason says which field was wrong and how.
- When a builder signals that it needs operator input, that need reaches the operator (a halt or a recorded decision request). It's never just counted as a failed attempt.
- Negative path: a claim that really is invalid (unknown outcome, out-of-range child, empty paths and symbols) is still refused.
<<< END INBOUND >>>
