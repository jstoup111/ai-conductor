# Intake origin: connector-seam-for-event-submissions-is-registered

Source-Ref: jstoup111/ai-conductor#1516
Owner: jstoup111

## Desired outcome

- A connector plugin installed in the global or project plugin directory receives event submissions during a run, or the harness refuses it at load time with a message saying the kind is unsupported. Silent registration followed by no submissions is not an acceptable outcome either way.
- Every emitter the harness ships, including the OTel one, receives its events through the same connector seam an installed plugin uses — so the seam is exercised by production code rather than only by plugins nobody has written yet.
- A connector can attribute each submission it receives to the run's engine version, project, branch, and feature without re-deriving that identity from the filesystem itself.
- Enabling or disabling one emitter leaves every other connector receiving submissions unaffected.
- The built-in OTel emitter keeps working unchanged from the operator's point of view, including its enable/disable gate and its stop-time flush.
- A connector that throws on start or on a submission does not fail or stall the run.
- `docs/` states one answer to "how do I receive event submissions from the spine", and it matches what the code does.
