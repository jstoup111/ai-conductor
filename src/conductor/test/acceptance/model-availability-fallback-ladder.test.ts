import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LLMProvider, InvokeOptions, InvokeResult } from '../../src/execution/llm-provider.js';
import type { ConductState } from '../../src/types/index.js';
import type { HarnessConfig } from '../../src/types/config.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Model availability probe + fallback ladder"
// (jstoup111/ai-conductor#186, adr-2026-07-03-reactive-model-fallback-ladder).
//
// These drive the REAL entry point the daemon actually calls —
// DefaultStepRunner.run() (autonomous AND collaborative dispatch) — not the
// ModelAvailability primitive in isolation (writing-system-tests §3b/§3d: a
// unit test on the new class alone would pass even if runAutonomous / the
// collaborative branch never routed through it, shipping an orphaned
// primitive). Detection-regex and config-validation unit coverage live in
// their own TDD tasks (Tasks 2-5); this file only covers the cross-cutting
// wiring: ladder walk in-attempt, cache consult on the interactive path, and
// the loud downgrade warning at the real call sites.
// ─────────────────────────────────────────────────────────────────────────────

const emptyState: ConductState = {};

/** Records every invoke() call's requested model and returns canned results keyed by model. */
function laddderProvider(
  resultsByModel: Record<string, Partial<InvokeResult>>,
  fallback: Partial<InvokeResult> = { success: true, output: 'done', exitCode: 0 },
) {
  const invokeCalls: InvokeOptions[] = [];
  const invokeInteractiveCalls: InvokeOptions[] = [];
  const provider: LLMProvider = {
    invoke: vi.fn(async (opts: InvokeOptions): Promise<InvokeResult> => {
      invokeCalls.push(opts);
      const canned = (opts.model && resultsByModel[opts.model]) ?? fallback;
      return { success: true, output: '', exitCode: 0, ...canned };
    }),
    invokeInteractive: vi.fn(async (opts: InvokeOptions): Promise<void> => {
      invokeInteractiveCalls.push(opts);
    }),
  };
  return { provider, invokeCalls, invokeInteractiveCalls };
}

const modelUnavailable = (): Partial<InvokeResult> => ({
  success: false,
  output: 'API Error: 404 not_found_error: model: bogus',
  exitCode: 1,
  modelUnavailable: true,
});

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

function warnLines(): string {
  return warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
}

describe('In-attempt ladder walk on the autonomous entry point (TS-2, TS-4)', () => {
  it('healthy configured model: exactly one invocation, zero downgrade noise', async () => {
    const { provider, invokeCalls } = laddderProvider({});
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      modelOverride: 'fable',
    });

    const result = await runner.run('build', emptyState);

    expect(result.success).toBe(true);
    expect(invokeCalls).toHaveLength(1);
    expect(invokeCalls[0].model).toBe('fable');
    expect(warnLines()).toBe('');
  });

  it('configured model unavailable: step completes on the next ladder model in ONE attempt', async () => {
    const { provider, invokeCalls } = laddderProvider({
      fable: modelUnavailable(),
      opus: { success: true, output: 'done', exitCode: 0 },
    });
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      modelOverride: 'fable',
      config: { model_fallback_ladder: ['fable', 'opus', 'sonnet'] } as HarnessConfig,
    });

    const result = await runner.run('build', emptyState);

    expect(result.success).toBe(true);
    expect(invokeCalls.map((c) => c.model)).toEqual(['fable', 'opus']);
    // Loud downgrade: configured model, actual model, and a reason are all present.
    const warned = warnLines();
    expect(warned).toContain('fable');
    expect(warned).toContain('opus');
    expect(warned.toLowerCase()).toMatch(/unavailable|not found/);
  });

  it('unavailable at every ladder position walks the full prefix before succeeding', async () => {
    const { provider, invokeCalls } = laddderProvider({
      fable: modelUnavailable(),
      opus: modelUnavailable(),
      sonnet: { success: true, output: 'done', exitCode: 0 },
    });
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      modelOverride: 'fable',
      config: { model_fallback_ladder: ['fable', 'opus', 'sonnet'] } as HarnessConfig,
    });

    const result = await runner.run('build', emptyState);

    expect(result.success).toBe(true);
    expect(invokeCalls.map((c) => c.model)).toEqual(['fable', 'opus', 'sonnet']);
  });

  it('full ladder exhaustion: ordinary failure flows into the existing retry path (no HALT special-casing)', async () => {
    const { provider, invokeCalls } = laddderProvider(
      {},
      modelUnavailable(), // every model on the ladder reports unavailable
    );
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      modelOverride: 'fable',
      config: { model_fallback_ladder: ['fable', 'opus', 'sonnet'] } as HarnessConfig,
    });

    const result = await runner.run('build', emptyState);

    expect(result.success).toBe(false);
    expect(result.rateLimited).toBeUndefined();
    expect(result.sessionExpired).toBeUndefined();
    // Exactly one invocation per live ladder model — never a retry loop within the attempt.
    expect(invokeCalls).toHaveLength(3);
    // Exhaustion failure must name every model tried so the eventual HALT (if
    // retries also exhaust) is diagnosable from daemon.log alone.
    expect(result.output).toContain('fable');
    expect(result.output).toContain('opus');
    expect(result.output).toContain('sonnet');
  });

  it('rate-limit AFTER a downgrade returns the rate-limited result — does not advance the ladder further', async () => {
    const { provider, invokeCalls } = laddderProvider({
      fable: modelUnavailable(),
      opus: { success: false, output: 'rate limit exceeded, 429', exitCode: 1, rateLimited: true },
    });
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      modelOverride: 'fable',
      config: { model_fallback_ladder: ['fable', 'opus', 'sonnet'] } as HarnessConfig,
    });

    const result = await runner.run('build', emptyState);

    // Existing rate-limit handling wins — only modelUnavailable advances the walk.
    expect(result.rateLimited).toBe(true);
    expect(invokeCalls.map((c) => c.model)).toEqual(['fable', 'opus']);
  });

  it('configured model NOT on the ladder falls to the ladder\'s first live entry', async () => {
    const { provider, invokeCalls } = laddderProvider({
      'claude-fable-5-custom': modelUnavailable(),
      fable: { success: true, output: 'done', exitCode: 0 },
    });
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      modelOverride: 'claude-fable-5-custom',
      config: { model_fallback_ladder: ['fable', 'opus', 'sonnet'] } as HarnessConfig,
    });

    const result = await runner.run('build', emptyState);

    expect(result.success).toBe(true);
    expect(invokeCalls.map((c) => c.model)).toEqual(['claude-fable-5-custom', 'fable']);
  });

  it('empty ladder ([]) means NO fallback: unavailable surfaces exactly as today', async () => {
    const { provider, invokeCalls } = laddderProvider({ fable: modelUnavailable() });
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      modelOverride: 'fable',
      config: { model_fallback_ladder: [] } as unknown as HarnessConfig,
    });

    const result = await runner.run('build', emptyState);

    expect(result.success).toBe(false);
    expect(invokeCalls).toHaveLength(1);
    expect(invokeCalls[0].model).toBe('fable');
  });
});

