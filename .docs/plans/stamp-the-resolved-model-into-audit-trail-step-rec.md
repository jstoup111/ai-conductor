# Implementation Plan: Stamp the resolved model into audit-trail step records

**Date:** 2026-09-06
**Stories:** .docs/stories/stamp-the-resolved-model-into-audit-trail-step-rec.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; scoped intent conforms to the existing audit-trail contract: one derived record per handled bus event, whole-line append, additive optional fields, and no new sink or event-union member.

## Summary

Four bounded tasks deliver #640 by keeping two fields the completed-step bus event already carries instead of discarding them at the audit-trail projection. The stamp is attribution only. No gate, verdict, dashboard, or routing decision reads it, model selection is untouched, and the issue's optional commit-trailer extension is outside this slice.

## Technical Approach

Add two optional fields to the audit record type: `model`, the model that produced the completed step's result, and `provider`, the provider that actually produced that result. Both are documented on the type as attribution-only, so a later reader cannot mistake them for an enforcement input. Neither is ever written as an empty string or null; an absent source value omits the key, matching how every other optional field on this record already behaves.

Change exactly one projection: the completed-step case of the writer's private event-to-record mapping. Today that case returns a bare pass record, or `null` when a gate verdict for the same step was already observed in this process. The revised case computes the attribution pair once and then chooses between two records. With no prior verdict it returns the existing pass record, unchanged in origin and reason, with the attribution pair merged in. With a prior verdict it returns an attribution record whose event string is the source event type, carrying only the attribution pair — and, when there is no model to record, it returns `null` exactly as it does today. That keeps duplicate-suppression behavior identical for every event that carries no model, so no existing fixture changes meaning, while guaranteeing that a resolved model is never dropped.

Use the producing provider rather than the routing preference. The source event carries both a preferred provider and the provider that produced the successful result; only the latter answers "who ran this". When the source names no producing provider, omit the key rather than falling back to the preference, so the field never asserts something the engine did not observe.

Nothing upstream needs plumbing. The runner already stamps its resolved model onto the step result, the conductor already forwards that onto the bus with the producing provider, and the sink registry already declares the completed-step event audited, so the writer is handed both values on every dispatch. This is a projection fix, not new instrumentation.

Test at the writer's own seam, which is where the behavior lives: construct the real writer over a temporary directory, subscribe it to a real event emitter, emit real events, and read the appended lines back. That is the established pattern in the existing writer test file and uses the real internal path end to end with no third-party boundary in play. Assert key absence with an explicit property check, not a truthiness check, so an empty-string regression cannot pass. Do not run a conductor to prove a projection.

Documentation is part of the same change: the reference page that publishes this record's shape enumerates its fields and the strings the writer emits, and both enumerations go stale the moment the projection changes.

## Preconditions and claim ledger

- Operator approved Small scope, attribution-only intent, technical track, and both stories on 2026-09-06 (delegated).
- Verified: `src/conductor/src/types/events.ts:316-331` declares the completed-step event with optional `model`, `preferredProvider`, and `actualProvider`.
- Verified: `src/conductor/src/engine/step-runners.ts:1363` populates that event's `model` from the runner result's `resolvedModel`.
- Verified: `src/conductor/src/engine/conductor.ts:11411` forwards the step result's model onto the bus alongside the preferred and actual providers.
- Verified: `src/conductor/src/engine/event-sinks.ts:41` declares the completed-step event `audit: true`, so the writer already subscribes to it.
- Verified: `src/conductor/src/engine/audit-trail.ts:27-53` defines the record type with no model or provider field, and `:287-293` is the projection that drops both, returning `null` when the step already has a recorded verdict.
- Verified: `src/conductor/test/engine/audit-trail.test.ts` already exercises the writer through a real emitter and covers both the first-pass and already-verdicted completed-step paths, so the negative criteria extend existing fixtures rather than introducing a new harness.
- Verified: `docs/reference/artifacts.md:794-822` publishes the record type and enumerates the emitted event strings and the subscribed source events.
- Scope check: consumer-facing engine behavior documented under the reference tree; no skill addition; provider-agnostic. Event spine: no new channel, an existing sink's projection only.
- Verify-claims verdict: CLEAR. Every path, symbol, and line above was read in this worktree; no pending product or scope assumption remains.

## Tasks

### Task 1: Carry the resolved model onto the completed-step audit record
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/audit-trail.ts, src/conductor/test/engine/audit-trail.test.ts
**Dependencies:** none

**Steps:**
1. Write failing writer fixtures that subscribe the real writer to a real emitter and emit a completed-step event carrying a resolved model, once with no prior gate verdict for that step and once after a satisfied gate verdict for the same step.
2. Establish RED, then add an optional `model` field to the record type, documented as attribution only and never consumed by a gate.
3. Rework the completed-step projection to compute the attribution value once, merge it into the existing pass record on the no-prior-verdict path, and return an attribution record whose event string is the source event type on the already-verdicted path.
4. Run the focused writer test file through the repository's scoped test invocation, run the typecheck target that includes test files, and commit the focused change.

