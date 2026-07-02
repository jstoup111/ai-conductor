import type { ConductorEvent } from '../../src/conductor/src/types/index.js';
import type { UISubscriber } from '../../src/conductor/src/ui/types.js';
import type { ConductorEventEmitter, EventHandler } from '../../src/conductor/src/ui/events.js';

/**
 * JsonStdoutSubscriber — Feature 3.2
 *
 * Emits every ConductorEvent as a newline-delimited JSON line to stdout.
 * Each line includes all original event fields plus a `ts` ISO timestamp.
 *
 * Selectable via `ui_renderer: json-stdout` in .ai-conductor/config.yml.
 *
 * Design: handle() is a no-op (silent) before start() and after stop().
 * This matches the TerminalSubscriber contract for safe lifecycle management.
 *
 * When constructed with a ConductorEventEmitter, start()/stop() subscribe to
 * and unsubscribe from all relevant event types on the real event bus (see
 * TerminalSubscriber for the same pattern). The emitter is optional so unit
 * tests can continue to drive handle() directly without a bus.
 */
const SUBSCRIBED_EVENT_TYPES: ConductorEvent['type'][] = [
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
  'mode_skip',
  'build_stall',
  'renderer_error',
];

export class JsonStdoutSubscriber implements UISubscriber {
  private started = false;
  private eventEmitter?: ConductorEventEmitter;
  private handlers: Array<{ type: ConductorEvent['type']; handler: EventHandler }> = [];

  constructor(eventEmitter?: ConductorEventEmitter) {
    this.eventEmitter = eventEmitter;
  }

  start(): void {
    this.started = true;

    if (this.eventEmitter) {
      for (const type of SUBSCRIBED_EVENT_TYPES) {
        const handler: EventHandler = (event) => this.handle(event);
        this.handlers.push({ type, handler });
        this.eventEmitter.on(type, handler);
      }
    }
  }

  stop(): void {
    this.started = false;

    if (this.eventEmitter) {
      for (const { type, handler } of this.handlers) {
        this.eventEmitter.off(type, handler);
      }
      this.handlers = [];
    }
  }

  handle(event: ConductorEvent): void {
    if (!this.started) return;
    const line = JSON.stringify({ ...event, ts: new Date().toISOString() }) + '\n';
    process.stdout.write(line);
  }
}

// Default export for plugin loader discovery
export default new JsonStdoutSubscriber();
