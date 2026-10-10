# Intake origin: unresolved-covers-marker-on-a-changed-test-exhaust

Source-Ref: jstoup111/ai-conductor#2540
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2540 digest=991fd3fcfb827fdd496eb62c7dba96071855414b99d215fe4203e068f6053106 >>>
## Desired outcome

- When a changed test's `Covers:` marker carries a token that matches no known reference grammar, the feature is routed back to build with the file path and the offending token named, and build_review is not re-run against an unchanged tree.
- An unresolvable Covers token never consumes the build_review mechanical fault allowance.
- A genuine infrastructure failure on the same rubric (provider malformed result, materialization failure) still consumes the allowance as it does today.
- Negative path: a well-formed `task:<id>` that names a task absent from the active plan is still reported as scope-incomplete, not silently accepted.
<<< END INBOUND >>>
