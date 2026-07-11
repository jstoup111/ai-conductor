import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ConductorEvent } from '../types/index.js';
import type { ConductorEventEmitter, EventHandler } from '../ui/events.js';

/**
 * Thrown when EventPersister cannot append to the event log file.
 */
export class EventPersistError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly cause?: unknown,
  ) {
    super(
      `EventPersister failed to write to ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'EventPersistError';
  }
}

/**
 * All ConductorEvent types — used to subscribe to every event kind.
 */
const ALL_EVENT_TYPES: Array<ConductorEvent['type']> = [
  'step_started',
  'step_completed',
  'step_failed',
  'step_retry',
  'checkpoint_reached',
  'recovery_needed',
  'gate_blocked',
  'tier_skip',
  'config_skip',
  'navigation_back',
  'rate_limit',
  'session_reset',
  'feature_complete',
  'dashboard_refresh',
  'auto_heal',
  'mode_skip',
  'build_progress',
  'build_no_progress',
  'build_stall',
  'renderer_error',
  'when_skip',
  'parallel_started',
  'parallel_completed',
  'parallel_failure',
  'attribution_divergence',
];

/**
 * EventPersister subscribes to every ConductorEvent and appends each event
 * as a newline-delimited JSON line (with timestamp) to the specified file.
 *
 * Parent directories are created on first write.
 * Write errors surface as EventPersistError (re-thrown through the emitter).
 */
export class EventPersister {
  private readonly filePath: string;
  private readonly emitter: ConductorEventEmitter;
  private readonly handler: EventHandler;
  private dirEnsured = false;

  constructor(filePath: string, emitter: ConductorEventEmitter) {
    this.filePath = filePath;
    this.emitter = emitter;

    this.handler = (event: ConductorEvent): void => {
      this.persist(event);
    };
  }

  /**
   * Subscribe to all ConductorEvent types.
   */
  start(): void {
    for (const type of ALL_EVENT_TYPES) {
      this.emitter.on(type, this.handler);
    }
  }

  /**
   * Unsubscribe from all ConductorEvent types.
   */
  stop(): void {
    for (const type of ALL_EVENT_TYPES) {
      this.emitter.off(type, this.handler);
    }
  }

  private persist(event: ConductorEvent): void {
    try {
      if (!this.dirEnsured) {
        mkdirSync(dirname(this.filePath), { recursive: true });
        this.dirEnsured = true;
      }
      const record = JSON.stringify({ ...event, ts: new Date().toISOString() });
      appendFileSync(this.filePath, record + '\n', 'utf-8');
    } catch (err) {
      throw new EventPersistError(this.filePath, err);
    }
  }
}
