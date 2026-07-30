# Architecture Review: Deterministic test-suite step

**Date:** 2026-07-29
**Tier:** Medium (lightweight review)
**Technical intent reviewed:** Remove the test-suite skill surface; run wiring and aggregate verification concurrently before model review.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack compatibility:** Feasible in the existing TypeScript engine without a package, service, schema, or external integration.
- **Prerequisites:** The approved concurrent-group core, native wiring probe, `FullSuiteVerifier`, and standalone `conduct-ts test-suite` adapter already exist.
- **Integration surface:** Step topology, group membership, conductor join/routing, completion predicates, skill installation/migration, provider metadata, lifecycle guidance, tests, and canonical documentation.
- **Data implications:** No application data. Existing gitignored wiring and suite evidence remain branch-owned; conductor state remains join-owned.
- **Performance:** Successful deterministic latency becomes approximately the slower branch. `build_review` begins later than today but is never paid for when a deterministic branch fails.
- **Worktree isolation:** Both branches operate inside the feature worktree. The suite retains its existing process-tree cleanup and lock; the wiring probe has no shared port, database, or queue.

## Alignment

- Reuses `adr-2026-07-10-concurrent-group-core`; a new parallel executor would violate the one-core decision.
- Preserves `adr-2026-07-10-validation-group-join`: the SHIP validation group remains unchanged and downstream. The new group is a separate BUILD group with deterministic-only membership.
- Amends `adr-2026-07-12-wiring-check-gate` and `adr-2026-07-25-content-addressed-full-suite-proof` only where they require serial ordering and a direct test-suite skill.
- Preserves the full-suite proof's configuration, fingerprint, redaction, locking, timeout, execution, evidence, and finish/CI boundaries.
- Provider parity is structural: the engine group is provider-neutral and the retained standalone adapter is the same command for every host.
- The approved component and sequence diagrams show the fan-out, final join, deferred model review, and removal of the skill actor.

## Wiring Surface

- **Deterministic BUILD group definition** — registered in `steps.ts` with members `wiring_check` and `test_suite`; entered after `build` and joined before `build_review`.
- **Native group branch adapter** — invoked by the conductor's group core to call the existing wiring and full-suite engine functions without `StepRunner` or skill rendering.
- **Joined deterministic kickback** — consumed by the existing BUILD rewind and per-gate budget machinery, carrying evidence from every failed member.
- **Standalone aggregate adapter** — `conduct-ts test-suite` remains wired into the CLI command table and `FullSuiteVerifier`.
- **Interactive conduct guidance** — invokes the deterministic adapter directly and never suggests a `test-suite` skill for either supported host.
- **Skill migration** — release migration removes only obsolete installed `test-suite` catalog links for both supported hosts.
- **Status/events** — existing per-step events remain attributable; group start/completion/failure events identify both deterministic members and the joined disposition.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| Dual failures consume the wrong budgets or trigger two BUILD rewinds. | Integration | Medium | High | One join-owned rewind; charge each failing gate exactly once; acceptance coverage for both-fail ordering. |
| Interruption loses a completed branch or falsely marks an incomplete branch green. | Data | Low | High | Reuse the concurrent core's pending-completion side channel; final predicates remain authoritative. |
| Aggregate execution competes with wiring analysis and increases suite duration. | Performance | Low | Medium | Respect `validation_concurrency`; cap one degrades deterministically to wiring then suite; measure rather than add speculative tuning. |
| Removed skill remains installed as a dangling or discoverable link. | Integration | Medium | Medium | Runnable migration removes the exact links; install/update tests cover both host catalogs. |
| Interactive guidance loses a supported-host path. | Integration | Low | High | Retain and test the provider-neutral deterministic CLI adapter; update provider contract tests.

## ADRs Created

- `adr-2026-07-29-deterministic-build-verification-fanout` — **APPROVED** by the operator on 2026-07-29.

## Conditions

1. The concurrent group core is reused; no parallel executor is duplicated.
2. No model dispatch occurs before both deterministic gates are passing.
3. The obsolete installed skill links receive a real migration, not a waiver.
4. The implementation preserves all existing verifier proof and failure semantics not explicitly superseded by the ADR.

## Blocking Issues

None.
