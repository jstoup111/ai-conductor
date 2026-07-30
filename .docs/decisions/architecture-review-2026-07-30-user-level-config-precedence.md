# Architecture Review: User-level configuration precedence (#1000)

**Date:** 2026-07-30
**Tier:** Medium (lightweight review)
**Technical intent reviewed:** `.docs/track/user-level-config-for-8-keys-is-silently-discarded.md` and issue #1000
**Stories reviewed:** Not yet authored; review precedes stories on the technical track.
**Verdict:** APPROVED

## Feasibility

The correction is feasible inside the existing TypeScript configuration boundary and requires no new dependency, service, schema, persistent state, or shared worktree resource.

- **Verified mutation boundary:** `validateConfig` aliases its `raw` object and writes defaults or normalized values into that object, including nested configuration blocks.
- **Verified precedence failure:** `loadMergedConfig` obtains a project result from `loadConfig`, which currently contains materialized defaults, and deep-merges that result over user configuration before validating the effective config.
- **Verified compatibility boundary:** `loadConfig` also serves project-only runtime and evidence paths. Its ordinary resolved-default contract must remain unchanged; deferred absent-default materialization is confined to the project pre-merge pass used by `loadMergedConfig`.
- **Feasible seam:** validation can operate on a deep clone and distinguish an explicit-value project pass from the final effective-config pass. Present project values are still validated and normalized; only defaults for absent project keys are deferred until after merge.
- **Worktree isolation:** the change reads the same two configuration files and introduces no ports, databases, queues, locks, or global mutable state.

## Alignment

The design preserves the established project-over-user merge contract from the daemon merged-configuration work: explicit project scalars and arrays replace user values, while objects merge recursively. It does not change `mergeConfigs` semantics.

The project-source anti-leak guard for `spec_owner` remains fail-closed before merging. Explicit malformed project values continue through their current error or fallback behavior and therefore remain authoritative over user values; only keys absent from the project file can inherit user values.

The ordinary project-only `loadConfig` path continues to return runtime-ready defaults. The deferred-default mode is an internal pre-merge concern, not a global weakening of validation or normalization.

The focused configuration sequence diagram reflects this boundary. No container, external integration, data relationship, domain boundary, or infrastructure topology changes.

## Wiring Surface

- **Pure `validateConfig` result** — existing callers continue invoking `src/conductor/src/engine/config.ts#validateConfig`; validation returns a normalized clone and never mutates the supplied object, including nested blocks.
- **Deferred project pre-merge validation** — `src/conductor/src/engine/config.ts#loadMergedConfig` invokes project-source validation without materializing defaults for absent keys, then feeds that explicit project result into the existing `mergeConfigs` boundary.
- **Effective normalization** — `loadMergedConfig` invokes merged-source validation after project-over-user merge; that pass materializes defaults once and supplies the runtime-ready `HarnessConfig` already consumed by daemon, CLI, renderer, and provider paths.
- **Project-only compatibility** — ordinary `loadConfig` callers, including inline conductor setup and full-suite inspection, retain the current normalized-default behavior.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| Deferred defaults accidentally apply to every project-only `loadConfig` caller and disable expected guardrail defaults. | Technical | Low | High | Keep ordinary `loadConfig` normalization unchanged; engage deferred defaults only inside the pre-merge path and cover both entry paths. |
| A shallow clone leaves nested inputs mutable despite top-level immutability tests passing. | Data integrity | Medium | Medium | Use a deep clone at the validation boundary and assert nested input identity/content remains unchanged. |
| Explicit malformed project values stop overriding user values because all normalization is deferred. | Compatibility | Low | Medium | Defer only absent defaults; continue validating and normalizing every present project value before merge. |
| Future default-writing keys recreate the precedence bug outside an eight-key allowlist. | Technical | Medium | Medium | Make default materialization a validation phase property rather than maintaining a list of affected keys; add a whole-input immutability contract test. |
| Concurrent spec branches also touch the central config module. | Integration | High | Medium | Keep the implementation localized, rely on the finish-time integration gate, and resolve any actual branch conflict against the latest base. |

## Advisory Overlap Scan

The required scan reports many current and historical spec branches touching `src/conductor/src/engine/config.ts`. The issue-dependency query was indeterminate because GitHub was unreachable. This is advisory and does not change the verdict, but the central file has elevated merge-conflict likelihood.

## ADRs Created

None. This applies the existing project-over-user precedence contract and pure-function boundary within the established config component; it introduces no new decision category requiring an ADR.

## Conditions

None.

## Blocking Issues

None. All load-bearing claims were verified against the current loader, validator, consumers, tests, and configuration reference.
