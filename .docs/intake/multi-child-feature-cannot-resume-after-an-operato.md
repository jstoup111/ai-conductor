# Intake origin: multi-child-feature-cannot-resume-after-an-operato

Source-Ref: jstoup111/ai-conductor#3365
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3365 digest=e9f9e3ed008bf8f7f0635eec7a4a02b1bdfde5cafd20b3e3ea3d4e10188711f1 >>>
## Desired outcome

- After `ai-conductor reseal` changes DECIDE artifacts on a multi-child feature, the next dispatch reruns coverage binding and resumes the active child without any manual state edit.
- If the active child truly can't be resolved, the run writes its own HALT that names the cause and gives a working recovery command, not the generic "loop ended without DONE or HALT".
- Negative path: a single-child (flat) feature resealed the same way keeps today's behavior. Coverage binding reruns once and BUILD continues.
- Negative path: a coverage-binding envelope that is genuinely absent or corrupt on a feature with child state still refuses to guess the child.
<<< END INBOUND >>>
