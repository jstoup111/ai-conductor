import { describe, expect, it, vi } from 'vitest';

import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { LiveE2EProviderDescriptor } from './live-e2e-providers.js';

vi.mock('../engine/daemon-e2e-fixture.test.js', () => ({
  dumpPipelineDiagnostics: vi.fn(),
}));

describe('runLiveE2ERunBody authentication source', () => {
  it('installs the live Codex API key before construction, rather than repairing a cached-login provider afterward', async () => {
    const { createLiveProvider } = await import('./live-e2e-run-body.js') as {
      createLiveProvider: (descriptor: LiveE2EProviderDescriptor, credential: string | undefined) => LLMProvider;
    };
    const priorKey = process.env.CODEX_API_KEY;
    const createProvider = vi.fn(() => ({
      source: process.env.CODEX_API_KEY ? 'api-key' : 'cached-login',
      invoke: vi.fn(),
      invokeInteractive: vi.fn(),
    }));
    const descriptor = {
      credentialEnvVar: 'CODEX_API_KEY',
      createProvider,
    } as unknown as LiveE2EProviderDescriptor;

    try {
      delete process.env.CODEX_API_KEY;
      const constructedFirst = descriptor.createProvider() as LLMProvider & { source: string };

      const constructedWithCredential = createLiveProvider(
        descriptor,
        'live-codex-key',
      ) as LLMProvider & { source: string };

      expect({
        constructedFirst: constructedFirst.source,
        constructedWithCredential: constructedWithCredential.source,
        constructorCalls: createProvider.mock.calls.length,
      }).toEqual({
        constructedFirst: 'cached-login',
        constructedWithCredential: 'api-key',
        constructorCalls: 2,
      });
    } finally {
      if (priorKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = priorKey;
    }
  });

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
