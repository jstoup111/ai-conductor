# Conflict Check: Connector Seam — Visualizer Selection Loop (#1516)

**Date:** 2026-08-26
**Stories scanned:** all 5 in `.docs/stories/connector-seam-for-event-submissions-is-registered.md`,
pairwise and against the ADR corpus and adjacent existing stories (OTel observability 2026-06-28).
**ADR corpus:** `repo_wide` (config `conflict_check.adr_corpus`).
**Examined (subject-overlapping):** adr-014-otel-observability-exporter (amended 2026-08-26),
002-plugin-manifest-and-discovery, 003-ui-renderer-plugin-point,
adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration,
adr-2026-06-29-per-project-memory-provider-selection,
adr-2026-07-26-event-sink-registry-exhaustiveness,
adr-2026-08-12-live-provider-coverage-from-plugin-registry.
**Narrowed out (subject does not touch the connector seam):** the event-flow ADRs
(audit-trail sink, halt events on spine, kickback emission, intra-step progress, reseal audit,
containment ledger, closeout timestamps, task-stamping telemetry, event-driven wake) and all
non-plugin ADRs. None is fully superseded in the examined set.

**Result: PASS — 1 blocking conflict found and resolved; zero remaining.**

## Conflict (RESOLVED): `otel` listed in `visualizers` while the `otel:` block is disabled

**Stories involved:** Story 1 (Installed visualizer plugin receives event submissions) vs Story 2
(Built-in OTel exporter rides the same seam with unchanged operator behavior)
**Files:** `.docs/stories/connector-seam-for-event-submissions-is-registered.md` (both)
**Type:** overlap
**Severity:** blocking

**Description:** Story 1's selection rule (a listed name that is registered gets started) and
Story 2's enablement rule (OTel governed solely by the `otel:` gate) were mutually exclusive in
the overlap case `visualizers: [otel]` with `otel:` absent/disabled — satisfying either direction
broke the other, and the OTel constructor throws when handed a disabled config.

**Resolution applied (operator-selected option 1):** Story 2 gains an explicit negative path —
a `visualizers` entry naming `otel` is ignored with a one-time warning pointing at the `otel:`
block; OTel is never started off-gate; the run proceeds. Enablement has a single source per
emitter. Superseded assertion replaced in place per story amendment rules.

Alternatives rejected: treating the listing as enablement-with-defaults (changes the operator
surface, violating #1516's "OTel unchanged" outcome); reserving the `otel` name at load
(heavier, still requires the warning).

## Verified clean pairs (both directions reasoned)

- Story 1 vs Story 4: warn-and-skip (missing name) vs isolate-and-continue (throwing start) are
  disjoint failure stages; no oscillation.
- Story 1 vs Story 5: refusal at load removes the plugin from the registry, so selection's
  "named but not registered" warning covers it consistently; refusing does not violate Story 1's
  happy path (which requires a *valid* plugin).
- Story 3 vs adr-014 sub-decision "generate a non-empty id when neither is available": the seam
  delivers absent fields as absent (no fabrication at the seam); OTel may still generate its own
  correlation id internally. Compatible — seam contract vs consumer behavior.
- Story 4 vs adr-2026-07-26-event-sink-registry-exhaustiveness: the start-failure error event
  must be an existing sink-registered type or, if new, must be added to `EVENT_SINKS` — noted as
  a plan constraint; no story text contradicts the ADR.
- Story 2 vs existing OTel stories/tests (2026-06-28): observable behavior explicitly preserved;
  packaging change only.
- Stories vs 002/003/memory-provider ADRs: the design is derived from these precedents; no
  opposing sentences exist.
