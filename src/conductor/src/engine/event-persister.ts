import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  epochAnchoredMonotonicClock,
  type IntervalClock,
} from '../execution/observed-interval.js';
import type { ConductorEvent } from '../types/index.js';
import { ConductorEventEmitter, type EventHandler } from '../ui/events.js';
import { persistedEventTypes } from './event-sinks.js';

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
  private readonly clock: IntervalClock;
  private readonly openSteps = new Map<string, number>();
  private readonly openGroups = new Map<string, number>();
  private dirEnsured = false;

  constructor(
    filePath: string,
    emitter: ConductorEventEmitter,
    clock: IntervalClock = epochAnchoredMonotonicClock,
  ) {
    this.filePath = filePath;
    this.emitter = emitter;
    this.clock = clock;

    this.handler = (event: ConductorEvent): void => {
      this.persist(event);
    };
  }

  /**
   * Subscribe to all ConductorEvent types.
   */
  start(): void {
    for (const type of persistedEventTypes()) {
      this.emitter.on(type, this.handler);
    }
  }

  /**
   * Unsubscribe from all ConductorEvent types.
   */
  stop(): void {
    for (const type of persistedEventTypes()) {
      this.emitter.off(type, this.handler);
    }
  }

  private persist(event: ConductorEvent): void {
    try {
      if (!this.dirEnsured) {
        mkdirSync(dirname(this.filePath), { recursive: true });
        this.dirEnsured = true;
      }
      const step = 'step' in event && typeof event.step === 'string'
        ? event.step
        : undefined;
      const closesStep = (
        event.type === 'step_completed'
        || event.type === 'step_failed'
      );
      const closesGroup = (
        event.type === 'parallel_completed'
        || event.type === 'parallel_failure'
      );
      const openIntervals = closesGroup ? this.openGroups : this.openSteps;
      const startedAtMs = step !== undefined && (closesStep || closesGroup)
        ? openIntervals.get(step)
        : undefined;
      const activeInterval = closesStep
        || closesGroup
        ? startedAtMs === undefined ? undefined : {
            startedAtMs,
            durationMs: Math.max(0, this.clock.nowMs() - startedAtMs),
          }
        : undefined;
      const lifecycleEvent = event.type === 'provider_attempt' ? event : undefined;
      const lifecycle = lifecycleEvent?.lifecycle;
      const lifecycleKey = lifecycle === undefined
        ? undefined
        : `provider-lifecycle:${lifecycleEvent!.step}:${lifecycle.attemptId}`;
      const lifecycleNow = lifecycle === undefined ? undefined : this.clock.nowMs();
      const lifecycleStartedAt = lifecycleKey === undefined
        ? undefined
        : this.openSteps.get(lifecycleKey);
      const lifecycleInterval = lifecycleStartedAt === undefined || lifecycleNow === undefined
        ? undefined
        : {
            startedAtMs: lifecycleStartedAt,
            durationMs: Math.max(0, lifecycleNow - lifecycleStartedAt),
          };
      const record = JSON.stringify({
        ...event,
        ...(lifecycleInterval
          ? { observedIntervals: [...(lifecycleEvent?.observedIntervals ?? []), lifecycleInterval] }
          : {}),
        ...(activeInterval ? { activeInterval } : {}),
        ts: new Date().toISOString(),
      });
      appendFileSync(this.filePath, record + '\n', 'utf-8');
      if (event.type === 'step_started') {
        this.openSteps.set(event.step, this.clock.nowMs());
      } else if (event.type === 'parallel_started') {
        this.openGroups.set(event.step, this.clock.nowMs());
      } else if (startedAtMs !== undefined && step !== undefined) {
        openIntervals.delete(step);
      }
      if (lifecycleKey !== undefined && lifecycleNow !== undefined) {
        if (lifecycle?.phase === 'settled' || lifecycle?.phase === 'exhausted') {
          this.openSteps.delete(lifecycleKey);
        } else {
          this.openSteps.set(lifecycleKey, lifecycleNow);
        }
      }
    } catch (err) {
      throw new EventPersistError(this.filePath, err);
    }
  }
}

/**
 * Tracks every event forwarded from a feature-scoped bus onto the daemon-wide
 * bus. The feature-scoped bus already renders the event (tagged) via its own
 * listeners before forwarding; without this marker the daemon-wide
 * TerminalSubscriber would render the same event a second time, untagged (see
 * beginFeatureRun in daemon-cli.ts). Keeping this out of the event object
 * preserves the closed ConductorEvent contract while forwarding.
 */
const forwardedFromFeature = new WeakSet<ConductorEvent>();

export function isForwardedFromFeature(event: ConductorEvent): boolean {
  return forwardedFromFeature.has(event);
}

class ForwardingEventEmitter extends ConductorEventEmitter {
  constructor(private readonly globalEvents: ConductorEventEmitter) {
    super();
  }

  override async emit(event: ConductorEvent): Promise<void> {
    await super.emit(event);
    const forwarded: ConductorEvent = { ...event };
    forwardedFromFeature.add(forwarded);
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
