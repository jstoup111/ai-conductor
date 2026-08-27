import type { ConductorEventEmitter } from '../../ui/events.js';
import type { ResolvedOtelConfig } from './otel-config.js';
import { OtelVisualizer, type OtelVisualizerContext } from './otel-visualizer.js';

/**
 * Construct an `OtelVisualizer` with production wiring (FR-8).
 *
 * Bridges `onWarning` to a `renderer_error` ConductorEvent on the shared bus so
 * transport failures surface to the operator as structured events instead of
 * silent drops. Constructor errors (e.g. a disabled config passed by mistake)
 * are caught, surfaced as `renderer_error`, and `null` is returned so the run
 * proceeds with OTel disabled.
 *
 * This is the single construction site: the built-in `visualizer:otel` factory
 * registered by `registerBuiltins` (`../plugin-loader.ts`) calls it, and the
 * FR-8 regression tests drive it directly so their proofs bind the shipped
 * path while still injecting fake exporters through `OtelVisualizerContext`.
 */
export function createOtelVisualizer(
  resolved: ResolvedOtelConfig,
  ctx: Omit<OtelVisualizerContext, 'onWarning'>,
  events: ConductorEventEmitter,
): OtelVisualizer | null {
  const onWarning = (msg: string): void => {
    void events.emit({ type: 'renderer_error', rendererName: 'otel', error: msg });
  };
  try {
    return new OtelVisualizer(resolved, { ...ctx, onWarning });
  } catch (err) {
    onWarning(err instanceof Error ? err.message : String(err));
    return null;
  }
}
