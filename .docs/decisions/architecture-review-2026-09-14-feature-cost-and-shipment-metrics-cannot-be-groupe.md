# Architecture Review: feature-cost-and-shipment-metrics-cannot-be-groupe

**Date:** 2026-09-14
**Mode:** lightweight (Tier M, technical track) — Sections 2 and 4 plus Wiring Surface and Risks
**Input reviewed:** `.docs/track/feature-cost-and-shipment-metrics-cannot-be-groupe.md`,
`.docs/architecture/feature-cost-and-shipment-metrics-cannot-be-groupe.md` (approved by the
operator 2026-09-14), the repo-wide ADR sweep (585 ADRs), and the source at HEAD `97a000c17`.
**Verdict:** APPROVED WITH CONDITIONS

## Scope boundary (binding)

From the track marker: all six tierless feature metrics named by #2528, plus `conductor.run.outcomes`
because it is fed by the same `feature_dispatch_ended` event (approved with the diagram). Approach A:
an optional `tier` field on the five feature events, threaded through `MetricsListener` into
`MetricsRecorder`'s feature methods. Excluded: the generic dimension table (#2483), new span
attributes, per-member validation-group telemetry (#2414), Grafana dashboard edits, and any
listener-side inference of tier from step series.

## Feasibility

| Check | Finding | Confidence |
|---|---|---|
| Stack compatibility | No new package or service. The OTel instruments already exist; only attribute sets change. | 100% verified — `metrics.ts` instrument table |
| Prerequisites | None. `BacklogItem.tier` (`daemon.ts:58`) is already parsed from the committed marker by `daemon-backlog.ts`; `state.complexity_tier` is already populated in-run; `step_completed.tier` already exists (#1940). | 100% verified |
| Integration surface | Five files in two processes: `types/events.ts` (five shapes), `daemon-runner.ts` (three single emit sites), `conductor.ts` (one emit site + the snapshot trigger), `cost-rollup.ts` (`toFeatureCostSnapshot` gains a tier parameter), `otel/metrics.ts` + `otel/metrics-listener.ts`. Plus `docs/reference/configuration.md`. Stays inside the otel module and its event inputs. | 95% verified — each emit site located by grep; `emitFeatureCostSnapshot()` currently takes no argument and must receive the triggering event's tier (`conductor.ts:2088`), which is the one signature change outside otel |
| Data implications | Events are additive-optional; `events.jsonl` readers ignore unknown fields. No persisted-schema migration. `feature_cost_snapshot` is non-persisted. | 100% verified — `event-sink-registry-exhaustiveness` keys sinks by type, not field |
| Performance | Zero new I/O: every source is already in scope at its emit site. | 100% verified |
| Worktree isolation | No shared resource. | n/a |

**Load-bearing assumption surfaced and confirmed:** `item.tier` reaches `daemon-runner.ts` as the
raw parsed value, not defaulted. Verified: no `.tier ??` fallback exists in `daemon*.ts` or
`daemon-cli.ts`; the `'M'` fallback named in the `BacklogItem` comment is applied downstream in
`step-runners.ts:2537` for policy only. The `?? 'L'` sites (`conductor.ts:6843`, `:12935`,
`:13731`) are skip-policy resolutions and must not be borrowed by any emit site (Condition C2).

## Alignment

- **Governing ADR reused, not duplicated.** `adr-014-otel-observability-exporter` governs the
  exporter's label contract; D10 admits `tier` on step instruments only and the #1940 amendment
  closes the set. This review amends ADR-014 in place with **D14** (below) rather than drafting a
  new ADR, per the repository's amendment-over-new-ADR practice. No other structural decision is
  made: no new boundary, seam, integration, persistence model, or technology.
- **D11 precedent applies directly.** Dimensions ride the events that already describe the thing;
  the same additive optional-field path (`adr-2026-07-05-retry-as-escalation-ladder` §6) is used.
- **`adr-2026-08-11` (per-emit-site rejection) reconciled.** That ADR rejected stamping an optional
  field at ~30 `loop_halt` sites. Here each of the five events has exactly one production emit site
  (`daemon-runner.ts:407`, `:417`, `:431`; `conductor.ts:12347`; `cost-rollup.ts:179` via
  `conductor.ts:2105`), and #1940 used the identical path for `tier` on `step_completed`. D14 states
  this so `build_review` does not re-litigate it.
- **Absence contract honored.** ADR-014 D10, the #1940 review's C2 (which names `tier`), and
  `adr-2026-07-27-cost-unmetered-is-a-first-class-state` all require omit-not-placeholder. The
  existing spread form at `conductor.ts:12321` (`...(state.complexity_tier !== undefined && { tier })`)
  is the local pattern to preserve at every new emit site.
- **Event-spine principle honored.** No new channel; `MetricsListener` remains the single metrics
  projection (ADR-014 D7, operator clarification 2026-09-10). Listener-side inference from
  `latestDispatchDimensions` was considered and rejected (see `.memory/decisions/2026-09-14-…`).
- **Recorder threading is per-method, not via the identity seam.** Putting `tier` into
  `identityAttrs` would silently label `memory.setup`, `gate.verdicts`, `gate.kickbacks`, and
  `pipeline.closeout.duration`, widening the closed label set beyond D14. Each feature method takes
  an optional `tier` and merges it explicitly.
- **Diagram accuracy.** The approved component diagram matches this review; no update needed.
- **Sealed-artifact rule.** The ADR-014 amendment is authored now, on the spec branch, during
  DECIDE. The plan MUST NOT emit a task whose `**Files:**` names `.docs/decisions/`
  (`adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts`).

**Focused local pattern basis (for BUILD rediscovery):** the exemplar for "optional dimension stamped
at emit, omitted when unresolved" is the `step_completed` emit in `conductor.ts` (search for the
spread `state.complexity_tier !== undefined && { tier:`), and the exemplar for "recorder method
merges an optional dimension into attributes" is `MetricsRecorder.withDimensions` in
`otel/metrics.ts`. Traits to preserve: the raw `undefined` propagates; the attribute key is absent,
not empty; identity attributes are merged last. Allowed variation: feature methods may take `tier`
as a plain optional parameter rather than a `DispatchDimensions` object.

## Wiring Surface

| New/changed surface | Called from in production |
|---|---|
| `tier?` on `feature_dispatch_started` / `feature_dispatch_ended` / `feature_shipped` | The three existing emit sites in `daemon-runner.ts` (daemon dispatch loop), populated from `item.tier` |
| `tier?` on `feature_usage_total` | The existing `finish`-close emit in `conductor.ts` (`emitTracked`), populated from `state.complexity_tier` |
| `tier?` on `feature_cost_snapshot`; `toFeatureCostSnapshot(rollup, tier?)` | `Conductor.emitFeatureCostSnapshot`, invoked from the terminal-delivery path after every `step_completed`/`step_failed`, passing that event's `tier` |
| `MetricsRecorder.onFeatureDispatch/onFeatureHalt/onRunClose/onFeatureShipped/onFeatureDuration/onFeatureCostSnapshot/onFeatureUsageTotal` accept optional `tier` | The corresponding `MetricsListener.METRICS_HANDLERS` entries, which already route every feature event to these methods |
| `docs/reference/configuration.md` label documentation for the nine instruments | Read by operators; rides the diff outside the plan (precedent: #2056 C4) |

Early overlap scan (`ai-conductor overlap-scan` over the seven source/doc paths plus ADR-014):
**no overlap detected, no open blockers.** #2414's implementation (PR #2514) is at
needs-remediation and did not register as overlapping on these paths; Risk R3 keeps it on watch.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 — an emit site borrows a `?? 'L'`/`?? 'M'` policy default and exports a fabricated tier | Data | Medium | High | C2: a negative test per event asserts the data point has **no** `tier` key when the marker is absent; the spread form is the mandated shape |
| R2 — cross-dispatch re-tier splits the cumulative `feature.cost` series so `sum by (tier)` counts a feature twice | Data | Low | Medium | D14 documents the split as the honest record; C4 requires the configuration reference to say so and to show the `max by (feature, tier)` last-value query |
| R3 — collision with #2414 (`adr-2026-09-10-shared-step-lifecycle-telemetry`, in flight) on `events.ts`, `metrics.ts`, `metrics-listener.ts` | Integration | Medium | Medium | Additive-only edits at distinct symbols; conflict-check must include `.docs/decisions/`; rebase ordering is the daemon's concern |
| R4 — `tier` added to `identityAttrs` widens the label set beyond D14 | Technical | Low | Medium | C3: per-method threading; a test asserts `memory.setup`/`gate.*` points carry no `tier` |
| R5 — a changed APPROVED ADR with an uncitable amendment fails the land gate | Process | Low | High | D14 is written as `> 14. **…**` inside `## Decision`; replicated `parseAdrDecisions` now yields ids 1–14 |

## ADRs Created

None. `adr-014-otel-observability-exporter` amended in place with **D14** (dated amendment note
2026-09-14, additive; D10–D13 untouched). Status remains APPROVED.

## Conditions

- **C1** — Every one of the nine instruments in D14 carries `tier` when the feature's marker
  resolves; a test per feature event proves the label reaches the exported data point.
- **C2** — When the tier is unresolved, the attribute is **absent**: a negative test per feature
  event asserts no `tier` key, and specifically that the value is not `L` or `M`. No emit site may
  use a policy default.
- **C3** — `tier` is threaded per feature method in `MetricsRecorder`, never through
  `identityAttrs`; a test asserts a non-feature instrument (`memory.setup` or `gate.verdicts`)
  exports no `tier`.
- **C4** — `docs/reference/configuration.md` documents `tier` on all nine instruments, adds the
  missing rows for `feature.shipped`, `feature.halts`, `feature.dispatches`, `feature.duration.*`,
  and `run.outcomes`, and states the re-tier series semantics with a `max by (feature, tier)`
  last-value example. Rides the diff, not a plan task.
- **C5** — Feature and step series for the same dispatch agree on `tier`: a test drives a
  `step_completed` with `tier: 'M'` through terminal delivery and asserts the resulting
  `feature_cost_snapshot` point carries `tier="M"`.
- **C6** — The plan's Architecture Obligation Coverage table carries one row per parsed ADR-014
  decision id (1–14), and the plan names no `.docs/decisions/` path in any `**Files:**` line.
