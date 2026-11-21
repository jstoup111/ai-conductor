# Complexity: BUILD runs the configured test_suite pre-check

Tier: S

Rationale: by the conduct signal table every signal is Small — no models or tables, no external
integrations, no auth, no new state machine (one routing conjunct whose PASS is held in process memory
per HEAD), and four stories. Production changes are one small new engine module
(`src/conductor/src/engine/build-pre-check.ts`) that reuses `executeFullSuite`, one optional config key
with its type and validation (`types/config.ts`, `config.ts`), its call sites in the `build` completion
predicate (`artifacts.ts`) and the exhaustion escape and HALT reason (`conductor.ts`), one stall-breaker
exemption (`build-progress-watcher.ts`), and one retry hint (`remediation-hints.ts`). The decision is
recorded by appending D11 to the existing APPROVED `adr-2026-08-01-engine-owned-scoped-test-invocation`,
which owns the `test_suite` configuration surface and BUILD's intermediate test execution policy, so no
architecture review is needed. Per tier rules: architecture-diagram, architecture-review,
conflict-check, and coherence-check are skipped.

Delivery: operator-approved direct PR carrying these artifacts and the implementation together (not
daemon-built).
