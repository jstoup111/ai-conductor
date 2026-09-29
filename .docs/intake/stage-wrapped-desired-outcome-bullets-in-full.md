# Intake origin: stage-wrapped-desired-outcome-bullets-in-full

Source-Ref: jstoup111/ai-conductor#2620
Owner: jstoup111

## Desired outcome
- A Desired-outcome bullet that spans several lines in the issue is staged, and committed to the intake marker, with its full text.
- A coherence `outcome` row quoting the full text of a wrapped bullet is accepted at land.
- A bullet written on a single line is staged exactly as it is today.
- Negative path: prose in the section that is not part of any bullet — a lead-in sentence, a blank-line-separated paragraph — is not absorbed into a neighbouring bullet.
- Negative path: a nested sub-bullet is not silently merged into its parent in a way that changes the number of outcomes; how it is counted is stated and tested.
- Negative path: specs already landed with truncated markers keep landing and building; their existing `outcome` rows are not retroactively rejected.
