import type { ConductorEvent } from '../types/index.js';
import { ConductorEventEmitter, type EventHandler } from './events.js';
import type { UISubscriber, UIEventHandler } from './types.js';

export type { UISubscriber, UIEventHandler } from './types.js';
/** @deprecated use UIEventHandler */
export type RenderCallback = UIEventHandler;

export class TerminalSubscriber implements UISubscriber {
  private eventEmitter: ConductorEventEmitter;
  private onRender: UIEventHandler;
  private handlers: Array<{ type: ConductorEvent['type']; handler: EventHandler }> = [];

  constructor(eventEmitter: ConductorEventEmitter, onRender: UIEventHandler) {
    this.eventEmitter = eventEmitter;
    this.onRender = onRender;
  }

  start(): void {
    // Dashboard renders are event-driven. No periodic refresh — the sticky
    // live region is updated when conductor state changes. A polling refresh
    // would accumulate stale frames in the scrollback.
    const eventTypes: ConductorEvent['type'][] = [
      'step_started',
      'step_completed',
      'step_failed',
      'step_retry',
      'checkpoint_reached',
      'recovery_needed',
      'dashboard_refresh',
      'tier_skip',
      'config_skip',
      'gate_blocked',
      'rate_limit',
      'session_reset',
      'feature_complete',
      'auto_heal',
    ];

    for (const type of eventTypes) {
      const handler: EventHandler = (event) => this.onRender(event);
      this.handlers.push({ type, handler });
      this.eventEmitter.on(type, handler);
    }
  }

  stop(): void {
    for (const { type, handler } of this.handlers) {
      this.eventEmitter.off(type, handler);
    }
    this.handlers = [];
  }
}
