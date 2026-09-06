# Implementation Plan: Report progress-bypassed build retries against their own allowance

**Date:** 2026-09-06
**Stories:** .docs/stories/report-progress-bypassed-build-retries-against-the.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent adds optional fields to one existing event union member and changes no budget, ceiling, halt classification, configuration key, or control flow, so it cannot contradict an in-flight requirement.

## Summary

Four bounded tasks deliver #1513. The build step's completion-miss retry decision stops describing a refunded attempt with the fixed slot it never consumes, and starts carrying the progress allowance that actually governed it. One shared formatting helper then renders that allowance at the three retry-line call sites, and the span recorder carries it onto the retry span. Retry budgets, ceiling policy, halt classification, and every non-build retry are outside this slice.

## Technical Approach

The build step's completion-miss retry decision currently emits the retry with `attempt + 1` and the fixed step maximum, then decrements `attempt` when the progress bypass fired. Because the decrement is a refund, the slot the next attempt will occupy is the current `attempt`, not `attempt + 1` — so on a refunded retry the emitted number is one past the slot and, after enough refunds, one past the maximum on the same event. Emit `attempt` on the refunded branch and leave the ordinary branch emitting `attempt + 1` unchanged. This makes the fixed pair self-consistent on every retry without touching the refund itself, the completion gate, or the ceiling backstop.

The allowance that actually governs a refunded retry is the progress-attempt counter checked against `build_progress_halt.attempt_ceiling`. The counter already lives at retry-loop scope; the ceiling is currently resolved inside the nested bypass block and discarded. Hoist a ceiling variable next to the existing bypass flag, assign it where the bypass is taken, and carry both values on the emit.

Extend the existing `step_retry` member of the `ConductorEvent` union with two additive optional fields for the consumed progress attempt and its ceiling, present together or not at all. This is the shape the event spine blesses for an occurrence the bus already carries: one union, one persister, one reader path, and every current consumer reads named fields so an absent pair is inert. Do not overload the existing fixed pair, and do not introduce a flag whose meaning changes what the fixed pair denotes — a consumer that knows nothing about progress bypass must keep reading the fixed pair correctly.

Rendering is already centralized: the module that owns retry-line formatting exports the reason and progress-delta helpers, and is imported by the daemon CLI renderer and both terminal renderers. Add one pure counter helper there that returns the bare fixed counter when the progress pair is absent or only half-present, and the fixed counter followed by a distinct allowance fragment when both values are present. Each of the three call sites then substitutes the helper for its inline interpolation while keeping its own surrounding wording, prefix, and colour — the daemon line and the terminal lines phrase the retry differently and must stay that way.

The OpenTelemetry retry span event copies the fixed pair from the same event. Add the two allowance attributes there only when both fields are present, so a retry without them records exactly the attributes it records today rather than two undefined-valued ones.

Testing follows the repository's test-authoring rules. The emit correction is proved at the conductor boundary, because the refund and the emit are a single engine behavior and the existing attempt-ceiling fixture already drives real consecutive task-resolving build attempts with an injected step runner and no third-party contact; assert on collected events, not on a full lifecycle. The formatter is a pure function and is proved by unit cases. The three renderers and the span recorder are proved by their existing fixture styles, which feed one constructed event through the real render or record path. No test may reach a real provider, GitHub, or network, and none is added here that could.

