# Architecture Review: Operators cannot attach their own metadata to exported telemetry (#2056)

**Date:** 2026-09-09
**Mode:** lightweight (Medium tier, technical track) — Sections 2 and 4, wiring surface, risks, ADR reuse check
**Stories reviewed:** none yet (pre-stories review); input is `.docs/track/operators-cannot-attach-their-own-metadata-to-expo.md` and `.docs/architecture/operators-cannot-attach-their-own-metadata-to-expo.md`
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding | Confidence |
|---|---|---|
| Stack compatibility | No new dependency. `resourceFromAttributes` (`@opentelemetry/resources`) accepts arbitrary string-keyed attributes; `MetricsRecorder.withIdentity` already spreads an attribute record onto every point. | 100% verified (`resource.ts`, `metrics.ts` `withIdentity`) |
| Prerequisites | `CONFIG_CONSUMER_KEY_SETS.otel` (`src/conductor/src/engine/config.ts`) is an allowlist of accepted `otel:` keys; `attributes` must be added or the loader treats it as unknown. `OtelConfig` in `types/config.ts` gains the optional field. | 100% verified |
| Integration surface | One subsystem (`engine/otel/`) plus the config type/allowlist and `docs/reference/configuration.md`. Three construction sites read the same resolved map: `wireDaemonOtel`, `wireInteractiveOtelMetrics` (both `wire.ts`), `OtelVisualizer.initializeProviders`. | 100% verified |
| Data implications | None. No schema, no persisted state, no migration. `ResolvedOtelConfig` gains an optional field on both enabled variants. | verified |
| Performance risk | None on the bus. Validation runs once at config resolution; injection is a spread at existing seams (Decision 4's bounded in-memory work). | verified |
| Worktree isolation | Unchanged. The map is read from the project's own `.ai-conductor/config.yml`; two worktrees of one project export identical static values, which is the intended semantics. | verified |

**Verified claim about backend cost.** Datadog custom-metric billing counts unique `metric name × tag values` (docs: account_management/billing/custom_metrics). A value that is constant for a worker process adds one label to every existing series and creates no new combination, so the series count is unchanged; only a value that varies within a process would multiply it. Datadog maps only semantic-convention Resource attributes to metric tags by default (docs: opentelemetry/mapping/semantic_mapping, `metrics::resource_attributes_as_tags`). Both facts are load-bearing for D13 and were read from the vendor documentation on 2026-09-09.

**Verified local precedent (bounded pattern basis).** `otel.project_name` / `otel.worker_name` (adr-014 amendments 2026-08-27 and #1937 D8) are the exemplar for an existing-block `otel:` key: resolved and trimmed once in `resolveOtelConfig`, carried on `ResolvedOtelConfig`, and threaded to the same three construction sites. Traits to preserve: single resolution path, no new block, never disables the exporter on a soft value. Allowed variation: `attributes` validates entries and drops invalid ones with a warning, where `project_name` merely falls back. Rediscovery hints: `resolveOtelConfig` in `engine/otel/otel-config.ts`, `projectNameOverride` in `otel-visualizer.ts`, `resolved.projectName` in `wire.ts`.

## Alignment

- **Governing ADR:** adr-014 (`adr-014-otel-observability-exporter`) governs every structural question here — the `otel:` config surface (Decision 6), the signal-scoped Resource contract (2026-08-28 amendment), the worker-stable metric Resource and data-point identity seam (#1937 D8). This feature makes no new structural decision: no new boundary, component, integration seam, state model, or technology. It **extends the label contract**, which adr-014 already owns, so the decision is recorded as an amendment (D12, D13) rather than a new ADR — consistent with how every prior otel change to this contract was recorded.
- **Domain boundaries:** stays inside `engine/otel/` plus the config type. No cross-domain reads.
- **Pattern consistency:** mirrors the `project_name` existing-block-key pattern; no new structural pattern.
- **State management:** none. Invalid entries are refused at parse time (parse, don't validate); the resolved map is a plain immutable record.
- **Merge-order invariant:** `withIdentity` is `{ ...attrs, ...identityAttrs }` today — identity last. The custom map must be merged *before* both per-point attrs and identity (`{ ...custom, ...attrs, ...identityAttrs }`), and in `buildResource` before the conductor keys. D13 makes this order a contract with a proof obligation, so a custom key can never replace `project`, `worker`, `feature`, or any `service.`/`conductor.` Resource key.
- **Key rule replaces a denylist:** every conductor data-point label is a bare word; every custom key must contain a dot. That single rule makes collision with present and future bare labels (including #1940's `effort`, `provider`, `tier`, `fallback`) impossible without maintaining a list. Reserved dotted prefixes (`service.`, `conductor.`, `host.`) cover the Resource side.
- **Diagram accuracy:** `.docs/architecture/operators-cannot-attach-their-own-metadata-to-expo.md` (approved by the operator 2026-09-09) reflects this design. One correction folded into D13: the diagram's "conductor-owned keys written LAST" is the contract; today's `withIdentity` order already puts identity last, so the change is to insert the custom map first, not to reorder identity.
- **Production DI defaults:** n/a — no stores.
- **Security:** values are operator-authored config literals exported to the operator's own backend; no secrets path (the `headers` env-reference rule exists precisely because credentials never ride config literals — attributes are not credentials, and D12 forbids env references so no secret can be smuggled in by reference either).

## Wiring Surface

| New production surface | Called from |
|---|---|
| `OtelConfig.attributes?: Record<string, string>` (`types/config.ts`) | read by `resolveOtelConfig` (`engine/otel/otel-config.ts`) on every config load that has an `otel:` block |
| `'attributes'` in `CONFIG_CONSUMER_KEY_SETS.otel` (`engine/config.ts`) | consulted by the existing unknown-key check on config load |
| `ResolvedOtelConfig.attributes` + `attributeWarnings` (`otel-config.ts`) | consumed by `wireDaemonOtel`, `wireInteractiveOtelMetrics` (`wire.ts`) and the `OtelVisualizer` constructor (`otel-visualizer.ts`, beside `projectNameOverride`) |
| `ResourceContext.attributes` (`resource.ts`) | passed by all three construction sites above into `buildResource(ctx, signal)` for both signals |
| `MetricsRecorder` custom-attribute input (`metrics.ts`) | passed at construction by `wireDaemonOtel`, `wireInteractiveOtelMetrics`, and `OtelVisualizer.initializeProviders`; merged in `withIdentity` on every `record()`/`add()` |
| per-key warning for dropped entries | emitted on the existing `renderer_error` path — `createOtelVisualizer`'s `onWarning` bridge for the visualizer, the `events.emit({ type: 'renderer_error', rendererName: 'otel' })` shape already used in `wire.ts` for the meter paths |
| `otel.attributes` row + prose in `docs/reference/configuration.md` | consumer-facing reference (the `otel` section already documents every sibling key) |

**Early overlap scan.** `ai-conductor overlap-scan --files` over the eight paths above: *No overlap detected; no open blockers.* The scan sees merged/pushed work only; the known collision with #1940 (unpushed spec worktree `engineer-export-the-telemetry-dimensions-the-engine-already`, which amends adr-014 at the same insertion point with D10/D11 and widens `metrics.ts`/`MetricsListener` labels) is recorded under Conditions.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Custom key silently replaces a conductor identity or outcome attribute | Data | Low | High | D12 dot/prefix rule refuses the key at parse; D13 merge order writes conductor keys last; proof-obligation test asserts a colliding key does not replace `project` |
| Operator supplies a run-varying value through a future extension (env/template) and mints series per run | Performance | Low | High | D12 forbids every non-literal source; configuration reference documents that the bound depends on it; refusal of `{ env: }`-shaped values is a negative test |
| adr-014 amendment and `metrics.ts` widening conflict textually with #1940 on rebase | Integration | High | Low | Intake sequenced `blocked_by #1940`; D12/D13 numbered past D10/D11; the rebase is one-directional and mechanical |
| Datadog-specific cost claim drifts as vendor pricing changes | Knowledge | Low | Low | Claim is dated and cited in this review; the design's bound (one value per worker) holds independently of any vendor's pricing model |

## ADRs Created

None. adr-014 governs and is **amended** (D12: one static validated `otel.attributes` map; D13: placement on both Resources and every data point, merge-order contract, proof obligations). The amendment is additive inside `## Decision`; ids parse as 1–9, 12, 13 on this branch (10/11 arrive with #1940).

## Conditions

1. **Land after #1940.** The intake carries `blocked_by #1940`; the daemon builds this feature on a main that already has D10/D11 and #1940's `metrics.ts` labels. If #1940 is abandoned, renumber D12/D13 to D10/D11 before build — the ids are the only coupling.
2. **`CONFIG_CONSUMER_KEY_SETS.otel` gains `'attributes'`** in the same diff as the type; a config with the new key must not warn as unknown.
3. **Three proof obligations from D13 are story criteria**, not optional tests: metric Resource carries custom keys plus exactly Decision 8's conductor keys; a data point carries custom keys and a colliding key does not replace `project`; no `attributes` block ⇒ byte-identical Resources and data points.
4. **Documentation accompanies the diff, outside the plan:** `docs/reference/configuration.md` `otel` table row and prose for `otel.attributes` (rules, bound, drop-and-warn behavior, the cost reasoning in one sentence). Per the plan skill's documentation boundary this is not a plan task; BUILD delivers it alongside the config-surface change and `/finish` checks it here.
