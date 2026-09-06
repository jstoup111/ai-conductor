# Intake origin: clamp-resume-entry-to-a-runnable-step-and-halt-whe

Source-Ref: jstoup111/ai-conductor#1717
Owner: jstoup111

## Desired outcome

- Resuming a feature whose earliest non-done step is a re-opened `build` dispatches build, regardless of later steps' recorded `done` status.
- A resume that cannot dispatch any step writes a terminal HALT naming the inconsistency (which step it wanted, which prerequisite blocked it) instead of exiting with no verdict and re-halting identically on every re-kick.
- Existing forward behavior (never skipping ahead past gates) is preserved.
