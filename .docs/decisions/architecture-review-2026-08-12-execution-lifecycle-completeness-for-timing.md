# Architecture Review: Shipped-record timing never reaches `measured` (#1260)

**Date:** 2026-08-12
**Mode:** design-time, lightweight (Medium tier — Sections 2 and 4 in full)
**Track:** technical
**Input reviewed:** `.docs/track/…`, `.docs/complexity/…`, `.docs/architecture/…` for this slug;
intake jstoup111/ai-conductor#1260. Stories and plan do not exist yet.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Buildable as-is. No new dependency, service, or runtime. The change is confined to existing TypeScript modules in `src/conductor/src`. |
| **Prerequisites** | None. No migration, no schema backfill, no external account. Historical ledgers and committed records are read-only inputs that must keep parsing. |
| **Integration surface** | Four engine modules plus the event union: `conductor.ts` (interrupt paths), `types/events.ts`, `event-persister.ts`, `timing-rollup.ts`, `shipped-record.ts`, `kpi-report.ts`. Crosses the emit → persist → read → render → parse chain, which is why it is Medium and not Small. No external API. |
| **Data implications** | None persistent. `.pipeline/events.jsonl` gains events on paths that previously emitted nothing (strictly additive to an append-only file); the shipped record's `## Time` block gains one optional field. No existing field changes meaning. |
| **Performance risk** | Negligible. The added emits are one record per interrupt; the rollup already walks the whole ledger once and gains no extra pass. |
| **Worktree isolation** | Unaffected. All state is per-worktree `.pipeline/` and per-feature `.docs/shipped/`. No port, database, queue, or shared path is introduced. |

**Verified, not assumed.** The feasibility claims above rest on running the shipped
`computeTimingRollup` against all six live worktree ledgers on 2026-08-12: five returned `partial`
via `openExecutions.size > 0`, and the sixth — the only one with no open executions — returned a
complete `measured` result. The partition arithmetic is therefore already correct and is not part
of this change. Confidence 90%, basis: verified by execution.

## Alignment

**Domain boundaries — respected.** Emission stays in the conductor, interval stamping stays in the
persister, partitioning stays in `timing-rollup.ts`, rendering stays in `shipped-record.ts`, parsing
stays in `kpi-report.ts`. Each module keeps its existing responsibility; none reaches across.

**Pattern consistency — follows two established precedents.** The additive optional field on the
`## Time` block follows `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates`, and the
refusal to synthesize a value follows `adr-2026-07-27-cost-unmetered-is-a-first-class-state`. The
single-emit-path shape recommended for the interrupt terminals is the one #1477 adopts for
`loop_halt`: one conductor-owned private emitter, so no call site is free to omit the field.

**Event spine — extended, not forked.** Checked explicitly against the repository's event-spine
procedure before this design was written down. The interrupt terminal is an occurrence in time and
rides the existing `ConductorEvent` union; the `reason` is durable state qualifying a `state:` value
already committed to the record and read by name by `kpi-report`'s parser. No sibling ledger, no
bespoke format, no new reader path, so no exception A/B/C is invoked and no channel ADR is owed.

**State management — this is the substance of the change.** The execution lifecycle is an existing
implicit state machine (`started` → terminal) whose terminal transition is currently optional in
practice. The decision makes it mandatory on every path that can still run code, and makes the one
genuinely unrepresentable case — a process killed before it can emit — degrade explicitly rather
than be closed by inference. Invalid states are narrowed, not widened.

**Production DI defaults — n/a.** No dependency injection, no store, no in-memory production
default is introduced.

**Security boundaries — n/a.** No endpoint, no user input, no new field carrying user data. The
`reason` carries execution keys (step names), which already appear throughout the ledger.

**Diagram accuracy.** `.docs/architecture/<slug>.md` was authored in this pass and renders clean
under `conduct-ts render-diagrams --check`. It records the two mechanical facts the design turns on
— the persister as the sole `activeInterval` source, and the per-process open map against the
per-worktree append-only ledger.

## Wiring Surface

