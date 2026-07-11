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

interface StepState {
  span: Span;
  index: number;
  retryCount: number;
  startTimeMs: number;
}

export interface SpanManagerCallbacks {
  /** Called when a step completes; carries accumulated metrics data. */
  onStepClose?: (step: string, durationMs: number, retryCount: number) => void;
}

export class SpanManager {
  private runSpan: Span | null = null;
  private runCtx: Context = ROOT_CONTEXT;
  private runStarted = false;
  private readonly openSteps: Map<string, StepState> = new Map();

  constructor(
    private readonly tracer: Tracer,
    private readonly onWarning?: (msg: string) => void,
    private readonly callbacks?: SpanManagerCallbacks,
  ) {}

  // ── Run span ───────────────────────────────────────────────────────────────

  private ensureRunSpan(): void {
    if (!this.runStarted) {
      this.runStarted = true;
      this.runSpan = this.tracer.startSpan('conductor.run');
      this.runCtx = trace.setSpan(ROOT_CONTEXT, this.runSpan);
    }
  }

  // ── Step-span open/close ───────────────────────────────────────────────────

  onStepStarted(event: Extract<ConductorEvent, { type: 'step_started' }>): void {
    this.ensureRunSpan();

    // Re-run: a second step_started for the same step closes the old span first.
    if (this.openSteps.has(event.step)) {
      const old = this.openSteps.get(event.step)!;
      old.span.setStatus({ code: SpanStatusCode.OK });
      old.span.end();
      this.openSteps.delete(event.step);
    }

    const span = this.tracer.startSpan(event.step, {}, this.runCtx);
    // Set index and step name now; status + retryCount set at close.
    span.setAttribute('conductor.step', event.step);
    span.setAttribute('conductor.step.index', event.index);

    this.openSteps.set(event.step, {
      span,
      index: event.index,
      retryCount: 0,
      startTimeMs: Date.now(),
    });
  }

  onStepCompleted(event: Extract<ConductorEvent, { type: 'step_completed' }>): void {
    const state = this.openSteps.get(event.step);
    if (!state) {
      this.warn(
        `step_completed for '${event.step}' received but no open span exists — ignoring`,
      );
      return;
    }
    const durationMs = Date.now() - state.startTimeMs;

    state.span.setAttribute('conductor.step.status', event.status);
    state.span.setAttribute('conductor.retry.count', state.retryCount);
    state.span.setStatus({ code: SpanStatusCode.OK });
    state.span.end();
    this.openSteps.delete(event.step);

    this.callbacks?.onStepClose?.(event.step, durationMs, state.retryCount);
  }

  onStepFailed(event: Extract<ConductorEvent, { type: 'step_failed' }>): void {
    const state = this.openSteps.get(event.step);
    if (!state) {
      this.warn(
        `step_failed for '${event.step}' received but no open span exists — ignoring`,
      );
      return;
    }
    const durationMs = Date.now() - state.startTimeMs;

    state.span.setAttribute('conductor.step.status', 'failed');
    // Use event.retryCount for failed steps (authoritative source on failure).
    state.span.setAttribute('conductor.retry.count', event.retryCount);
    state.span.setStatus({ code: SpanStatusCode.ERROR, message: event.error });
    state.span.end();
    this.openSteps.delete(event.step);

    this.callbacks?.onStepClose?.(event.step, durationMs, event.retryCount);
  }

  // ── Span events ────────────────────────────────────────────────────────────

  onStepRetry(event: Extract<ConductorEvent, { type: 'step_retry' }>): void {
    const state = this.openSteps.get(event.step);
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
    const state = this.openSteps.get(event.step);
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
    const fromState = this.openSteps.get(event.from);
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
    const state = this.openSteps.get(event.step);
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
    const state = this.openSteps.get(event.step);
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
    const state = this.openSteps.get(event.step);
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

  // ── Run completion ─────────────────────────────────────────────────────────

  onFeatureComplete(_event: Extract<ConductorEvent, { type: 'feature_complete' }>): void {
    // Close any still-open step spans (OK — run completed normally).
    for (const [step, state] of this.openSteps) {
      state.span.setAttribute('conductor.step.status', 'done');
      state.span.setAttribute('conductor.retry.count', state.retryCount);
      state.span.setStatus({ code: SpanStatusCode.OK });
      state.span.end();
      const durationMs = Date.now() - state.startTimeMs;
      this.callbacks?.onStepClose?.(step, durationMs, state.retryCount);
    }
    this.openSteps.clear();

    // Close the run span OK.
    if (this.runSpan) {
      this.runSpan.setStatus({ code: SpanStatusCode.OK });
      this.runSpan.end();
      this.runSpan = null;
    }
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
      state.span.end();
      const durationMs = Date.now() - state.startTimeMs;
      this.callbacks?.onStepClose?.(step, durationMs, state.retryCount);
    }
    this.openSteps.clear();

    // Close run span (OK — the problem is incomplete steps, not the run itself).
    if (this.runSpan) {
      this.runSpan.setStatus({ code: SpanStatusCode.OK });
      this.runSpan.end();
      this.runSpan = null;
    }
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private warn(msg: string): void {
    this.onWarning?.(msg);
  }
}
