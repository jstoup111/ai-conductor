# Architecture Review: Newer-engine child events vanish from OTel when the supervisor predates them (#3646)
**Date:** 2026-11-07
**Inputs reviewed:** explore output and track (`.docs/track/newer-engine-child-events-vanish-from-otel-when-th.md`). Its scope boundary is full span and metric parity with the in-process executor at any version skew, with child-local types excluded and #3360 excluded. Also: the approved diagram `.docs/architecture/newer-engine-child-events-vanish-from-otel-when-th.md`, ADR-014, adr-2026-10-15 D4 and D7, and the code on #3333's branch (`.worktrees/daemon-still-carries-two-feature-executors-in-proc`).
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Intent | Assessment |
|---|---|
| Spans for every type the child declares | Feasible (95%, verified). `wireOtelVisualizer` already takes an injected spool runtime (`engine/otel/wire.ts`). `createSpoolRuntime` builds store, lease and drainer separately (`engine/otel/spool-wiring.ts`), so a store-only runtime is a narrow construction. The spool is multi-writer by design (ADR-014 D15). The child loads merged config (`executor-child-runtime.ts` `loadMergedConfig`). Containment wraps only provider invocations (`engine/conductor.ts` `wrapForContainment`), and `.daemon/` is in `LIVE_CHECKOUT_VOLATILE` regardless. |
| Metrics for every type the child declares | Feasible (90%, verified). `MetricsRecorder` takes an OTel `Meter` and only calls `createHistogram` (with `advice`), `createCounter` and `createGauge` (`engine/otel/metrics.ts` `createInstruments`), so a synchronous proxy `Meter` covers it. `@opentelemetry/sdk-metrics` 2.10.0 `MetricStorageRegistry._findOrUpdateCompatibleStorage` reuses compatible storage for a same-name instrument, so child-projected and supervisor-owned points share one stream. |
| No double counting, older-pair compatibility | Feasible. `hello` and the work-order envelope already carry additive optional fields (`effectiveConcurrency` precedent in `executor-child.ts`). The run-close dedupe (`MetricsListener.terminal`) is kept by decision 7 of the new ADR. |
| Child-local types stay out | Already true. Each projection subscribes only to its own registry's `otel: true` rows. The child's registry is the authority. |
| #3333 dispatch-trace identity | Feasible. The identity fields `attachChildFeatureOtelVisualizer` builds today (`daemon-cli.ts` on #3333's branch: session id, harness version, `sourceRef`, branch) travel with the acceptance. The engine version is the child's own pin. |

Prerequisites: #3333 must merge first. It rewrites `ExecutorBrokerDeps.attachFeatureOtelVisualizer`, `attach`'s identity parameter, the async `close`, and `attachChildFeatureOtelVisualizer`, which are the exact seams this spec changes. No new packages, migrations or infrastructure are needed. The advisory `overlap-scan` reported no overlap. It does not see #3333's unmerged build branch, whose diff was inspected directly.

## Complexity

High: two OTel projections move across the executor process boundary. Mixed-version pairs need negotiation, and the run-close bookkeeping must work across processes. There are no external APIs and no persistence changes. The estimate is ~14–18 plan tasks, under the 20-task split threshold (§3a), so there is no split.

## Alignment

- **adr-2026-10-15 D4** decided that unknown variants are silently kept in the child ledger and that the OTel visualizer stays on the supervisor's proxy bus. That decision is the cause of #3646. It is amended (2026-11-07 note) to defer to the new ADR when projection is negotiated. The spine treatment of unknown types (not rendered, not persisted by the supervisor) is unchanged.
- **ADR-014 D7** (one dispatcher-side meter, fed by events) is preserved. The provider stays single and long-lived. Only which process runs the event-to-measurement projection changes, and it is amended to say so. D8's identity is preserved, because the host stamps `project`, `worker` and `feature`. D4 (synchronous, O(1) handlers) is preserved, because `meter` messages are fire-and-forget. D15 and D16 (multi-writer spool, single drainer) are preserved: the child holds no lease.
- **Event spine:** the brokered meter is a coordination service against a dispatcher-owned provider, the same class as D4's rate-limit and availability services. It carries projections, not occurrences, and every occurrence stays on the spine. It adds no variant, ledger or sidecar. It is compliant under exception A.
- **Layering:** all new code is in `engine/` and `engine/otel/`. The entry layer (`daemon-cli.ts`) only composes it.
- **Focused local pattern basis (brokered state service):** the child-side replica plus supervisor-side authority pattern of `withExecutorBrokerProxies` / `createExecutorBroker` for rate-limit and provider availability. The traits to preserve: the supervisor is authoritative, the child-side calls keep their synchronous signatures, and the messages are typed and parsed by `parseExecutorMessage`. Allowed variation: meter messages are fire-and-forget with no response. Hints: `engine/executor-proxies.ts`, `engine/executor-broker.ts` `request`, `engine/executor-protocol.ts` `parseExecutorMessage`.

