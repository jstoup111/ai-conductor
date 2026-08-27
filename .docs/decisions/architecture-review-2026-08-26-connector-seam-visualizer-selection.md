# Architecture Review: Connector Seam — Visualizer Selection Loop (#1516)
**Date:** 2026-08-26
**Stories reviewed:** none yet (pre-stories DECIDE review, technical track, tier M — lightweight mode)
**Verdict:** APPROVED

Scope boundary (binding, from `.docs/track/connector-seam-for-event-submissions-is-registered.md`):
comprehensive — registry retrieval, error isolation, identity context, config enablement, OTel on
the seam, load-time shape validation, sink-registry divergence documented, docs page. Excludes
`step`/`hook` kinds (#1931), full sink-declaration redesign, durable-telemetry store.

## Feasibility

- **Stack compatibility** — no new dependencies; all changes are internal TypeScript in
  `src/conductor/src` (verified: registry, loader, index.ts wiring, OTel visualizer all exist).
- **Prerequisites** — none external. `registerBuiltins` (`plugin-loader.ts:135-170`) is the
  established site for a `visualizer:otel` built-in; `tryGet` (`plugin-registry.ts:67`) supports
  warn-and-skip resolution pre-initialization.
- **Integration surface** — plugin loader/registry, `index.ts` run-loop wiring, OTel visualizer,
  `types/plugin.ts`, `types/config.ts`, docs. No event-emission sites change (preserves ADR-014
  FR-1 additivity).
- **Interface change risk** — `start(emitter)` → `start(emitter, context)` touches
  `VisualizerPlugin`, OtelVisualizer, and the visualizer test files. Verified claim (95%,
  verified): no third-party visualizer plugin can exist in the wild, because the kind was never
  retrievable — the signature change is breaking on paper only. Context fields are all already
  computed in `main()` for the OTel constructor path (`index.ts:285-299`), so no new derivation
  is needed; `engineVersion` and `branch` are additions — engine version is available from the
  package/dist metadata, branch from the run's git context (inferred, 85%; if branch is not
  already in scope at wiring time, derive once via the existing git helpers — impact if wrong:
  one extra lookup, no design change).
- **Data implications / performance** — none. Selection runs once at startup; submission path is
  unchanged (`emitter.on`, errors already swallowed by `emit()` at `ui/events.ts:36-43`).
- **Worktree isolation** — no new ports, DBs, services, or shared state; per-worktree
  `.pipeline/` unchanged.

## Alignment

- **ADR-014** governs the structural decision (listener internals, visualizer packaging, selection
  loop). This work is its undelivered decision 3; landed as an additive amendment (2026-08-26)
  rather than a new ADR, per operator direction. No supersession.
- **ADR-002** — built-ins register through the same loader; moving OTel from a hard-wired
  construction to `registerBuiltins` restores ADR-002's stated principle ("index.ts consults the
  registry").
- **ADR-003** — the error-isolation rule (a failing renderer never poisons the others; error event
  emitted) is applied verbatim to visualizer start.
- **Memory-provider ADRs (2026-06-29)** — named-but-missing → warn once + skip mirrors
  `resolveMemoryProvider` (`config.ts:2494-2517`).
- **adr-2026-07-26-event-sink-registry-exhaustiveness** — visualizers self-select event types via
  `emitter.on`; no connector column is added to `EVENT_SINKS`. This divergence is deliberate and
  documented in the architecture diagram legend and the decision memory (Approach B rejected).
- **State management / domain integrity** — no new persistent state; enablement is config-derived
  at startup. `ResolvedOtelConfig`'s discriminated-union pattern is the local precedent for any
  new resolution type. Pattern basis: the `ui_renderer` selection (`index.ts` around the
  `registry.get<UISubscriber>` call) is the exemplar for the selection loop — preserve
  config-name → registry lookup → start ordering; variation allowed: multiple visualizers run
  concurrently (list, not single selection). Rediscovery seeds: `registry.get`,
  `buildVisualizers`, `resolveOtelConfig` symbols in `src/conductor/src/index.ts`.
- **Production DI defaults** — n/a; no stores.
- **Security** — no new inputs beyond config names; unknown names are skipped with a warning,
  unknown shapes refused at load.

## Wiring Surface

| New production surface | Called from (design-time commitment) |
|---|---|
| Visualizer selection loop (resolve enabled connectors) | `main()` in `src/conductor/src/index.ts`, replacing the hard-wired OTel-only block (~`index.ts:1279-1296`) |
| `visualizers` config key | Read by the selection loop via the loaded `HarnessConfig` (`types/config.ts`); documented in `docs/reference/configuration.md` |
| `visualizer:otel` built-in registration | `registerBuiltins` (`plugin-loader.ts`), invoked via `registerCliBuiltins` (`cli-builtins.ts`) on every CLI/daemon startup |
| `start(emitter, context)` context construction | Built in `main()` from the same values currently fed to `OtelVisualizerContext` (`index.ts:285-299`) |
| Visualizer shape validation | `discoverPlugins` (`plugin-loader.ts`), same site as the existing `llm_provider` shape check (`plugin-loader.ts:30-36`) |
| Start-failure error event | Emitted by `buildVisualizers` (`index.ts:199-207`) onto the existing `ConductorEventEmitter` — rendered/persisted per the existing sink registry entry for the chosen event type |
| Docs page (visualizer/connector authoring + selection) | `docs/reference/configuration.md` (key) + a plugin-authoring reference page linked from the docs index |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Signature change misses an OTel test path, silently breaking flush-on-exit | Technical | Medium | Medium | OTel integration tests (`otel-exporter`, `otel-disabled-noop`) run unchanged; stop-path covered by existing tests |
| Start-failure error event type chosen poorly (new event vs reuse `renderer_error`) | Integration | Medium | Low | Prefer reusing the existing error event type; if a new type is added it must ride the sink registry (event-spine skill) — flagged for /plan |
| Warn-and-skip hides an operator typo in `visualizers` | Technical | Medium | Low | Warning names the missing plugin and lists registered visualizer names |
| Context field (branch/engineVersion) unavailable at wiring point | Technical | Low | Low | Fields optional-safe; derive via existing helpers once |

## ADRs Created

None. ADR-014 amended additively (2026-08-26 note under Decision 3); no structural decision is
uncovered by the existing governing set (ADR-014, ADR-002, ADR-003, memory-provider ADRs,
adr-2026-07-26-event-sink-registry-exhaustiveness). No draft-status artifacts exist.
