# Complexity: whole-feature simplify floor before build_review

Tier: S

Rationale: by the conduct signal table every signal is Small — no models or tables, no external
integrations, no auth, no new state machine (one routing conjunct over a file the build already writes
under `.pipeline/audit-trail/`), and three stories. Production changes are one small new engine module
(`src/conductor/src/engine/feature-simplify.ts`), its call sites in the `build` completion predicate
(`artifacts.ts`) and the exhaustion escape (`conductor.ts`), one stall-breaker exemption
(`build-progress-watcher.ts`), one retry hint (`remediation-hints.ts`), and the `simplify`/`tdd` skill
text. The decision is recorded by appending D9 to the existing APPROVED
`adr-2026-08-03-uncommitted-work-floor-under-build-completion`, which already owns the two-door
routing-floor rule, so no architecture review is needed. Per tier rules: architecture-diagram,
architecture-review, conflict-check, and coherence-check are skipped.

Delivery: operator-approved direct PR carrying these artifacts and the implementation together (not
daemon-built).
