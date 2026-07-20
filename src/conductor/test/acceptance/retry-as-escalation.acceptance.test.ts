/**
 * Acceptance specs for retry-as-escalation (jstoup111/ai-conductor#188,
 * adr-2026-07-05-retry-as-escalation-ladder). Stories S1–S11.
 *
 * These drive the REAL entry points the daemon calls:
 *   - S1/S2/S5/S9/S10 — Conductor.run()'s retry loop threads the escalated
 *     (model, effort) into DefaultStepRunner via per-attempt overrides.
 *   - S8            — DefaultStepRunner.run() routes the escalated model through
 *                     ModelAvailability.effectiveModel (#186 composition).
 *   - S3/S4/S11     — resolved budgets, step_retry logging + aggregation, and
 *                     config validation at their real seams.
 *
 * The pure-ladder unit coverage (S1/S2/S5/S6/S7 in isolation) lives in
 * test/engine/escalation.test.ts; this file proves the wiring.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({ execa: vi.fn() }));

import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult, StepRunOptions } from '../../src/engine/conductor.js';
import type { StepName, ConductState } from '../../src/types/index.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { LLMProvider, InvokeOptions, InvokeResult } from '../../src/execution/llm-provider.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { validateConfig } from '../../src/engine/config.js';
import { resolveStepConfig, DEFAULT_STEP_RETRIES } from '../../src/engine/resolved-config.js';
import { aggregateRetryHotspots, parseEvents } from '../../src/engine/report-renderer.js';

// ── Dispatch record for the Conductor-level stories ──────────────────────────

interface Dispatch {
  step: StepName;
  model?: string;
  effort?: string;
}

/**
 * A StepRunner that records the (model, effort) override handed to each
 * dispatch and follows a per-step script of results (so a step can fail a fixed
 * number of times, or return a transient non-consuming signal on a given call).
 */
function makeRecordingRunner(
  scripts: Partial<Record<StepName, (call: number) => StepRunResult>>,
) {
  const dispatches: Dispatch[] = [];
  const callCounts = new Map<StepName, number>();
  const runner: StepRunner = {
    run: vi.fn(async (step: StepName, _state: ConductState, opts?: StepRunOptions): Promise<StepRunResult> => {
      dispatches.push({ step, model: opts?.modelOverride, effort: opts?.effortOverride });
      const n = (callCounts.get(step) ?? 0) + 1;
      callCounts.set(step, n);
      const script = scripts[step];
      return script ? script(n) : { success: true };
    }),
    resetSession: vi.fn(async () => {}),
  };
  const forStep = (step: StepName) => dispatches.filter((d) => d.step === step);
  return { runner, dispatches, forStep };
}

const okEscalation = () => vi.fn().mockResolvedValue({ prUrl: undefined });

