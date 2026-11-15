# Intake origin: manual-test-report-left-in-product-worktree-blocks

Source-Ref: jstoup111/ai-conductor#3683
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3683 digest=8530bf384231205b03926c7f8fdcbc6aa48dba9830c37fc9e74c16c6add3f95f >>>
## Desired outcome

- Manual-test artifacts never leave the product worktree dirty. They live where the harness ignores them, or they're cleaned before the next step.
- A stray untracked artifact from a pipeline step never turns into a needs-human halt on routed host entry.
- Negative path: genuinely dirty product files (real uncommitted source changes) still block host entry.
<<< END INBOUND >>>