**Done when:**
1. A completed-step event with a resolved model and no prior verdict appends exactly one record whose event is the existing pass string and whose model equals the event's model.
2. A completed-step event with a resolved model for an already-verdicted step appends exactly one additional record whose event names the source event type and whose model equals the event's model.
3. No other projection case in the writer changes shape, and every pre-existing fixture in the writer test file still passes unmodified.

### Task 2: Preserve today's behavior when no model was resolved
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/audit-trail.ts, src/conductor/test/engine/audit-trail.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing writer fixtures for a completed-step event with no model, once after a satisfied gate verdict for the same step and once with no prior verdict for that step.
2. Establish RED, then confirm the projection returns null on the already-verdicted no-model path and the unmodified pass record on the no-verdict no-model path.
3. Assert absence with an explicit own-property check on the parsed record so an empty string or null value fails the fixture.
4. Run the focused writer test file through the repository's scoped test invocation and commit.

**Done when:**
1. A completed-step event with no model for an already-verdicted step appends no line at all.
2. A completed-step event with no model and no prior verdict appends one pass record on which the model key is absent rather than empty or null.

### Task 3: Qualify the recorded model with the producing provider
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/audit-trail.ts, src/conductor/test/engine/audit-trail.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing writer fixtures emitting a completed-step event that carries a resolved model together with a producing provider, and a second that carries a resolved model with only a preferred provider and no producing provider.
2. Establish RED, then add an optional `provider` field to the record type, documented as the provider that produced the result rather than the routing preference.
3. Populate it from the source event's producing provider only, on both the pass-record and attribution-record paths, omitting the key when that value is absent.
4. Run the focused writer test file through the repository's scoped test invocation, run the typecheck target that includes test files, and commit.

**Done when:**
1. A completed-step event naming a producing provider appends a record whose provider equals that value verbatim, on both the no-prior-verdict and already-verdicted paths.
2. A completed-step event naming only a preferred provider appends a record on which the provider key is absent while the model is still recorded.

### Task 4: Publish the new record shape in the artifacts reference
**Story:** Story 2
**Type:** happy-path
**Files:** docs/reference/artifacts.md
**Dependencies:** 1, 3

**Steps:**
1. Read the audit-trail section of the reference page and locate the record type block and the sentence enumerating the strings the writer emits.
2. Add both new optional fields to the published record type in the same inline style the block already uses.
3. Update the emitted-string enumeration and its stated count to include the attribution record, and state that the two new fields are attribution only with no consumer.
4. Commit the documentation change with the implementation it describes.

**Done when:**
1. The published record type block lists both new optional fields.
2. The emitted-string enumeration and its stated count include the attribution record and remain consistent with the writer's projection.
3. The section states that the recorded model and provider are attribution only and that no gate reads them.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a completed-step event carries a resolved model and no gate verdict has been recorded for that step, when the audit writer handles it, then it appends one positive-evidence pass record carrying that model. | 1 | "A completed-step event with a resolved model and no prior verdict appends exactly one record whose event is the existing pass string and whose model equals the event's model." | diff-local |
| Story 1 happy: Given a completed-step event carries a resolved model for a step whose gate verdict was already recorded, when the audit writer handles it, then it appends one attribution record carrying that model instead of a duplicate pass record. | 1 | "A completed-step event with a resolved model for an already-verdicted step appends exactly one additional record whose event names the source event type and whose model equals the event's model." | diff-local |
| Story 1 negative: Given a completed-step event carries no model for a step whose gate verdict was already recorded, when the audit writer handles it, then it appends no record at all. | 2 | "A completed-step event with no model for an already-verdicted step appends no line at all." | diff-local |
| Story 1 negative: Given a completed-step event carries no model and no gate verdict has been recorded for that step, when the audit writer handles it, then it appends the existing pass record with no model key present. | 2 | "A completed-step event with no model and no prior verdict appends one pass record on which the model key is absent rather than empty or null." | diff-local |
| Story 2 happy: Given a completed-step event carries a resolved model and the provider that produced the result, when the audit writer handles it, then the appended record carries that provider alongside the model. | 3 | "A completed-step event naming a producing provider appends a record whose provider equals that value verbatim, on both the no-prior-verdict and already-verdicted paths." | diff-local |
| Story 2 negative: Given a completed-step event carries a resolved model but no provider that produced the result, when the audit writer handles it, then the appended record carries the model with no provider key present. | 3 | "A completed-step event naming only a preferred provider appends a record on which the provider key is absent while the model is still recorded." | diff-local |

## Test dispositions and integration ownership

All six criteria are diff-local against controlled fixtures at the writer's own seam. Task 1 owns the positive model-attribution cases, Task 2 owns the absent-model cases, and Task 3 owns both provider cases. Every fixture constructs the real writer over a temporary directory, subscribes it to a real event emitter, and reads the appended lines back, so the real internal path runs end to end; no third-party boundary is crossed and no fake is required. No conductor run is added, because the behavior under test is one projection and completes without orchestration. Task 4 is documentation and carries no test. The pre-existing writer fixtures remain authoritative for every other projection case and for write-failure handling; no aggregate or external-service test is added, and no terminal validation task is required.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3 -> Task 4
