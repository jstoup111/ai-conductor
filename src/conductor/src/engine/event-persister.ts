import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  epochAnchoredMonotonicClock,
  type IntervalClock,
} from '../execution/observed-interval.js';
import type {
  CiRepairDiagnosticDisposition,
  CiRepairDiagnosticReason,
  CiRepairDiagnosticStage,
  ConductorEvent,
} from '../types/index.js';
import { ConductorEventEmitter, type EventHandler } from '../ui/events.js';
import { resolveExecutionIdentity, type ExecutionScope } from './execution-identity.js';
import { persistedEventTypes } from './event-sinks.js';
import { CloseoutEventTail } from './closeout-tail.js';

const MAX_CI_REPAIR_DIAGNOSTIC_BYTES = 8_192;
const CI_REPAIR_STAGES = new Set<CiRepairDiagnosticStage>(['context', 'log-enrichment', 'branch', 'readiness', 'execution', 'guard', 'verification', 'publication']);
const CI_REPAIR_REASONS = new Set<CiRepairDiagnosticReason>(['auth', 'permission', 'timeout', 'api', 'capability', 'malformed-context', 'missing-context', 'missing-branch', 'log-unavailable', 'context-truncated', 'provider-unavailable', 'readiness-degraded', 'flag-invalid', 'spawn-env', 'unknown', 'guard-refused', 'verification-failed', 'publication-refused', 'verified-publication']);
const CI_REPAIR_DISPOSITIONS = new Set<CiRepairDiagnosticDisposition>(['deferred', 'degraded', 'failed', 'published']);

/** Bound untrusted attribution; raw output and hints are not event fields. */
export function boundCiRepairDiagnostic(event: ConductorEvent): ConductorEvent {
  if (event.type !== 'ci_repair_diagnostic') return event;
  const truncate = (value: string, max: number) => {
    if (Buffer.byteLength(value, 'utf8') <= max) return value;
    const marker = '[truncated]';
    let result = '';
    for (const char of value) {
      if (Buffer.byteLength(result + char + marker, 'utf8') > max) break;
      result += char;
    }
    return result + marker;
  };
  const safePrUrl = (value: string): string => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
        ? truncate(url.toString(), 2_048)
        : '[invalid]';
    } catch { return '[invalid]'; }
  };
  let bounded: ConductorEvent = {
    ...event,
    slug: /^[A-Za-z0-9._-]+$/.test(event.slug) ? truncate(event.slug, 512) : '[invalid]',
    prUrl: safePrUrl(event.prUrl),
    stage: CI_REPAIR_STAGES.has(event.stage) ? event.stage : 'execution',
    reason: CI_REPAIR_REASONS.has(event.reason) ? event.reason : 'unknown',
    disposition: CI_REPAIR_DISPOSITIONS.has(event.disposition) ? event.disposition : 'failed',
    // Provider identity is attribution, not diagnostic text. Never preserve a
    // prefix of an oversized value: a malformed adapter could otherwise place
    // a credential in that prefix. Known production identities are tiny.
    ...(event.provider === undefined ? {} : {
      provider: /^[A-Za-z0-9._-]+$/.test(event.provider)
        ? (Buffer.byteLength(event.provider, 'utf8') <= 64 ? event.provider : '[truncated]')
        : 'unknown',
    }),
  };
  if (Buffer.byteLength(JSON.stringify(bounded), 'utf8') > MAX_CI_REPAIR_DIAGNOSTIC_BYTES) {
    bounded = { ...bounded, provider: '[truncated]' };
  }
  return bounded;
}

/**
 * Thrown when EventPersister cannot append to the event log file.
 */
