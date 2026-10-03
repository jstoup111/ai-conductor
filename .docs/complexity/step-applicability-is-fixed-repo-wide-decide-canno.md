# Complexity: Per-feature step applicability (#1789)

Tier: M

Rationale: Cross-cutting but bounded engine change — a new per-feature marker and parser, a land-gate validation layer, a step-metadata opt-in flag, a repo config toggle, dispatch-time honoring read from the base tree, and a distinct skip event on the ConductorEvent spine. No new subsystem, no data migration; existing tier/track/config-disable paths stay unchanged when the toggle is off.
