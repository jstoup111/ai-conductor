import type { ConductorEvent } from '../types/index.js';
import { ConductorEventEmitter, type EventHandler } from './events.js';

export interface UISubscriber {
  start(): void;
  stop(): void;
}

export type RenderCallback = (event: ConductorEvent) => void;

export class TerminalSubscriber implements UISubscriber {
  private eventEmitter: ConductorEventEmitter;
  private onRender: RenderCallback;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private handlers: Array<{ type: ConductorEvent['type']; handler: EventHandler }> = [];

  constructor(eventEmitter: ConductorEventEmitter, onRender: RenderCallback) {
    this.eventEmitter = eventEmitter;
    this.onRender = onRender;
  }

  start(): void {
    const eventTypes: ConductorEvent['type'][] = [
      'step_started',
      'step_completed',
      'step_failed',
      'checkpoint_reached',
      'recovery_needed',
      'dashboard_refresh',
      'tier_skip',
      'config_skip',
      'gate_blocked',
      'feature_complete',
    ];

    for (const type of eventTypes) {
      const handler: EventHandler = (event) => this.onRender(event);
      this.handlers.push({ type, handler });
      this.eventEmitter.on(type, handler);
    }

    this.refreshInterval = setInterval(() => {
      this.eventEmitter.emit({ type: 'dashboard_refresh' });
    }, 10_000);
  }

  stop(): void {
    for (const { type, handler } of this.handlers) {
      this.eventEmitter.off(type, handler);
    }
    this.handlers = [];

    if (this.refreshInterval !== null) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}
