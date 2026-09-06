# Implementation Plan: Stamp released harness version on OTel trace resource

**Date:** 2026-09-06
**Stories:** .docs/stories/stamp-released-harness-version-on-otel-trace-resou.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the approved signal-scoped Resource contract — run-varying identity rides the trace scope only, and the metric scope keeps exactly its feature-stable attribute set.

## Summary

Three bounded tasks deliver #2235: the trace Resource gains an OTel-standard `service.version` attribute holding the released harness version, the supported OTel start-context seam carries that value the same way it already carries the engine dist id, and both supported start boundaries resolve it from their own module directory using the resolver the version command already uses. Publish-time sidecar capture, dist backfill, backend span-metrics configuration, and dashboards are outside this slice.

## Technical Approach

The engine already answers "which harness is this?" with two identities, and only one of them reaches telemetry today. `resolveEngineVersion` supplies the dist id and is stamped on the trace Resource as `conductor.engine.version`; `resolveHarnessVersion` supplies the released `VERSION` value and is used only by the version command. This plan sends the second identity down the exact path the first already travels, so the two can never diverge into separate probes with separate probe orders.

Name the attribute `service.version`. The operator's follow-up on the issue requires the release to be groupable by any OTel consumer, not only by a locally configured span-metrics dimension, and `service.version` is the semantic-convention key every backend already offers alongside the `service.name` and `service.instance.id` this Resource sets today. A conductor-namespaced alternative would need per-backend configuration to become groupable at all.

Emit it on the traces branch only, immediately after the existing dist-id attribute, and leave the metrics branch untouched. The metrics branch returns early with a fixed five-attribute object, and the existing exact-key assertion over that set is the standing guard against `target_info` series growth; adding a release value to the fixture context makes that guard load-bearing for this change without modifying the production metrics path.

Reuse the identity normalizer rather than inventing new vocabulary. An omitted property stays `not-supplied`, an explicitly undefined or empty one stays `unresolved`, and an unreadable or non-semver version source resolves to the existing `0.0.0` unknown marker inside the resolver itself. Three explicit markers, no absent attribute, and the Resource builder stays synchronous and non-throwing.

Thread the value as a required `string | undefined` member of the supported OTel start-context interface, mirroring the branch and dist-id declarations, so a start boundary cannot silently forget it; the compile-time fixtures in the existing wire and visualizer-selection tests already encode that requirement for the other two members and are extended in kind. The shared visualizer start-context type gains the matching optional member so the visualizer can read it, and the visualizer projects it with the same own-property guard the dist id uses, which is what keeps omitted distinguishable from unresolved.

At the two boundaries, await the existing module-relative resolver beside the existing dist-id call. Both call sites already sit inside async functions and already pass their own `__dirname`, and the resolver never rejects, so no new error path or fallback is introduced. Do not add a second probe, a cwd-relative lookup, or a cached module-level value.

Tests follow the repository's test-authoring rules. Resource behavior is unit-level against the exported builder. The wire seam and the daemon dispatch are the two production boundaries and are proved through the existing integration fixtures with in-memory exporters and injected resolvers; no test reaches a real collector, a real LLM, or the network.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, the `service.version` attribute name, and all three stories on 2026-09-06 (delegated).
- Verified: the Resource builder is signal-scoped — the metrics branch returns exactly five feature-stable attributes and returns early, and the traces branch adds the run id and the engine dist id.
- Verified: the identity normalizer already maps an omitted property to `not-supplied` and an empty or undefined one to `unresolved`, and its key union is explicit and must be widened.
- Verified: the supported OTel start-context interface declares branch and engine dist id as required `string | undefined` members, and both existing boundary tests carry compile-time fixtures proving that requirement.
- Verified: the visualizer projects the start context into the resource context behind an own-property guard, and the shared visualizer start-context type declares its identity members as optional.
- Verified: `resolveHarnessVersion(moduleDir, readText?)` already exists, probes three and four levels above the module directory for a semver-shaped value, returns `0.0.0` when none is readable, and never throws.
- Verified: both supported start boundaries already resolve the engine dist id from their own `__dirname`, and both calls sit inside async functions, so awaiting the release resolver adds no new control flow.
- Verified: the existing daemon wiring integration already injects the dist-id resolver and asserts the exported span resource attribute for two values, so the release resolver has a proven seam to follow.
- Scope check: consumer-facing engine telemetry; no new skill; provider-agnostic. Event spine: no channel added — one attribute on a Resource the existing exporter already emits.
- Verify-claims verdict: CLEAR. One accepted limitation is recorded in the track marker rather than left implicit — the module-relative probe reports the installed harness's current release, which differs from the release at the dist's source commit only between a release merge and the next engine publish.

