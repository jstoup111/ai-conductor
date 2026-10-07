import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createManagedSessionObservationPreparer,
  prepareManagedSessionObservationDestination,
} from '../../src/execution/managed-session-preparation.js';
import { executeProviderCandidates } from '../../src/engine/provider-execution.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { claudeLaunchObservedCommandReach, claudeReadOnlyReviewPolicyArgs } from '../../src/execution/claude-read-only-review-policy.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionScope } from '../../src/engine/provider-session.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function context() {
  const root = await mkdtemp(join(tmpdir(), 'managed-session-preparation-'));
  roots.push(root);
  const worktreeRoot = join(root, 'worktree');
  const producerRoot = join(worktreeRoot, '.pipeline', 'session-events', 'dispatch-1');
  await mkdir(producerRoot, { recursive: true });
  return {
    projectRoot: root, worktreeRoot, producerRoot, dispatchId: 'dispatch-1', provider: 'codex',
    scope: { kind: 'feature' as const, featureSlug: 'feature-a' },
  };
}

describe('managed observation destination preparation', () => {
  it('admits only a proven per-dispatch producer destination under the read-only policy', async () => {
    const managed = await context();
    const probe = vi.fn(async () => ({ producerWrite: 'allowed' as const, protectedWrites: 'refused' as const }));

    await expect(prepareManagedSessionObservationDestination({
      provider: 'codex', context: managed, readOnlyReview: true, probe,
    })).resolves.toEqual({ producerRoot: managed.producerRoot });
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({
      producerRoot: managed.producerRoot,
      protectedPaths: [
        managed.worktreeRoot,
        join(managed.worktreeRoot, '.pipeline', 'sealed'),
        join(managed.worktreeRoot, '.pipeline', 'unrelated'),
        join(managed.projectRoot, '.codex'),
      ],
    }));
  });

  it('forwards the selected executable through the shared daemon-session preparer', async () => {
    const managed = await context();
    const probe = vi.fn(async () => ({ producerWrite: 'allowed' as const, protectedWrites: 'refused' as const }));
    const prepare = createManagedSessionObservationPreparer(probe);

    await expect(prepare({
      provider: 'codex', context: managed, readOnlyReview: true, executable: '/self-host/codex',
    })).resolves.toEqual({ producerRoot: managed.producerRoot });

    expect(probe).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'codex', producerRoot: managed.producerRoot, executable: '/self-host/codex',
    }));
  });

  it('refuses before provider launch when native read-only availability cannot prove observation access', async () => {
    const managed = await context();
    const invoke = vi.fn(async () => ({ success: true, output: 'must not run', exitCode: 0 }));
    const result = await executeProviderCandidates({
      step: 'build_review', configuredProviders: ['codex'], preferredProvider: 'codex',
      runtimes: new ProviderRuntimeSet([{ key: 'codex', provider: { invoke }, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder) }]),
      sessions: new ProviderSessionScope(vi.fn()),
      options: { prompt: 'review', cwd: managed.worktreeRoot, readOnlyReview: true, managedSessionContext: managed },
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(result.providerSetupExhaustion?.candidates).toEqual([expect.objectContaining({
      provider: 'codex', capability: 'managed-observation-destination',
      recoveryAction: expect.stringContaining('observation destination'),
    })]);
  });

  it('prepares the selected policy destination before launching the supported review candidate', async () => {
    const managed = await context();
    const order: string[] = [];
    const invoke = vi.fn(async () => {
      order.push('invoke');
      return { success: true, output: 'reviewed', exitCode: 0 };
    });
    const prepareManagedSessionObservation = vi.fn(async ({ provider, context: candidateContext, readOnlyReview, executable }) => {
      order.push('prepare-observation');
      expect({ provider, candidateContext, readOnlyReview, executable }).toEqual({
        provider: 'codex', candidateContext: { ...managed, provider: 'codex' }, readOnlyReview: true,
        executable: '/isolated/codex',
      });
      return { producerRoot: managed.producerRoot };
    });

    const result = await executeProviderCandidates({
      step: 'build_review', configuredProviders: ['codex'], preferredProvider: 'codex',
      runtimes: new ProviderRuntimeSet([{ key: 'codex', provider: { invoke }, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder) }]),
      sessions: new ProviderSessionScope(vi.fn()),
      prepareCandidateSelfHost: async () => ({ executable: '/isolated/codex', env: {}, args: [], teardown: async () => {} }),
      prepareManagedSessionObservation,
      options: { prompt: 'review', cwd: managed.worktreeRoot, readOnlyReview: true, managedSessionContext: managed },
    });

    expect(result).toMatchObject({ success: true, actualProvider: 'codex' });
    expect(order).toEqual(['prepare-observation', 'invoke']);
    expect(prepareManagedSessionObservation).toHaveBeenCalledOnce();
  });

  describe('read-only review whose launch reaches no observed command (#3022)', () => {
    function claudeRuntime(provider: LLMProvider) {
      return new ProviderRuntimeSet([{ key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]);
    }
    const unprovenProbe = vi.fn(async () => ({ producerWrite: 'unproven' as const, protectedWrites: 'unproven' as const }));

    it('launches the real Claude read-only policy with no producer destination and no proof', async () => {
      const managed = { ...(await context()), provider: 'claude' };
      const claude = new ClaudeProvider();
      const invoke = vi.fn(async () => ({ success: true, output: 'reviewed', exitCode: 0 }));
      const prepareManagedSessionObservation = vi.fn(createManagedSessionObservationPreparer(unprovenProbe));

      const result = await executeProviderCandidates({
        step: 'build_review', configuredProviders: ['claude'], preferredProvider: 'claude',
        runtimes: claudeRuntime({
          invoke,
          lifecycleCapability: { synchronousSpawnPermit: true },
          readOnlyReviewObservedCommandReach: (options) => claude.readOnlyReviewObservedCommandReach(options),
        }),
        sessions: new ProviderSessionScope(vi.fn()),
        prepareManagedSessionObservation,
        options: { prompt: 'review', cwd: managed.worktreeRoot, readOnlyReview: true, managedSessionContext: managed },
      });

      expect(result).toMatchObject({ success: true, actualProvider: 'claude' });
      expect(invoke).toHaveBeenCalledOnce();
      expect(prepareManagedSessionObservation).not.toHaveBeenCalled();
      expect(unprovenProbe).not.toHaveBeenCalled();
      // No observer wrapper (or any other telemetry file) was provisioned.
      await expect(readdir(managed.producerRoot)).resolves.toEqual([]);
    });

    it.each([
      ['an allowed gh prefix', ['--allowedTools', 'Bash(gh:*)']],
      ['unrestricted Bash', ['--allowedTools', 'Bash']],
    ])('still refuses setup when the launch policy adds %s', async (_name, extra) => {
      const managed = { ...(await context()), provider: 'claude' };
      const invoke = vi.fn(async () => ({ success: true, output: 'must not run', exitCode: 0 }));

      const result = await executeProviderCandidates({
        step: 'build_review', configuredProviders: ['claude'], preferredProvider: 'claude',
        runtimes: claudeRuntime({
          invoke,
          readOnlyReviewObservedCommandReach: () => claudeLaunchObservedCommandReach([...claudeReadOnlyReviewPolicyArgs(), ...extra]),
        }),
        sessions: new ProviderSessionScope(vi.fn()),
        prepareManagedSessionObservation: createManagedSessionObservationPreparer(unprovenProbe),
        options: { prompt: 'review', cwd: managed.worktreeRoot, readOnlyReview: true, managedSessionContext: managed },
      });

      expect(invoke).not.toHaveBeenCalled();
      expect(result.providerSetupExhaustion?.candidates).toEqual([expect.objectContaining({
        provider: 'claude', capability: 'managed-observation-destination',
        reason: 'the selected read-only policy cannot prove narrow observation access',
      })]);
    });

    it('still refuses setup when real self-host args widen the Claude launch', async () => {
      const managed = { ...(await context()), provider: 'claude' };
      const claude = new ClaudeProvider();
      const invoke = vi.fn(async () => ({ success: true, output: 'must not run', exitCode: 0 }));

      const result = await executeProviderCandidates({
        step: 'build_review', configuredProviders: ['claude'], preferredProvider: 'claude',
        runtimes: claudeRuntime({
          invoke,
          readOnlyReviewObservedCommandReach: (options) => claude.readOnlyReviewObservedCommandReach(options),
        }),
        sessions: new ProviderSessionScope(vi.fn()),
        prepareCandidateSelfHost: async () => ({ executable: '/isolated/claude', env: {}, args: ['--settings', '{}'], teardown: async () => {} }),
        prepareManagedSessionObservation: createManagedSessionObservationPreparer(unprovenProbe),
        options: { prompt: 'review', cwd: managed.worktreeRoot, readOnlyReview: true, managedSessionContext: managed },
      });

      expect(invoke).not.toHaveBeenCalled();
      expect(result.providerSetupExhaustion?.candidates).toEqual([expect.objectContaining({
        provider: 'claude', capability: 'managed-observation-destination',
      })]);
    });
  });
});
