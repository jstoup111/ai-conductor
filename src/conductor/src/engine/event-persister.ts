import { appendFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  epochAnchoredMonotonicClock,
  type IntervalClock,
} from '../execution/observed-interval.js';
import type { ConductorEvent } from '../types/index.js';
import { ConductorEventEmitter, type EventHandler } from '../ui/events.js';
import { resolveExecutionIdentity, type ExecutionScope } from './execution-identity.js';
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
  private readonly settledSteps = new Map<string, number>();
  private readonly openGroups = new Map<string, number>();
  private readonly executionScope: ExecutionScope;
  private dirEnsured = false;

  constructor(
    filePath: string,
    emitter: ConductorEventEmitter,
    clock: IntervalClock = epochAnchoredMonotonicClock,
  ) {
    this.filePath = filePath;
    this.emitter = emitter;
    this.clock = clock;
    this.executionScope = { featureId: filePath, runId: 'event-persister' };

    this.handler = (event: ConductorEvent): void => {
      this.persist(event);
    };
  }

  /**
   * Subscribe to all ConductorEvent types.
   */
  start(): void {
    for (const type of ledgerEventTypes()) {
      this.emitter.on(type, this.handler);
    }
  }

  /**
   * Unsubscribe from all ConductorEvent types.
   */
  stop(): void {
    for (const type of ledgerEventTypes()) {
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
      const executionContext = 'executionContext' in event ? event.executionContext : undefined;
      // A refusal ends a serial step's attempt, so it closes that step's
      // interval exactly as a completion or failure does (adr-2026-08-12 D1:
      // every started execution closes on the ledger). A validation-group
      // member never opened `step:<member>` — the group owns `parallel:<entry>`
      // — so its refusal finds no open interval here, carries none, and closes
      // nothing; `parallel_failure` still closes the group.
      const closesStep = (
        event.type === 'step_completed'
        || event.type === 'step_failed'
        || event.type === 'step_refused'
      );
      const closesGroup = (
        event.type === 'parallel_completed'
        || (event.type === 'parallel_failure' && event.terminal !== false)
      );
      const intervalKey = step === undefined
        ? undefined
        : this.intervalKey(step, executionContext);
      const openIntervals = closesGroup ? this.openGroups : this.openSteps;
      const startedAtMs = intervalKey !== undefined && (closesStep || closesGroup)
        ? openIntervals.get(intervalKey)
        : undefined;
      const finishedAtMs = startedAtMs === undefined
        ? undefined
        : closesStep ? this.settledSteps.get(intervalKey!) ?? this.clock.nowMs() : this.clock.nowMs();
      const activeInterval = closesStep
        || closesGroup
        ? startedAtMs === undefined || finishedAtMs === undefined ? undefined : {
            startedAtMs,
            durationMs: Math.max(0, finishedAtMs - startedAtMs),
          }
        : undefined;
      const lifecycleEvent = event.type === 'provider_attempt' ? event : undefined;
      const lifecycle = lifecycleEvent?.lifecycle;
      const lifecycleIdentity = lifecycleEvent === undefined
        ? undefined
        : this.intervalKey(lifecycleEvent.step, lifecycleEvent.executionContext);
      const lifecycleKey = lifecycle === undefined || lifecycleIdentity === undefined
        ? undefined
        : `provider-lifecycle:${lifecycleIdentity}:${lifecycle.attemptId}`;
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
      if (event.type === 'step_started' && intervalKey !== undefined) {
        this.openSteps.set(intervalKey, this.clock.nowMs());
      } else if (event.type === 'parallel_started' && intervalKey !== undefined) {
        this.openGroups.set(intervalKey, this.clock.nowMs());
      } else if (event.type === 'group_member_step' && event.phase === 'result') {
        const settlementKey = this.intervalKey(event.member, event.executionContext);
        if (settlementKey !== undefined && this.openSteps.has(settlementKey)) {
          this.settledSteps.set(settlementKey, this.clock.nowMs());
        }
      } else if (startedAtMs !== undefined && intervalKey !== undefined) {
        openIntervals.delete(intervalKey);
        if (closesStep) this.settledSteps.delete(intervalKey);
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

  private intervalKey(legacyStep: string, executionContext: unknown): string | undefined {
    return resolveExecutionIdentity({
      scope: this.executionScope,
      legacyStep,
      executionContext,
    })?.correlationKey;
  }
}

/** Member settlement is persisted so its clock boundary reaches the terminal record. */
function ledgerEventTypes(): ConductorEvent['type'][] {
  return [...new Set<ConductorEvent['type']>([...persistedEventTypes(), 'group_member_step'])];
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
const forwardedFeature = new WeakMap<ConductorEvent, string>();

export function isForwardedFromFeature(event: ConductorEvent): boolean {
  return forwardedFromFeature.has(event);
}

/** Feature identity is forwarding metadata, deliberately not a mutable event payload field. */
export function forwardedFeatureOf(event: ConductorEvent): string | undefined {
  return forwardedFeature.get(event);
}

class ForwardingEventEmitter extends ConductorEventEmitter {
  constructor(private readonly globalEvents: ConductorEventEmitter, private readonly slug?: string) {
    super();
  }

  override async emit(event: ConductorEvent): Promise<void> {
    await super.emit(event);
    // Forward an independent event envelope.  In particular, a configured
    // member's nested subject is execution identity, not listener-local
    // decoration: the daemon-wide metrics projection must receive it intact.
    const forwarded = cloneForwardedEvent(event);
    forwardedFromFeature.add(forwarded);
    if (this.slug) forwardedFeature.set(forwarded, this.slug);
    await this.globalEvents.emit(forwarded);
  }
}

function cloneForwardedEvent(event: ConductorEvent): ConductorEvent {
  if (!('executionContext' in event) || event.executionContext === undefined) {
    return { ...event };
  }
  return {
    ...event,
    executionContext: {
      ...event.executionContext,
      subject: { ...event.executionContext.subject },
    },
  };
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
  slug?: string,
): { events: ConductorEventEmitter; stop: () => void } {
  const featureEvents = new ForwardingEventEmitter(globalEvents, slug ?? basename(worktreePath));
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

/** Persist only daemon-origin events. Feature copies already have their own ledger. */
export function startDaemonEventPersistence(
  mainRoot: string,
  events: ConductorEventEmitter,
  log: (message: string) => void = () => {},
): { stop: () => void } {
  const persister = new EventPersister(join(mainRoot, '.daemon', 'events.jsonl'), events);
  const handler: EventHandler = (event) => {
    if (isForwardedFromFeature(event)) return;
    try {
      // EventPersister is intentionally private; invoke its subscribed handler through a small local emitter
      // would duplicate subscriptions. The direct method is runtime-private only and preserves its schema.
      (persister as unknown as { persist(event: ConductorEvent): void }).persist(event);
    } catch (error) {
      log(`[daemon] event persistence failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  for (const type of persistedEventTypes()) events.on(type, handler);
  return { stop: () => { for (const type of persistedEventTypes()) events.off(type, handler); } };
}
