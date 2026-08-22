Waives: outcome-5

Rationale: `outcome-5` of jstoup111/ai-conductor#1759 asks for "a supported command to discard
cached rubric verdicts for a feature." During `/explore` the operator was asked how comprehensive
the fix should be and chose the minimal engine-side fix plus the log event, explicitly excluding an
operator clear command (recorded as the `Scope boundary:` in
`.docs/track/cached-rubric-verdicts-survive-an-engine-change-so.md` and as D7 of
`.docs/decisions/adr-2026-08-21-engine-identity-in-build-review-cache-key.md`).

The exclusion does not leave the filed failure unaddressed: outcomes 1–4 make the engine discard a
stale verdict on its own at the next dispatch, so the hand-deletion the issue describes is no longer
the recovery path for an engine change. The remaining case a clear command would serve — an
operator wanting to force a re-judge for reasons other than an engine or skill change — is a
separate operator affordance, not part of the observed defect, and is left for its own intake if
it proves needed.
