# Intake origin: no-decide-sweep-covers-task-versus-task-oscillatio

Source-Ref: jstoup111/ai-conductor#1540
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#1540 digest=622798f7fd79bbdd6b4861ec68b3614f5a2e58fce637c3d70c9fe444e5895ccf >>>
## Desired outcome

- A plan whose tasks can invalidate each other's fixtures or assertions is caught during DECIDE, before the spec lands — not by a reader who happens to ask.
- The both-directions oscillation question is applied to task pairs sharing a behavior, entity, file, or fixture, not only to story pairs and cross-layer pairs.
- An acyclic dependency graph is no longer treated as evidence that tasks do not interfere — the two properties are checked separately.
- The layer split between the sweeps is stated somewhere that makes an uncovered layer visible, so a future gap of this shape is apparent from the skill text rather than discovered in a spec.
- A plan with genuinely independent tasks still passes without new ceremony, and S-tier specs gain no new required step.
<<< END INBOUND >>>
