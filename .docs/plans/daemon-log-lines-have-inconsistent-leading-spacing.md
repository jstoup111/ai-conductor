# Implementation Plan: daemon log indentation encodes nesting depth by one rule

**Date:** 2026-10-28
**Stories:** .docs/stories/daemon-log-lines-have-inconsistent-leading-spacing.md
**Conflict check:** skipped at Tier S

## Summary

Give every `.daemon/daemon.log` line one shape. The body after the `[daemon]`/`[daemon][<slug>]`
prefix starts with the depth marker for its declared depth. Continuation lines carry `│ ` after that
marker, so forwarded git and provider output can never fake a nesting level. Three tasks.

## Technical Approach

- **One invariant, one test, no site lists.** The rule is stated once: every line body starts with
  the marker for its declared depth (`""`, `· `, `·   `), and then either a character that is neither
  whitespace nor `·`, or `│` for a continuation line. One test file,
  `src/conductor/test/engine/daemon-log-line-shape.test.ts`, enforces it. Its core case builds a
  real fixture for every type `renderedEventTypes()` returns and renders each one through the
  production renderer and loggers. Any renderer arm that still writes its own marker, its own
  leading spaces, or a second depth fails that case. BUILD migrates arms by working through the
  case's failures. The plan deliberately lists no renderer `case` arms.
- **New module `src/conductor/src/engine/daemon-line-shape.ts`** holds three things.
  - `DaemonLogDepth = 0 | 1 | 2`.
  - `composeDaemonLineBodies(message, depth): string[]`. It splits on `\r?\n` and drops one
    trailing empty line, which matches what the loggers do today. The first line becomes
    `marker(depth)` plus the line with its leading whitespace removed; whitespace that follows
    leading ANSI SGR codes counts as leading. Each later line becomes `marker(depth) + '│ ' + line`,
    or `marker(depth) + '│'` when the line is empty.
  - `DAEMON_EVENT_DEPTH`, declared `as const satisfies DaemonEventDepthTable`. Here
    `DaemonEventDepthTable = Record<RenderedEventType, DaemonLogDepth>`, and `RenderedEventType`
    is derived from `EVENT_SINKS` entries whose `render` is `true`, the same way `OtelEventType`
    is derived in `engine/event-sinks.ts`. The module imports only `event-sinks.ts` (type) and
    `types/events.ts`, so it adds no import cycle under the layer ratchet.
- **Who composes.** Only the logger that knows the prefix composes the line.
  - `createFeatureDaemonLogger` composes at depth 0 and tags every body.
  - `createDaemonModeLogger` composes repository-wide (not feature-owned) messages at depth 0.
    Feature-owned messages arrive already composed and keep their existing per-line handling.
  - `renderDaemonEvent` composes at the event type's table depth and logs one body per call.
  - The supervisor console tee in `runDaemonMode` composes each `console.warn`/`console.error`
    message at depth 0.
  - Composing an already-composed single line changes nothing, because it starts with `·`, `│`, or
    a non-space character.
- **Table values follow one rule, decided here.** An arm whose lines all use one depth on main
  keeps that depth. An arm whose lines use more than one depth takes the deepest. Depth is read
  from the arm's ANSI-stripped output, so a `·` inside a `chalk.*()` call still counts.
  Known instances: `provider_attempt` mixes 1 and 2, `build_review_outer_verdict` mixes 1 and 2,
  and `finish_publication_transition` mixes 1 and 2, so each becomes 2.
