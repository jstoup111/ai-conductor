# Intake origin: exclude-patch-equivalent-upstream-commits-from-the

Source-Ref: jstoup111/ai-conductor#1654
Owner: jstoup111

## Desired outcome
- A commit that is patch-equivalent to one already on the review base is not attributed to the feature by any rubric: it appears in no reviewed diff hunk and generates no scope/completeness findings.
- The exclusion is recorded in the lap evidence (which commits were filtered and why) so a grader or operator can audit it.
- A commit that is genuinely novel — including a modified variant of an upstream commit that is NOT patch-equivalent — is still fully attributed and graded.
- No rebase of the feature branch is required or triggered by this mechanism.
