# Stories: retry log lines carry the completion-check reason and progress delta

Source: jstoup111/ai-conductor#546

## Story 1 (happy): daemon retry line carries the completion-check reason

**As** an operator tailing `.daemon/daemon.log`,
**I want** every `↻ <step> retry` line to include the same reason string the
terminal `✗ <step> failed` line would print,
**so that** I can answer "why did it retry?" from the log alone, without
worktree forensics.

- **Given** a `step_retry` event with
  `reason: "5/11 tasks pending/not completed: 3, 6, ..."` and `attempt: 2`,
  `maxAttempts: 3`,
- **When** `renderDaemonEvent` renders it,
- **Then** the emitted log line contains the step name, the attempt/maxAttempts
  (`try 2/3` or equivalent), and the reason text
  `5/11 tasks pending/not completed: 3, 6, ...`,
- **And** it is exactly ONE log line (no per-task fan-out — #521 log-noise bar).

## Story 2 (happy): progress delta distinguishes forward-progress from zero-progress

**As** an operator,
**I want** a retry that made forward task progress to read differently from one
that made zero progress,
**so that** a healthy pacing retry (session ended mid-plan, count advanced) is
visually distinct from a wedged one (count unchanged).

- **Given** a build `step_retry` event whose payload carries the resolved-task
  counts `resolvedBefore: 3` and `resolvedAfter: 5`,
- **When** `renderDaemonEvent` renders it,
- **Then** the line shows the progress delta (e.g. `+2 tasks` or `3→5 tasks`),
- **And given** a payload with `resolvedBefore: 3` and `resolvedAfter: 3`,
  **then** the line shows zero progress (e.g. `+0 tasks` or `3→3 tasks`),
  making the two cases distinguishable by eye.

## Story 3 (happy): the emit sites populate reason and delta from in-scope values

**As** a maintainer,
**I want** the conductor's two `step_retry` emit sites to attach the reason and
(for the build step) the resolved-task counts they already hold,
**so that** the renderer has real data to show.

- **Given** the completion-check-failed retry path in `Conductor.run`
  (`conductor.ts` ~line 2365),
- **When** it emits `step_retry`,
- **Then** the payload includes `reason: completion.reason ?? <fallback>`,
  `resolvedBefore` = `resolvedTasksBefore`, and `resolvedAfter` =
  `resolvedTasksAfter`,
- **And given** the session-ended-with-error retry path (~line 1847),
  **then** the payload includes `reason: lastError` and (for the build step)
  the `resolvedTasksBefore` count it holds, with `resolvedAfter` omitted when it
  has not yet been computed.

## Story 4 (negative): reason absent/unavailable — line still renders, no crash

**As** an operator,
**I want** a retry with no usable reason string to still produce a clean single
line,
**so that** a missing/empty reason never crashes the renderer or the daemon
loop.

- **Given** a `step_retry` event with `reason: ""` (empty) or a reason that is
  `undefined` at the emit site (fallback substituted),
- **When** `renderDaemonEvent` renders it,
- **Then** it renders exactly one line with a sane fallback (e.g.
  `no reason recorded`) and does not throw,
- **And given** a non-build step whose payload omits `resolvedBefore`/
  `resolvedAfter`, **then** the progress-delta fragment is omitted entirely and
  the line still renders as one clean line.

## Story 5 (negative): multi-line / oversized reason respects the log-noise bar

**As** an operator,
**I want** a reason string that contains newlines or is very long to be
collapsed to a single truncated line,
**so that** one retry never explodes into many log lines (#521) or a wall of
text.

- **Given** a `step_retry` event whose `reason` contains embedded newlines and
  exceeds the single-line budget (e.g. a multi-line `result.output` fallback),
- **When** `renderDaemonEvent` renders it,
- **Then** the reason is collapsed to a single line (newlines replaced) and
  truncated to a bounded length with an ellipsis,
- **And** the total output for that retry is exactly one log line.

Status: Accepted
