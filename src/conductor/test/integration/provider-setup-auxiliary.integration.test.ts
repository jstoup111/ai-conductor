import { describe, expect, it, vi } from 'vitest';
import { executeAuxiliaryProviderCandidates } from '../../src/engine/provider-execution.js';
import { ProviderSetupUnavailableError } from '../../src/engine/provider-setup-failure.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionScope } from '../../src/engine/provider-session.js';
import { CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';

describe('auxiliary setup exhaustion', () => {
  it('retains the typed carrier for the owning build-review and coverage callers', async () => {
    const result = await executeAuxiliaryProviderCandidates({ step: 'build_review', memberId: 'scope', policy: { enabled: true, llm_provider: ['codex'], model: 'gpt-5.6-sol', effort: 'high', model_fallback_ladder: [], max_retries: 1, escalate: false, min_confidence: 0 },
      runtimes: new ProviderRuntimeSet([{ key: 'codex', provider: { invoke: vi.fn() }, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability([]) }]), sessions: new ProviderSessionScope(vi.fn()), options: { prompt: 'review', cwd: '/workspace' },
      prepareCandidateSelfHost: async () => { throw new ProviderSetupUnavailableError({ provider: 'codex', reason: 'secret-canary', recoveryAction: 'secret-canary-recovery' }); }, });
    expect(result.providerSetupExhaustion?.candidates).toHaveLength(1);
  });
});
