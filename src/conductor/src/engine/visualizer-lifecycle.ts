import type { VisualizerPlugin } from '../types/plugin.js';
import type { ConductorEventEmitter } from '../ui/events.js';
import type { PluginRegistry } from './plugin-registry.js';

/**
 * Start every visualizer plugin by calling `.start(emitter)`. Returns the same
 * array (for chaining). Called immediately after EventPersister is started.
 */
export function buildVisualizers(
  visualizers: VisualizerPlugin[],
  emitter: ConductorEventEmitter,
): VisualizerPlugin[] {
  for (const vis of visualizers) {
    let warned = false;
    const warn = (err: unknown): void => {
      if (warned) return;
      warned = true;
      console.warn(
        `[visualizer] visualizer '${vis.name}' start() error: ${err instanceof Error ? err.message : String(err)}`,
      );
    };
    try {
      emitter.withIsolatedHandlerRegistrations(() => vis.start(emitter), warn);
    } catch (err: unknown) {
      warn(err);
    }
  }
  return visualizers;
}

export function startRegisteredVisualizers(
  registry: PluginRegistry,
  emitter: ConductorEventEmitter,
  builtIns: VisualizerPlugin[] = [],
): VisualizerPlugin[] {
  const registered = registry.list('visualizer').map(
    (name) => registry.get<VisualizerPlugin>('visualizer', name),
  );
  return buildVisualizers([...builtIns, ...registered], emitter);
}

/**
 * Stop every visualizer plugin, swallowing individual errors so one failing
 * exporter cannot prevent the others from flushing.
 */
export async function stopVisualizers(visualizers: VisualizerPlugin[]): Promise<void> {
  await Promise.all(
    visualizers.map(async (vis) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve().then(() => vis.stop()),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('timed out after 2000ms')), 2_000);
          }),
        ]);
      } catch (err: unknown) {
        try {
          console.warn(
            `[visualizer] visualizer '${vis.name}' stop() error: ${err instanceof Error ? err.message : String(err)}`,
          );
        } catch {
          /* reporting failures must not block shutdown */
        }
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    }),
  );
}
