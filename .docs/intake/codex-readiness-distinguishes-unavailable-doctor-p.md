# Intake origin: codex-readiness-distinguishes-unavailable-doctor-p

Source-Ref: jstoup111/ai-conductor#1039
Owner: jstoup111

## Desired outcome

- An operator inspecting a Codex auth halt or a `credentials_park_progress` event can tell, from recorded evidence alone, whether the probe failed to produce an answer (exec error, timeout, unparseable output) or doctor affirmatively reported the credential unusable — without re-running anything by hand.
- A probe that could not produce an answer is distinguishable in the readiness result from a probe that produced a negative answer, and callers can act on that difference.
- Repeatedly failing to obtain an answer does not consume the full auth-park timeout and then halt with a message that attributes the failure to credentials.
- The doctor probe timeout is no longer an unreviewable hardcoded constant where a slow or loaded machine silently manufactures a credential verdict.
- A probe failure is recorded durably (no secrets) rather than discarded, so the next incident is diagnosable from logs alone.
- Regression coverage distinguishes exec-failure, timeout, unparseable-output, and affirmatively-unhealthy doctor results, asserting they are not collapsed into one verdict.
