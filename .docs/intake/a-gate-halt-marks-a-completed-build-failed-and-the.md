# Intake origin: a-gate-halt-marks-a-completed-build-failed-and-the

Source-Ref: jstoup111/ai-conductor#1753
Owner: jstoup111

## Desired outcome

- A halt caused by a gate or environmental refusal, rather than by the step's own work failing,
- After such a halt is cleared, the feature resumes and reaches its next step without any
- When a prerequisite gate blocks a step, the resulting halt names the unsatisfied prerequisite and
- A build that genuinely failed is still recorded as failed and still blocks its dependents.