describe('#188 retry-as-escalation — Conductor wiring', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'esc-accept-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Base config: plan pinned at sonnet/medium, budget 3, escalate default (true).
  const planConfig = (extra: Record<string, unknown> = {}): HarnessConfig => ({
    steps: { plan: { model: 'sonnet', effort: 'medium', max_retries: 3, ...extra } },
  } as HarnessConfig);

  it('S1+S2: attempt 2 bumps effort; attempt 3 bumps model tier', async () => {
    const { runner, forStep } = makeRecordingRunner({
      plan: () => ({ success: false, output: 'plan failed' }),
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      config: planConfig(),
      escalateBuildFailure: okEscalation(),
    });

    await conductor.run();

    const planDispatches = forStep('plan');
    expect(planDispatches).toHaveLength(3);
    // Attempt 1 — base (S1 "given").
    expect(planDispatches[0]).toMatchObject({ model: 'sonnet', effort: 'medium' });
    // Attempt 2 — effort bumped one level, model unchanged (S1).
    expect(planDispatches[1]).toMatchObject({ model: 'sonnet', effort: 'high' });
    // Attempt 3 — model bumped one tier, effort held (S2).
    expect(planDispatches[2]).toMatchObject({ model: 'opus', effort: 'high' });
  });

  it('S5: escalate:false pins the base (model, effort) across every attempt', async () => {
    const { runner, forStep } = makeRecordingRunner({
      plan: () => ({ success: false, output: 'plan failed' }),
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      config: planConfig({ escalate: false }),
      escalateBuildFailure: okEscalation(),
    });

    await conductor.run();

    const planDispatches = forStep('plan');
    expect(planDispatches).toHaveLength(3);
    for (const d of planDispatches) {
      expect(d).toMatchObject({ model: 'sonnet', effort: 'medium' });
    }
  });

  it('S9: exhausted retries HALT correctly — ladder adds no extra attempts', async () => {
    const { runner, forStep } = makeRecordingRunner({
      plan: () => ({ success: false, output: 'plan failed' }),
    });
    const haltEvents: string[] = [];
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') haltEvents.push(e.reason);
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      config: planConfig(),
      escalateBuildFailure: okEscalation(),
    });

    await conductor.run();

    // Exactly max_retries (3) attempts — escalation changes HOW attempts run,
    // never HOW MANY.
    expect(forStep('plan')).toHaveLength(3);
    // Terminal HALT preserved.
    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(halt).toMatch(/plan/);
    expect(haltEvents).toHaveLength(1);
  });

  it('S10: a non-consuming (stale-session) retry re-runs at the SAME rung, no model bump', async () => {
    // Script: attempt 1 fails; attempt 2 (effort=high) returns sessionExpired
    // (attempt--; continue — budget not burned); the re-run of attempt 2 fails
    // normally; attempt 3 fails. Escalation derives from `attempt`, so the two
    // attempt-2 dispatches must share the same rung and NEITHER may be opus.
    let call = 0;
    const { runner, forStep } = makeRecordingRunner({
      plan: () => {
        call += 1;
        if (call === 2) return { success: false, sessionExpired: true };
        return { success: false, output: 'plan failed' };
      },
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      config: planConfig(),
      escalateBuildFailure: okEscalation(),
    });

    await conductor.run();

    const planDispatches = forStep('plan');
    // 4 dispatches: attempt1, attempt2 (transient), attempt2 (re-run), attempt3.
    expect(planDispatches).toHaveLength(4);
    expect(planDispatches[0]).toMatchObject({ model: 'sonnet', effort: 'medium' }); // attempt 1
    expect(planDispatches[1]).toMatchObject({ model: 'sonnet', effort: 'high' });   // attempt 2 (transient)
    expect(planDispatches[2]).toMatchObject({ model: 'sonnet', effort: 'high' });   // attempt 2 re-run — SAME rung
    expect(planDispatches[3]).toMatchObject({ model: 'opus', effort: 'high' });     // attempt 3
    // The transient retry never triggered a premature model bump.
    expect(planDispatches[1].model).not.toBe('opus');
    expect(planDispatches[2].model).not.toBe('opus');
  });
});

// ── S8: availability composition at the real StepRunner seam ─────────────────

describe('#188 retry-as-escalation — S8 availability composition', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  function ladderProvider(resultsByModel: Record<string, Partial<InvokeResult>>) {
    const invokeCalls: InvokeOptions[] = [];
    const provider: LLMProvider = {
      invoke: vi.fn(async (opts: InvokeOptions): Promise<InvokeResult> => {
        invokeCalls.push(opts);
        const canned = (opts.model && resultsByModel[opts.model]) ?? { success: true, output: 'done', exitCode: 0 };
        return { success: true, output: '', exitCode: 0, ...canned };
      }),
      invokeInteractive: vi.fn(async (): Promise<void> => {}),
    };
    return { provider, invokeCalls };
  }

  it('an attempt-3 escalated target (opus) that is dead is substituted by the #186 ladder', async () => {
    // The conductor would hand modelOverride='opus' at attempt 3 for a base
    // sonnet step. opus is unavailable this process, so effectiveModel must
    // substitute a live tier from the availability ladder rather than dispatch
    // on the dead one.
    const { provider, invokeCalls } = ladderProvider({
      opus: {
        success: false,
        output: 'API Error: 404 not_found_error: model: opus',
        exitCode: 1,
        modelUnavailable: true,
      },
      fable: { success: true, output: 'done', exitCode: 0 },
    });
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      config: { model_fallback_ladder: ['fable', 'opus', 'sonnet'] } as HarnessConfig,
    });

    const result = await runner.run('build', {}, { modelOverride: 'opus', effortOverride: 'high' });

    expect(result.success).toBe(true);
    // opus was attempted then substituted; the step ran on a LIVE model, not opus.
    expect(invokeCalls.map((c) => c.model)).toEqual(['opus', 'fable']);
    const last = invokeCalls[invokeCalls.length - 1];
    expect(last.model).not.toBe('opus');
    // The escalated effort override still flows through unchanged.
    expect(invokeCalls[0].effort).toBe('high');
  });
});

// ── S3: deep-step budgets reduced to 3 ───────────────────────────────────────

