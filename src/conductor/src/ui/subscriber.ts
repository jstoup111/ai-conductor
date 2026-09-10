import type { ConductorEvent } from '../types/index.js';
import { ConductorEventEmitter, type EventHandler } from './events.js';
import { renderedEventTypes } from '../engine/event-sinks.js';
import { isForwardedFromFeature } from '../engine/event-persister.js';
import type { UIRenderer, UISubscriber, UIEventHandler } from './types.js';

export type { UISubscriber, UIEventHandler } from './types.js';
/** @deprecated use UIEventHandler */
export type RenderCallback = UIEventHandler;

export const NON_RENDERABLE_DASHBOARD_EVENT_TYPES: readonly ConductorEvent['type'][] = [
  'checkpoint_reached',
  'recovery_needed',
  'dashboard_refresh',
  'tier_skip',
  'config_skip',
  'gate_blocked',
  'feature_complete',
  'auto_heal',
  'mode_skip',
  'parallel_failure',
];

export class TerminalSubscriber implements UISubscriber {
  private renderers: UIRenderer[] = [];
  private handlers: Array<{ type: ConductorEvent['type']; handler: EventHandler }> = [];

  constructor(private readonly eventEmitter: ConductorEventEmitter) {}

  start(renderers: UIRenderer[]): void {
    this.renderers = renderers;
    // Dashboard renders are event-driven. No periodic refresh — the sticky
    // live region is updated when conductor state changes. A polling refresh
    // would accumulate stale frames in the scrollback.
    const eventTypes = new Set([
      ...renderedEventTypes(),
      ...NON_RENDERABLE_DASHBOARD_EVENT_TYPES,
    ]);

    for (const type of eventTypes) {
      const handler: EventHandler = async (event) => {
        // A forwarded event has ALREADY been rendered, tagged, by its
        // feature-scoped listeners (see beginFeatureRun in daemon-cli.ts).
        // The daemon-wide `onRender` honours that marker and returns early;
        // this second sink must honour it too, or every feature gate verdict
        // prints a second, untagged copy in the daemon pane.
        if (isForwardedFromFeature(event)) return;
        await Promise.all(this.renderers.map(async (renderer) => {
          try {
            await renderer.handle(event);
          } catch (error) {
            // Do not recursively report a renderer which also fails while
            // displaying its own renderer_error diagnostic.
            if (event.type === 'renderer_error') return;
            await this.eventEmitter.emit({
              type: 'renderer_error',
              rendererName: renderer.name ?? renderer.constructor.name,
              error: String(error),
            });
          }
        }));
      };
      this.handlers.push({ type, handler });
      this.eventEmitter.on(type, handler);
    }
  }

  async stop(): Promise<void> {
    for (const { type, handler } of this.handlers) {
      this.eventEmitter.off(type, handler);
    }
    this.handlers = [];
    await Promise.all(this.renderers.map((renderer) => renderer.stop()));
    this.renderers = [];
  }
}
