# Intake origin: custom-steps-work-only-in-this-repo-engine-hardcod

Source-Ref: jstoup111/ai-conductor#1344
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#1344 digest=f02fe948ea723f6e7a8ec23e9df4e6ce1de125f70b7084b37ea263609f60d594 >>>
## Desired outcome

- A repository other than ai-conductor can declare a gating custom step in its own
- Renaming a custom step's skill directory or step key does not silently disable its gate.
- The conductor package's exported surface contains only what a consumer can actually use;
- Adding a custom step in a consumer repository is documented end-to-end, and following
- Negative path: a repository that declares NO custom steps is unaffected — FINISH has no
- Negative path: a bootstrapped consumer's generated PR template still contains no
- This repository's own two custom steps keep working through the change, including the
<<< END INBOUND >>>
