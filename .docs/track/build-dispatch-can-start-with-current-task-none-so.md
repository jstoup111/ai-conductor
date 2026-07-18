# Track: build-dispatch-can-start-with-current-task-none-so

Track: technical

## Rationale

Engine-invariant bug fix (issue jstoup111/ai-conductor#671). No product-facing surface: the
change adds a deterministic pre-dispatch attribution invariant, a loud consecutive-abstention
signal, and promotes `Task: none` dispatch telemetry to an error state. Acceptance criteria
live in the stories; no PRD on the technical track.
