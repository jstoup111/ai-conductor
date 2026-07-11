# Tier: S

Source: jstoup111/ai-conductor#546

## Rationale

Small, well-bounded change against machinery that already exists:

- The `step_retry` event variant (`src/conductor/src/types/events.ts`, lines
  28-34) already carries `reason: string`. The only additions are two OPTIONAL
  numeric fields for the progress delta.
- Both emit sites already have the values in scope:
  - `src/conductor/src/engine/conductor.ts` ~line 1847 (session-ended-with-error
    path) — emits `reason: lastError`; `resolvedTasksBefore` (function-scoped
    `let`, line 1563) is in scope.
  - `src/conductor/src/engine/conductor.ts` ~line 2365 (completion-check-failed
    path) — emits `reason: completion.reason`; both `resolvedTasksBefore`
    (line 1563) and `resolvedTasksAfter` (`const`, line 2065, inside the same
    `if (!completion.done)` block) are in scope.
- The daemon log line that drops the reason is a single `case 'step_retry'` in
  `renderDaemonEvent` / `renderDaemonEventUnsafe`
  (`src/conductor/src/daemon-cli.ts`, lines 1480-1482). Two more renderers
  (`terminal-renderer.ts:146-150`, `create-renderer.ts:130-134`) already print
  `reason` and only need the optional delta appended.
- A dedicated `renderDaemonEvent` unit test already exists
  (`src/conductor/test/engine/daemon-render.test.ts`) with a `step_retry`
  sample, so the RED test has an established home.

No architectural change, no new module, no schema/CLI/hook surface. The reason
string and progress delta are computed and discarded today; this makes them
durable on one log line. Well under the S ceiling — estimated 4 tasks.

## Not larger because

- No new event type — the existing `step_retry` variant is extended additively.
- No cross-cutting refactor; the render change is localized to the three
  existing `step_retry` render cases.
- The only genuinely new logic is a tiny single-line collapse/truncate helper to
  keep the reason on one log line (#521 log-noise bar). That is a pure string
  function with straightforward tests.
