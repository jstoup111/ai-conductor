# Architecture Review: Daemon merged configuration (#967)

**Date:** 2026-07-26
**Tier:** Medium (lightweight review)
**Technical intent reviewed:** issue #967 and `.docs/track/daemon-merged-config-967.md`
**Verdict:** APPROVED

## Feasibility

The correction is feasible with the existing TypeScript configuration boundary and requires no new package, service, schema, persistent state, or shared worktree resource.

- **Verified composition root:** `runDaemonMode` currently calls project-only `loadConfig`, then passes that result to provider validation, provider selection, provider runtimes, step resolution, memory-provider resolution, backlog policy, and each constructed `Conductor`.
- **Verified merge contract:** `loadMergedConfig` first validates raw project configuration, reads user configuration, deep-merges project over user, and validates the effective result. Objects merge key-by-key; project scalars and arrays replace user values.
- **Verified entry-path convergence:** direct `conduct daemon` constructs options and calls `runDaemonMode`; `daemon start` supervises that same daemon command. Restart and self-respawn return through the same runtime entry. No parallel daemon runtime config composition exists.
- **Source-boundary exclusions:** daemon status/logs/park/unpark and supervisor lifecycle management do not construct LLM runtime policy. `FullSuiteVerifier.resolveInspection` intentionally reloads the project-owned `test_suite` declaration for content evidence and is not a daemon composition root. Machine identity keeps its dedicated user-only anti-leak resolver.
- **Backward compatibility:** a missing user file contributes `{}`; project-only configurations therefore preserve their effective values. With neither scope selecting a provider, the existing provider normalization default remains unchanged.
- **Worktree isolation:** the change reads existing configuration files only and introduces no ports, databases, queues, locks, or cross-worktree files.

## Alignment

The design reuses the established `loadMergedConfig` boundary rather than creating daemon-specific merge semantics. It preserves the approved project-over-user provider policy and the machine-identity anti-leak decision. Provider, model, effort, retry/session, auth, permission, memory, and plugin selection remain aligned because one validated effective `HarnessConfig` is threaded through the existing daemon runtime.

No architecture diagram changes are required: no container, component, external integration, data relationship, or request flow changes. No new ADR is required because this applies an existing precedence decision at an omitted composition root rather than introducing a new cross-cutting strategy.

## Wiring Surface

- **Merged daemon runtime configuration** — the existing `loadMergedConfig` result is consumed by `src/conductor/src/daemon-cli.ts#runDaemonMode` before plugin discovery, provider validation/selection, backlog construction, and conductor creation.
- **Startup diagnostics** — configuration failure from either scope is surfaced by the existing daemon startup error path in `src/conductor/src/daemon-cli.ts#runDaemonMode`; the loader's scope-qualified user parse error remains intact.
- **Supervised and bare daemon launches** — both continue to enter through `src/conductor/src/index.ts#main` and the existing `runDaemonMode` call; no supervisor-only configuration reader is introduced.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| A user setting unexpectedly begins affecting daemon behavior after previously being ignored. | Compatibility | Medium | Medium | This is the intended repair; project configuration remains the explicit override and project-only behavior gets regression coverage. |
| A malformed user file blocks daemon startup. | Integration | Low | Medium | Preserve fail-closed effective-config validation and emit an actionable error naming user scope; do not silently discard operator policy. |
| A broad loader replacement leaks machine identity or changes project-owned evidence. | Security | Low | High | Limit the production change to `runDaemonMode`; retain dedicated identity and project-only full-suite paths. |
| Merge semantics drift between daemon and other merged-config consumers. | Technical | Low | Medium | Reuse `loadMergedConfig` directly and assert effective config at the daemon boundary rather than reimplementing merge logic. |

## ADRs Created

None. Existing merged-config and provider-precedence decisions already govern the choice.

## Conditions

None.

## Blocking Issues

None. All load-bearing precedence, entry-path, source-boundary, and failure-mode claims were verified against current source and tests.
