// Covers: task:2
import { describe, expect, it } from 'vitest';
import type { HarnessConfig } from '../../src/types/config.js';

type ResolveComposeLaunchHost = (input: {
  providerFlag?: string;
  config: HarnessConfig;
}) => string;

async function resolveHost(input: Parameters<ResolveComposeLaunchHost>[0]): Promise<string | undefined> {
  const module = await import('../../src/engine/compose-launch-host.js').catch(() => null);
  return (module as { resolveComposeLaunchHost?: ResolveComposeLaunchHost } | null)
    ?.resolveComposeLaunchHost?.(input);
}

async function resolveHostOrError(
  input: Parameters<ResolveComposeLaunchHost>[0],
): Promise<string | undefined> {
  try {
    return await resolveHost(input);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('resolveComposeLaunchHost', () => {
  it('selects the flag, explore pin, first configured provider, or Claude default', async () => {
    const hosts = await Promise.all([
      resolveHost({ config: {} }),
      resolveHost({ config: { llm_provider: 'codex' } }),
      resolveHost({ config: { llm_provider: ['codex', 'claude'] } }),
      resolveHost({
        config: {
          llm_provider: ['codex', 'claude'],
          steps: { explore: { llm_provider: 'claude' } },
        },
      }),
      resolveHost({
        providerFlag: 'claude',
        config: { steps: { explore: { llm_provider: 'codex' } } },
      }),
      resolveHostOrError({ providerFlag: 'gemini', config: {} }),
    ]);

    expect(hosts).toEqual([
      'claude',
      'codex',
      'codex',
      'claude',
      'claude',
      expect.stringContaining('--provider names unknown provider "gemini"'),
    ]);
  });
});
