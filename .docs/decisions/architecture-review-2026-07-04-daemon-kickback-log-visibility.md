# Architecture Review: Daemon kickback log visibility

**Date:** 2026-07-04
**Mode:** Lightweight (tier M, technical track) — feasibility + alignment
**Inputs reviewed:** .docs/track/daemon-logs-surface-kickback-steps-visibly.md, .docs/complexity/daemon-logs-surface-kickback-steps-visibly.md, .docs/architecture/2026-07-04-daemon-kickback-log-visibility.md (+ sequence), .memory/decisions/daemon-kickback-log-visibility.md, source verification in src/conductor/src/engine/conductor.ts + daemon-cli.ts + selector.ts
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack:** No new dependencies. chalk (already used) for console styling; the file log is
  already ANSI-stripped via existing `stripAnsi` — prominence is carried structurally
  (uppercase `KICKBACK` tag), which is why the design survives both sinks.
- **Prerequisites:** None. The `kickback` event variant already exists in the
  `ConductorEvent` union with `from/to/evidence/count`; the front-half emission reuses it
  verbatim. `navigation_back` already exists in the union — only a renderer case is missing.
- **Integration surface:** Three files (conductor.ts advanceTail, daemon-cli.ts
  renderDaemonEvent, tests) plus test fixtures. No cross-module boundary crossings.
- **Verified mechanic (load-bearing):** `advanceTail` returns null at conductor.ts:1869-1871
  for steps before the first loopGate, before both the kickbackTargets emit scan
  (:1905-1933) and the selector — confirming DECIDE amendment kickbacks emit nothing today.
  Moving a detection scan above that early return is feasible without touching routing:
  emit + count, then still return null.
- **Data/performance/worktree isolation:** No schema, no migrations, no shared-state or
  port implications. Safe in parallel worktrees.

## Alignment

- **Single choke point preserved:** all rendering stays in `renderDaemonEvent`
  (daemon-cli.ts); no second logging path — consistent with the curated-signal comment and
  003-ui-renderer-plugin-point.
- **adr-2026-06-29 (convergent kickbacks):** this feature surfaces the kickback edges that
  ADR introduced; it does not alter routing, amendment mode, or the structural-gap bar.
  Review found the ADR's "existing per-gate kickback cap applies to the new targets" is only
  *counted* in the tail scan today — front-half re-opens are uncounted. This feature makes
  them counted and visible; cap **enforcement** in the front half is explicitly out of scope
  (condition 2).
- **adr-014 (OTel exporter):** event consumers see additional `kickback` emissions with an
  unchanged shape — additive and compatible.
- **Pattern consistency:** matches existing symbol-per-event-type convention (✋ ↻ ✗ ✓);
  byte-exact renderer tests remain the format contract.
- **Convention over precedent:** no documented decision conflicts found.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Double emission for the same kickback verdict (front-half detection + tail scan) | Technical | Medium | Medium | Single emission predicate (`kickback.from === completed step`) evaluated in exactly one place per completion; integration test asserts one event per verdict |
| External tooling grepping the old lowercase `kickback:` line breaks | Integration | Low | Low | Only known consumer is the renderer test (updated in-change); KICKBACK becomes the stable grep anchor |
| Front-half cap enforcement introduces a new HALT path in previously always-linear DECIDE | Technical | Low | Medium | Reuses the tail's exact HALT sequence (marker, remediation PR, loop_halt); integration test covers cap-exceeded front-half HALT; cap policy already approved in adr-2026-06-29 |
| Renderer restyle drifts from dashboard palette conventions | Technical | Low | Low | Mirror dashboard-text.ts palette; byte-exact tests |

## ADRs Created

- `adr-2026-07-04-kickback-event-emission-and-log-prominence.md` (DRAFT → requires approval)

## Conditions

1. Exactly-one-emission per kickback verdict must be asserted by an integration test
   (gate-loop test extended with a front-half amendment scenario).
2. Front-half cap enforcement (added by amendment at conflict-check) must reuse the tail
   scan's exact HALT sequence — `.pipeline/HALT` marker, remediation-PR surfacing,
   `loop_halt` event — and share one per-gate counter with the tail scan; an integration
   test must cover the cap-exceeded front-half HALT.
3. The `navigation_back` marker must be visually distinct from the engine `KICKBACK` line
   (operator-initiated vs engine-initiated backward motion must not be conflatable).

*Amendment note (2026-07-04):* original condition 2 (file a follow-up issue for deferred
front-half cap enforcement) was superseded when conflict-check's degrading conflict with
decide-pipeline-restructure S8 was resolved by expanding scope — enforcement is now in this
feature. Verdict unchanged: APPROVED WITH CONDITIONS.
