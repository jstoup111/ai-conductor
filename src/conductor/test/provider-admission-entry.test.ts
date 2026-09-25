import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeRunFeature } from '../src/engine/daemon-runner.js';
import { executeProviderCandidates } from '../src/engine/provider-execution.js';
import { ProviderRuntimeSet, type ProviderRuntime } from '../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../src/engine/provider-session.js';
import { CODEX_MODEL_POLICY, CLAUDE_MODEL_POLICY } from '../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../src/engine/model-availability.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function runtime(key: 'codex' | 'claude', invoke: () => Promise<{ success: boolean; output: string; exitCode: number }>): ProviderRuntime {
  const policy = key === 'codex' ? CODEX_MODEL_POLICY : CLAUDE_MODEL_POLICY;
  return { key, provider: { invoke }, policy, builtIn: true, availability: new ModelAvailability(policy.modelFallbackLadder) };
}

describe('provider admission at the daemon dispatch entry point', () => {
  it('dispatches a disallowed-substitution step only to its pinned provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'provider-admission-entry-'));
    roots.push(root);
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const codexInvoke = vi.fn(async () => ({ success: true, output: 'done', exitCode: 0 }));
    const claudeInvoke = vi.fn(async () => ({ success: true, output: 'must not run', exitCode: 0 }));
    const attempts: string[] = [];
    const providerExecution = {
      configuredProviders: ['codex', 'claude'],
      runtimes: new ProviderRuntimeSet([runtime('codex', codexInvoke), runtime('claude', claudeInvoke)]),
      sessions: new ProviderSessionStore(),
      config: { provider_substitution: 'disallow' as const },
      onAttempt: (_step: string, attempt: { provider: string }) => { attempts.push(attempt.provider); },
    };
    const events = new ConductorEventEmitter();
    const run = makeRunFeature({
      createWorktree: async () => ({ path: root, branch: 'feature' }),
      runConductor: async (_worktree, _item, execution) => {
        await executeProviderCandidates({
          step: 'build', configuredProviders: execution!.configuredProviders,
          preferredProvider: 'codex', runtimes: execution!.runtimes, sessions: execution!.sessions,
          config: execution!.config, onAttempt: execution!.onAttempt,
          options: { prompt: 'build', cwd: root },
        });
      },
      readOutcome: async () => ({ done: false, halted: true }),
      teardownWorktree: async () => {}, markProcessed: async () => {}, daemon: false, project: 'test',
      beginFeatureRun: () => ({ events, providerExecution, stop: () => {} }),
    });

    await run({ slug: 'feature' });

    expect(attempts).toEqual(['codex']);
    expect(codexInvoke).toHaveBeenCalledOnce();
    expect(claudeInvoke).not.toHaveBeenCalled();
  });

  it('records a suppressed provider without spawning it through a later daemon dispatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'provider-admission-entry-'));
    roots.push(root);
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const codexInvoke = vi.fn();
    const attempts: Array<{ provider: string; skipReason?: string }> = [];
    const providerExecution = {
      configuredProviders: ['codex'],
      runtimes: new ProviderRuntimeSet([runtime('codex', codexInvoke)]),
      sessions: new ProviderSessionStore(),
      providerAvailability: { suppress: vi.fn(), isAvailable: vi.fn(() => false) },
      onAttempt: (_step: string, attempt: { provider: string; skipReason?: string }) => {
        attempts.push(attempt);
      },
    };
    const events = new ConductorEventEmitter();
    const run = makeRunFeature({
      createWorktree: async () => ({ path: root, branch: 'feature' }),
      runConductor: async (_worktree, _item, execution) => {
        await executeProviderCandidates({
          step: 'build', configuredProviders: execution!.configuredProviders,
          runtimes: execution!.runtimes, sessions: execution!.sessions,
          providerAvailability: execution!.providerAvailability, onAttempt: execution!.onAttempt,
          options: { prompt: 'build', cwd: root },
        });
      },
      readOutcome: async () => ({ done: false, halted: true }),
      teardownWorktree: async () => {}, markProcessed: async () => {}, daemon: false, project: 'test',
      beginFeatureRun: () => ({ events, providerExecution, stop: () => {} }),
    });

    await run({ slug: 'later-step' });

    expect(attempts).toEqual([expect.objectContaining({
      provider: 'codex', invoked: false, skipReason: 'suppression-refused',
    })]);
    expect(codexInvoke).not.toHaveBeenCalled();
  });
});