| New / changed production surface | Where it is called from in production |
|---|---|
| Terminal-event emission on catchable interrupt paths | The conductor's own halt, live-boundary-abort, and shutdown paths in `conductor.ts`, routed through one private conductor-owned emitter so no path can omit it — the same shape `emitLoopHalt` uses. |
| Optional interrupt/terminal fields on the `ConductorEvent` union | `types/events.ts`; consumed by the already-wired `EventPersister` subscription derived from `EVENT_SINKS` via `persistedEventTypes()`. No new subscription. |
| Degrade reason returned by `calculateTimingRollup` | Returned through the existing `computeTimingRollup` export, whose only production caller is `shipped-record-cli.ts:161` inside the already-wired `conduct-ts shipped-record` command. |
| `reason` field on the `## Time` block | Written by `appendTimingSection` (`shipped-record.ts:217`), called from `shipped-record-cli.ts:159`; read by the `## Time` parser in `kpi-report.ts`, reached from the wired `conduct-ts kpi` command. |

No new command, hook, config key, scheduled job, or subscription is introduced — every surface
above lands on a code path that is already dispatched in production today.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A future interrupt path forgets to emit its terminal, silently restoring the defect | Technical | Medium | Medium | Route every emit through one conductor-owned private emitter rather than a prose rule, per this repo's deterministic-enforcement principle; cover with a test that drives a real interrupt. |
| #1477 lands first or second and collides in the same halt emission neighborhood | Integration | High | Low | Both are additive to the same union and the same emit region; whichever lands second rebases. Raised explicitly for `/conflict-check`. |
| An already-committed record or a record with no `## Time` block stops parsing | Data | Low | High | The reason is read by name and its absence is not an error; a round-trip test pins both historical shapes against the current parser. |
| The KPI's measured sample count stays at zero because every ship is interrupted in practice | Knowledge | Low | Medium | The observable check is one uninterrupted end-to-end ship producing a `measured` record; if that still fails, the remaining route is named in the record itself, which is precisely what the reason field buys. |

No High-likelihood/High-impact risk is registered.

## ADRs Created

- `adr-2026-08-12-execution-lifecycle-completeness-for-timing` — **APPROVED (operator-approved
  2026-08-12).**
  Extends (does not supersede) `adr-2026-07-29-engine-observed-provider-time-partition`, whose
  contract 4 requires terminal evidence to carry an active interval but never requires that terminal
  evidence exist. Structural prerequisite met: it establishes a durable state-transition invariant on
  the event-store boundary. Governing-ADR reuse check performed — `adr-2026-07-29-…` and
  `adr-2026-07-27-cost-unmetered-is-a-first-class-state` are cited and applied rather than
  duplicated, and neither covers the completeness invariant.

## Early Overlap Scan

`conduct-ts overlap-scan` was run over the Wiring Surface paths. It is **non-informative for this
change** and is recorded as such rather than as a clean result: it reports 172 overlapping branches
for `timing-rollup.ts` alone, and every unmerged spec branch as overlapping `event-persister.ts`,
because spec branches diverge from stale bases and the scan compares whole files. Advisory only; it
does not affect this verdict.

The one substantive overlap was found by reading, not by the scan:
`.docs/plans/loop-halt-never-reaches-events-jsonl-so-a-halt-is-.md` (#1477, unshipped) persists
`loop_halt` / `rebase_conflict_halt` and adds a `step` field to both, touching the same emit region.
It makes a halt *visible* in the ledger but does not close the open execution or restore its lost
`activeInterval`, so the two are complementary rather than contradictory. Carried to
`/conflict-check`.

## Conditions

1. **Reader-side closure of an open execution is out of bounds.** Any implementation that reaches
   `measured` by inferring a terminal the ledger does not contain violates decision 2 of the ADR and
   is a blocking finding at build review, not a shortcut.
2. **Backward compatibility is proven, not asserted.** The plan must carry an explicit round-trip
   task covering a reason-free `partial` record and a record with no `## Time` block at all.
3. **`docs/reference/cli.md` (~640-691) and `docs/reference/artifacts.md` (~566-574) are updated in
   the same PR** — both document the `## Time` block's fields and go stale on this change, and this
   repository's documentation-upkeep rule makes that a completion condition.
