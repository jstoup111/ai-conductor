# Intake origin: recover-automatically-when-build-review-needs-fres

Source-Ref: jstoup111/ai-conductor#3586
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3586 digest=56b795420fa564cb8ba063aa2c75636594a0b697aac48511140cccb1b108b337 >>>
## Desired outcome

- When `build_review` reports that its inputs need `test_suite` re-run, the run re-runs it without operator action and then reaches a `build_review` verdict if the proof becomes current.
- The number of automatic re-runs per feature is bounded, and a needs-human HALT appears only once that bound is exhausted, never on the first occurrence.
- The HALT at exhaustion names the failing step, the step that was re-run, and how many attempts were made.
- A proof that is already CURRENT at `build_review` causes no re-run.
- A genuinely failing suite still follows the existing test-failure route rather than consuming this bound repeatedly with no progress.
<<< END INBOUND >>>
