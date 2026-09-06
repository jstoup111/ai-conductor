# Implementation Plan: Mechanically enforce OTel handler coverage for traced events

**Date:** 2026-09-06
**Stories:** .docs/stories/mechanically-enforce-otel-handler-coverage-for-ote.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; scoped intent conforms to the existing telemetry contract — one sink declaration per union member, subscription derived from it, and the visualizer's bounded, non-throwing warning seam.

## Summary

Four bounded tasks close the residue of #1490: the OTel visualizer's per-event routing becomes a compile-checked table derived from the same sink declaration that already drives its subscriptions, and an event that is subscribed but unroutable reports itself instead of being discarded. Halt outcomes, span closure at termination, and the membership of the traced set are already delivered and are not touched.

## Technical Approach

`EVENT_SINKS` is annotated `Record<ConductorEvent['type'], SinkDeclaration>`, which widens each `otel` value to `boolean` and erases the per-type literal. Re-declare it as `as const satisfies Record<ConductorEvent['type'], SinkDeclaration>` so the literal `true`/`false` survives, then export a type alias that filters the table's keys by `otel extends true`. This changes no runtime value: `eventTypesFor` still keys into the same object and the four accessors return the same members. The pattern is already established in this engine — `live-e2e-providers.ts`, `config.ts`, `model-table-metadata.ts` and `closeout-cli.ts` all use `as const satisfies`. The readonly properties `as const` introduces stay assignable to the mutable `SinkDeclaration`, so the existing registry test's `@ts-expect-error` on a table missing one declaration continues to hold.

In the visualizer, replace `handleEvent`'s sixteen-case `switch` with a private readonly instance field typed as a mapped record over that alias, one entry per traced type, each entry carrying exactly the effect its switch case had. A missing key is `TS2741` and an extra key is `TS2353`; both were confirmed against the pinned TypeScript 6.0.3 before this plan was written. Entries are arrow properties so they close over the instance state the current cases use — `dispatchMetering`, `pendingDispatch`, `spanManager` and `metricsRecorder` — and `handleEvent` keeps its existing early return when the providers are not yet initialized. Dispatch reads the table by `event.type` through one localized cast, because the incoming parameter is the whole union and is not narrowed by the lookup.

Keep a runtime floor under the type guard. The traced set is consulted at runtime through `otelEventTypes()` while the table is bound at compile time, so a future data-driven or configuration-gated traced set could reintroduce the divergence. When the lookup finds no entry, call the visualizer's existing injected `onWarning` callback with a message naming the event type instead of returning silently. This reuses the established warning seam — the same one `SpanManager.warn` already uses for an unexpected event — and adds no channel; it never throws, so `emit()` stays non-blocking and a run is never affected.

Tests stay at unit level and inject every boundary. The visualizer test file already constructs instances with `InMemorySpanExporter`/`InMemoryMetricExporter` and already demonstrates the `vi.doMock` of the sink-registry module needed to vary the traced set; reuse both rather than running a conductor. Compile-time negatives are written as `@ts-expect-error` assertions in the test files, which `tsconfig.test.json` type-checks because it includes `test/**/*`; a green vitest run is not evidence that they hold, so `npm run typecheck:test` is named in the completion checks. No new fixture directory, no process launch, and no third-party call is introduced. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, compile-time derivation over a test-only parity assertion, the technical track, and both stories on 2026-09-06 (delegated).
- Verified: `src/conductor/src/engine/event-sinks.ts` declares `SinkDeclaration` with `render`, `persist`, `audit` and `otel`, annotates `EVENT_SINKS` as `Record<ConductorEvent['type'], SinkDeclaration>`, and derives all four accessors through `eventTypesFor`.
- Verified: `src/conductor/src/engine/otel/otel-visualizer.ts` imports `otelEventTypes` and subscribes from it in `start()`, while the private `handleEvent` dispatches through a hand-written `switch`; its sixteen cases and the sixteen `otel: true` declarations agree today with nothing enforcing it.
- Verified: the visualizer holds `onWarning`, `warnOnce`, `dispatchMetering`, `pendingDispatch`, `spanManager` and `metricsRecorder` as instance members, and `handleEvent` already returns early when the span manager or metrics recorder is null.
- Verified: `src/conductor/test/event-sink-registry.test.ts` carries an `@ts-expect-error` proving a table missing one declaration fails `satisfies Record<ConductorEvent['type'], SinkDeclaration>`.
- Verified: `src/conductor/test/engine/otel/otel-visualizer.test.ts` contains a test that subscribes from a `vi.doMock`ed sink-registry module, and `src/conductor/test/engine/otel-visualizer-parity.test.ts` asserts subscriptions equal the traced set for two concurrent buses.
- Verified: `src/conductor/tsconfig.test.json` includes `test/**/*`, and `package.json` exposes `typecheck` and `typecheck:test`.
- Verified against the pinned TypeScript 6.0.3: `as const satisfies` preserves the literal `otel` values, the filtering alias resolves to the traced keys, a mapped record over it rejects a missing key with `TS2741` and an extra key with `TS2353`, and a spread missing one key still fails the existing `satisfies` assertion.
- Scope check: consumer-facing engine code; no new skill; provider-agnostic. Event-spine: no new channel — existing bus, existing warning seam.
- Verify-claims verdict: CLEAR. No pending assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Derive the traced event type from the sink declaration table
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/event-sinks.ts, src/conductor/test/event-sink-registry.test.ts
**Dependencies:** none