describe('#188 retry-as-escalation — S3 budgets', () => {
  it('explore/prd/plan/build resolve to max_retries 3 by default', () => {
    for (const step of ['explore', 'prd', 'plan', 'build'] as StepName[]) {
      expect(DEFAULT_STEP_RETRIES[step]).toBe(3);
      const resolved = resolveStepConfig(step, 'PLANNING', undefined);
      expect(resolved.max_retries).toBe(3);
    }
  });

  it('a per-step max_retries override still wins over the reduced default', () => {
    const config = { steps: { build: { max_retries: 7 } } } as HarnessConfig;
    expect(resolveStepConfig('build', 'BUILD', config).max_retries).toBe(7);
  });

  it('architecture_review is out of scope — stays at 5', () => {
    expect(DEFAULT_STEP_RETRIES['architecture_review']).toBe(5);
  });
});

// ── S4: escalation is logged and aggregated for retro Part C ──────────────────

describe('#188 retry-as-escalation — S4 logging', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'esc-log-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('step_retry carries the NEXT attempt\'s escalated (model, effort)', async () => {
    const retryEvents: Array<{ attempt: number; escalatedModel?: string; escalatedEffort?: string }> = [];
    events.on('step_retry', (e) => {
      if (e.type === 'step_retry' && e.step === 'plan') {
        retryEvents.push({
          attempt: e.attempt,
          escalatedModel: e.escalatedModel,
          escalatedEffort: e.escalatedEffort,
        });
      }
    });
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName): Promise<StepRunResult> =>
        step === 'plan' ? { success: false, output: 'plan failed' } : { success: true },
      ),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      config: { steps: { plan: { model: 'sonnet', effort: 'medium', max_retries: 3 } } } as HarnessConfig,
      escalateBuildFailure: okEscalation(),
    });

    await conductor.run();

    // Two step_retry emits (before attempt 2 and before attempt 3), each naming
    // the upcoming attempt's rung.
    const forAttempt = (a: number) => retryEvents.find((e) => e.attempt === a);
    expect(forAttempt(2)).toMatchObject({ escalatedModel: 'sonnet', escalatedEffort: 'high' });
    expect(forAttempt(3)).toMatchObject({ escalatedModel: 'opus', escalatedEffort: 'high' });
  });

  it('aggregateRetryHotspots surfaces the terminal escalation rung', () => {
    const raw = [
      JSON.stringify({ type: 'step_retry', step: 'plan', ts: '2026-07-19T00:00:00Z', attempt: 2, reason: 'x', escalatedModel: 'sonnet', escalatedEffort: 'high' }),
      JSON.stringify({ type: 'step_retry', step: 'plan', ts: '2026-07-19T00:01:00Z', attempt: 3, reason: 'x', escalatedModel: 'opus', escalatedEffort: 'high' }),
    ].join('\n');
    const hotspots = aggregateRetryHotspots(parseEvents(raw));
    const plan = hotspots.find((h) => h.step === 'plan');
    expect(plan).toBeDefined();
    expect(plan!.count).toBe(2);
    // Terminal rung = the furthest up each ladder the step climbed.
    expect(plan!.escalatedModel).toBe('opus');
    expect(plan!.escalatedEffort).toBe('high');
  });

  it('backward-compat: pre-#188 step_retry lines (no escalation fields) still aggregate', () => {
    const raw = [
      JSON.stringify({ type: 'step_retry', step: 'prd', ts: '2026-07-19T00:00:00Z', attempt: 2, reason: 'boom' }),
      JSON.stringify({ type: 'step_retry', step: 'prd', ts: '2026-07-19T00:01:00Z', attempt: 3, reason: 'boom' }),
    ].join('\n');
    const hotspots = aggregateRetryHotspots(parseEvents(raw));
    const prd = hotspots.find((h) => h.step === 'prd');
    expect(prd).toBeDefined();
    expect(prd!.count).toBe(2);
    expect(prd!.topReason).toBe('boom');
    expect(prd!.escalatedModel).toBeUndefined();
    expect(prd!.escalatedEffort).toBeUndefined();
  });
});

// ── S11: invalid escalate config is rejected ─────────────────────────────────

describe('#188 retry-as-escalation — S11 config validation', () => {
  it('accepts escalate: true / false', () => {
    expect(validateConfig({ steps: { plan: { escalate: true } } }).ok).toBe(true);
    expect(validateConfig({ steps: { plan: { escalate: false } } }).ok).toBe(true);
  });

  it('rejects a non-boolean escalate, naming steps.<name>.escalate', () => {
    const result = validateConfig({ steps: { plan: { escalate: 'no' as unknown as boolean } } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('steps.plan.escalate');
    expect(result.error.message).toMatch(/boolean/i);
  });

  it('rejects an unknown sibling key next to escalate', () => {
    const result = validateConfig({ steps: { plan: { escalate: true, bogus: 1 } as unknown as Record<string, unknown> } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/bogus/);
  });
});
