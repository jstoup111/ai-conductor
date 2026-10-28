# Intake origin: build-review-remediate-context-grows-with-the-whol

Source-Ref: jstoup111/ai-conductor#3291
Owner: jstoup111

## Desired outcome

- The remediate judgement's input size tracks the findings under adjudication. A finding touching 2 tasks of a 56-task plan does not carry all 56 task bodies.
- The judge can still cite and check admission against the full contract of any task it routes work to. Admission quality does not regress on the existing build_review adjudication tests.
- The context ceiling the engine enforces is one every provider transport can actually deliver. An over-limit context fails with a named, operator-readable reason instead of an unclassified provider failure.
