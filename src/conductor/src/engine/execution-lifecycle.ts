import {
  epochAnchoredMonotonicClock,
  type IntervalClock,
} from '../execution/observed-interval.js';
import type { ConductorEvent, ExecutionContext } from '../types/events.js';
import type { StepName } from '../types/steps.js';
import { ConductorEventEmitter } from '../ui/events.js';
import { resolveExecutionIdentity, type ExecutionScope } from './execution-identity.js';
import { getGroupForStep } from './steps.js';

const executionLifecycleScope: ExecutionScope = {
  featureId: 'execution-lifecycle',
  runId: 'in-memory',
};

type LifecycleStartEvent = Extract<ConductorEvent, { type: 'step_started' | 'parallel_started' }>;
type LifecycleRetryEvent = Extract<ConductorEvent, { type: 'step_retry' }>;
type LifecycleSettlementEvent = Extract<ConductorEvent, { type: 'group_member_step' }>;
type LifecycleTerminalEvent = Extract<
  ConductorEvent,
  { type: 'step_completed' | 'step_failed' | 'step_refused' | 'parallel_completed' | 'parallel_failure' }
>;

export interface ExecutionBoundary {
  startedAtMs: number;
  finishedAtMs?: number;
}

export interface OpenExecution {
  kind: 'step' | 'parallel';
  step: StepName;
  executionContext?: ExecutionContext;
  boundary: ExecutionBoundary;
}

export interface LifecycleTerminalObservation {
  event: LifecycleTerminalEvent;
  boundary: Required<ExecutionBoundary>;
}

export interface ExecutionLifecycleOptions {
  events: ConductorEventEmitter;
  clock?: IntervalClock;
  onTerminal?: (observation: LifecycleTerminalObservation) => void | Promise<void>;
}

/**
 * Owns one conductor's admitted execution scopes and serializes their event
 * delivery. It has no gate or telemetry-export authority: all observations
 * stay on the existing ConductorEventEmitter.
 */
export class ExecutionLifecycle {
  readonly openExecutions = new Map<string, OpenExecution>();
  private readonly closingExecutions = new Map<string, Promise<void>>();
  private readonly closedBoundaries = new Map<string, Required<ExecutionBoundary>>();
  private executionEventTail: Promise<void> = Promise.resolve();
  private activeEventDeliveries = 0;
  private readonly clock: IntervalClock;

  constructor(private readonly options: ExecutionLifecycleOptions) {
    this.clock = options.clock ?? epochAnchoredMonotonicClock;
  }

  /** Compatibility entry point for existing conductor call sites. */
  emit(event: ConductorEvent): Promise<void> {
    if (event.type === 'step_started' || event.type === 'parallel_started') return this.admit(event);
    if (event.type === 'step_retry') return this.retry(event);
    if (event.type === 'group_member_step' && event.phase === 'result') return this.settle(event);
    if (isLifecycleTerminal(event)) {
      return event.type === 'parallel_failure' && event.terminal === false
        ? this.deliver(event)
        : this.close(event);
    }
    return this.deliver(event);
  }

  /** Emits one logical start after its caller has admitted work. */
  admit(event: LifecycleStartEvent): Promise<void> {
    const key = startKey(event);
    if (key === undefined || this.openExecutions.has(key)) return Promise.resolve();
    this.closedBoundaries.delete(key);
    this.openExecutions.set(key, {
      kind: event.type === 'step_started' ? 'step' : 'parallel',
      step: event.step,
      ...(event.type === 'step_started' && event.executionContext !== undefined
        ? { executionContext: event.executionContext }
        : {}),
      boundary: { startedAtMs: this.clock.nowMs() },
    });
    return this.deliver(event);
  }

  /** A retry remains an observation inside its already-admitted execution. */
  retry(event: LifecycleRetryEvent): Promise<void> {
    if (event.executionContext !== undefined) {
      const key = contextualKey(event.executionContext, event.step);
      if (key === undefined || !this.openExecutions.has(key)) return Promise.resolve();
    }
    return this.deliver(event);
  }

  /** Freezes an admitted member's work boundary without classifying its terminal. */
  settle(event: LifecycleSettlementEvent): Promise<void> {
    if (event.executionContext === undefined) return this.deliver(event);
    const key = contextualKey(event.executionContext);
    if (key === undefined) return Promise.resolve();
    const execution = this.openExecutions.get(key);
    if (!execution || execution.boundary.finishedAtMs !== undefined) return Promise.resolve();
    execution.boundary.finishedAtMs = this.clock.nowMs();
    return this.deliver(event);
  }

