# Intake origin: late-gate-fixes-restack-the-whole-stack-every-repa

Source-Ref: jstoup111/ai-conductor#3653
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3653 digest=d4b8403d54ca53728f88c9f3c54855f12250fdbebbf3fc52fcdd492edf7a54f2 >>>
## Desired outcome

- During final-gate repair rounds, landing a routed fix doesn't restack the children above its owner each round. Total restack work for a feature grows with the number of publishes, not the number of repair rounds.
- At publish, every fix is in the PR of the child that owns its code (the child routing already picks today). A reviewer reading child N's PR sees child N's work complete, without needing a later PR.
- After fixes are moved to their owning children, each child still passes its own gates. A child that only passes because of a fix owned by a higher child is caught before publish and never reaches review.
- The owner choice routing makes for each finding is still the authority for where a fix ends up, and is visible per fix (for example, in the round record or in commit metadata).
- Negative path: a fix whose correct owner is unclear, or that can't move cleanly onto its owner, halts with the specific fix and child named. It's never silently left in a higher PR.
- Restack spend is reported per feature and per round, so the reduction can be measured against this feature's baseline (33 resolver runs, $68.55).
<<< END INBOUND >>>
