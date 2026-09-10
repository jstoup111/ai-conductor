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

export const FORWARDED_TO_TERMINAL_RENDERER_EVENT_TYPES: readonly ConductorEvent['type'][] = [
  'halt_marker_write_failed',
  'renderer_error',
  'pipeline_tail_diagnostic',
];

export class TerminalSubscriber implements UISubscriber {
  private eventEmitter: ConductorEventEmitter;
  private onRender: UIEventHandler;
  private handlers: Array<{ type: ConductorEvent['type']; handler: EventHandler }> = [];

  constructor(
    eventEmitter: ConductorEventEmitter,
    onRender: UIEventHandler,
    private readonly terminalRenderer?: UIRenderer,
  ) {
    this.eventEmitter = eventEmitter;
    this.onRender = onRender;
  }

  start(_renderers: UIRenderer[] = []): void {
    // Dashboard renders are event-driven. No periodic refresh — the sticky
    // live region is updated when conductor state changes. A polling refresh
    // would accumulate stale frames in the scrollback.
    const eventTypes = new Set([
      ...renderedEventTypes(),
      ...NON_RENDERABLE_DASHBOARD_EVENT_TYPES,
    ]);

    for (const type of eventTypes) {
      const handler: EventHandler = async (event) => {
        await this.onRender(event);
        // A forwarded event has ALREADY been rendered, tagged, by its
        // feature-scoped listeners (see beginFeatureRun in daemon-cli.ts).
        // The daemon-wide `onRender` honours that marker and returns early;
        // this second sink must honour it too, or every feature gate verdict
        // prints a second, untagged copy in the daemon pane.
        if (isForwardedFromFeature(event)) return;
        if (FORWARDED_TO_TERMINAL_RENDERER_EVENT_TYPES.includes(event.type)) {
          await this.terminalRenderer?.handle(event);
        }
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
  }
}
