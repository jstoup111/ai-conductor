# Intake origin: a-trace-cannot-be-tied-to-the-commit-pr-or-issue-t

Source-Ref: jstoup111/ai-conductor#2000
Owner: jstoup111

## Desired outcome

- From a trace alone, a consumer can identify the commit the run built, and the base it was built against.
- From a trace alone, a consumer can reach the pull request the run opened, when one exists.
- From a trace alone, a consumer can identify the tracker issue the work originated from.
- A run that legitimately produced no PR is distinguishable from one whose PR is simply unrecorded.
- A value resolved late in the run (a PR that does not exist until FINISH) still lands on the exported trace rather than being dropped for having arrived after the span opened.