  /** Emits at most one terminal for the exact admitted execution it names. */
  close(event: LifecycleTerminalEvent): Promise<void> {
    const key = terminalKey(event, this.openExecutions);
    if (key === undefined) {
      return event.type === 'step_refused'
        && event.executionContext === undefined
        && isOpenLegacyGroupMember(event.step, this.openExecutions)
        ? this.deliver(event)
        : Promise.resolve();
    }
    const inFlight = this.closingExecutions.get(key);
    if (inFlight) return inFlight;
    const execution = this.openExecutions.get(key);
    if (!execution) return Promise.resolve();
    const boundary: Required<ExecutionBoundary> = {
      startedAtMs: execution.boundary.startedAtMs,
      finishedAtMs: execution.boundary.finishedAtMs ?? this.clock.nowMs(),
    };

    const delivery = this.activeEventDeliveries > 0
      ? this.deliverNow(event)
      : this.executionEventTail.then(() => this.deliverNow(event));
    this.executionEventTail = delivery.catch(() => {});
    const terminalDelivery = delivery.then(async () => {
      this.openExecutions.delete(key);
      this.closedBoundaries.set(key, boundary);
      await this.options.onTerminal?.({ event, boundary });
    }).finally(() => {
      this.closingExecutions.delete(key);
    });
    this.closingExecutions.set(key, terminalDelivery);
    return terminalDelivery;
  }

  /** Closes every admitted scope once during a catchable shutdown. */
  async closeOpen(): Promise<void> {
    for (const [key, execution] of this.openExecutions) {
      const inFlight = this.closingExecutions.get(key);
      if (inFlight) {
        await inFlight;
        continue;
      }
      if (execution.kind === 'parallel') {
        await this.close({
          type: 'parallel_failure',
          step: execution.step,
          branch: 'conductor',
          error: 'execution interrupted before a terminal event was emitted',
        });
      } else {
        await this.close({
          type: 'step_failed',
          step: execution.step,
          error: 'execution interrupted before a terminal event was emitted',
          retryCount: 0,
          ...(execution.executionContext === undefined ? {} : { executionContext: execution.executionContext }),
        });
      }
    }
  }

  /** Returns an admitted or recently closed member boundary for terminal consumers. */
  boundaryFor(context: ExecutionContext): ExecutionBoundary | undefined {
    const key = contextualKey(context);
    if (key === undefined) return undefined;
    return this.openExecutions.get(key)?.boundary ?? this.closedBoundaries.get(key);
  }

  /** Preserves the private conductor test seam while keeping ownership here. */
  replaceOpenExecutions(executions: Map<string, OpenExecution>): void {
    this.openExecutions.clear();
    for (const [key, execution] of executions) {
      this.openExecutions.set(key, {
        ...execution,
        boundary: execution.boundary ?? { startedAtMs: this.clock.nowMs() },
      });
    }
  }

  private deliver(event: ConductorEvent): Promise<void> {
    const delivery = this.executionEventTail.then(() => this.deliverNow(event));
    this.executionEventTail = delivery.catch(() => {});
    return delivery;
  }

  private async deliverNow(event: ConductorEvent): Promise<void> {
    this.activeEventDeliveries += 1;
    try {
      await this.options.events.emit(event);
    } finally {
      this.activeEventDeliveries -= 1;
    }
  }
}

function startKey(event: LifecycleStartEvent): string | undefined {
  if (event.type === 'parallel_started') return `parallel:${event.step}`;
  return event.executionContext === undefined
    ? `step:${event.step}`
    : contextualKey(event.executionContext, event.step);
}

function terminalKey(
  event: LifecycleTerminalEvent,
  openExecutions: ReadonlyMap<string, OpenExecution>,
): string | undefined {
  if (event.type === 'step_completed' || event.type === 'step_failed') {
    return event.executionContext === undefined ? `step:${event.step}` : contextualKey(event.executionContext, event.step);
  }
  if (event.type === 'step_refused') {
    return event.executionContext === undefined
      ? openExecutions.has(`step:${event.step}`) ? `step:${event.step}` : undefined
      : contextualKey(event.executionContext, event.step);
  }
  if (event.type === 'parallel_completed' || event.terminal !== false) return `parallel:${event.step}`;
  return undefined;
}

function contextualKey(context: ExecutionContext, legacyStep?: string): string | undefined {
  if (
    legacyStep !== undefined
    && resolveExecutionIdentity({
      scope: executionLifecycleScope,
      legacyStep,
      executionContext: context,
    }) === undefined
  ) {
    return undefined;
  }
  if (typeof context.executionId !== 'string' || context.executionId.length === 0) return undefined;
  const { subject } = context;
  if (subject.kind === 'lifecycle-step' && typeof subject.step === 'string' && subject.step.length > 0) {
    return `execution:${JSON.stringify([context.executionId, subject.kind, subject.step])}`;
  }
  if (
    subject.kind === 'configured-member'
    && typeof subject.parentGroup === 'string'
    && subject.parentGroup.length > 0
    && typeof subject.member === 'string'
    && subject.member.length > 0
  ) {
    return `execution:${JSON.stringify([context.executionId, subject.kind, subject.parentGroup, subject.member])}`;
  }
  return undefined;
}

function isOpenLegacyGroupMember(
  step: StepName,
  openExecutions: ReadonlyMap<string, OpenExecution>,
): boolean {
  const group = getGroupForStep(step);
  return group?.members.some((member) => openExecutions.has(`parallel:${member}`)) ?? false;
}

function isLifecycleTerminal(event: ConductorEvent): event is LifecycleTerminalEvent {
  return event.type === 'step_completed'
    || event.type === 'step_failed'
    || event.type === 'step_refused'
    || event.type === 'parallel_completed'
    || event.type === 'parallel_failure';
}
