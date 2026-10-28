# Intake origin: daemon-ci-fix-never-sees-the-test-failure-in-a-fai

Source-Ref: jstoup111/ai-conductor#3106
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3106 digest=0cd3cb01b79708f0090db28868b90ae047b5208190d36a19896e9ee078687b3e >>>
## Desired outcome

- For a failed conductor CI run, the excerpt CI-fix passes to its agent contains the failing test file name(s) and the failure lines, when the log has them.
- Checkout and fetch output doesn't crowd failure output out of the excerpt.
- The excerpt still stays within its byte budget, and a run with no recognizable failure lines still yields an excerpt rather than nothing (negative path).
<<< END INBOUND >>>
