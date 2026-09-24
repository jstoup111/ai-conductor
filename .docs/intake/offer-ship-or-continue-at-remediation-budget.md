# Intake origin: offer-ship-or-continue-at-remediation-budget

Source-Ref: jstoup111/ai-conductor#2185
Owner: jstoup111

## Desired outcome

- A feature whose tests are green, whose build review passed, and which has no BLOCKED or PLAN_GAP verdict reaches a PR when its remediation budget is spent, instead of halting.
- That PR is a draft and its body lists every open finding: the task and check or decision it belongs to, the reviewer's reason, and where in the tree the gap is marked.
- The suite on that PR is green; each open finding is visible in the test tree as a skipped test named for it, so an engineer can unskip as they close items. A red suite is never shipped.
- The shipped record for the feature carries the same list and a flag that it shipped at budget.
- Daemon status shows the at-budget state next to the feature.
- The release PR never includes an at-budget ship until its list is closed and the PR is undrafted.
- An engineer run can resume from the PR's list and finish the feature without re-running the tail.
- Observations recorded by the tail as non-blocking appear in a second list on the PR, clearly separated from the blocking list.