describe('Cache consult on the interactive dispatch path (TS-3 negative path)', () => {
  it('a model marked dead by a prior autonomous downgrade is substituted before invokeInteractive — with the same loud warning', async () => {
    const { provider, invokeCalls, invokeInteractiveCalls } = laddderProvider({
      fable: modelUnavailable(),
      opus: { success: true, output: 'done', exitCode: 0 },
    });
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      modelOverride: 'fable',
      config: { model_fallback_ladder: ['fable', 'opus', 'sonnet'] } as HarnessConfig,
    });

    // First: an autonomous step reactively discovers fable is dead.
    await runner.run('build', emptyState);
    expect(invokeCalls.map((c) => c.model)).toEqual(['fable', 'opus']);
    warnSpy.mockClear();

    // Second: a COLLABORATIVE step (reactive detection is impossible here —
    // invokeInteractive has no captured output) must consult the cache and
    // substitute BEFORE dispatch, not spawn a doomed fable subprocess.
    await runner.run('explore', emptyState);

    expect(invokeInteractiveCalls).toHaveLength(1);
    expect(invokeInteractiveCalls[0].model).toBe('opus');
    const warned = warnLines();
    expect(warned).toContain('fable');
    expect(warned).toContain('opus');
  });

  it('a fresh process (new runner instance) re-allows a previously dead model — restart semantics', async () => {
    const { provider: firstProvider } = laddderProvider({
      fable: modelUnavailable(),
      opus: { success: true, output: 'done', exitCode: 0 },
    });
    const firstRunner = new DefaultStepRunner(firstProvider, 'session-1', '/tmp/project', {
      modelOverride: 'fable',
      config: { model_fallback_ladder: ['fable', 'opus', 'sonnet'] } as HarnessConfig,
    });
    await firstRunner.run('build', emptyState);

    // A brand-new runner (new process, in production) must NOT inherit the dead-model cache.
    const { provider: secondProvider, invokeCalls: secondInvokeCalls } = laddderProvider({
      fable: { success: true, output: 'done', exitCode: 0 },
    });
    const secondRunner = new DefaultStepRunner(secondProvider, 'session-2', '/tmp/project', {
      modelOverride: 'fable',
      config: { model_fallback_ladder: ['fable', 'opus', 'sonnet'] } as HarnessConfig,
    });
    const result = await secondRunner.run('build', emptyState);

    expect(result.success).toBe(true);
    expect(secondInvokeCalls.map((c) => c.model)).toEqual(['fable']);
  });
});
