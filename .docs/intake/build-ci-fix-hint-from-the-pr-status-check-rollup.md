# Intake origin: build-ci-fix-hint-from-the-pr-status-check-rollup

Source-Ref: jstoup111/ai-conductor#2153
Owner: jstoup111

## Desired outcome
- When a PR has failing CI checks, the ci-fix dispatch prompt contains the actual failing check names and their detail links.
- A failure to enumerate checks is surfaced (log/event), never silently collapsed into an empty hint.
