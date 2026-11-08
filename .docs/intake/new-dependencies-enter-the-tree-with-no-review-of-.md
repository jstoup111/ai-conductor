# Intake origin: new-dependencies-enter-the-tree-with-no-review-of-

Source-Ref: jstoup111/ai-conductor#2045
Owner: jstoup111

## Desired outcome

- A diff adding or upgrading a dependency yields a build_review judgement covering necessity (vs existing code), version pinning, and license compatibility; an unjustifiable addition fails with a finding.
- Dependency-free diffs incur no cost from this rubric; findings route through the adjudicator (#2033).
