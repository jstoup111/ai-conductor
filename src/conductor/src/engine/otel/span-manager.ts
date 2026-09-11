/**
 * SpanManager — run/step span lifecycle for the OTel visualizer.
 *
 * Handles:
 *  - One root run span opened on first step event (FR-2).
 *  - Per-step child spans parented to the run span (FR-3).
 *  - Span attributes: conductor.step, index, status, retry count, tier (FR-4).
 *  - Span events: retries, gate verdicts, kickbacks (FR-4).
 *  - Orphan events (no open span): warn + no-op, never throw (FR-3 negatives).
 *  - Step re-run (second step_started same step): closes old span, opens new one (FR-3).
 *  - Force-close of all open spans on flush (FR-9).
 *  - Run outcome taxonomy: `complete` from `feature_complete`; `halted` from
 *    `loop_halt`; `terminated` is the force-close default. Rebase-conflict
 *    halts arrive via `loop_halt`; the park lifecycle (`auto_park`,
 *    `credentials_park`, and `operator_park_boundary`) intentionally uses the
 *    `terminated` default.
 *
 * All methods are synchronous — they only call OTel span APIs that enqueue
 * to the BatchSpanProcessor. No await, no network call (R1).
 */
import {
  Tracer,
  Span,
  SpanStatusCode,
  trace,
  ROOT_CONTEXT,
  Context,
} from '@opentelemetry/api';
import type { ConductorEvent } from '../../types/events.js';
import type { DispatchMeteringObservation } from '../dispatch-metering.js';
import { resolveExecutionIdentity, type ExecutionScope } from '../execution-identity.js';
import type { ObservedInterval } from '../../execution/observed-interval.js';

interface StepState {
  span: Span;
  index: number;
  retryCount: number;
  startTimeMs: number;
  subjectLabel: string;
  settlementEndTimeMs?: number;
  dispatch?: DispatchMeteringObservation;
}

export type RunOutcome = 'complete' | 'halted' | 'terminated';

export interface SpanManagerCallbacks {
  /** Called when a step completes; carries accumulated metrics data. */
  onStepClose?: (step: string, durationMs: number, retryCount: number) => void;
  /** Called exactly once when an opened run span reaches a terminal outcome. */
  onRunClose?: (outcome: RunOutcome) => void;
}

export class SpanManager {
  private runSpan: Span | null = null;
  private runCtx: Context = ROOT_CONTEXT;
  private runStarted = false;
  private runOutcome: RunOutcome | null = null;
  private readonly openSteps: Map<string, StepState> = new Map();

  constructor(
    private readonly tracer: Tracer,
    private readonly onWarning?: (msg: string) => void,
    private readonly callbacks?: SpanManagerCallbacks,
    private readonly executionScope: ExecutionScope = {
      featureId: 'unknown-feature',
      runId: 'unknown-run',
    },
  ) {}

  // ── Run span ───────────────────────────────────────────────────────────────

  private ensureRunSpan(): void {
    if (!this.runStarted) {
      this.runStarted = true;
      this.runSpan = this.tracer.startSpan('conductor.run');
      this.runCtx = trace.setSpan(ROOT_CONTEXT, this.runSpan);
    }
  }

  private closeRunSpan(outcome: RunOutcome): void {
    if (this.runOutcome !== null) return;
    if (!this.runSpan) return;

    this.runOutcome = outcome;
    this.runSpan.setAttribute('conductor.run.outcome', this.runOutcome);
    this.runSpan.setStatus({ code: SpanStatusCode.OK });
    this.runSpan.end();
    this.runSpan = null;
    this.callbacks?.onRunClose?.(outcome);
  }

  // ── Step-span open/close ───────────────────────────────────────────────────

  onStepStarted(event: Extract<ConductorEvent, { type: 'step_started' }>): void {
    this.ensureRunSpan();
    const identity = this.resolve(event.step, event.executionContext);
    if (!identity) return;

    // Context-free legacy re-runs retain their serial close-and-reopen behavior.
    // Explicit executions are independent even when they share the same member name.
    if (event.executionContext === undefined && this.openSteps.has(identity.correlationKey)) {
      const old = this.openSteps.get(identity.correlationKey)!;
      old.span.setStatus({ code: SpanStatusCode.OK });
      old.span.end();
      this.openSteps.delete(identity.correlationKey);
    }

    const span = this.tracer.startSpan(identity.subjectLabel, {}, this.runCtx);
    // Set index and step name now; status + retryCount set at close.
    span.setAttribute('conductor.step', identity.subjectLabel);
    span.setAttribute('conductor.step.index', event.index);
    if (event.executionContext?.subject.kind === 'configured-member') {
      span.setAttribute('conductor.execution.parent_group', event.executionContext.subject.parentGroup);
      span.setAttribute('conductor.execution.member', event.executionContext.subject.member);
    }

    this.openSteps.set(identity.correlationKey, {
      span,
      index: event.index,
      retryCount: 0,
      startTimeMs: Date.now(),
      subjectLabel: identity.subjectLabel,
    });
  }

