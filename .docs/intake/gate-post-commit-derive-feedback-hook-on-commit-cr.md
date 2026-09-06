# Intake origin: gate-post-commit-derive-feedback-hook-on-commit-cr

Source-Ref: jstoup111/ai-conductor#2162
Owner: jstoup111

## Desired outcome
- The engine invocation and trailer warning occur only after Bash commands that actually created a commit.
- All other Bash calls pay no hook latency.
