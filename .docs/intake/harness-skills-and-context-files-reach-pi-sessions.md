# Intake origin: harness-skills-and-context-files-reach-pi-sessions

Source-Ref: jstoup111/ai-conductor#1888
Owner: jstoup111

## Desired outcome

- A Pi-dispatched step sees the same skill catalog and behavioral instructions (HARNESS.md chain) as a claude/codex dispatch of the same step, and can invoke skills successfully.
- `bin/install --providers` accepts Pi, reports its readiness, and sets up whatever catalog/instruction wiring Pi needs; re-running is idempotent.
- Skills marked never-model-invocable keep that property under Pi.
- The multiprovider host-difference documentation covers Pi's row.
- Negative path: installing Pi support does not disturb the existing claude/codex catalog symlinks.
