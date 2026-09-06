# Intake origin: skip-registered-projects-whose-path-is-missing-ins

Source-Ref: jstoup111/ai-conductor#1131
Owner: jstoup111

## Desired outcome
- A registered project whose directory is missing is identified as a path-liveness problem, not a missing `gh` executable.
- Missing project paths do not produce repeated GitHub poll attempts indefinitely.
- Healthy registrations continue polling and the status surface identifies the skipped registration and reason.
