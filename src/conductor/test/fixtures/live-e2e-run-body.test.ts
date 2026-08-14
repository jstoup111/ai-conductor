import { describe, expect, it, vi } from 'vitest';

import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { LiveE2EProviderDescriptor } from './live-e2e-providers.js';

vi.mock('../engine/daemon-e2e-fixture.test.js', () => ({
  dumpPipelineDiagnostics: vi.fn(),
}));

describe('runLiveE2ERunBody authentication source', () => {
  it('rejects a descriptor authentication-source mismatch naming the expected and resolved sources', async () => {
    const { assertDescriptorAuthenticationSource } = await import('./live-e2e-run-body.js') as {
      assertDescriptorAuthenticationSource: (
        descriptor: LiveE2EProviderDescriptor,
        provider: LLMProvider,
      ) => Promise<void>;
    };
    const provider: LLMProvider = {
      invoke: vi.fn(),
      invokeInteractive: vi.fn(),
    };
    const resolveAuthenticationSource = vi.fn().mockResolvedValue('cached-login');
    const descriptor = {
      expectedAuthenticationSource: 'api-key',
      resolveAuthenticationSource,
    } as unknown as LiveE2EProviderDescriptor;

    await expect(assertDescriptorAuthenticationSource(descriptor, provider))
      .rejects.toThrow('expected api-key, resolved cached-login');
    expect(resolveAuthenticationSource).toHaveBeenCalledTimes(1);
    expect(resolveAuthenticationSource).toHaveBeenCalledWith(provider);
  });
});