  onStepCompleted(event: Extract<ConductorEvent, { type: 'step_completed' }>): void {
    const identity = this.resolve(event.step, event.executionContext);
    const state = identity ? this.openSteps.get(identity.correlationKey) : undefined;
    if (!state) {
      this.warn(
        `step_completed for '${event.step}' received but no open span exists — ignoring`,
      );
      return;
    }
    const durationMs = Date.now() - state.startTimeMs;

    this.setDispatchAttributes(state, {
      model: event.model,
      effort: event.effort,
      tier: event.tier,
      provider: event.actualProvider,
      preferredProvider: event.preferredProvider,
    });
    this.recordSettlement(state, event.observedIntervals);
    this.setTokenUsageAttributes(state.span, event.tokenUsage);
    state.span.setAttribute('conductor.step.status', event.status);
    state.span.setAttribute('conductor.retry.count', state.retryCount);
    state.span.setStatus({ code: SpanStatusCode.OK });
    this.endSpan(state);
    this.openSteps.delete(identity!.correlationKey);

    this.callbacks?.onStepClose?.(state.subjectLabel, durationMs, state.retryCount);
  }

  onStepFailed(event: Extract<ConductorEvent, { type: 'step_failed' }>): void {
    const identity = this.resolve(event.step, event.executionContext);
    const state = identity ? this.openSteps.get(identity.correlationKey) : undefined;
    if (!state) {
      this.warn(
        `step_failed for '${event.step}' received but no open span exists — ignoring`,
      );
      return;
    }
    const durationMs = Date.now() - state.startTimeMs;

    this.setDispatchAttributes(state, {
      effort: event.effort,
      tier: event.tier,
    });
    this.recordSettlement(state, event.observedIntervals);
    state.span.setAttribute('conductor.step.status', 'failed');
    // Use event.retryCount for failed steps (authoritative source on failure).
    state.span.setAttribute('conductor.retry.count', event.retryCount);
    state.span.setStatus({ code: SpanStatusCode.ERROR, message: event.error });
    this.endSpan(state);
    this.openSteps.delete(identity!.correlationKey);

    this.callbacks?.onStepClose?.(state.subjectLabel, durationMs, event.retryCount);
  }

  onProviderAttempt(
    event: Extract<ConductorEvent, { type: 'provider_attempt' }>,
    observation: DispatchMeteringObservation,
  ): void {
    const identity = this.resolve(event.step, event.executionContext);
    const state = identity ? this.openSteps.get(identity.correlationKey) : undefined;
    if (!state) {
      this.warn(`provider_attempt for '${event.step}' received but no open span exists — ignoring`);
      return;
    }
    // Candidate observations can be partial. Keep the latest known value for
    // each dimension so a failed close is still attributable, but keep the
    // first fallback reason: later fallback candidates commonly omit it.
    state.dispatch = {
      ...state.dispatch,
      ...observation,
      ...(state.dispatch?.fallbackReason === undefined && observation.fallbackReason !== undefined
        ? { fallbackReason: observation.fallbackReason }
        : state.dispatch?.fallbackReason !== undefined
          ? { fallbackReason: state.dispatch.fallbackReason }
          : {}),
    };
    this.recordSettlement(state, event.observedIntervals);
  }

  private setDispatchAttributes(
    state: StepState,
    event: {
      model?: string;
      effort?: string;
      tier?: string;
      provider?: string;
      preferredProvider?: string;
    },
  ): void {
    const provider = event.provider ?? state.dispatch?.provider;
    const preferredProvider = event.preferredProvider ?? state.dispatch?.preferredProvider;
    const model = event.model ?? state.dispatch?.model;
    const effort = event.effort ?? state.dispatch?.effort;
    const tier = event.tier ?? state.dispatch?.tier;
    if (model !== undefined) state.span.setAttribute('conductor.model', model);
    if (effort !== undefined) state.span.setAttribute('conductor.effort', effort);
    if (tier !== undefined) state.span.setAttribute('conductor.complexity_tier', tier);
    if (provider !== undefined) state.span.setAttribute('conductor.provider', provider);
    if (preferredProvider !== undefined) {
      state.span.setAttribute('conductor.provider.preferred', preferredProvider);
    }
    if (provider !== undefined && preferredProvider !== undefined) {
      state.span.setAttribute('conductor.fallback', preferredProvider !== provider);
    }
    if (state.dispatch?.fallbackReason !== undefined) {
      state.span.setAttribute('conductor.fallback.reason', state.dispatch.fallbackReason);
    }
  }

