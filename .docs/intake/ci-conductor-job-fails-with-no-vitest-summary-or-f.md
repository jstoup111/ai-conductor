# Intake origin: ci-conductor-job-fails-with-no-vitest-summary-or-f

Source-Ref: jstoup111/ai-conductor#2631
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2631 digest=d36fbb6d2619bdf6ff0fa463c22880d20154215318b59fbde0008e36ea292cde >>>
## Desired outcome

- When a CI test run fails or aborts, the log names the test file or files that were running or failed.
- A test file that stops making progress is reported by name within a bounded time, not only when the job itself dies.
- A passing run's output and duration are unchanged in any way that matters.
<<< END INBOUND >>>
