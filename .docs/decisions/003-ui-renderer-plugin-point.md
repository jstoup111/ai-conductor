# ADR 003: UIRenderer as Plugin Point; UISubscriber Demoted to Lifecycle Wrapper

**Date:** 2026-04-19
**Status:** APPROVED

## Context

`UISubscriber` (`src/conductor/src/ui/types.ts:17`) currently exposes only `start()/stop()`. Rendering happens inside a closure passed to `createTerminalSubscriber(events, render)`. A second renderer (web-SSE, JSON-stdout, structured log) would have to reinvent the entire event subscription pipeline — there is no contract for "thing that consumes a `ConductorEvent`."

Two refactor options were considered:

**Option A (Thicken UISubscriber):** Add `handle(event)` to `UISubscriber`. Each backend implements the full subscription lifecycle and the rendering. Simpler interface count (one), but every backend re-implements identical event-bus subscription glue.

**Option B (Split: Renderer is the plugin point, Subscriber is internal):** Introduce `UIRenderer.handle(event)/stop()` as the small plugin contract. Demote `UISubscriber` to internal infrastructure that subscribes to the event bus and dispatches to one or more `UIRenderer`s via `Promise.all`. Plugin authors write a single-file `UIRenderer` — they never touch event-bus internals.

## Decision

Adopt **Option B**.

### `UIRenderer` interface (the plugin contract)

```ts
export interface UIRenderer {
  handle(event: ConductorEvent): Promise<void>;
  stop(): Promise<void>;
}
```

### `UISubscriber` interface (internal lifecycle wrapper, not a plugin point)

```ts
export interface UISubscriber {
  start(renderers: UIRenderer[]): void;  // subscribes to event bus, fan-out via Promise.all
  stop(): Promise<void>;                  // calls stop() on each renderer
}
```

### Multi-renderer dispatch

`UISubscriber.start()` subscribes once to the conductor event bus. For every event:

```ts
await Promise.all(renderers.map(r =>
  r.handle(event).catch(err => emitRendererError(r, event, err))
));
```

A renderer that throws does not poison the others; a `renderer_error` event is emitted with the renderer name and original error, and remaining renderers receive subsequent events normally.

### Plugin registry integration

`TerminalRenderer` (the renamed `create-renderer.ts` → `terminal-renderer.ts`, now a class implementing `UIRenderer`) registers itself as `kind: ui_renderer, name: terminal` via the loader (ADR-002). New backends drop into `~/.ai-conductor/plugins/<name>/` with `plugin.yml` declaring `kind: ui_renderer`.

### File rename

`src/conductor/src/ui/create-renderer.ts` → `src/conductor/src/ui/terminal-renderer.ts`. The old name described the closure-factory pattern; the new name describes the class. Test file renamed in lockstep.

## Consequences

- **Pro:** A new backend is one file (`class JsonRenderer implements UIRenderer { ... }`) plus a manifest. Zero conductor edits.
- **Pro:** Headless mode (no renderers registered) is well-defined: events fire into the void, no error.
- **Pro:** `renderer_error` makes per-renderer failures observable without crashing the conductor.
- **Pro:** `Promise.all` lets renderers run concurrently — slow renderers don't serialize.
- **Con:** `UISubscriber` is now internal infrastructure with no third-party extension point. Acceptable — third parties extend at the renderer layer.
- **Con:** Renderers that depend on each other's side effects (none currently exist) would have undefined behavior under `Promise.all`. Documented as out of scope.
- **Public-API impact:** `UISubscriber`'s shape changes (`start()` now takes `renderers: UIRenderer[]`). No third-party plugins exist yet, so this is internal-only churn — does not require a MAJOR bump.

## Evidence

- `src/conductor/src/ui/subscriber.ts` is currently 1.7K — small enough that the refactor is mechanical.
- `Promise.all` per-event is bounded by registered renderer count (typically 1–2); no scaling concern.
- Closure-based renderer pattern in `create-renderer.ts:` returns a render function; the refactor simply moves that function onto a class with `handle()`.
