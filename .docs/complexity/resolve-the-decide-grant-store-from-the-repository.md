# Complexity: Resolve the decide-grant store from the repository root

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one CLI dispatch function, a strict variant of an existing root resolver, the single caller that already carries a duplicate of that probe, and one exported path helper shared by the writer and the reader. It introduces no new command, flag, schema, artifact, store, event, metric, or telemetry channel, and it does not change the grant format, its scoping, its single-use consumption, or the entry policy that decides whether a grant applies. Four production files change, all inside the existing engine; the only new files are tests. Small-tier architecture, conflict-check, and coherence artifacts are not required.