## Tasks

### Task 1: Carry the release value on the trace scope only
**Story:** Story 1
**Story:** Story 3
**Type:** happy-path
**Files:** src/conductor/src/engine/otel/resource.ts, src/conductor/test/engine/otel/resource.test.ts
**Dependencies:** none

**Steps:**
1. Add a released-harness-version property to the existing signal-scope unit fixture context and write RED cases: the trace scope exposes the release value under `service.version` while the dist-id attribute keeps its own value; two trace resources sharing one release value but different dist ids expose an identical `service.version`; an omitted property yields `not-supplied` and an explicitly undefined or empty one yields `unresolved`, with neither call throwing; the metric-scope exact-key case still lists exactly the five feature-stable keys; two metric resources built under different release values compare equal.
2. Verify RED, then add the optional released-harness-version member to the resource context interface and widen the identity normalizer's key union to include it.
3. Emit `service.version` in the traces branch only, immediately after the existing dist-id attribute, using the normalizer. Leave the metrics early return and its attribute object untouched, and keep the builder synchronous and non-throwing.
4. Run the focused resource test file through ai-conductor scoped-run, run the repository typecheck target that covers test files, and commit.

**Done when:**
1. A trace-scope unit case asserts `service.version` holds the supplied release value while `conductor.engine.version` keeps its supplied dist id.
2. Two trace resources sharing one release value but different dist ids expose an identical `service.version`.
3. Omitted and unresolved release inputs expose `not-supplied` and `unresolved` respectively, and neither build throws.
4. The metric-scope exact-key case supplies a release value and still asserts exactly the five feature-stable keys, and metric resources built under two different release values compare equal.

### Task 2: Thread the release value through the supported start seam
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/otel/wire.ts, src/conductor/src/engine/otel/otel-visualizer.ts, src/conductor/src/types/plugin.ts, src/conductor/test/otel-wire.test.ts
**Dependencies:** 1

**Steps:**
1. Write RED cases in the existing wire-boundary test: a supported start context carrying a release value exports a `conductor.run` span whose resource `service.version` matches it; the omitted-input context exports `not-supplied` and the explicitly-undefined context exports `unresolved`. Add a compile-time fixture for an omitted release property mirroring the existing branch and dist-id fixtures.
2. Verify RED, then add the released-harness-version member to the supported OTel start-context interface as a required `string | undefined`, declared exactly like the branch and dist-id members.
3. Add the matching optional member to the shared visualizer start-context type, and extend the visualizer's resource-context projection with the same own-property guard the dist id already uses so an omitted property stays distinguishable from an unresolved one.
4. Run the focused wire test through ai-conductor scoped-run, run the typecheck target that covers test files, and commit.

**Done when:**
1. A wire-boundary integration exports a `conductor.run` span whose resource `service.version` equals the release value supplied to the supported start context.
2. The same integration exports `not-supplied` for an omitted release property and `unresolved` for an explicitly undefined one.
3. A compile-time fixture rejects a supported OTel start context that omits the release property, alongside the existing branch and dist-id fixtures.
4. The shared visualizer start-context type gains only an optional member, so existing visualizer call sites typecheck unchanged.

### Task 3: Resolve the running engine's release at both start boundaries
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/index.ts, src/conductor/src/daemon-cli.ts, src/conductor/test/daemon-otel-wiring.test.ts, src/conductor/test/integration/visualizer-selection.test.ts
**Dependencies:** 2

**Steps:**
1. Extend the daemon wiring integration with RED cases that inject the module-relative release resolver: assert the exported span resource `service.version` for two different injected values, assert the resolver receives the daemon module directory, and assert that a version source resolving to the unknown marker still exports `0.0.0` with the dispatch reaching its terminal export.
2. Extend the interactive visualizer-selection fixtures with the release property, add the compile-time fixture for an omitted property, and assert the interactive start-context builder returns the release value it was given.
3. Verify RED, then await the existing module-relative release resolver at the interactive start-context builder and at the daemon per-feature wiring, passing the resolved string into the supported start context beside the existing dist-id call.
4. Introduce no second probe: neither boundary may add a cwd-relative lookup, a cached module-level value, or a new fallback, because the existing resolver already returns the unknown marker and never rejects. Run both focused test files through ai-conductor scoped-run, run the typecheck target that covers test files, and commit.

