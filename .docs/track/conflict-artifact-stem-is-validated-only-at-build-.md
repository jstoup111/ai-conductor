# Track: conflict-artifact-stem-is-validated-only-at-build-

Track: technical

Scope boundary: Validate ALL feature-scoped artifact stems (specs, stories, conflicts, plans, coherence) at engineer-land time via the real STEP_ARTIFACT_CONTRACTS identity matching, and extend the resolver diagnostic to name the naming rule + expected filename. Excludes: skill-side filename derivation as the enforcement mechanism, commit-hook validators, corpus audit of already-merged artifacts.

Engine gate + diagnostic improvement; no user-facing product behavior — approach A (land gate resolves through the real artifact contracts) selected over skill-side derivation (prompt discipline) and commit hooks (duplicate logic, weak context).
