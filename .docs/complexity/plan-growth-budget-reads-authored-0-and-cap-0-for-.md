# Complexity: Plan-growth budget resolves daemon feature plans

Tier: S

Rationale: One subsystem — plan-growth accounting in the kickback ledger. The change routes an existing derivation through an existing resolver (`selectFeaturePlan`), extracts one shared budget function from four duplicated inline computations, and adjusts two operator renderings. No new component, state file, event, schema, config key, or CLI flag; the cap formula and fail-closed behavior are unchanged. All behavior is unit-testable at the ledger and CLI layers, with one conductor-run test for the engine boundary.
