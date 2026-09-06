# Intake origin: summarize-the-decide-artifacts-in-the-spec-land-co

Source-Ref: jstoup111/ai-conductor#1779
Owner: jstoup111

## Desired outcome
- A spec PR opened by `handoff` has a non-empty, descriptive title and body — at minimum a real summary of what the spec does, sourced from the DECIDE artifacts already sitting in the worktree, rather than a bare commit subject line.
- Separately: some artifact tied to the spec PR captures the operator's own understanding of why the change matters, in a way that is meaningfully harder to satisfy by asking the AI to draft an answer and pasting it in than the current status quo (nothing is asked at all).
- Whatever achieves the above does not depend on detecting whether text was AI-written (unreliable, gameable) — it works by *when* and *what* is asked, not by policing *how* the answer was produced.
- Negative path: a spec PR for a trivial/tiny change still opens without friction disproportionate to its size — whatever is added doesn't become a reason small specs stop landing.
