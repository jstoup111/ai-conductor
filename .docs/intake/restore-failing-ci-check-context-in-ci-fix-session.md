# Intake origin: restore-failing-ci-check-context-in-ci-fix-session

Source-Ref: jstoup111/ai-conductor#2153
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2153 digest=12a47ca717aed25f122e33da92d171d70bc4d8fa0923c26a380a97c25dd78a48 >>>
## Desired outcome

- When a PR has failing CI checks, the ci-fix dispatch prompt contains the actual failing check names and their detail links.
- A failure to enumerate checks is surfaced (log/event), never silently collapsed into an empty hint.
<<< END INBOUND >>>
