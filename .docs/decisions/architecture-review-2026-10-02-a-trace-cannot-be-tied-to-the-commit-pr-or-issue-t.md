# Architecture Review: Trace provenance — commit, base, PR, and originating issue (#2000)
**Date:** 2026-10-02
**Stories reviewed:** none yet (pre-stories, technical track). Input: explore decision, track marker `.docs/track/a-trace-cannot-be-tied-to-the-commit-pr-or-issue-t.md`, diagram `.docs/architecture/a-trace-cannot-be-tied-to-the-commit-pr-or-issue-t.md`.
**Mode:** Lightweight (Medium tier) — §2 Feasibility and §4 Alignment only.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding | Confidence / basis |
|---|---|---|
| Stack compatibility | No new package. OTel `Span.setAttribute` and `resourceFromAttributes` already in use (`otel/span-manager.ts`, `otel/resource.ts`). | 95% verified |
| Prerequisites | None. `feature_complete` already carries `prUrl`; `loop_halt` already carries `prUrl`; `rebase_mergeable_skip` already carries `baseSha`; `parseIntakeSourceRef` and `resolveFeaturePlanPath` already exist (`engine/artifacts.ts`, used by `createFinishPresentationRepair` in `engine/conductor.ts`). | 90% verified |
| Integration surface | Four modules: event union (`types/events.ts`), terminal emit seams (`Conductor.completeRun`, `Conductor.emitLoopHalt`), rebase outcome emission (`engine/rebase.ts`, the `switch (outcome.kind)` emit block), and `engine/otel/` (`resource.ts`, `span-manager.ts`, `otel-visualizer.ts`, `otel-config.ts`) plus config key registration (`engine/config.ts` `CONFIG_CONSUMER_KEY_SETS.otel`) and run-start context (`index.ts` `createVisualizerStartContext`). | 85% verified by reading call sites |
| Data implications | Additive optional event fields; `events.jsonl` readers tolerate unknown/optional fields. No migration. | 85% inferred from the D14 precedent (#2528) that added `tier` the same way |
| Performance | One `git rev-parse HEAD` per terminal emit (once per run). No hot-path cost. | 90% inferred |
| Worktree isolation | No ports, services, or shared files. | 95% verified |

**Crash coverage, stated precisely.** A span that is never ended is never exported, so a crashed
run exports no root span. What survives a crash: the trace Resource on every already-closed step
span (hence `conductor.source.ref` on the Resource) and the rebase step span (hence `vcs.base.sha`
also on that span). The built commit and PR are close-time values and are absent from a crashed
run's trace; that is accepted, and `conductor.pr.disposition` is absent there too, which is itself
the "no close happened" signal. Confidence 85% (inferred from BatchSpanProcessor semantics; the
force-close path on graceful stop still stamps `unrecorded`).

**Run-start source ref.** `index.ts` builds the start context before the conductor resolves the
plan, but it has `opts.featureDesc`; `resolveFeaturePlanPath(projectRoot, featureDesc)` then
`.docs/intake/<planStem>.md` yields the ref exactly as `createFinishPresentationRepair` does. A
run with no intake marker (non-intake idea) omits the attribute. Confidence 85% verified on the
helper, inferred on availability at that call site.

## Alignment

- **ADR-014 D4 (no I/O in projections):** satisfied — SHAs and the source ref are resolved at
  emit sites / run start, never by `SpanManager` or `OtelVisualizer`.
- **ADR-014 D10 (unbounded is trace-only):** satisfied — SHAs, URL, and issue ref are span or trace
  Resource attributes only; `MetricsListener` derives nothing new.
- **ADR-014 D11 (existing events, no new type):** satisfied — additive fields on
  `feature_complete`, `loop_halt`, and rebase outcome events; precedent D14 (#2528) added `tier` to
  the same two terminal events through the same two seams.
- **ADR-014 2026-08-28 identity amendment:** `feature: false` changes only the trace Resource's
  `service.instance.id`; metric Resource identity is untouched. The run id is already trace-only,
  so `«project»/«run-id»` adds no metric series.
- **ADR-014 D12 (config under existing `otel:` block):** `otel.provenance` follows the same
  existing-block, resolved-once pattern as `otel.attributes`.
- **State modelling:** PR disposition is a closed three-value enum, not a nullable URL plus a
  boolean — the invalid "no-PR but URL present" state is unrepresentable.
- **Event spine:** no parallel channel; the new facts also persist to `events.jsonl` for other
  consumers.
- **Diagram accuracy:** the approved component diagram matches this design.

**Focused local pattern basis.** Role: terminal-event dimension plumbing. Traits to preserve:
optional field omitted (never placeholder) when unresolved; stamped at the existing centralized
terminal seams, not at every halt caller. Why it applies: #2528 D14 solved the identical "add a
value to both terminal events" problem. Allowed variation: these fields are span-only, not
data-point labels. Rediscovery hints: `engine/conductor.ts` `completeRun`, `emitLoopHalt`; the
`tier` spread in both.

## Wiring Surface

| New surface | Production caller (design-time) |
|---|---|
| `feature_complete.headSha/baseSha/prDisposition` | emitted by `Conductor.completeRun` on every verified terminal run |
| `loop_halt.headSha/baseSha/prDisposition` | emitted by the centralized `Conductor.emitLoopHalt` |
| `baseSha` on `rebase_noop` / `rebase_changed` | the existing rebase outcome emit block in `engine/rebase.ts` |
| `VisualizerStartContext.sourceRef` | `index.ts` start-context construction for interactive and daemon-dispatched runs |
| `conductor.source.ref` resource attribute | `buildResource(…, 'traces')` called from `OtelVisualizer.initializeProviders` |
| root/rebase span provenance attributes | `SpanManager` handlers already switched on by `OtelVisualizer` for `feature_complete`, `loop_halt`, rebase events |
| `otel.provenance` config key | `resolveOtelConfig` → `ResolvedOtelConfig` → `OtelVisualizer` / `buildResource`; key registered in `CONFIG_CONSUMER_KEY_SETS.otel` |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `OtelVisualizer` does not route any rebase event to `SpanManager` today (verified: no `rebase_` case in its switch) | Integration | Certain | Medium | Plan task adds the routing explicitly and tests it through the visualizer, not SpanManager alone |
| Source ref unavailable at start for runs whose plan path cannot be resolved | Integration | Low | Low | Omit the attribute; never fail start |
| `git rev-parse HEAD` fails at a terminal seam | Technical | Low | Low | Omit `headSha`; never block the terminal emit |
| Operators with dashboards keyed on `service.instance.id` turn `feature` off | Data | Low | Medium | Default on; documented in D20 and config docs |

## ADRs Created

None new. **ADR-014 amended** (additive, 2026-10-02 by #2000) with Decisions 18–20. Structural
prerequisite met: the change revises ADR-014's trace identity contract (`service.instance.id`) and
its attribute-placement contract. Reused rather than duplicated per operator preference for
amendments.

## Conditions

1. The amendment to ADR-014 must be operator-approved before stories.
2. A test must drive rebase, finish, and halt events through `OtelVisualizer` (not `SpanManager`
   alone) and assert the exported root-span and Resource attributes.
3. Each `otel.provenance` toggle must have a test proving its attributes are absent when off, and
   `feature: false` must have a test proving metric Resource and data-point labels are unchanged.
