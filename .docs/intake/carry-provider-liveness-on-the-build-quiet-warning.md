# Intake origin: carry-provider-liveness-on-the-build-quiet-warning

Source-Ref: jstoup111/ai-conductor#1815
Owner: jstoup111

## Desired outcome
- When the build step is quiet on task progress but the step is otherwise demonstrably live,
  the operator can tell that apart from a wedged step without running any manual command.
- A genuinely wedged or dead build step still surfaces a warning, at least as promptly as it
  does today.
- Whatever liveness evidence distinguishes the two cases is carried on the event itself, so
  every spine consumer sees the same distinction the terminal line does — not only the
  rendered string.