**Steps:**
1. Add to the existing registry test a compile-checked pair: a variable of the new traced-type alias assigned a traced literal such as `loop_halt`, and an `@ts-expect-error` assertion rejecting an untraced literal such as `gate_blocked`.
2. Run the test typecheck project and confirm both assertions fail because the alias does not exist yet (RED).
3. Re-declare `EVENT_SINKS` as `as const satisfies Record<ConductorEvent['type'], SinkDeclaration>` and export the alias that filters the table's keys by their literal `otel` value. Leave `SinkDeclaration`, every declaration row, `eventTypesFor`, and all four accessors otherwise unchanged.
4. Run the narrowest invocation for the registry and sink test files plus both typecheck projects (GREEN), then commit the focused change.

**Done when:**
1. The registry test assigns a traced literal to the exported alias and carries an `@ts-expect-error` that rejects an untraced literal.
2. `npm run typecheck` and `npm run typecheck:test` both pass, and the file's pre-existing missing-declaration `@ts-expect-error` still holds.
3. The unchanged sink registry test file passes, so the four accessors return the same members they returned before the change.

### Task 2: Route traced events through a compile-checked handler table
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/otel/otel-visualizer.ts, src/conductor/test/engine/otel/otel-visualizer.test.ts
**Dependencies:** 1

**Steps:**
1. Write a failing unit test that constructs a visualizer with in-memory exporters and asserts its handled event-type set equals the set returned by the traced-type accessor, with no missing and no extra member.
2. Run the file's narrowest invocation and confirm the accessor does not exist (RED).
3. Replace `handleEvent`'s `switch` with a private readonly instance field typed as a mapped record over the alias from Task 1, one arrow entry per traced type carrying exactly the effect its case had, including the pending-dispatch cleanup on completion and the deliberate no-op for routine progress. Expose a read accessor for the table's keys and keep the existing early return for uninitialized providers.
4. Run the visualizer, span-manager, parity, wiring and observability OTel test files plus both typecheck projects (GREEN), then commit.

**Done when:**
1. A unit test asserts the visualizer's handled event-type set equals the traced-type accessor's set, with no missing and no extra member.
2. All sixteen traced types keep their previous span or metric effect, proven by the existing OTel visualizer, span-manager, parity, wiring and observability test files passing unchanged.
3. `npm run typecheck` passes with the routing table typed as a mapped record over the derived alias rather than an index signature.

### Task 3: Report a traced event that has no handler entry
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/otel/otel-visualizer.ts, src/conductor/test/engine/otel/otel-visualizer.test.ts
**Dependencies:** 2

