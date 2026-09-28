# Architecture Review: Pi as a build provider
**Date:** 2026-09-24
**Stories reviewed:** none yet (pre-stories full pass; input is the explore decision, the track scope boundary, and `.docs/architecture/pi-as-a-build-provider.md`)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack compatibility:** No new npm dependency. Pi is an external CLI, installed by the operator and probed at boot.
- **Prerequisites:** None for the default suite. The live smoke leg needs a Pi install and credentials, and is opt-in.
- **Integration surface:** Wide but shallow. About 60 production sites across `engine/` and `execution/` take a descriptor lookup instead of a literal. The boot sequence changes at two entry points, daemon `runDaemonMode` and CLI `registerCliBuiltins`.
- **Data implications:** None. There is no persisted schema change. One new `ConductorEvent` variant is added for the discovery result.
- **Performance:** Boot adds one `--version` exec per catalog descriptor (3), run concurrently with a bounded timeout. There is no per-dispatch cost.
- **Worktree isolation:** No ports or shared state. The probe is read-only.

## Complexity

High by breadth, Low by novelty. The refactor is mechanical, and the only novel component is the Pi JSONL parser and classifier. It does not need splitting: the catalog and the Pi adapter must land together for Pi to be selectable, and the catalog without a third provider has no forcing test.

## Alignment

- No APPROVED ADR conflicts. The sweep read titles for all 605 decision files and the Decision sections of every provider-related ADR. The reused ADRs are listed in the new ADR's Context.
- Boot fail-fast differs from the park-and-wait gates (gh floor, missing credentials). The operator chose it, and the ADR's D4 records the rationale: static misconfiguration is not transient.
- The design honors the ci-fix 2026-09-11 amendment: the probe is catalog-driven, not a Claude-only veto.
- It extends the event spine (one event variant) rather than adding a side log.
- **Focused local pattern basis.**
  - The `execution/codex-provider.ts` classifier is the precedent for the Pi adapter, `classifyProviderFailure`-style ordering in particular. Traits to preserve: ENOENT/127 maps to run-scope unavailable; regexes are anchored; auth is checked before model availability.
  - The gh version floor is the precedent for the probe runner: an injected runner guarded by `assertRealExecAllowed`, rediscoverable via `probeGhVersion`.
  - Allowed variation: Pi's stderr text signatures.

## Domain Integrity

- Provider ids become a derived literal type instead of `string` or ad-hoc unions: no primitive obsession.
- Capabilities are explicit fail-closed booleans on the descriptor. Consumers receive `ProviderWith<cap>`, so the invalid state "unsupported provider reaches a provider-specific branch" cannot be represented.
- Discovery reasons are a closed enum (`not-found | not-executable | version-failed | timeout`), matched exhaustively.

## Wiring Surface

- `execution/provider-catalog.ts` (`BUILT_IN_PROVIDERS`, `BuiltInProviderId`, `DEFAULT_PROVIDER`, `ProviderWith`). Read by `plugin-loader.ts` `registerBuiltins`, `cli-builtins.ts`, `provider-selection.ts`, `provider-model-policy.ts`, `provider-runtime.ts`, `child-environment.ts`, `step-runners.ts`, `conductor.ts`, `self-host/*`, `build-review-*`, `live-e2e-providers.ts`, and `skill-invocation.ts`.
- `engine/provider-discovery.ts` `discoverInstalledProviders`. Called from `daemon-cli.ts` `runDaemonMode` before `registerBuiltins`, and from `index.ts` before `registerCliBuiltins`.
- Distinct not-installed startup error. Raised from the same validation point as `validateRegisteredProviderSelections`, in both boot paths.
- Provider-discovery `ConductorEvent` variant. Emitted through `ConductorEventEmitter` at boot and persisted by `EventPersister`.
- `execution/pi-provider.ts` `PiProvider`. Constructed by the catalog descriptor factory and registered by `registerBuiltins` when discovery reports Pi installed.
- New config values: `llm_provider: pi` (run, step, and ladder). New env overrides: `PI_EXECUTABLE` and `CLAUDE_EXECUTABLE`.
- A live smoke leg for Pi, keyed from `live-e2e-providers.ts`.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Refactor misses a site and a provider falls into another's branch | Technical | Medium | High | Structural test bans id literals outside catalog and adapters (D1); capability narrowing makes the compiler flag misuse |
| Behavior change for claude/codex during refactor | Technical | Medium | High | Descriptor declares exactly today's capabilities; existing provider tests stay green unchanged |
| Pi auth and rate-limit output shapes unverified | Knowledge | High | Medium | D5: unconfirmed signatures stay unclassified step failures until confirmed against real output |
| Boot probe shells out under test | Technical | Medium | Medium | Injected runner plus `assertRealExecAllowed` (adr-2026-09-05 precedent) |
| Existing installs whose config lists an absent provider stop booting | Integration | Medium | Medium | Operator-accepted as a bug fix; actionable error names the provider and path; release note Fixed |
| Pi exit and JSONL contract drifts across Pi versions | Integration | Medium | Medium | Fake built from observed 0.84.3 output; live smoke leg catches drift |

## ADRs Created

- adr-2026-09-24-built-in-provider-catalog-and-boot-discovery (APPROVED by James Stoup, 2026-09-24)

## Conditions

1. The id-literal structural test (ADR D1) lands in the same feature as the catalog.
2. Pi's auth and rate-limit signatures are anchored only after confirmation against real Pi output. Otherwise those cases remain unclassified step failures (ADR D5).
3. The live-coverage test enumerates the full catalog, not the discovered set (ADR D7).
4. The docs update covers `docs/guides/multiprovider.md`: its "Exactly two hosts" statement, the executable table, the fail-at-dispatch statement, and the new not-installed boot error.
