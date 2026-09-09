# Intake origin: print-only-applicable-resume-steps-in-the-self-hos

Source-Ref: jstoup111/ai-conductor#1775
Owner: jstoup111

## Desired outcome
- The resume procedure a self-host gate HALT prints contains only steps that apply to a
  self-hosting repository.
- An operator following the printed procedure verbatim reaches a merged PR without running a
  command that is a no-op or a wrong-context action for this repository.
- The procedure still states the ADR-005/ADR-010 invariant that the daemon never merges and the
  operator does.
