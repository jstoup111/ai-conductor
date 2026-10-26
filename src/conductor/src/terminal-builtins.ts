import type { ConductorEventEmitter } from './engine/conductor-event-emitter.js';
import type { PluginRegistry } from './engine/plugin-registry.js';
import { TerminalSubscriber } from './ui/subscriber.js';
import { TerminalRenderer, type TerminalRendererOptions } from './ui/terminal-renderer.js';
import type { UIRenderer } from './ui/types.js';

/** Registers the terminal UI at the entry-point composition boundary. */
export function registerTerminalBuiltins(
  registry: PluginRegistry,
  events: ConductorEventEmitter,
  rendererOpts?: TerminalRendererOptions,
  additionalRenderers: readonly UIRenderer[] = [],
  startSubscriber = true,
): TerminalSubscriber {
  const renderers: UIRenderer[] = [...additionalRenderers];
  if (rendererOpts) {
    const renderer = new TerminalRenderer(rendererOpts);
    registry.register('ui_renderer', 'terminal', renderer);
    renderers.unshift(renderer);
  }
  const subscriber = new TerminalSubscriber(events, renderers);
  if (startSubscriber) subscriber.start(renderers);
  return subscriber;
}
