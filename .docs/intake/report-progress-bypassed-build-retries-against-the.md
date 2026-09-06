# Intake origin: report-progress-bypassed-build-retries-against-the

Source-Ref: jstoup111/ai-conductor#1513
Owner: jstoup111

## Desired outcome
- A retry counter shown to an operator never exceeds its own stated maximum, in the daemon log, the terminal renderers, and any other consumer of the retry event.
- When a build retry is granted because the attempt made forward progress, the operator can tell from the emitted line that a progress allowance was used rather than a fixed retry, and can see how much of *that* allowance remains.
- The fixed-retry counter still reads `1/3`, `2/3`, `3/3` for ordinary non-progress build retries and for every other step, unchanged.