  private setTokenUsageAttributes(
    span: Span,
    tokenUsage: Extract<ConductorEvent, { type: 'step_completed' }>['tokenUsage'],
  ): void {
    if (!tokenUsage) return;
    if (Number.isFinite(tokenUsage.reasoningOutput)) {
      span.setAttribute('conductor.usage.reasoning_output', tokenUsage.reasoningOutput!);
    }
    if (Number.isFinite(tokenUsage.numTurns)) {
      span.setAttribute('conductor.usage.turns', tokenUsage.numTurns!);
    }
    if (Number.isFinite(tokenUsage.durationMs)) {
      span.setAttribute('conductor.usage.duration_ms', tokenUsage.durationMs!);
    }
    if (tokenUsage.costSource !== undefined) {
      span.setAttribute('conductor.cost.source', tokenUsage.costSource);
    }
  }

  private resolve(step: string, executionContext: unknown) {
    return resolveExecutionIdentity({
      scope: this.executionScope,
      legacyStep: step,
      executionContext,
    });
  }

  private stateFor(step: string, executionContext?: unknown): StepState | undefined {
    const identity = this.resolve(step, executionContext);
    return identity ? this.openSteps.get(identity.correlationKey) : undefined;
  }

  private recordSettlement(state: StepState, intervals: readonly ObservedInterval[] | undefined): void {
    if (!intervals) return;
    for (const interval of intervals) {
      const endedAtMs = interval.startedAtMs + interval.durationMs;
      if (Number.isFinite(endedAtMs) && endedAtMs >= state.startTimeMs) {
        state.settlementEndTimeMs = Math.max(state.settlementEndTimeMs ?? endedAtMs, endedAtMs);
      }
    }
  }

  private endSpan(state: StepState): void {
    state.span.end(state.settlementEndTimeMs);
  }

  // ── Span events ────────────────────────────────────────────────────────────

  onStepRetry(event: Extract<ConductorEvent, { type: 'step_retry' }>): void {
    const state = this.stateFor(event.step, event.executionContext);
    if (!state) {
      // Out-of-band retry — step isn't tracked. Silently drop (no warn needed).
      return;
    }
    state.retryCount++;
    state.span.addEvent('retry', {
      attempt: event.attempt,
      maxAttempts: event.maxAttempts,
      reason: event.reason,
    });
  }

  onGateVerdict(event: Extract<ConductorEvent, { type: 'gate_verdict' }>): void {
    this.ensureRunSpan();
    // Prefer the active step span; fall back to run span if no step is open.
    const state = this.stateFor(event.step);
    const targetSpan = state?.span ?? this.runSpan;
    if (!targetSpan) {
      this.warn(`gate_verdict for '${event.step}' received but no span available — dropping`);
      return;
    }
    const attrs: Record<string, boolean | string> = { satisfied: event.satisfied };
    if (event.reason !== undefined) attrs.reason = event.reason;
    targetSpan.addEvent('gate_verdict', attrs);
  }

  onKickback(event: Extract<ConductorEvent, { type: 'kickback' }>): void {
    this.ensureRunSpan();
    // Use the 'from' step's span if open; otherwise run span.
    const fromState = this.stateFor(event.from);
    const targetSpan = fromState?.span ?? this.runSpan;
    if (!targetSpan) {
      this.warn(`kickback from '${event.from}' received but no span available — dropping`);
      return;
    }
    const attrs: Record<string, string | number> = {
      from: event.from,
      to: event.to,
      count: event.count,
    };
    if (event.evidence !== undefined) attrs.evidence = event.evidence;
    targetSpan.addEvent('kickback', attrs);
  }

  onBuildProgress(event: Extract<ConductorEvent, { type: 'build_progress' }>): void {
    this.ensureRunSpan();
    const state = this.stateFor(event.step);
    const targetSpan = state?.span ?? this.runSpan;
    if (!targetSpan) {
      this.warn(`build_progress for '${event.step}' received but no span available — dropping`);
      return;
    }
    const attrs: Record<string, string | number> = {
      resolved: event.resolved,
      total: event.total,
    };
    if (event.currentTaskId !== undefined) attrs.currentTaskId = event.currentTaskId;
    targetSpan.addEvent('build_progress', attrs);
  }

