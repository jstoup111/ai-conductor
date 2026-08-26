# Complexity: as-built invalid-verdict halt diagnostics

Tier: S

Rationale: single-module change (`src/conductor/src/engine/artifacts.ts` classifier +
one message site) with unit-test coverage; no new models, integrations, auth, or state
machines; small story count. Conductor consumers branch on `kind` only and are untouched.
