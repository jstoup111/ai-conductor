# Intake origin: gh-cli-capability-probe-report-an-unsupported-json

Source-Ref: jstoup111/ai-conductor#2139
Owner: jstoup111

## Desired outcome

- A `gh` too old for the fields the harness depends on is reported as a version/capability problem, naming the CLI and the unsupported field, rather than as "cannot verify PR ... identity and head".
- The failure is surfaced before a feature's FINISH retry budget is consumed — an operator learns the CLI is unusable without waiting for a halt.
- (negative path) A genuinely missing or mismatched PR still fails closed exactly as it does today, and no outcome is ever recorded on an unverifiable PR.
