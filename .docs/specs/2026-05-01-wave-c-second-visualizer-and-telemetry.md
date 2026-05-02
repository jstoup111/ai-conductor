# Design: Wave C — Second Visualizer + Telemetry & Structured Event Log

**Date:** 2026-05-01
**Status:** Approved

## Problem

Waves A and B delivered a pluggable harness (plugin loader, RunMode resolution, autonomous
escalation, thickened `UISubscriber`, `RecorderProvider`, conditional + parallel workflow
primitives). Two gaps from `.docs/specs/2026-04-12-pluggable-harness-architecture.md` remain:

1. **The UI abstraction has only one consumer.** `TerminalSubscriber` is the sole renderer.
   Without a second consumer, the abstraction is unproven — we cannot demonstrate that a
   non-terminal renderer can be installed via the Wave A loader and selected via config.

2. **No observability layer.** Conductor events are emitted to subscribers but not persisted.
   Per-step timing, retry counts, and token spend are invisible after a run completes. There
   is no way to ask "where did the last run spend its time?" or "which step retries the most?"
   The harness optimization targets (correctness, gates, minimal intervention) cannot be
   measured against actual runs.

## Solution

Two independent features shipping concurrently in two separate worktrees, each opening its
own PR to main.

### Feature 3.2 — JSON-events-to-stdout subscriber

A second UI plugin that proves the abstraction. Each `ConductorEvent` from the bus is
serialized to a single JSON line on `stdout`:

```
{"type":"step_started","step":"brainstorm","index":3,"ts":"2026-05-01T14:23:11.482Z"}
{"type":"step_completed","step":"brainstorm","status":"done","ts":"2026-05-01T14:24:02.119Z"}
```

- Lives at `plugins/json-stdout-subscriber/` with `plugin.yml` (`kind: ui_renderer`,
  `name: json-stdout`) and `index.ts` exporting a class that implements `UISubscriber`
  from Wave B
- Installs via the Wave A `discoverPlugins()` loader without any edits to
  `src/conductor/src/index.ts`
- Selectable via config: `ui_renderer: json-stdout` in `.ai-conductor/config.yml`
- Newline-delimited JSON, suitable for piping into `jq`, `tee`, or external dashboards
- Integration test starts the conductor with this subscriber configured and asserts the
  event stream is parseable line-by-line and contains the expected event types

