# Intake origin: compose-the-spec-pr-body-with-its-release-disposit

Source-Ref: jstoup111/ai-conductor#1869
Owner: jstoup111

## Desired outcome
- An `engineer/land` spec PR opened into a repository that requires a release disposition
  records zero failed `release-metadata` check runs across its whole life, when its declared
  disposition is valid.
- A spec PR whose disposition is genuinely invalid still fails the check, and that failure is
  the only `release-metadata` failure on the PR.
- The disposition present on the PR immediately after `engineer handoff` completes is the same
  one an operator would read there ten minutes later — no window in which the body lacks it.
