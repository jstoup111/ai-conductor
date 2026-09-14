import { describe, expect, it, vi } from 'vitest';
import { executeProviderCandidates } from '../../src/engine/provider-execution.js';
import { ProviderSetupUnavailableError } from '../../src/engine/provider-setup-failure.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionScope } from '../../src/engine/provider-session.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';

describe('self-host candidate preparation', () => {
  it('releases the skipped Codex candidate and dispatches Claude through the real candidate loop', async () => {
    const codex = vi.fn(); const claude = vi.fn(async () => ({ success: true, output: 'claude', exitCode: 0 }));
    const result = await executeProviderCandidates({ step: 'build', configuredProviders: ['codex', 'claude'], sessions: new ProviderSessionScope(vi.fn()),
      runtimes: new ProviderRuntimeSet([
        { key: 'codex', provider: { invoke: codex }, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability([]) },
        { key: 'claude', provider: { invoke: claude }, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability([]) },
      ]), options: { prompt: 'build', cwd: '/workspace' },
      prepareCandidateSelfHost: async (candidate) => { if (candidate.providerKey === 'codex') throw new ProviderSetupUnavailableError({ provider: 'codex', reason: 'isolated home unavailable', recoveryAction: 'install home' }); return undefined; },
    });
    expect(result.success).toBe(true);
    expect(result.actualProvider).toBe('claude');
    expect(result.attempts[0]).toMatchObject({ provider: 'codex', invoked: false, skipReason: 'setup-unavailable' });
    expect(codex).not.toHaveBeenCalled(); expect(claude).toHaveBeenCalledOnce();
  });
});
