import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, vi } from 'vitest';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import { defineBoundaryContract } from './boundary-contract.js';

function invokeOptions(prompt: string) {
  return { prompt, sessionId: 'llm-contract-session', resume: false };
}

export const llmContract = defineBoundaryContract<LLMProvider>({
  boundary: 'llm',
  expectations: [
    {
      name: 'declares the adapter capabilities',
      run: async (provider) => {
        expect(provider.supportsSessionResume).toBe(false);
        expect(provider.lifecycleCapability).toEqual({ synchronousSpawnPermit: true });
        expect(provider.nativeSchemaCapability).toEqual({ nativeOutputSchema: true });
        expect(provider.systemPromptCapability).toEqual({ deliversSystemPrompt: true });
      },
    },
    {
      name: 'refuses a denied spawn permit before spawning',
      run: async (provider) => {
        const onSpawn = vi.fn();

        await expect(provider.invoke({
          ...invokeOptions('one line'),
          onSpawn,
          spawnPermit: () => ({ permitted: false, reason: 'revoked' }),
        })).rejects.toThrow('revoked');
        expect(onSpawn).not.toHaveBeenCalled();
      },
    },
    {
      name: 'completes a minimal invocation',
      run: async (provider) => {
        const result = await provider.invoke(invokeOptions('one line'));

        expect(result.success).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.output).not.toBe('');
      },
    },
    {
      name: 'returns a native-schema terminal result',
      run: async (provider) => {
        const root = await mkdtemp(join(tmpdir(), 'llm-contract-'));
        const home = join(root, '.daemon', 'scratch', 'contract-1', 'home');

        try {
          await mkdir(home, { recursive: true });
          const result = await provider.invoke({
            ...invokeOptions('Return one boolean.'),
            cwd: root,
            nativeSchemaScratchRoot: root,
            nativeSchemaScratchHome: home,
            nativeSchema: {
              type: 'object',
              properties: { accepted: { type: 'boolean' } },
              required: ['accepted'],
              additionalProperties: false,
            },
          });

          expect(result.success).toBe(true);
          expect(result.finalStructuredResult).toEqual(expect.any(Object));
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      },
    },
  ],
});
