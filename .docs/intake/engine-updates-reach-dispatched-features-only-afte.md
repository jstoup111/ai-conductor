# Intake origin: engine-updates-reach-dispatched-features-only-afte

Source-Ref: jstoup111/ai-conductor#2392
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2392 digest=34b3a55b480e17581666fa83d4e6a84f0e3f2efcc9d459f065d63b46ea63c072 >>>
## Desired outcome

- A feature dispatched after an engine rebuild runs on that new engine without any in-flight feature having to finish first.
- A feature already in flight when a rebuild lands finishes on the engine it started with, and its verdicts and evidence stay valid across the change.
- Pulling and rebuilding on a cadence requires no operator action for the new build to reach subsequent dispatches.
- The engine version a given feature ran on is recoverable after the fact from its own record, not only from whatever the daemon happens to be running now.
- Exactly one daemon supervisor generation remains live at any moment.
- An operator can still see, at a glance, which features are on an older engine than the current build.
<<< END INBOUND >>>
