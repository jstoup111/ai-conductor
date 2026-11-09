# Intake origin: intake-carries-no-semver-signal-release-semver-is-

Source-Ref: jstoup111/ai-conductor#2027
Owner: jstoup111

## Desired outcome

- An intake issue can carry a declared semver tier (major/minor/patch) at filing time, and that tier should be set on filed issues the way size/priority are.
- The declared tier is visible to DECIDE and to the PR author so the PR's `Release-Semver` can be checked against (or seeded from) the intake's declaration.
- Filing without a tier still works — resolution follows the same prompt ▸ infer ▸ default path as size/priority, reported with its source.