## Domain Integrity

- Projection ownership is a closed two-state value per attachment (`supervisor` | `child`), not a boolean pair. The child cannot project unless it has been accepted.
- The instrument kind is a closed union (`counter` | `upDownCounter` | `histogram` | `gauge`), matched exhaustively in the host. An observable kind is refused at creation, never ignored.
- `meter` messages are parsed at the protocol boundary like every other message. A malformed one is logged and dropped as today, and never recorded.

## Wiring Surface

| New surface | Production caller |
|---|---|
| `hello.otelProjection` capability | Sent by `runExecutorChild` (`engine/executor-child.ts`), read in `createExecutorBroker` `attach` |
| Work-order envelope acceptance plus trace identity | Built by the supervisor's child executor when it sends the work order (`engine/child-feature-executor.ts` / broker), consumed by `runExecutorChild` |
| Store-only spool runtime constructor | Called by the child's OTel wiring in `runExecutorChild` |
| Child OTel wiring (visualizer + `MetricsListener` over the proxy `Meter`) | Started by `runExecutorChild` after acceptance, stopped before `sendOutcome` |
| Proxy `Meter` (child) | Passed to `MetricsRecorder` by the child OTel wiring |
| `meter` executor message kind | Parsed by `parseExecutorMessage`, handled in the broker `onMessage` |
| Brokered instrument host (supervisor) | Constructed in `wireDaemonOtel` over the existing provider's `Meter`, and passed to `createExecutorBroker` by `daemon-cli.ts` |
| Root-bus listener skip plus terminal bookkeeping for accepted children | `MetricsListener` started by `wireDaemonOtel`, with the accepted-child set supplied by the broker |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Double-counted runs or steps when both processes project one dispatch | Data | Medium | High | Decision 1 (one projector per dispatch), decision 7 (skip plus terminal bookkeeping); tests for capable, older-child and older-supervisor pairs |
| A child that hangs past the teardown timeout or is OOM-killed loses its open root and step spans | Data | Low | Medium | Accepted (A3); the stop runs on every outcome path, and the child's SIGTERM handler flushes and exports `terminated` before the SIGKILL escalation |
| A newer engine changes an instrument's kind or unit, creating an incompatible duplicate stream | Data | Low | Medium | The SDK warns and keeps separate storage. Instrument descriptors are pinned by the existing metrics tests |
| A future engine adds an observable instrument | Technical | Low | Medium | The proxy throws at creation, so that engine's own tests fail before release |
| #3333 lands with a different broker or visualizer seam shape | Integration | Medium | Medium | Blocked by #3333; the plan cites the seams by symbol, not line |
| A supervisor older than this change runs a capable child | Integration | High | Low | No acceptance, so behavior is unchanged; the gap closes once that supervisor restarts onto this release |

## ADRs Created

- `adr-2026-11-07-child-projected-dispatch-otel`: APPROVED by operator 2026-11-07, including assumptions A2 and A3.
- Amended (2026-11-07 notes): `adr-2026-10-15-per-dispatch-engine-pinned-executor` D4, `adr-014-otel-observability-exporter` D7.

## Conditions

1. The spec is blocked by #3333, and the plan builds on #3333's merged broker and visualizer seams.
2. The stories prove parity with a skewed pair: a child whose registry declares an OTel type that the supervisor's registry lacks gets that type's span and metric exported.
3. The stories prove no double counting for every pairing: capable with capable, older child with newer supervisor, and newer child with older supervisor.
