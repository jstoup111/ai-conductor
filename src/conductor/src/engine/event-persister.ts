import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ConductorEvent } from '../types/index.js';
import { ConductorEventEmitter, type EventHandler } from '../ui/events.js';

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
export const ALL_EVENT_TYPES: Array<ConductorEvent['type']> = [
  'step_started',
  'step_completed',
  'step_failed',
  'provider_attempt',
  'feature_usage_total',
  'provider_fallback',
  'session_policy',
  'step_retry',
  'checkpoint_reached',
  'recovery_needed',
  'gate_blocked',
  'tier_skip',
  'config_skip',
  'navigation_back',
  'rate_limit',
  'session_reset',
  'credentials_park',
  'credentials_park_progress',
  'feature_complete',
  'dashboard_refresh',
  'auto_heal',
  'mode_skip',
  'build_progress',
  'unattributed_progress',
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

/**
 * Marker property stamped on every event forwarded from a feature-scoped bus
 * onto the daemon-wide bus. The feature-scoped bus already renders the event
 * (tagged) via its own listeners before forwarding; without this marker the
 * daemon-wide TerminalSubscriber would render the same event a second time,
 * untagged (see beginFeatureRun in daemon-cli.ts).
 */
export const FORWARDED_FROM_FEATURE = Symbol('forwardedFromFeature');

class ForwardingEventEmitter extends ConductorEventEmitter {
  constructor(private readonly globalEvents: ConductorEventEmitter) {
    super();
  }

  override async emit(event: ConductorEvent): Promise<void> {
    await super.emit(event);
    const forwarded = { ...event } as ConductorEvent & { [FORWARDED_FROM_FEATURE]?: true };
    forwarded[FORWARDED_FROM_FEATURE] = true;
    await this.globalEvents.emit(forwarded);
  }
}

export async function withFeatureEventPersistence<T>(input: {
  worktreePath: string;
  globalEvents: ConductorEventEmitter;
  run: (featureEvents: ConductorEventEmitter) => Promise<T>;
}): Promise<T> {
  const scope = startFeatureEventPersistence(
    input.worktreePath,
    input.globalEvents,
  );
  try {
    return await input.run(scope.events);
  } finally {
    scope.stop();
  }
}

export function startFeatureEventPersistence(
  worktreePath: string,
  globalEvents: ConductorEventEmitter,
): { events: ConductorEventEmitter; stop: () => void } {
  const featureEvents = new ForwardingEventEmitter(globalEvents);
  const persister = new EventPersister(
    join(worktreePath, '.pipeline', 'events.jsonl'),
    featureEvents,
  );
  persister.start();
  return {
    events: featureEvents,
    stop: () => persister.stop(),
  };
}
