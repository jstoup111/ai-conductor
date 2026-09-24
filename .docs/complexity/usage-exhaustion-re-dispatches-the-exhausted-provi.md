# Complexity: Usage exhaustion re-dispatches the exhausted provider every step, and provider substitution cannot be disallowed

Tier: M

Rationale: One subsystem (provider execution/selection) but a genuinely cross-cutting change
within it. Adds a config surface in two places (global and per step) that alters how an existing
candidate list is resolved; introduces a new per-candidate admission seam in
`provider-execution.ts` that both policy refusal and exhaustion suppression flow through; extends
the `ConductorEvent` union so the `rate_limit` record carries the provider and deadline it
currently omits; and adds a spine-derived availability projection that must be correct across the
`beginFeatureRun` boundary where every existing runtime cache is discarded, and cheap enough to
consult on a dispatch hot path. The config addition also touches a declared breaking surface, so
the release gate applies. Not S: this is not a localized edit to one validation branch, and the
durability requirement forces a design decision about where suppression state lives. Not L: no new
subsystem, no phased migration, no change to any existing run's outcome — exhaustion still ends in
the same wait it does today.
