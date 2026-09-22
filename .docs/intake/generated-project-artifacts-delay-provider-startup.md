# Intake origin: generated-project-artifacts-delay-provider-startup

Source-Ref: jstoup111/ai-conductor#1219
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#1219 digest=6418f846d96a6ae71b7fae40f7ced123fbb420ea36c5781a603b5ec85c34fae0 >>>
## Desired outcome

- A project can declare checkout-local generated or cache artifacts that the live-boundary fingerprint does not read.
- A declared exclusion cannot silently remove source, configuration, hooks, credentials, or the exclusion policy itself from boundary protection.
- Git-ignored files remain protected unless the project explicitly declares them for this boundary.
- Same-named paths outside an explicitly declared scope remain fingerprinted.
- Provider-start diagnostics expose the time spent constructing the safety fingerprint so pre-provider latency is attributable.
- Existing projects without a declaration retain the current fail-closed protection behavior.
<<< END INBOUND >>>