- **Out of scope** (other #2867 splits): line wording, severity glyphs, next-action suffixes, UUIDs,
  verbosity levels, and collapsing multi-line output. `createOwnershipAwareDaemonLogger`,
  `formatDaemonConsoleTeeLine`, and `engine/executor-broker.ts` are not edited; open spec #3403
  reshapes them.
- **Local patterns to follow.**
  - Type-binding tests use `@ts-expect-error` on an incomplete `Record` (see
    `test/types/rubric-id-binding.test.ts`).
  - Tests that run `runDaemonMode` with `runDaemon` and the child executor factory mocked follow
    `test/engine/daemon-cli-executor-wiring.test.ts`.
  - Build fixtures as typed literals. Do not cast through `unknown`, so the type checker keeps every
    fixture a valid `ConductorEvent` of its type.

## Prerequisites

- none

## Tasks

### Task 1: The daemon loggers compose every line through one line composer
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-log-line-shape.test.ts` for every Done-when check below. Build a `createDaemonModeLogger` whose `writePersisted` applies `formatDaemonLogLine` with a fixed clock, and use `createFeatureDaemonLogger` over it.
2. Verify the tests fail (RED).
3. Create `src/conductor/src/engine/daemon-line-shape.ts` with `DaemonLogDepth` and `composeDaemonLineBodies` as described in Technical Approach.
4. In `src/conductor/src/engine/daemon-log.ts`:
   - `createFeatureDaemonLogger` calls `baseLog(`${featureTag} ${body}`, true)` for each body of `composeDaemonLineBodies(message, 0)`.
   - `createDaemonModeLogger` sends each body of `composeDaemonLineBodies(msg, 0)` through `writeDaemonMessage` for messages that are not feature-owned, and keeps its existing per-line split for feature-owned ones.
   - Start/resume/done suppression keeps matching the composed line.
5. Update `src/conductor/test/engine/daemon-log.test.ts` "prefixes and persists every diagnostic line independently" so that it expects `[daemon][feature-a] │ stderr continuation` for the second line.
6. Verify the tests pass (GREEN), then commit.

**Done when:**
- [test] A `createFeatureDaemonLogger('feature-a', …)` over `createDaemonModeLogger` logs the message `   ! [rejected] x`, and both the live and the persisted sink receive a line whose body after `[daemon][feature-a] ` is exactly `! [rejected] x`.
- [test] The repository-wide `createDaemonModeLogger` logs `progress re-kick: feature-a retained — halt disposition needs-human`, and the persisted line is the fixed timestamp, then `[daemon] `, then that message byte for byte, with no depth marker.
- [test] The repository-wide logger logs `first\n ! [rejected]        HEAD -> feat/x (non-fast-forward)` and persists exactly two lines, each beginning with the fixed timestamp and `[daemon] `; the first line's body is `first` and the second line's body is `│  ! [rejected]        HEAD -> feat/x (non-fast-forward)`, byte for byte.
- [test] The repository-wide logger logs `alpha\n\nbeta\n` and persists exactly three lines, with bodies `alpha`, `│`, and `│ beta`.
- [test] A feature logger logs `▶ start feature-a` twice in a row, and each of the live and persisted sinks receives exactly one line.

**Files likely touched:**
- src/conductor/src/engine/daemon-line-shape.ts — new: depth type and line composer
- src/conductor/src/engine/daemon-log.ts — both loggers compose through the composer
- src/conductor/test/engine/daemon-log-line-shape.test.ts — new: logger line-shape cases
- src/conductor/test/engine/daemon-log.test.ts — continuation expectation updated

**Dependencies:** none

### Task 2: Every rendered event type logs at the depth its table declares
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-log-line-shape.test.ts` and `src/conductor/test/types/daemon-event-depth-binding.test.ts` for every Done-when check below.
   - Add `src/conductor/test/fixtures/rendered-daemon-events.ts`, which exports `RENDERED_DAEMON_EVENT_FIXTURES: { [T in RenderedEventType]: Extract<ConductorEvent, { type: T }> }`. Give each fixture a payload its renderer arm turns into at least one line.
   - Render each fixture through `attachFeatureEventRenderer` on a real `ConductorEventEmitter`, with `createFeatureDaemonLogger` over `createDaemonModeLogger`.
2. Verify the tests fail (RED).
3. Add `DaemonEventDepthTable` and `DAEMON_EVENT_DEPTH` to `src/conductor/src/engine/daemon-line-shape.ts`. Assign the values by the rule in Technical Approach.
4. In `src/conductor/src/daemon-cli.ts`:
   - `renderDaemonEvent` passes `renderDaemonEventUnsafe` a log function. That function calls the caller's `log` once for each body of `composeDaemonLineBodies(message, DAEMON_EVENT_DEPTH[type])`.
   - Work through the every-type case's failures. Remove each arm's own `${dot}` marker and the spaces after it, including a marker inside a `chalk.*()` call, until no arm writes a marker.
5. Update the existing exact-line expectations whose depth changes under the rule, such as the exhausted `provider_attempt` and the `build_review_outer_verdict` finding lines, in `src/conductor/test/engine/daemon-render.test.ts` and `src/conductor/test/daemon-render-provider-attempt.test.ts`.
6. Verify the tests pass (GREEN), then commit.

**Done when:**
- [test] The line-shape test asserts that the fixture keys, the `DAEMON_EVENT_DEPTH` keys, and `new Set(renderedEventTypes())` are the same set; that each fixture, emitted on a `ConductorEventEmitter` wired by `attachFeatureEventRenderer`, persists at least one line; and that every persisted line body begins with the marker for `DAEMON_EVENT_DEPTH[type]` (`""`, `· `, or `·   `), followed by `│` or by a character that is neither whitespace nor `·`.
- [test] The line-shape test emits each fixture once through each of two separately created `createDaemonModeLogger` instances, and the two persisted line bodies are byte-identical.
- [test] The line-shape test renders `provider_attempt` events for one step with lifecycle phases `exhausted` and `preparing`, and both line bodies begin with the same depth marker. A `build_review_outer_verdict` with one suppressed and one advisory finding persists three lines whose bodies all begin with the same depth marker.
- [test] The line-shape test emits `halt_record_push_failed` with a three-line `reason` of git push output through a feature logger for `feature-a`. The first line body is exactly the event's normal rendered line: the marker for `DAEMON_EVENT_DEPTH.halt_record_push_failed`, then `⚠ halt record push failed: <path> — `, then the reason's first line, with nothing else; each of the next two lines is `[daemon][feature-a] `, then the same marker, then `│ `, then the reason's second or third line unchanged.
- [test] `daemon-event-depth-binding.test.ts` declares a `DaemonEventDepthTable` that omits `kickback` under `@ts-expect-error`, and `npm run typecheck:test` passes, which proves the type check rejects that table.

**Files likely touched:**
- src/conductor/src/engine/daemon-line-shape.ts — typed per-type depth table
- src/conductor/src/daemon-cli.ts — renderer composes the marker; arms emit bodies only
- src/conductor/test/engine/daemon-log-line-shape.test.ts — every-type invariant case
- src/conductor/test/fixtures/rendered-daemon-events.ts — new: one fixture per rendered type
- src/conductor/test/types/daemon-event-depth-binding.test.ts — new: table completeness type check
- src/conductor/test/engine/daemon-render.test.ts — depth-changed expectations
- src/conductor/test/daemon-render-provider-attempt.test.ts — depth-changed expectations

**Dependencies:** Task 1

### Task 3: The supervisor console tee writes multi-line output as continuation lines
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/daemon-console-tee-line-shape.test.ts` for every Done-when check below. Follow the `runDaemonMode` harness pattern named in Technical Approach. Inside the mocked `runDaemon`, call `console.warn('tee first\ntee second')`, then read `<projectRoot>/.daemon/daemon.log` after `runDaemonMode` resolves.
2. Verify the test fails (RED).
3. In `runDaemonMode`'s `teeConsoleLine` in `src/conductor/src/daemon-cli.ts`, write one sink line for each body of `composeDaemonLineBodies(stripAnsi(line), 0)`, each formatted by `formatDaemonLogLine(formatDaemonConsoleTeeLine(level, body))`.
4. Verify the test passes (GREEN), then commit.

**Done when:**
- [test] After `runDaemonMode` runs a mocked `runDaemon` that calls `console.warn('tee first\ntee second')`, `.daemon/daemon.log` holds exactly two lines for it. Both begin with an ISO-8601 timestamp followed by `[daemon] [warn] `.
- [test] In that same log, the first of the two lines ends `[warn] tee first`, and the text after the second line's `[warn] ` tag is exactly `│ tee second`.

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — console tee composes each message
- src/conductor/test/engine/daemon-console-tee-line-shape.test.ts — new: runDaemonMode tee case

**Dependencies:** Task 1

## Task Dependency Graph

```
Task 1 ──► Task 2
   └─────► Task 3
```

## Integration Points

- After Task 1: every raw daemon message is written in the new line shape through the production loggers.
- After Task 2: every rendered event type is written in the new line shape through `attachFeatureEventRenderer`, the production feature wiring.
- After Task 3: supervisor console diagnostics read back from `.daemon/daemon.log` follow the same continuation rule.

## Coverage Check

An independent coverage judge assessed every criterion row. It took two rounds, and all 13 rows assert. In round one it refused one row because the `halt_record_push_failed` first-line check asserted only a prefix; Task 2 now asserts the whole line. An independent contradiction judge found no conflict.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given any event type in the daemon's rendered event set, when an event of that type is logged, then every line body it produces begins with the depth marker declared for that type, followed by a character that is neither whitespace nor `·`. | 2 | "The line-shape test asserts that the fixture keys, the `DAEMON_EVENT_DEPTH` keys, and `new Set(renderedEventTypes())` are the same set; that each fixture, emitted on a `ConductorEventEmitter` wired by `attachFeatureEventRenderer`, persists at least one line; and that every persisted line body begins with the marker for `DAEMON_EVENT_DEPTH[type]` (`""`, `· `, or `·   `), followed by `│` or by a character that is neither whitespace nor `·`." | diff-local |
| Story 1 happy: Given the same event logged twice, once through each of two separately created daemon loggers, when both lines are persisted, then the two line bodies are byte-identical. | 2 | "The line-shape test emits each fixture once through each of two separately created `createDaemonModeLogger` instances, and the two persisted line bodies are byte-identical." | diff-local |
| Story 1 negative: Given two `provider_attempt` events for the same step, one whose lifecycle phase is `exhausted` and one whose phase is `preparing`, when both render, then both line bodies begin with the same depth marker. | 2 | "The line-shape test renders `provider_attempt` events for one step with lifecycle phases `exhausted` and `preparing`, and both line bodies begin with the same depth marker. A `build_review_outer_verdict` with one suppressed and one advisory finding persists three lines whose bodies all begin with the same depth marker." | diff-local |
| Story 1 negative: Given a `build_review_outer_verdict` event that carries a suppressed finding and an advisory finding, when it renders, then the suppressed-finding line, the advisory-finding line, and the verdict line all begin with the same depth marker. | 2 | "The line-shape test renders `provider_attempt` events for one step with lifecycle phases `exhausted` and `preparing`, and both line bodies begin with the same depth marker. A `build_review_outer_verdict` with one suppressed and one advisory finding persists three lines whose bodies all begin with the same depth marker." | diff-local |
| Story 1 negative: Given a depth table that omits one event type the sink registry marks as rendered, when the sources are type-checked, then the type check rejects that table. | 2 | "`daemon-event-depth-binding.test.ts` declares a `DaemonEventDepthTable` that omits `kickback` under `@ts-expect-error`, and `npm run typecheck:test` passes, which proves the type check rejects that table." | diff-local |
| Story 2 happy: Given a `halt_record_push_failed` event whose reason holds git push output over three lines, when it is logged by a feature logger, then the first line body is the event's normal line at its declared depth, and each later line is its own `[daemon][<slug>]` line whose body is the same depth marker, then `│ `, then that output line's original text. | 2 | "The line-shape test emits `halt_record_push_failed` with a three-line `reason` of git push output through a feature logger for `feature-a`. The first line body is exactly the event's normal rendered line: the marker for `DAEMON_EVENT_DEPTH.halt_record_push_failed`, then `⚠ halt record push failed: <path> — `, then the reason's first line, with nothing else; each of the next two lines is `[daemon][feature-a] `, then the same marker, then `│ `, then the reason's second or third line unchanged." | diff-local |
| Story 2 happy: Given a repository-wide daemon message over two lines, when it is logged, then both physical lines carry the `[daemon]` prefix, the persisted timestamp, and the depth 0 marker, and the second line body begins with `│ `. | 1 | "The repository-wide logger logs `first\n ! [rejected]        HEAD -> feat/x (non-fast-forward)` and persists exactly two lines, each beginning with the fixed timestamp and `[daemon] `; the first line's body is `first` and the second line's body is `│  ! [rejected]        HEAD -> feat/x (non-fast-forward)`, byte for byte." | diff-local |
| Story 2 negative: Given forwarded output whose line is ` ! [rejected]        HEAD -> feat/x (non-fast-forward)`, when it is logged as the second line of a repository-wide daemon message, then that line's body is `│ ` followed by the forwarded line exactly as given, including its leading space and inner column padding. | 1 | "The repository-wide logger logs `first\n ! [rejected]        HEAD -> feat/x (non-fast-forward)` and persists exactly two lines, each beginning with the fixed timestamp and `[daemon] `; the first line's body is `first` and the second line's body is `│  ! [rejected]        HEAD -> feat/x (non-fast-forward)`, byte for byte." | diff-local |
| Story 2 negative: Given a multi-line message with a blank middle line and a trailing newline, when it is logged, then the blank middle line logs as a continuation line whose body after the depth marker is exactly `│`, and the trailing newline adds no line. | 1 | "The repository-wide logger logs `alpha\n\nbeta\n` and persists exactly three lines, with bodies `alpha`, `│`, and `│ beta`." | diff-local |
| Story 2 negative: Given engine code writes a two-line `console.warn` while the daemon runs, when the console tee writes it to `.daemon/daemon.log`, then both physical lines carry the timestamp, the `[daemon]` prefix, and the `[warn]` tag, and the text after the second line's `[warn] ` tag begins with `│ `. | 3 | "In that same log, the first of the two lines ends `[warn] tee first`, and the text after the second line's `[warn] ` tag is exactly `│ tee second`." | diff-local |
| Story 3 happy: Given a daemon-authored message that is not a rendered event, such as `progress re-kick: feature-a retained — halt disposition needs-human`, when it is logged, then its line body is that message exactly, with no depth marker. | 1 | "The repository-wide `createDaemonModeLogger` logs `progress re-kick: feature-a retained — halt disposition needs-human`, and the persisted line is the fixed timestamp, then `[daemon] `, then that message byte for byte, with no depth marker." | diff-local |
| Story 3 negative: Given a message that begins with leading spaces, such as `   ! [rejected] x`, when a feature logger logs it, then the line body written to both the live and the persisted sink is `! [rejected] x`. | 1 | "A `createFeatureDaemonLogger('feature-a', …)` over `createDaemonModeLogger` logs the message `   ! [rejected] x`, and both the live and the persisted sink receive a line whose body after `[daemon][feature-a] ` is exactly `! [rejected] x`." | diff-local |
| Story 3 negative: Given a feature logger logs `▶ start feature-a` twice in a row, when both reach the daemon logger, then only the first is written, exactly as before this change. | 1 | "A feature logger logs `▶ start feature-a` twice in a row, and each of the live and persisted sinks receives exactly one line." | diff-local |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] `ai-conductor plan-protected-targets` passes

### Task rem-as-built-fix-kickback-depth-zero: src/conductor/src/engine/daemon-line-shape.ts: set DAEMON_EVENT_DEPTH.kickback (and navigation_back, plus any other arm markerless on main) to 0 per the plan's keep-main-depth rule and ADR adr-2026-07-04 D1/D3
**Gate:** as-built
**Rationale:** Verified (99%): on main the kickback arm logs `↩ KICKBACK: ...` with no `·` marker (depth 0), matching ADR adr-2026-07-04 D1 (prefix-free prominent line). The plan's Technical Approach rule says an arm whose lines all use one depth on main keeps that depth, so DAEMON_EVENT_DEPTH.kickback must be 0, not 1. This is implementation drift from approved architecture and the approved plan, with no new architectural decision needed; Task 2 (Step 3: assign values by the rule; Step 5: update depth-changed expectations) admits the repair. Sibling in the same defect class: `navigation_back` (ADR D3 `↰ BACK:` line, also markerless on main) is admitted by the same Task 2 rule and should be checked and corrected too; any other arm that was markerless on main must likewise be depth 0. Task 2's completed behavior and coverage survive: the every-type line-shape invariant still holds at depth 0 (empty marker followed by a non-space, non-`·` character).
**Governing clause:** adr-2026-07-04-kickback-event-emission-and-log-prominence decision 1
**Done when:**
- adr-2026-07-04-kickback-event-emission-and-log-prominence decision 1 is satisfied by this task.
- The repair for task rem-as-built-fix-kickback-depth-zero is committed and its targeted tests pass.

### Task rem-as-built-fix-kickback-test-expectations: src/conductor/test/engine/daemon-render.test.ts (:272, :278, :284, :636) and src/conductor/test/engine/daemon-mode-feature-log.integration.test.ts (:122): restore prefix-free `↩ KICKBACK: ...` exact-line expectations (and `↰ BACK:` if affected); add a line-shape assertion that kickback persists with no `· ` marker
**Gate:** as-built
**Rationale:** Verified (99%): on main the kickback arm logs `↩ KICKBACK: ...` with no `·` marker (depth 0), matching ADR adr-2026-07-04 D1 (prefix-free prominent line). The plan's Technical Approach rule says an arm whose lines all use one depth on main keeps that depth, so DAEMON_EVENT_DEPTH.kickback must be 0, not 1. This is implementation drift from approved architecture and the approved plan, with no new architectural decision needed; Task 2 (Step 3: assign values by the rule; Step 5: update depth-changed expectations) admits the repair. Sibling in the same defect class: `navigation_back` (ADR D3 `↰ BACK:` line, also markerless on main) is admitted by the same Task 2 rule and should be checked and corrected too; any other arm that was markerless on main must likewise be depth 0. Task 2's completed behavior and coverage survive: the every-type line-shape invariant still holds at depth 0 (empty marker followed by a non-space, non-`·` character).
**Governing clause:** adr-2026-07-04-kickback-event-emission-and-log-prominence decision 1
**Done when:**
- adr-2026-07-04-kickback-event-emission-and-log-prominence decision 1 is satisfied by this task.
- The repair for task rem-as-built-fix-kickback-test-expectations is committed and its targeted tests pass.