  onBuildNoProgress(event: Extract<ConductorEvent, { type: 'build_no_progress' }>): void {
    this.ensureRunSpan();
    const state = this.stateFor(event.step);
    const targetSpan = state?.span ?? this.runSpan;
    if (!targetSpan) {
      this.warn(`build_no_progress for '${event.step}' received but no span available — dropping`);
      return;
    }
    const attrs: Record<string, string | number> = {
      resolved: event.resolved,
      total: event.total,
      quietMinutes: event.quietMinutes,
    };
    if (event.currentTaskId !== undefined) attrs.currentTaskId = event.currentTaskId;
    targetSpan.addEvent('build_no_progress', attrs);
  }

  onBuildStall(event: Extract<ConductorEvent, { type: 'build_stall' }>): void {
    this.ensureRunSpan();
    const state = this.stateFor(event.step);
    const targetSpan = state?.span ?? this.runSpan;
    if (!targetSpan) {
      this.warn(`build_stall for '${event.step}' received but no span available — dropping`);
      return;
    }
    const attrs: Record<string, string | number> = {
      reason: event.reason,
      resolvedBefore: event.resolvedBefore,
      resolvedAfter: event.resolvedAfter,
    };
    targetSpan.addEvent('build_stall', attrs);
  }

  onPipelineCloseout(event: Extract<ConductorEvent, { type: 'pipeline_closeout' }>): void {
    this.ensureRunSpan();
    // Closeout belongs to the build lifecycle. It is emitted out-of-band, so
    // prefer an active build step and otherwise preserve it on the run span.
    const targetSpan = this.stateFor('build')?.span ?? this.runSpan;
    if (!targetSpan) {
      this.warn('pipeline_closeout received but no span available — dropping');
      return;
    }
    targetSpan.addEvent('pipeline_closeout', {
      obligation: event.obligation,
      startedAt: event.startedAt,
      endedAt: event.endedAt,
      durationMs: event.endedAt - event.startedAt,
    });
  }

  // ── Run completion ─────────────────────────────────────────────────────────

  onFeatureComplete(_event: Extract<ConductorEvent, { type: 'feature_complete' }>): void {
    // Close any still-open step spans (OK — run completed normally).
    for (const [step, state] of this.openSteps) {
      state.span.setAttribute('conductor.step.status', 'done');
      state.span.setAttribute('conductor.retry.count', state.retryCount);
      state.span.setStatus({ code: SpanStatusCode.OK });
      this.endSpan(state);
      const durationMs = Date.now() - state.startTimeMs;
      this.callbacks?.onStepClose?.(step, durationMs, state.retryCount);
    }
    this.openSteps.clear();

    this.closeRunSpan('complete');
  }

  onLoopHalt(event: Extract<ConductorEvent, { type: 'loop_halt' }>): void {
    // A terminal event may arrive after feature_complete has already closed the
    // root span. Preserve that authoritative outcome without treating it as an
    // orphan (which is reserved for a halt before any run started).
    if (this.runOutcome !== null) return;

    if (!this.runSpan) {
      this.warn('loop_halt received but no run span exists — ignoring');
      return;
    }

    if (event.step !== undefined) {
      this.runSpan.setAttribute('conductor.run.halt.step', event.step);
    }
    this.runSpan.setAttribute('conductor.run.halt.reason', event.reason);
    if (event.haltClass !== undefined) {
      this.runSpan.setAttribute('conductor.run.halt.class', event.haltClass);
    }

    this.closeRunSpan('halted');
  }

  // ── Flush / force-close (FR-9) ─────────────────────────────────────────────

  /**
   * Force-close all open spans as ERROR with `conductor.incomplete=true`.
   * Called by OtelVisualizer.stop() before flushing the batch processor.
   */
  forceCloseAll(): void {
    // Close step spans innermost-first (Map preserves insertion order).
    const steps = [...this.openSteps.entries()].reverse();
    for (const [step, state] of steps) {
      state.span.setAttribute('conductor.incomplete', true);
      state.span.setAttribute('conductor.step.status', 'incomplete');
      state.span.setAttribute('conductor.retry.count', state.retryCount);
      state.span.setStatus({ code: SpanStatusCode.ERROR, message: 'incomplete: process terminated' });
      this.endSpan(state);
      const durationMs = Date.now() - state.startTimeMs;
      this.callbacks?.onStepClose?.(step, durationMs, state.retryCount);
    }
    this.openSteps.clear();

    // The run itself ends cleanly; its default terminal outcome is terminated.
    // closeRunSpan preserves a prior complete or halted outcome.
    this.closeRunSpan('terminated');
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private warn(msg: string): void {
    this.onWarning?.(msg);
  }
}