Documentation: the build-progress ceilings section of the stalled-or-stuck-feature runbook is the canonical operator-facing description of this behavior and gains the new log fragment. No configuration key, CLI flag, step, gate, hook, or skill changes, so no other documentation page is affected.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, additive optional fields over overloading the existing pair, and both stories on 2026-09-06 (delegated).
- Verified: the build completion-miss retry decision in `conductor.ts` emits `step_retry` with `attempt + 1` and the fixed step maximum, and decrements `attempt` immediately afterwards when the bypass flag is set.
- Verified: the bypass flag is declared at retry-loop scope; the progress-attempt counter is declared at step scope; the ceiling is read from `build_progress_halt.attempt_ceiling` inside a nested block and is not visible at the emit.
- Verified: `format-retry-line.ts` exports the reason, progress-delta, and build-position helpers and is imported by the daemon CLI renderer and by both terminal renderers, which are the only three retry-line call sites.
- Verified: the OpenTelemetry span manager's retry handler sets the attempt, maximum, and reason attributes on a span event from the same fields.
- Verified: the conductor test suite already contains a build-progress attempt-ceiling fixture that drives consecutive task-resolving build attempts with an injected step runner, and the daemon-render, create-renderer-progress, and span-manager suites already contain retry fixtures to extend.
- Verified: the build-progress ceilings section of the stalled-or-stuck-feature runbook is the canonical operator-facing description of the refunded-retry behavior.
- Scope check: consumer-facing engine reporting; no new skill; provider-agnostic. Event spine: no new channel — additive optional fields on an existing union member.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior cited above was read in this worktree; no pending product or scope assumption remains.

## Tasks

### Task 1: Carry the progress allowance on the refunded retry
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/types/events.ts, src/conductor/src/engine/conductor.ts, src/conductor/test/engine/conductor.test.ts
**Dependencies:** none

**Steps:**
1. Add a conductor test beside the existing attempt-ceiling fixture that drives consecutive task-resolving build attempts under a small attempt ceiling and a fixed maximum of three, collecting every emitted retry event.
2. Assert RED on the current behavior: later refunded retries report an attempt number greater than their own maximum, and no allowance fields are present.
3. Add two additive optional fields to the `step_retry` member of the event union for the consumed progress attempt and its ceiling, documented as present together only on a refunded build retry.
4. Hoist a ceiling variable next to the existing bypass flag and assign it where the bypass is taken.
5. On the refunded branch emit the current attempt rather than the incremented one and include both allowance fields; leave the ordinary branch and the refund itself untouched.
6. Run the scoped conductor test file, then commit.

**Done when:**
1. Every retry event observed in the new conductor test has an attempt number no greater than its own stated maximum.
2. Each refunded retry event carries a consumed progress-attempt count one higher than the previous refunded retry and a ceiling equal to the configured attempt ceiling.
3. A build retry that resolved no additional tasks, and every retry from a step other than build, emit neither allowance field.

### Task 2: Format the counter and its allowance in one shared helper
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/format-retry-line.ts, src/conductor/test/format-retry-line.test.ts
**Dependencies:** 1

**Steps:**
1. Write table-driven unit cases for a new counter helper covering fixed-only input, input carrying both allowance values, and input carrying only one of the two.
2. Establish RED, then implement the helper as a pure function returning the bare fixed counter when the allowance pair is absent or half-present, and the fixed counter followed by a distinct allowance fragment when both values are present.
3. Run the scoped formatting test file, then commit.

**Done when:**
1. The helper returns exactly the bare fixed counter string for an input with no allowance fields.
2. The helper returns the fixed counter plus an allowance fragment naming the consumed count and the ceiling when both allowance values are present.
3. An input carrying only one of the two allowance values falls back to the bare fixed counter and renders no undefined value.

### Task 3: Render the allowance at all three retry-line call sites
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/src/ui/terminal-renderer.ts, src/conductor/src/ui/create-renderer.ts, src/conductor/test/engine/daemon-render.test.ts, src/conductor/test/ui/terminal-renderer.test.ts, src/conductor/test/create-renderer-progress.test.ts
**Dependencies:** 2

**Steps:**
1. Add an allowance-bearing retry fixture to each of the three renderer test files, asserting the rendered line contains both the in-range fixed counter and the allowance fragment, and keep every pre-existing fixed-only fixture as the regression guard.
2. Establish RED, then replace the inline attempt-over-maximum interpolation at each call site with the shared helper, preserving each site's own prefix, wording, and colour.
3. Run the three scoped renderer test files, then commit.

**Done when:**
1. The daemon log line for a refunded retry contains the in-range fixed counter and the allowance fragment.
2. Both terminal renderer fixtures produce those same two elements for the same event.
3. Every pre-existing retry fixture across the three files passes unchanged and its output contains no allowance fragment.

