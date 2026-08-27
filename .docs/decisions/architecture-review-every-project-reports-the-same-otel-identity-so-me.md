# Architecture Review: OTel two-layer identity (#1938)
**Date:** 2026-08-26
**Mode:** Lightweight (tier M) — feasibility + alignment
**Stories reviewed:** none yet (pre-stories DECIDE review; input = explore output + track marker)
**Verdict:** APPROVED

## Feasibility

- **Stack:** no new dependencies. All changes sit in `src/conductor/src/engine/otel/`
  (`resource.ts`, `metrics.ts`, `otel-visualizer.ts`) plus the single construction site
  `src/conductor/src/index.ts` (`createOtelVisualizer`, wired ~line 1283). Verified: that is the
  only production construction site.
- **Identity values today (verified):** `project` is passed as `projectRoot` (absolute path —
  the `~/code/ai-conductor` label in the issue) and `feature` as `opts.featureDesc ?? 'unknown'`
  (free text). The contract fixes the data-point `project` value to the basename of the project
  root; `feature` passes through as given (bounded: one value per feature).
- **Injection seam:** `MetricsRecorder` constructor takes an `identityAttrs` object
  (`{ project, feature }`) merged into every `record()`/`add()` attribute set at one code point.
  Composes with #1941's concurrent cost/dispatch counters whichever lands first.
- **Resource:** `buildResource` additionally sets `service.instance.id` = the resolved run id
  (existing source chain unchanged). No behavioral change to the never-throws contract
  (adr-2026-07-11-pipeline-state-durability D1).

## Alignment

- **Governing ADR:** `adr-014-otel-observability-exporter` is the sole APPROVED ADR owning OTel
  structure; this design **amends it in place** (additive note beside its sub-decisions) rather
  than authoring a new ADR — per the repo preference for amending governing ADRs and
  adr-2026-08-08 (a non-APPROVED `adr-*.md` blocks all discovery).
- **Run-id semantics preserved:** `service.instance.id` carries the conduct feature-run id
  exactly as adr-2026-07-27-cold-start-within-step-retries §7 defines it (never a
  provider-session/attempt id; `attempt.id` of adr-2026-08-25 is a distinct identifier).
  `resource.ts` mint-and-persist behavior is unchanged; adr-2026-08-09-worktree-local-provider-scratch
  remains a decoupled consumer (it injects its own run id, never reads the session file).
- **Forward-compat lane honored:** adr-2026-07-22-per-feature-cost-rollup reserved the OTel
  metrics surface for exactly this kind of consumer-side evolution; attribute injection is inside
  that lane. adr-2026-07-27-additive-cost-block-evolution: the change is additive (new labels,
  new resource attr; nothing removed or renamed).
- **Telemetry never a gate** (adr-2026-07-21-demote-task-stamping): the new attributes remain
  observability-only; nothing reads them for completion or gating.
- **No event-spine change:** no new event types (adr-2026-07-26-event-sink-registry untouched);
  the exporter stays a bus listener off the hot path (adr-014 core, unchanged).
- **Docs:** the consumer identity contract lands in the canonical observability documentation in
  the same PR (authored during DECIDE/BUILD per plan, respecting the phase-scoped docs guard for
  `.docs/`; `docs/` reference pages are not under that guard).

## Wiring Surface

| New/changed surface | Production caller |
|---|---|
| `MetricsRecorder` constructor param `identityAttrs` | `OtelVisualizer` constructor (`otel-visualizer.ts`), which passes `{ project: basename(ctx.project), feature: ctx.feature }`; constructed from `createOtelVisualizer` in `src/conductor/src/index.ts` |
| `service.instance.id` on the Resource | `buildResource` (`resource.ts`), invoked by the `OtelVisualizer` constructor; Resource attaches to both providers |
| Identity contract doc | `docs/` observability/reference page (reader-facing; no runtime caller) |

Early overlap scan run (advisory): many stale spec branches touch `resource.ts`; the live overlaps
of note are #1941 (`metrics.ts`, semantically compatible — dimensions explicitly deferred to this
lane) and `origin/spec/pipeline-run-state-lives-inside-the-worktree-cwd-r` (carries the unlanded
`adr-2026-07-21-run-state-home-dir-placement` with a `projectKey` token — if it lands first, the
project-name derivation should reuse `projectKey`; noted as a rebase-time check, not a blocker).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Textual merge race with #1941 in `metrics.ts`/tests | Integration | High | Low | Single-seam injection; rebase resolves mechanically |
| Basename collision (two project roots, same basename) | Data | Low | Medium | Full path stays on Resource (`conductor.project`); contract documents the tiebreaker |
| Per-run `target_info` churn remains (one series per run) | Performance | Medium | Low | Accepted: bounded to 1 series/run with no per-metric fan-out; documented in contract |
| `feature` label from free-text `featureDesc` | Data | Medium | Low | One value per feature run — bounded; contract notes the value is the dispatch's feature identifier |

## ADRs Created

None. `adr-014-otel-observability-exporter` amended in place (additive note, 2026-08-26, #1938);
original assertions preserved. Amendment requires operator approval before stories proceed.

## Conditions

None blocking. Rebase-time check recorded above for the `projectKey` branch.