The Express SSE dashboard explored as Approach B remains a viable future plugin built on
top of the same `UISubscriber` shape — Feature 3.2 deliberately establishes the
subscribe-and-emit pattern so a future plugin can layer HTTP/SSE on top without touching
the engine. (See Key Decision #1.)

### Feature 4.1 — Telemetry + structured event log

Three deliverables in one PR:

1. **Persistent event log at `.pipeline/events.jsonl`.** A new `EventPersister` module
   (in `src/conductor/src/engine/`) subscribes to the existing `ConductorEventEmitter` as
   a listener (does NOT modify emission sites) and appends every event with a timestamp
   to the JSONL file. Replayable for post-mortems and tooling.

2. **Per-step timing + retry tracking.** Captured by deriving start/end pairs from
   `step_started` / `step_completed` / `step_failed` events. Retry counts come from
   `step_retry` events already on the bus. Token spend per step comes from a small,
   backwards-compatible extension to the `LLMProvider` interface (see Key Decision #2).

3. **`conduct --report` subcommand.** Reads `.pipeline/events.jsonl` and renders three
   summary tables to stdout:
   - **Step durations** — total ms per step, sorted descending
   - **Retry hotspots** — steps with retry_count > 0, with reason breakdown
   - **Token spend** — input/output/cache tokens per step (only for steps where the
     provider reported token usage; gracefully skipped otherwise)

   The subcommand wires into `cli.ts` alongside the existing `--status`, `--cleanup`,
   `--reset` flags. It does not start a conductor session — it only reads the log.

## Scope

### In Scope (this wave)

- `plugins/json-stdout-subscriber/` plugin directory with manifest + implementation
- Integration test for the json-stdout subscriber (capture stdout, parse lines, assert)
- `EventPersister` module subscribing to the conductor event bus
- `.pipeline/events.jsonl` writer (newline-delimited JSON, append-only, every event
  carries a `ts` field)
- Optional `tokenUsage` field on `InvokeResult` in `src/conductor/src/execution/llm-provider.ts`
- `ClaudeProvider` populates `tokenUsage` by parsing Claude CLI's `stream-json` output
- `RecorderProvider` populates `tokenUsage` with deterministic synthesized counts (so
  recorded fixtures are useful for testing the report)
- `conduct --report` subcommand with three summary tables
- CHANGELOG `[Unreleased]` entries on each PR
- Migration block on the 4.1 PR if the new `--report` subcommand conflicts with anything;
  otherwise just a changelog note (it does not appear to conflict — `--report` is unused)
- VERSION stays on 0.99.x; let CI auto-patch

### Out of Scope (deferred or explicit non-goals)

- Express SSE dashboard plugin (Approach B from brainstorm) — viable future work, not
  this wave
- Web UI rendering events.jsonl in a browser — out
- Cost calculations from token counts (tokens × $/token) — out; report shows raw counts
- Historical/cross-run aggregation (e.g. "average step duration across last 10 runs") — out;
  report covers the current `events.jsonl` only
- Log rotation or size limits on `events.jsonl` — out; relies on per-feature pipeline
  directory cleanup
- Retroactive token counts for ClaudeProvider invocations that don't pass through the new
  parser path — out; only new invocations carry `tokenUsage`
- Modifying the bus's emission sites — Feature 4.1 is strictly a subscribe-and-persist
  layer

## Key Decisions

1. **JSON-stdout over Express SSE for the second visualizer.** The Wave C directive says
   "pick the simpler one." JSON-stdout has zero new deps, ~30 lines of code, and is
   trivially testable (capture stdout, parse, assert). Express SSE adds ~2MB of deps,
   port-conflict risk in parallel worktrees, and a browser dependency. The abstraction
   proof — that a non-terminal renderer plugs in via Wave A's loader — does not require
   HTTP. SSE remains a viable later plugin built on the same `UISubscriber` shape, since
   nothing in 3.2 forecloses it: both visualizers consume the same event types via the
   same subscribe interface.

2. **Token-usage extension is additive and optional.** Add `tokenUsage?: { input: number;
   output: number; cacheRead?: number; cacheCreation?: number }` to `InvokeResult`. The
   `?` makes it backwards-compatible — existing plugins (third-party `LLMProvider`
   implementations, future EchoProvider variants) work unchanged. The report skips
   token rows when the field is absent. `ClaudeProvider` parses from Claude CLI's
   `--output-format stream-json` (the JSONL stream emits `usage` events with token counts).
   `RecorderProvider` synthesizes deterministic counts so recorded fixtures yield stable
   reports. This satisfies the Wave C directive's note that the extension should be
   "generic enough that RecorderProvider can also populate it."

3. **EventPersister is a listener, not an emitter.** It subscribes to the existing
   `ConductorEventEmitter` (the same bus subscribers use). It does NOT modify any
   emission site in the conductor, step runners, or gates. This keeps the change
   strictly additive — if persistence breaks or is removed, conductor behavior is
   unaffected.

4. **`.pipeline/events.jsonl` is per-feature, not per-run.** It lives alongside the
   existing `.pipeline/conduct-state.json` and `.pipeline/task-status.json`. A new
   feature run on the same project starts a fresh `.pipeline/` directory, so the log
   naturally rotates with feature lifecycle. Cross-feature aggregation is explicit
   future work.

5. **`conduct --report` is read-only and stateless.** It does not start a session, does
   not touch state files, and does not require Claude. It only reads `events.jsonl` and
   prints. This makes it safe to run anywhere, anytime, and easy to test (snapshot the
   table output for a fixture log).

6. **Both PRs ride PATCH bumps.** Both features are MINOR-shaped (additive new
   capability), but VERSION is pinned to 0.99.x as a pre-1.0 marker per James's
   convention. Let CI auto-patch (0.99.N → 0.99.N+1). State the proposed VERSION to the
   user before opening each PR.

## Open Questions

None. Both features have well-defined surface areas, the visualizer choice is resolved
(Option A with explicit non-foreclosure of Option B), and the token-usage extension is
confirmed additive.

## Wave C Execution Sequence

```
MAIN (v0.99.14)
│
├── Feature 3.2 worktree (branch off main, PR #X)
│   - plugins/json-stdout-subscriber/{plugin.yml, index.ts}
│   - test/integration/json-stdout-subscriber.test.ts
│   - CHANGELOG entry: Added
│
└── Feature 4.1 worktree (branch off main, PR #Y)
    - src/conductor/src/engine/event-persister.ts (new)
    - src/conductor/src/engine/report-renderer.ts (new)
    - src/conductor/src/execution/llm-provider.ts (extend InvokeResult)
    - src/conductor/src/execution/claude-provider.ts (parse stream-json usage)
    - plugins/recorder-provider/index.ts (synthesize tokenUsage)
    - src/conductor/src/cli.ts (add --report flag)
    - src/conductor/src/index.ts (wire EventPersister to event bus, branch on --report)
    - test/engine/event-persister.test.ts, test/engine/report-renderer.test.ts
    - CHANGELOG entry: Added
    - Migration block: only if --report conflicts; otherwise changelog note suffices
```

3.2 and 4.1 touch disjoint files. 3.2 is a new plugin directory + new integration test.
4.1 adds new engine modules + a new CLI flag + extends the LLMProvider interface (which
has two consumers: ClaudeProvider and RecorderProvider). The only shared touch-point is
`src/conductor/src/index.ts` (4.1 needs to wire EventPersister; 3.2 does not touch it),
so light rebase may be needed if a Wave-A/B fix lands first, but no semantic conflict
between the two features.

**Merge order:** either order. If 4.1 merges first and 3.2 needs to rebase on a CHANGELOG
conflict, follow the established rule: `git checkout --ours CHANGELOG.md`, then append
only this feature's own entries. Verify commit count after every `git rebase --continue`
(`git log origin/main..HEAD | wc -l` must match expected) — Wave B's silent-commit-drop
pattern is real.

## Per-PR Gates (CLAUDE.md compliance)

1. `test/test_harness_integrity.sh` must pass — Wave A+B baseline preserved
2. `CHANGELOG.md [Unreleased]` entry present
3. Migration block — 3.2 unlikely (additive plugin, config-selectable); 4.1 only if
   `--report` clashes with existing CLI behavior (it does not appear to)
4. VERSION stayed on 0.99.x — confirm with user before opening each PR
5. `npm run build` from `src/conductor/` after every commit to `src/conductor/src/**`
6. NEVER call `gh pr merge` autonomously — user explicit approval required for every merge