**Steps:**
1. Write a failing unit test that mocks the sink-registry module so the traced set contains one extra type with no handler entry, starts a fresh visualizer against a fresh emitter with an injected warning callback, awaits an emit of that event, and asserts one warning naming the type.
2. Run the file's narrowest invocation and confirm the event is discarded with no warning (RED).
3. In `handleEvent`, look the handler up by event type and, when the entry is absent, invoke the injected warning callback once with a message naming that event type instead of returning silently. Do not throw and do not alter the existing early return for uninitialized providers.
4. Run the visualizer, parity and observability OTel test files plus both typecheck projects (GREEN), then commit.

**Done when:**
1. The mocked-registry unit test observes exactly one warning whose text contains the unhandled event type, and the emit resolves without throwing.
2. No warning is emitted for any of the sixteen traced types across the existing OTel test files.
3. In the same mocked run, a traced type that does have a handler entry still records its span or metric effect.

### Task 4: Prove untraced types stay off the OTel surface
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/engine/otel/otel-visualizer.test.ts
**Dependencies:** 2

**Steps:**
1. Add `@ts-expect-error` assertions in the visualizer test file proving that a handler table omitting a traced key, and one carrying a key the sink table declares untraced, are both unassignable to the exported table type.
2. Run the test typecheck project and confirm each assertion is reported as satisfied rather than unused (RED is the unused-directive error if the table type is too wide).
3. Add a unit test that starts a visualizer with in-memory exporters against a fresh emitter, emits a declared-untraced event such as `gate_blocked`, stops the visualizer, and asserts no subscription for that type and no exported span or metric.
4. Add the non-vacuity variant that mocks the sink registry so the same type is traced and observes the subscription appear, then run the file's narrowest invocation and both typecheck projects and commit.

**Done when:**
1. `npm run typecheck:test` passes and both `@ts-expect-error` assertions in the visualizer test file are satisfied rather than reported as unused directives.
2. A unit test observes no subscription and no exported span or metric for a declared-untraced event type.
3. The non-vacuity variant observes the subscription for that same type once the mocked registry declares it traced.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the sink table declares an event type as traced, when the visualizer starts and that event is emitted, then the visualizer routes it to the handler that owns it and records that type's span or metric effect. | 2 | "All sixteen traced types keep their previous span or metric effect, proven by the existing OTel visualizer, span-manager, parity, wiring and observability test files passing unchanged." | diff-local |
| Story 1 happy: Given a started visualizer, when its handled event-type set is compared with the traced set derived from the sink table, then the two sets are equal. | 2 | "A unit test asserts the visualizer's handled event-type set equals the traced-type accessor's set, with no missing and no extra member." | diff-local |
| Story 1 negative: Given a traced event type the visualizer has no handler entry for, when that event is emitted, then the visualizer reports the unhandled type through its injected warning callback and the emit completes without throwing. | 3 | "The mocked-registry unit test observes exactly one warning whose text contains the unhandled event type, and the emit resolves without throwing." | diff-local |
| Story 2 happy: Given an event type declared as not traced, when it is emitted on the bus, then the visualizer never subscribes to it and exports no span, span event, or metric for it. | 4 | "A unit test observes no subscription and no exported span or metric for a declared-untraced event type." | diff-local |
| Story 2 negative: Given a handler table that omits a traced event type, or one that names a type the sink table declares untraced, when the repository type-checks its tests, then compilation fails on that table. | 1, 4 | "`npm run typecheck:test` passes and both `@ts-expect-error` assertions in the visualizer test file are satisfied rather than reported as unused directives." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: each is decided by the sink registry, the visualizer, and their two test files, all inside this diff. Task 1 owns the compile-time derivation of the traced type and its two literal assertions at unit level. Task 2 owns the routing integration for the whole traced set — the production boundary here is the event bus, and its `start()`-to-`handleEvent` path is exercised through a real `ConductorEventEmitter` with injected in-memory exporters, so a passing table accessor never stands in for actual routing. Task 3 owns the unhandled-type negative through the same bus boundary with an injected warning callback. Task 4 owns the exclusion regression guard, its non-vacuity proof, and the two assignability assertions the test typecheck project evaluates. Existing OTel span, metric, resource, transport and config tests remain authoritative for span and metric shapes; none is rewritten. No conductor run, process launch, network call, or third-party service is introduced, and no terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3
Task 2 -> Task 4
