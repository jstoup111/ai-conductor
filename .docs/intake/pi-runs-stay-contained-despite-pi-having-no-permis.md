# Intake origin: pi-runs-stay-contained-despite-pi-having-no-permis

Source-Ref: jstoup111/ai-conductor#1886
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#1886 digest=d90e4c43d913bdab351922b334a5d63bad768fa41850a9394b4683aab9d72dc1 >>>
## Desired outcome

- An unattended Pi dispatch cannot modify files outside its feature worktree (plus explicitly allowed paths); an attempted out-of-tree write fails observably rather than landing.
- When containment cannot be established for a Pi run, the run fails closed with a halt naming why, mirroring the existing containment-unproven behavior.
- Pi's project-local `.pi/` extension auto-loading cannot execute repository-supplied code in a dispatch unless deliberately enabled.
- Environment-claim auditing gives correct verdicts for Pi runs (a "sandbox blocked me" claim is adjudicated against Pi's actual, absent, OS sandbox).
- Negative path: interactive operator use of Pi outside the daemon is not newly restricted by the harness.
<<< END INBOUND >>>
