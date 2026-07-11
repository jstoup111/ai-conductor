# Architecture Review: Emit intra-step build progress + stall as events (issue #347)
**Date:** 2026-07-10
**Mode:** Lightweight (tier M) — feasibility + alignment
**Input reviewed:** explore output + issue #347 technical intent (technical track; stories do not exist yet)
**Verdict:** APPROVED

## Feasibility

- **Stack:** pure TypeScript inside `src/conductor` — no new packages, services, or
  infrastructure. OTel export rides the existing `OtelVisualizer`/BatchSpanProcessor.
  Verified: all named seams exist (`ui/events.ts` emitter, `types/events.ts` union,
  `ui/subscriber.ts`, `plugin-loader.ts` `registerBuiltins`, `daemon-cli.ts
  renderDaemonEvent`, `engine/otel/otel-visualizer.ts`).
- **Prerequisites:** none — ground truth (`.pipeline/task-status.json`) is already
  engine-owned and written atomically (adr-2026-07-05-engine-owned-task-status,
  `task-seed.ts:246`); `countResolvedTasks(this.projectRoot)` (`conductor.ts:1436`)
  proves the conductor already holds the correct root for the watcher's reads.
- **Integration surface:** engine + UI subscriber layer only; no cross-repo, no
  daemon-registry, no auth. The `ui_renderer` plugin is discoverable per Wave C
  (plugin.yml; zero `src/index.ts` edits — the constraint its stories 3.2-1/3.2-3 pin).
- **Data implications:** none. `task-status.json` is read-only input; no schema change.
  Two divergent `TaskStatusFile` shapes exist (`task-seed.ts` `{tasks:[]}` vs
  `types/state.ts` map) — the watcher must reuse the tolerant parse
  (`countResolvedTasks.countFromParsed` handles both) rather than a new parser.
- **Performance:** one stat+read of two small JSON files + one `git rev-parse` per
  ~30s poll tick, only while a build step is pending. Negligible. Emission is
  change-driven, not per-tick, so subscriber and events.jsonl volume stays bounded.
- **Worktree isolation:** watcher reads only the conductor's own `projectRoot`
  (per-feature worktree in daemon runs); no shared state, ports, or services touched.
  Parallel worktrees each get their own watcher instance.

## Alignment

- **Pattern consistency:** polling-follow matches the codebase's only existing follow
  mechanism (`daemon-log.ts:146` `setInterval` + `.unref()`); no fs.watch precedent
  exists and none is introduced. Event emission goes through the one sanctioned bus;
  no parallel logging path (explicit issue #347 directive honored).
- **Prior decisions honored:**
  - adr-2026-07-05-engine-owned-task-status — read-only consumption, no new writer.
  - Wave C JSON-stdout-subscriber ruling — new UI surface = discoverable
    `ui_renderer` plugin, not SSE/HTTP, not `index.ts` wiring.
  - Wave B subscriber isolation — `emit()` swallows handler errors; new render cases
    cannot crash the engine.
- **State management:** watcher is a two-state (advancing / quiet) tracker with an
  explicit re-arm; `build_no_progress` fires once per quiet episode, preventing
  page-per-tick invalid behavior.
- **Existing-drift note (pre-existing, now partially remediated):**
  `EventPersister.ALL_EVENT_TYPES` and the two renderers already drift from the
  event union; this feature adds its kinds everywhere + a union-exhaustiveness guard
  test story. Full back-fill of ALL drifted kinds is out of scope (separate issue).
- **Diagram accuracy:** feature component + sequence diagrams authored this session
  (`.docs/architecture/emit-intra-step-build-progress-and-stall-as-events.md`,
  `.docs/architecture/sequences/…`); both pass `render-diagrams --check`.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Watcher interval leaks past step settle | Technical | Low | Medium | start/stop owned by one call site; stop in `finally`; `.unref()`; leak-assert test story |
| New events silently dropped by a drifted subscriber list | Technical | Medium | Low | exhaustiveness guard test pinning union ↔ persister/renderer lists |
| Quiet-threshold false alarms on legitimately slow single tasks | Technical | Medium | Low | threshold configurable (`quiet_minutes`, default 15); event is advisory, never gates/halts |
| Divergent task-status schemas mis-parsed | Data | Low | Medium | reuse `countFromParsed` tolerant reader; missing/unparseable = "no change" |

No High-impact risks.

## ADRs Created

- `adr-2026-07-10-intra-step-build-progress-events.md` — Status: APPROVED. Decision
  category: cross-cutting observability approach + new engine timer pattern.
  Operator approval basis: issue #347 pre-declares the design direction ("emit
  intra-step forward-progress and stall as first-class events on the existing bus,
  let subscribers render them; UI plugin per the Wave C ruling") — the ADR's chosen
  option is that directive made concrete; final ratification is the operator's
  spec-PR merge (engineer flow: no build without a merged spec PR).

## Conditions

None. Deviation from the issue's letter is documented in the ADR (§Decision-2):
`rework_cycles` does not exist in `task-status.json`; the thrash signal is served by
`task-evidence.json`'s existing `noEvidenceAttempts` instead of a new counter.
