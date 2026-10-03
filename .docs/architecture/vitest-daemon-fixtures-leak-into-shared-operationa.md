# Components: Test-run isolation from operator OTel export

**Last updated:** 2026-10-03
**Scope:** How an ordinary Vitest run (unit, integration, acceptance, e2e) is kept away from the
operator's user-level config and from any shared OTLP backend. It covers two seams: the user-config
location (`src/engine/user-config.ts`) and the single OTLP exporter construction point
(`buildExporters` in `src/engine/otel/transport.ts`). Real daemon export is unchanged.

## Diagram

```mermaid
graph TD
    subgraph run["Vitest run (default, e2e, smoke configs)"]
        setup["test/setup.ts (CHANGED)<br/>sets AI_CONDUCTOR_NO_REAL_EXEC=1 (existing)<br/>NEW: AI_CONDUCTOR_USER_CONFIG_DIR → empty run-scoped tmpdir"]
        fixture["Daemon / conductor fixtures<br/>mkdtemp project roots"]
        smoke["Opt-in smoke test<br/>sets AI_CONDUCTOR_OTEL_SMOKE=1 explicitly"]
    end

    subgraph cfg["Config resolution (existing, CHANGED seam)"]
        ucp["userConfigPath() (CHANGED)<br/>AI_CONDUCTOR_USER_CONFIG_DIR override,<br/>else ~/.ai-conductor/config.yml"]
        merged["loadMergedConfig / loadMergedConfigForRead<br/>user layer under project layer"]
        resolve["resolveOtelConfig (unchanged, pure)"]
    end

    subgraph otel["OTel wiring (existing)"]
        wire["wireDaemonOtel / wireInteractiveOtelMetrics /<br/>wireOtelVisualizer"]
        refusal["export-refusal.ts (NEW)<br/>otlpExportRefusal(env): pure decision,<br/>importable by a future spool drainer"]
        build["buildExporters(config, env) (CHANGED)<br/>otlp + NO_REAL_EXEC + no smoke opt-in → refused result,<br/>no OTLP exporter constructed"]
        file["file exporter<br/>.pipeline/otel.jsonl (still allowed under test)"]
        spine["ConductorEventEmitter<br/>existing renderer_error event names the refusal"]
    end

    shared[("Shared OTLP backend<br/>(Grafana LGTM / collector)")]
    home[["Operator ~/.ai-conductor/config.yml<br/>(otel: otlp, llm_provider, spec_owner, …)"]]

    setup --> fixture
    fixture --> merged
    merged --> ucp
    ucp -. "under test: never read" .-> home
    merged --> resolve --> wire --> build
    build --> refusal
    build -- "exporter: file" --> file
    build -- "otlp under test, refused" --> spine
    build -- "otlp, real daemon OR smoke opt-in" --> shared
    smoke --> build
```

## Legend

- **CHANGED**: an existing component whose behavior changes in this feature. Everything else exists
  and is unchanged.
- Dotted edge: the path the feature severs. Under test, the operator's user config is never read.
- `AI_CONDUCTOR_NO_REAL_EXEC=1` is the suite's existing kill-switch marker (`test/setup.ts`; it is
  consumed by `daemon-tmux.ts` and `ci-fix.ts`). It is reused here as the "under test" signal rather
  than adding a parallel marker.
- `AI_CONDUCTOR_OTEL_SMOKE=1` is the explicit opt-in. Only tests under the smoke tier, which is
  excluded from default verification, may set it.
- The refusal is reported through the existing `renderer_error` event on the spine. No new channel
  is added.
- Wiring entry points accept an optional `env` (default `process.env`) so a test can drive a real
  exporter against a loopback receiver it owns without mutating the process environment.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-03 | Initial generation | #2471: Vitest daemon fixtures leak into shared OTel metrics |
| 2026-10-03 | Plan update: added the `export-refusal.ts` decision module and the injectable `env` on `buildExporters` and the wiring contexts | `/plan` for #2471; conflict-check resolution option 1 |
