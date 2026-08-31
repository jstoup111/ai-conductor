# Complexity: infrastructure-exits-can-masquerade-as-test-sensit

Tier: M

Rationale: Coordinated change across several existing surfaces — the counterfactual
preflight's classification type, the testQuality reviewer result contract (v3 → v4)
with engine-side validation and persistence of the new sensitivity-judgement field,
and the build-review-test-quality skill text — plus fixtures covering the #1915
infrastructure-exit shapes. One bounded seam, no new subsystem, no migration of
persisted state, so not Large; more than a single-file or prompt-only edit, so not
Small.
