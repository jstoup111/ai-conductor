# Conflict Check: feature-cost-and-shipment-metrics-cannot-be-groupe

**Date:** 2026-09-14
**Stories checked:** `.docs/stories/feature-cost-and-shipment-metrics-cannot-be-groupe.md` (Stories 1–5) against every file in `.docs/stories/` and the `repo_wide` ADR corpus.
**Result:** 0 blocking, 0 degrading. Clean pass.

## ADR corpus (repo_wide)

All 585 `adr-*.md` files under `.docs/decisions/` were examined (delegated full read, 2026-09-14, recorded in the architecture review). Narrowed to the ADRs whose subject overlaps OTel export, the event schema, complexity-tier resolution, cost rollup, or sealed-artifact amendment: adr-014-otel-observability-exporter (incl. D10–D14), adr-2026-09-10-shared-step-lifecycle-telemetry, adr-2026-08-11-halt-events-ride-the-persisted-spine, adr-2026-08-03-fail-closed-decide-entry, adr-2026-07-21-s-tier-pipeline-knobs, adr-2026-07-22-per-feature-cost-rollup-in-shipped-record, adr-2026-07-27-cost-unmetered-is-a-first-class-state, adr-2026-07-26-event-sink-registry-exhaustiveness, adr-2026-07-05-retry-as-escalation-ladder, adr-2026-08-19-live-provider-stream-observation, adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts, adr-2026-09-02-adr-decision-citability-contract, adr-2026-08-09-adr-layer-gated-by-committed-adr-signal, adr-2026-08-02-plan-scope-containment-at-commit-boundary, adr-2026-08-01-conduct-state-mutation-port, adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal. Narrowed out as non-overlapping: adr-2026-07-07-audit-trail-event-sink, adr-006-flywheel-lesson-selection-and-provenance, adr-2026-07-03-owner-gate-gated-channel, the intake priority-banding ADRs, adr-2026-08-13 (publication dimensions), adr-2026-07-29-engine-observed-provider-time-partition D8, the build_review finding-vocabulary ADRs, adr-2026-08-19-operator-step-rewind-through-the-mutation-port, and the remainder of the corpus (sweep digest held in the architecture review). No ADR was excluded on supersession grounds; none of the narrowed set is superseded.

## Pairs examined in both directions

| Pair | Shared subject | A ⇒ B holds? | B ⇒ A holds? | Finding |
|---|---|---|---|---|
| Story 1 / Story 2 vs adr-2026-08-11 D2 | optional field stamped at emit | yes | yes | D2 rejected ~30 `loop_halt` sites; each feature event here has one site, and adr-014 D14 records that reconciliation. No opposing sentence. |
| Story 2 vs adr-2026-08-03 D2 (`'L'` is the engine's single resolution) | unresolved tier | yes | yes | D2 governs skip policy; Story 2's negative asserts the *event* carries no key, and D14 forbids borrowing the policy default. Compatible. |
| Story 4 vs adr-2026-07-22 (#2095 amendment: cumulative gauge, three projections agree) | `conductor.feature.cost` | yes | yes | Adding a label does not change the gauge's value or cadence; the cross-dispatch re-tier split is documented in D14 and is the honest record, not a disagreement between projections. |
| Story 3 negative (partial active) vs adr-014 D9 | `feature.duration.active` omitted when partial | yes | yes | Identical rule, restated. |
| Story 5 vs adr-014 D12/D13 (custom map, merge order) | custom `tier` key | yes | yes | D12 already refuses an unnamespaced key at config; Story 5 adds a recorder-level guarantee. Belt and braces, not contradiction. |
| Story 5 vs operators-cannot-attach… Story 4/5 ("label set identical to the pre-feature set with no attributes") | closed label set | yes | yes | That story's "pre-feature set" is relative to the custom-attribute map; its fixtures carry no feature `tier`, so D14's label appears only when an event carries one. Its no-map test remains true. |
| Stories 1–4 vs export-the-telemetry… Story 1/6 (`tier` on step events; both paths omit when unresolved) | `tier` source and absence | yes | yes | Same source (`state.complexity_tier`), same absence rule; Story 4's C5 test makes the agreement explicit. |
| Stories 3–4 vs restore-per-member-telemetry… (adr-2026-09-10 D5/D6) | `metrics-listener.ts`, `metrics.ts`, `events.ts` | yes | yes | D5/D6 add parent/member labels on the *step* dimension and keep missing dimensions absent; D14 adds `tier` on *feature* instruments. Distinct symbols, additive both ways; neither assumes the other lands first (no sequencing conflict). Resource contention on files is a rebase concern, not a story conflict — see architecture review R3. |
| Story 1 vs adr-2026-07-26 (sink registry total over event types) | new field on existing events | yes | yes | A field owes no sink row. |

No pair produced an opposing sentence in either direction; no oscillation candidate exists (every pair holds in both directions).

## Assumptions carried (per /verify-claims)

- `BacklogItem.tier` reaches `daemon-runner.ts` undefaulted — verified (no `.tier ??` fallback in `daemon*.ts` / `daemon-cli.ts`), 100%.
- `emitFeatureCostSnapshot` is invoked only from the terminal-delivery path where the closing step event is in scope — verified (`conductor.ts:2088`), 100%.
