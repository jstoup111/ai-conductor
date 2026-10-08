# Track: Decompose conductor.ts — target architecture, roadmap, and module-level evacuation (#1481)

Track: technical

Change class: refactor

Scope boundary: Architecture ADR recording the target shape (vertical per-step slices, convention over registration, generated hot files, keyed/append-only shared state, mechanical layer enforcement) and the ordered decomposition roadmap, with every follow-on slice filed as its own intake issue; this spec builds ONLY feature 1 — moving `engine/conductor.ts` module-level functions, types, and constants (everything outside `class Conductor`) into topical engine modules, starting with `prdAuditScopeProjection` and `remediationLapCapForGate` so `step-runners.ts` no longer value-imports the conductor module. Excluded from this build: any change inside `class Conductor` (including `run()`), the import-graph ratchet, the provider-catalog cycle, GitRunner unification, the generated step registry, and the deferred `conduct` naming contract rename. Observable behavior is unchanged.

Internal structural refactor with no user-facing behavior; the existing suite is the specification.