### Task 4: Record the allowance on the retry span and document the line
**Story:** Story 1
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/otel/span-manager.ts, src/conductor/test/engine/otel/span-manager.test.ts, docs/runbooks/stalled-or-stuck-feature.md
**Dependencies:** 1

**Steps:**
1. Add span-manager cases for an allowance-bearing retry and for a retry with no allowance fields, asserting the recorded span-event attributes in each.
2. Establish RED, then set the two allowance attributes on the retry span event only when both fields are present on the incoming event.
3. Extend the build-progress ceilings section of the stalled-or-stuck-feature runbook with the new log fragment and what it tells an operator triaging a running build.
4. Run the scoped span-manager test file, then commit.

**Done when:**
1. An allowance-bearing retry records the consumed progress-attempt count and its ceiling as attributes on its retry span event.
2. A retry with no allowance fields records only the pre-existing attempt, maximum, and reason attributes and adds no undefined-valued attribute.
3. The build-progress ceilings runbook section names the allowance fragment and states that the fixed counter now stays within its own maximum.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a build attempt resolves more tasks than the previous attempt and the progress-attempt ceiling has not been reached, when the retry is emitted, then its fixed-retry attempt number is the slot the next attempt reuses and is never greater than the stated maximum on the same event. | 1 | "Every retry event observed in the new conductor test has an attempt number no greater than its own stated maximum." | diff-local |
| Story 1 happy: Given that same refunded retry, when it is emitted, then it additionally carries the number of progress attempts consumed so far and the configured progress-attempt ceiling. | 1 | "Each refunded retry event carries a consumed progress-attempt count one higher than the previous refunded retry and a ceiling equal to the configured attempt ceiling." | diff-local |
| Story 1 happy: Given a refunded retry, when the daemon log line and both terminal renderers render it, then each line shows the in-range fixed counter and, distinctly from it, the consumed progress-attempt count and its ceiling. | 2, 3 | "Both terminal renderer fixtures produce those same two elements for the same event." | diff-local |
| Story 1 happy: Given a refunded retry, when the OpenTelemetry span recorder consumes it, then the retry span event carries the consumed progress-attempt count and its ceiling alongside the existing fixed attempt and maximum. | 4 | "An allowance-bearing retry records the consumed progress-attempt count and its ceiling as attributes on its retry span event." | diff-local |
| Story 1 negative: Given a build retry whose attempt resolved no additional tasks, when it is emitted and rendered, then it carries no progress-attempt count and no ceiling, and every rendered line reads exactly as it did before this change. | 1, 3 | "A build retry that resolved no additional tasks, and every retry from a step other than build, emit neither allowance field." | diff-local |
| Story 2 happy: Given a step retry that consumed a fixed retry, when the daemon log line and both terminal renderers render it, then the line carries the plain fixed counter and no progress-allowance fragment. | 3 | "Every pre-existing retry fixture across the three files passes unchanged and its output contains no allowance fragment." | diff-local |
| Story 2 negative: Given a retry record carrying no progress-attempt fields, such as one replayed from an event log written before those fields existed, when the renderers and the span recorder consume it, then they report the fixed pair alone and add no text fragment or span attribute holding an undefined value. | 2, 4 | "A retry with no allowance fields records only the pre-existing attempt, maximum, and reason attributes and adds no undefined-valued attribute." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local: each is decided by fixtures and code inside this diff, and no commit outside it can change whether they hold. Task 1 owns the engine boundary — the emitted retry contract for both the refunded and the ordinary branch — proved at the conductor with an injected step runner and no third-party contact. Task 2 owns pure formatting cases. Task 3 owns the three render call sites, each exercised through its existing renderer fixture style with one constructed event. Task 4 owns the span-recording boundary and the runbook paragraph. Existing retry fixtures across all four suites supply the unchanged-behavior permutations and are kept rather than rewritten, so Story 2 is guarded by tests that predate this change. No aggregate, external-service, or terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3
Task 1 -> Task 4
