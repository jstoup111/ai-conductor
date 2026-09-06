# Intake origin: stage-intake-outcomes-when-the-desired-outcome-hea

Source-Ref: jstoup111/ai-conductor#1528
Owner: jstoup111

## Desired outcome

- An intake issue's Desired-outcome bullets reach `.pipeline/intake-outcomes.md` whether the issue's heading is written singular or plural.
- A claim that cannot supply the originating issue's body does not silently yield an empty outcomes file; the condition is observable before any DECIDE artifact is authored, not at land.
- When an issue that has Desired-outcome bullets stages zero of them, that discrepancy is surfaced with the reason, rather than appearing later as a `fabricated-id` coherence error that names neither the staging file nor the issue.
- Negative path: an issue genuinely carrying no Desired-outcome section still stages zero bullets and still lands without outcome rows — today's legitimate behavior is preserved and does not become an error.
- Re-running the #1502 flow end to end stages six bullets with no hand repair of `.pipeline/`.