export class EventPersistError extends Error {
  constructor(
    public readonly filePath: string,
    public override readonly cause?: unknown,
  ) {
    super(
      `EventPersister failed to write to ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'EventPersistError';
  }
}

export interface EventPersisterDependencies {
  /** Test seam for observing the one-time canonical replay index scan. */
  readonly readPersistedEvents?: (filePath: string) => string | undefined;
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
  /** Indexed once at persistence ownership start; producer ledgers are never rollup input. */
  private readonly persistedObservationIds = new Set<string>();
  private observationIndexBuilt = false;
  private dirEnsured = false;

  constructor(
    filePath: string,
    emitter: ConductorEventEmitter,
    clock: IntervalClock = epochAnchoredMonotonicClock,
    dependencies: EventPersisterDependencies = {},
  ) {
    this.filePath = filePath;
    this.emitter = emitter;
    this.clock = clock;
    this.readPersistedEvents = dependencies.readPersistedEvents ?? readCanonicalEvents;
    this.executionScope = { featureId: filePath, runId: 'event-persister' };

    this.handler = (event: ConductorEvent): void => {
      this.persist(event);
    };
  }

  private readonly readPersistedEvents: (filePath: string) => string | undefined;

  /**
   * Subscribe to all ConductorEvent types.
   */
  start(): void {
    this.buildObservationIndex();
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
      this.buildObservationIndex();
      const observationId = observationEventId(event);
      if (observationId !== undefined && this.persistedObservationIds.has(observationId)) return;
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
        || event.type === 'step_interrupted'
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
        ...boundCiRepairDiagnostic(event),
        ...(lifecycleInterval
          ? { observedIntervals: [...(lifecycleEvent?.observedIntervals ?? []), lifecycleInterval] }
          : {}),
        ...(activeInterval ? { activeInterval } : {}),
        ts: new Date().toISOString(),
      });
      appendFileSync(this.filePath, record + '\n', 'utf-8');
      if (observationId !== undefined) this.persistedObservationIds.add(observationId);
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

  /** Recover durable observation ids once; never rescan during tail polling. */
  private buildObservationIndex(): void {
    if (this.observationIndexBuilt) return;
    this.observationIndexBuilt = true;
    // Preserve the existing delayed write-error boundary for an invalid target
    // such as a directory: subscribing succeeds and the emitter owns that
    // failure when an event is actually projected.
    try {
      const content = this.readPersistedEvents(this.filePath);
      if (content === undefined) return;
      for (const line of content.split('\n')) {
        if (!line) continue;
        try {
          const id = observationEventId(JSON.parse(line) as ConductorEvent);
          if (id !== undefined) this.persistedObservationIds.add(id);
        } catch {
          // Malformed historical rows cannot acknowledge producer progress.
        }
      }
    } catch (error) {
      throw new EventPersistError(this.filePath, error);
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

function readCanonicalEvents(filePath: string): string | undefined {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return undefined;
  return readFileSync(filePath, 'utf8');
}

const OBSERVATION_EVENT_TYPES = new Set<ConductorEvent['type']>([
  'session_command_refused',
  'github_bypass_attempt',
  'github_bypass_result',
  'github_possible_bypass',
  'session_event_delivery_diagnostic',
]);

/** Only producer observations are replay-deduplicated; ordinary events still append. */
function observationEventId(event: ConductorEvent): string | undefined {
  return OBSERVATION_EVENT_TYPES.has(event.type)
    && 'eventId' in event
    && typeof event.eventId === 'string'
    ? event.eventId
    : undefined;
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
    await scope.drain();
  }
}

/** The feature ledger every persisted event of a worktree is appended to. */
export const FEATURE_EVENT_LOG_PATH = '.pipeline/events.jsonl';

export interface SessionEventTailOwner {
  /** Preserve the legacy synchronous stop boundary for short-lived callers. */
  stop(): void;
  /** Stop polling, join an in-flight read, then make one settled final pass. */
  drain(): Promise<void>;
}

/**
 * Own the external producer tail for one persistence lifetime. Project-scoped
 * foreground/prelude callers use this with their existing EventPersister;
 * feature callers use it below with their forwarding feature emitter.
 */
export function startSessionEventTail(
  projectRoot: string,
  events: ConductorEventEmitter,
  featureSlug?: string,
): SessionEventTailOwner {
  const tail = new CloseoutEventTail({ projectRoot, featureSlug, events });
  tail.start();
  let drainPromise: Promise<void> | undefined;
  return {
    stop: () => tail.stop(),
    drain: () => {
      if (!drainPromise) {
        drainPromise = (async () => {
          tail.stop();
          await tail.drain();
        })();
      }
      return drainPromise;
    },
  };
}

export function startFeatureEventPersistence(
  worktreePath: string,
  globalEvents: ConductorEventEmitter,
  slug?: string,
): { events: ConductorEventEmitter; stop: () => void; drain: () => Promise<void> } {
  const featureEvents = new ForwardingEventEmitter(globalEvents, slug ?? basename(worktreePath));
  const persister = new EventPersister(
    join(worktreePath, FEATURE_EVENT_LOG_PATH),
    featureEvents,
  );
  persister.start();
  // Session producers can run during any feature step.  The feature scope is
  // therefore the sole lifecycle owner: it starts before provider invocation
  // and drains before feature listeners detach, rather than adding a daemon
  // observer or coupling the tail to BUILD.
  const tail = startSessionEventTail(
    worktreePath,
    featureEvents,
    slug ?? basename(worktreePath),
  );
  let drainPromise: Promise<void> | undefined;
  return {
    events: featureEvents,
    // Keep the legacy synchronous stop contract for existing short-lived
    // callers. Feature shutdowns use drain() to settle in-flight reads first.
    stop: () => {
      tail.stop();
      persister.stop();
    },
    drain: () => {
      if (!drainPromise) {
        drainPromise = (async () => {
          // The first poll joins any interval-triggered read already in
          // flight; the second is the bounded final pass after that read has
          // settled, so a producer record completed at the boundary is not
          // detached with the feature listeners.
          try {
            await tail.drain();
          } catch {
            // Final delivery is best-effort. A source/sink outage must not
            // replace the feature result or prevent consumer shutdown; the
            // retained producer records are retried by the next drain owner.
          } finally {
            persister.stop();
          }
        })();
        // Do not retain a rejected promise: a subsequent closeout owner must
        // be able to attempt delivery again after a transient failure.
        drainPromise.catch(() => { drainPromise = undefined; });
      }
      return drainPromise;
    },
  };
}

/** Persist only daemon-origin events. Feature copies already have their own ledger. */
export function startDaemonEventPersistence(
  mainRoot: string,
  events: ConductorEventEmitter,
  log: (message: string) => void = () => {},
): { stop: () => void } {
  const persister = new EventPersister(join(mainRoot, '.daemon', 'events.jsonl'), events);
  // A full daemon ledger remains unavailable after a write failure. Boundary
  // sampling continues so other listeners can run, but repeating the same
  // write error for every sample would turn one outage into log noise.
  let loggedMemorySampleFailure = false;
  const handler: EventHandler = (event) => {
    if (isForwardedFromFeature(event)) return;
    try {
      // EventPersister is intentionally private; invoke its subscribed handler through a small local emitter
      // would duplicate subscriptions. The direct method is runtime-private only and preserves its schema.
      (persister as unknown as { persist(event: ConductorEvent): void }).persist(event);
    } catch (error) {
      if (event.type === 'daemon_memory_sample' && loggedMemorySampleFailure) return;
      if (event.type === 'daemon_memory_sample') loggedMemorySampleFailure = true;
      log(`[daemon] event persistence failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  for (const type of persistedEventTypes()) events.on(type, handler);
  return { stop: () => { for (const type of persistedEventTypes()) events.off(type, handler); } };
}

/**
 * Short-lived operator CLI roots (github-operation, engineer, halt-issues,
 * reconcile-parked) share one way onto the canonical spine: an emitter
 * persisted to `<cwd>/.pipeline/events.jsonl`. Call `stop()` before exit.
 */
export function startOperatorEventSpine(cwd: string): { events: ConductorEventEmitter; stop: () => void } {
  const events = new ConductorEventEmitter();
  const persister = new EventPersister(join(cwd, '.pipeline', 'events.jsonl'), events);
  persister.start();
  return { events, stop: () => persister.stop() };
}
