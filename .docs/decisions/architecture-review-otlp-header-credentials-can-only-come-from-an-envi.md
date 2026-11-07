# Architecture Review: Shared credential-reference resolver, first consumer `otel.headers`
**Date:** 2026-10-28
**Mode:** Lightweight (Tier M) — Technical Feasibility and Architectural Alignment only
**Inputs reviewed:** `.docs/track/otlp-header-credentials-can-only-come-from-an-envi.md` (scope boundary),
`.docs/complexity/otlp-header-credentials-can-only-come-from-an-envi.md`,
`.docs/architecture/otlp-header-credentials-can-only-come-from-an-envi.md` (operator-approved 2026-10-28,
including the send-time resolution, 300-second TTL and 10-second timeout defaults)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack compatibility.** No new dependency. Command execution uses Node's `child_process.execFile`.
  The installed `@opentelemetry/otlp-exporter-base` 0.221.0 accepts `headers` as an async factory
  (`HeadersFactory = () => Promise<Record<string, string>>`, `legacy-base-configuration.d.ts`) and
  awaits it on every send (`http-exporter-transport.js`, `send()`), verified 97%.
- **Prerequisites.** None. The `otel` known-key table in `engine/config.ts` already admits `headers`;
  the nested reference keys are validated by `resolveOtelConfig`, not that table.
- **Integration surface.** Two modules: the new `engine/credentials/` and the existing `engine/otel/`
  (`otel-config.ts`, `spool-wiring.ts`, `spool-drainer.ts`, `transport.ts`), plus the `OtelConfig`
  type in `types/config.ts`. No external API beyond the configured OTLP endpoint already in use.
- **Data implications.** No persisted format changes. Spooled batches still never carry headers
  (`spool-wiring.ts` resolves references per POST today).
- **Performance.** At most one command run per header per `cache_seconds` (default 300) per process,
  with single-flight refresh; failures are not cached, but drainer backoff bounds retry frequency.
- **Worktree isolation.** No ports, databases or shared files. Each process holds its own cache.

## Alignment

- **Governing ADRs.** adr-014-otel-observability-exporter governs export; this change keeps its
  default-off gate and transports. adr-2026-07-07-daemon-owned-build-credential's `BuildAuthProvider`
  selects a build credential mode and does not resolve configured references, so there is no overlap.
  No existing ADR governs a shared credential seam, so a new one is created (below).
- **Pattern consistency.** Follows the #1939 reference-not-value contract and the
  value-or-`unavailable` result shape already used by `readGithubBotToken`
  (`engine/github-bot-credential.ts`). Config refusals keep `resolveOtelConfig`'s
  never-throw, disable-with-named-error behavior.
- **State management.** References are a discriminated union over source kinds with an exhaustive
  switch; resolve results are a two-variant union (value or `unavailable`), not nullable strings.
- **Event spine.** Failures reuse the drainer's existing deduplicated `renderer_error`
  (`rendererName: 'otel'`) and its "delivery recovered" report. No new channel, file or event type.
- **Security boundaries.** Values never enter configuration, errors, events or the spool; command
  output never appears in a reason. Commands run without a shell. `command` references are accepted
  from project config by operator decision (ADR decision 6), which departs from the machine-scoped
  precedent of `github_bot` and `spec_owner` (`engine/config.ts`, project-source refusals).
- **Test isolation.** Command execution honors `AI_CONDUCTOR_NO_REAL_EXEC`
  (`execution/real-exec-guard.ts`), and the child environment is passed through
  `scrubTmuxEnvironment` as every engine-spawned child is.
- **Diagram accuracy.** The approved component and sequence diagrams match this design.

## Focused local pattern basis

- **Role:** value-or-unavailable credential read. **Precedent:** `readGithubBotToken` /
  `GithubBotToken` in `engine/github-bot-credential.ts`. **Traits to keep:** async read at use time,
  trimmed value, a typed `unavailable` result instead of a throw, and no value in diagnostics.
  **Why it applies:** it is the harness's existing at-use-time credential read and a future adopter.
  **Allowed variation:** the resolver adds a TTL cache, single-flight refresh, and a reason naming the
  source.

## Wiring Surface

| New or changed surface | Production caller (design-time) |
|---|---|
| `engine/credentials/` parser | Called by `resolveOtelConfig` for each `otel.headers` entry, reached from `wireOtelVisualizer` (`engine/otel/wire.ts`) and the plugin loader |
| `engine/credentials/` resolver (`env`, `command` sources, cache) | Called by the otel header provider |
| otel header provider (async) | Built in `engine/otel/` from the resolved config; consumed by `createSpoolRuntime` for the drainer and by `buildExporters` / `buildHttpExporterOptions` for direct exporters |
| `SpoolDrainer` async `headers` option | Already constructed by `createSpoolRuntime` in `engine/otel/spool-wiring.ts` |
| `otel.headers.<name>.command` / `.prefix` / `.cache_seconds` config keys | Read by `resolveOtelConfig` from the merged user and project config |

Early overlap scan (`ai-conductor overlap-scan` over those paths): no unmerged dependent work found;
`engine/credentials` is reported as not yet present, as expected. Advisory only.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A committed project config makes the daemon run an arbitrary command | Security | Low | High | Operator-accepted (ADR decision 6); argv only, no shell; documented in the config reference |
| A credential value leaks through an error, event or spool file | Security | Low | High | Reasons name only the source; sentinel-value tests over every error and event path |
| A rejected headers factory escapes the direct exporter as an unhandled rejection or sends unauthenticated | Technical | Medium | Medium | Condition 1 |
| A hanging command blocks delivery | Performance | Low | Medium | 10-second timeout; failure is `unavailable`, retried on the next send |
| Concurrent sends spawn the command repeatedly at expiry | Performance | Medium | Low | Single-flight refresh; condition 2 |

## ADRs Created

- `adr-2026-10-28-shared-credential-reference-resolver` — the shared resolver seam, its two sources,
  caching, the `otel.headers` consumer, failure reporting, the project-config trust decision, and
  the non-migration of other consumers.

## Conditions

1. A test proves that when a header cannot be resolved, the direct OTLP/HTTP exporter sends no request
   and reports a failed export result, with no unhandled rejection (ADR assumption A2).
2. A test proves that concurrent `resolve()` calls during one expired-cache refresh run the command
   exactly once.
3. Every header-related error and `renderer_error` produced by the new form is tested against a
   sentinel value and never contains it, nor the command's stdout or stderr.