**Done when:**
1. The daemon dispatch integration asserts the exported span resource `service.version` equals each of two injected release values and that the resolver was called with the daemon module directory.
2. A version source with no readable semver value exports `service.version` as `0.0.0` and the dispatch still produces its terminal `conductor.run` export.
3. The interactive start-context builder returns the release value it was given, and its compile-time fixture rejects an omitted release property.
4. Each boundary calls the existing module-relative release resolver exactly once with its own module directory, and neither adds another version probe.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a trace resource context supplies a resolved released harness version, when the trace resource is built, then it carries `service.version` set to that value alongside the existing `conductor.engine.version` dist id. | 1 | "A trace-scope unit case asserts `service.version` holds the supplied release value while `conductor.engine.version` keeps its supplied dist id." | diff-local |
| Story 1 happy: Given two runs execute on different engine dist ids built from one harness release, when their `conductor.run` spans are exported, then both span resources carry the same `service.version` value, so a backend groups them under one release label. | 1, 2 | "Two trace resources sharing one release value but different dist ids expose an identical `service.version`." | diff-local |
| Story 1 negative: Given the trace resource context omits the released-harness-version property entirely, when the trace resource is built, then `service.version` is `not-supplied` and building does not throw. | 1, 2 | "Omitted and unresolved release inputs expose `not-supplied` and `unresolved` respectively, and neither build throws." | diff-local |
| Story 1 negative: Given the trace resource context supplies the released-harness-version property as undefined or empty, when the trace resource is built, then `service.version` is `unresolved` and building does not throw. | 1, 2 | "Omitted and unresolved release inputs expose `not-supplied` and `unresolved` respectively, and neither build throws." | diff-local |
| Story 2 happy: Given an interactive run starts its visualizers, when the OTel start context is created, then it carries the released harness version resolved from the running engine module directory. | 3 | "The interactive start-context builder returns the release value it was given, and its compile-time fixture rejects an omitted release property." | diff-local |
| Story 2 happy: Given the daemon dispatches a feature, when that feature's span is exported, then the span resource carries the released harness version resolved from the running daemon module directory. | 3 | "The daemon dispatch integration asserts the exported span resource `service.version` equals each of two injected release values and that the resolver was called with the daemon module directory." | diff-local |
| Story 2 negative: Given no candidate `VERSION` source for the running module holds a semver-shaped value, when a run exports a trace, then `service.version` is the explicit `0.0.0` unknown marker rather than an absent attribute, and the run still reaches its terminal export. | 3 | "A version source with no readable semver value exports `service.version` as `0.0.0` and the dispatch still produces its terminal `conductor.run` export." | diff-local |
| Story 3 happy: Given a resource context supplies a released harness version, when the metric resource is built, then its attribute set is exactly the five feature-stable attributes and contains no `service.version`. | 1 | "The metric-scope exact-key case supplies a release value and still asserts exactly the five feature-stable keys, and metric resources built under two different release values compare equal." | diff-local |
| Story 3 negative: Given two metric resources are built for one feature under different released harness versions, when their attribute sets are compared, then the sets are identical, so `target_info` gains no series. | 1 | "The metric-scope exact-key case supplies a release value and still asserts exactly the five feature-stable keys, and metric resources built under two different release values compare equal." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local against controlled fixtures. Task 1 owns the unit dispositions for both signal scopes: trace attribute presence and value, the two identity markers, and the metric exact-key and cross-version equality assertions that bound backend series growth. Task 2 owns the wire-seam integration proof, which is the first production boundary the release value crosses: a real start context through the real visualizer to an in-memory span exporter. Task 3 owns the entry-point integration proof for both supported boundaries, with the release resolver injected at the daemon dispatch and the interactive builder asserted directly. The unknown-marker negative is owned once, at Task 3, because the resolver that produces the marker only participates at the boundaries. Existing resource, wire, and daemon wiring coverage supplies the unchanged permutations for the other identity attributes; no new aggregate, end-to-end, or external-service test is added, and no terminal validation task exists.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3
