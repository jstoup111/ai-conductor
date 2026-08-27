import { registerBuiltins } from '../plugin-loader.js';
import { PluginRegistry } from '../plugin-registry.js';
import type { HarnessConfig } from '../../types/config.js';
import type {
  VisualizerFactory,
  VisualizerPlugin,
  VisualizerStartContext,
} from '../../types/plugin.js';
import type { ConductorEventEmitter } from '../../ui/events.js';
import { resolveOtelConfig } from './otel-config.js';

/**
 * Create and start the OTel visualizer for one event stream.
 *
 * The built-in registry factory owns visualizer construction; this helper owns
 * only the per-stream lifecycle wiring so each entry point follows the same
 * configuration gate and start seam.
 */
export function wireOtelVisualizer(
  config: HarnessConfig,
  context: VisualizerStartContext & { pipelineDir: string },
  events: ConductorEventEmitter,
): VisualizerPlugin | null {
  if (!resolveOtelConfig(config, context.pipelineDir).enabled) return null;

  const registry = new PluginRegistry();
  registerBuiltins(registry, events, () => {});
  registry.markInitialized();
  const factory = registry.get<VisualizerFactory>('visualizer', 'otel');
  const visualizer = factory({
    config,
    pipelineDir: context.pipelineDir,
    startContext: context,
    emitter: events,
  });

  if (!visualizer) return null;
  visualizer.start(events, context);
  return visualizer;
}
