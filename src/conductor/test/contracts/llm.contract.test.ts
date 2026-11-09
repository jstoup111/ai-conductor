// Covers: S4.1, S4.2, S4.3, S4.4, S4.5, task:7
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import type { InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { createClaudeProviderFake } from '../fixtures/claude-provider-fake.js';
import { createCodexProviderFake } from '../fixtures/codex-provider-fake.js';
import { createPiProviderFake } from '../fixtures/pi-provider-fake.js';
import { runBoundaryContract } from './boundary-contract.js';
import { llmContract } from './llm.contract.js';

const fakeProviders = {
  claude: createClaudeProviderFake,
  codex: createCodexProviderFake,
  pi: createPiProviderFake,
} as const;

describe('llm contract fake leg', () => {
  for (const [adapter, createFake] of Object.entries(fakeProviders)) {
    runBoundaryContract(llmContract, {
      adapter,
      leg: 'fake',
      create: () => createFake().provider,
    });
  }

  it('does not let the contract module construct providers or import process launchers', async () => {
    const source = await readFile(fileURLToPath(new URL('./llm.contract.ts', import.meta.url)), 'utf8');

    expect(source).not.toMatch(/(?:from|import)\s+['"](?:execa|child_process|node:child_process)['"]/);
    expect(source).not.toMatch(/new\s+(?:ClaudeProvider|CodexProvider|PiProvider)\b/);
  });
});

describe('llm contract expectation sensitivity', () => {
  it('fails only the mutated capability subject', async () => {
    const capability = llmContract.expectations.find(({ name }) => name === 'declares the adapter capabilities')!;
    const claude = createClaudeProviderFake().provider;

    await expect(capability.run({ ...claude, supportsSessionResume: true })).rejects.toThrow();
    await expect(capability.run(createCodexProviderFake().provider)).resolves.toBeUndefined();
    await expect(capability.run(createPiProviderFake().provider)).resolves.toBeUndefined();
  });

  it('requires denied permits to reject before an observer and name the reason', async () => {
    const denial = llmContract.expectations.find(({ name }) => name === 'refuses a denied spawn permit before spawning')!;
    const pi = createPiProviderFake().provider;
    const resolvesDenied: LLMProvider = {
      ...pi,
      invoke: async () => ({ success: false, output: 'denied', exitCode: 1 }),
    };
    const observesBeforeRejecting: LLMProvider = {
      ...pi,
      invoke: async (options) => {
        options.onSpawn?.();
        throw new Error('revoked');
      },
    };
    const omitsReason: LLMProvider = {
      ...pi,
      invoke: async () => { throw new Error('spawn denied'); },
    };

    await expect(denial.run(resolvesDenied)).rejects.toThrow();
    await expect(denial.run(observesBeforeRejecting)).rejects.toThrow();
    await expect(denial.run(omitsReason)).rejects.toThrow();
    await expect(denial.run(createClaudeProviderFake().provider)).resolves.toBeUndefined();
    await expect(denial.run(createCodexProviderFake().provider)).resolves.toBeUndefined();
  });

  it('accepts any non-empty minimal output and rejects each required result failure', async () => {
    const minimal = llmContract.expectations.find(({ name }) => name === 'completes a minimal invocation')!;
    const pi = createPiProviderFake().provider;
    const result = (overrides: Partial<InvokeResult>): LLMProvider => ({
      ...pi,
      invoke: async () => ({ success: true, output: 'zzz-unrelated', exitCode: 0, ...overrides }),
    });

    await expect(minimal.run(result({}))).resolves.toBeUndefined();
    await expect(minimal.run(result({ output: '' }))).rejects.toThrow();
    await expect(minimal.run(result({ success: false }))).rejects.toThrow();
    await expect(minimal.run(result({ exitCode: 1 }))).rejects.toThrow();
  });

  it('supplies a confined scratch home to native-schema invocations and removes it afterwards', async () => {
    const nativeSchema = llmContract.expectations.find(({ name }) => name === 'returns a native-schema terminal result')!;
    let observedRoot: string | undefined;
    let observedHome: string | undefined;
    const recording: LLMProvider = {
      supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
      systemPromptCapability: { deliversSystemPrompt: true },
      invoke: async (options) => {
        observedRoot = options.nativeSchemaScratchRoot;
        observedHome = options.nativeSchemaScratchHome;
        const { writeScratchSchema } = await import('../../src/execution/scratch-schema.js');
        await writeScratchSchema({
          worktreeRoot: options.nativeSchemaScratchRoot!,
          homeDir: options.nativeSchemaScratchHome!,
          schema: options.nativeSchema!,
        });
        return { success: true, output: 'structured', exitCode: 0, finalStructuredResult: { ok: true } };
      },
    };

    await expect(nativeSchema.run(recording)).resolves.toBeUndefined();
    expect(observedHome).toMatch(new RegExp(`${observedRoot!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.daemon/scratch/`));
    await expect(access(observedRoot!)).rejects.toThrow();
  });
});
