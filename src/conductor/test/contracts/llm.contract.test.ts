// Covers: S4.1, S4.2, S4.3, S4.4, S4.5, task:7
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { createVitest, type RunnerTask, type RunnerTestCase } from 'vitest/node';
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

const expectationNames = [
  'declares the adapter capabilities',
  'refuses a denied spawn permit before spawning',
  'completes a minimal invocation',
  'returns a native-schema terminal result',
] as const;

function collectTests(tasks: readonly RunnerTask[]): readonly RunnerTestCase[] {
  return tasks.flatMap((task) => task.type === 'test'
    ? [task as RunnerTestCase]
    : task.tasks === undefined ? [] : collectTests(task.tasks));
}

async function registeredFakeLegCases(): Promise<readonly string[]> {
  const root = await mkdtemp(join(tmpdir(), 'llm-contract-fake-leg-'));
  const fixture = join(root, 'llm-contract-fake-leg.fixture.test.ts');
  const contractModule = fileURLToPath(new URL('./llm.contract.ts', import.meta.url));
  const boundaryModule = fileURLToPath(new URL('./boundary-contract.ts', import.meta.url));
  const claudeFakeModule = fileURLToPath(new URL('../fixtures/claude-provider-fake.ts', import.meta.url));
  const codexFakeModule = fileURLToPath(new URL('../fixtures/codex-provider-fake.ts', import.meta.url));
  const piFakeModule = fileURLToPath(new URL('../fixtures/pi-provider-fake.ts', import.meta.url));

  await writeFile(fixture, [
    `import { llmContract } from ${JSON.stringify(contractModule)};`,
    `import { runBoundaryContract } from ${JSON.stringify(boundaryModule)};`,
    `import { createClaudeProviderFake } from ${JSON.stringify(claudeFakeModule)};`,
    `import { createCodexProviderFake } from ${JSON.stringify(codexFakeModule)};`,
    `import { createPiProviderFake } from ${JSON.stringify(piFakeModule)};`,
    '',
    'for (const [adapter, createFake] of Object.entries({ claude: createClaudeProviderFake, codex: createCodexProviderFake, pi: createPiProviderFake })) {',
    "  runBoundaryContract(llmContract, { adapter, leg: 'fake', create: () => createFake().provider });",
    '}',
  ].join('\n'));

  const vitest = await createVitest('test', {
    root,
    config: false,
    include: [fixture],
    exclude: [],
    environment: 'node',
    pool: 'forks',
    maxWorkers: 1,
    silent: true,
  });

  try {
    await vitest.start([fixture]);
    return collectTests(vitest.state.getFiles()).map((test) => test.fullTestName.replaceAll(' > ', ' › '));
  } finally {
    await vitest.close();
    await rm(root, { recursive: true, force: true });
  }
}

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
  it('defines the source contract and registers all twelve fake-leg cases', async () => {
    const source = await readFile(fileURLToPath(new URL('./llm.contract.ts', import.meta.url)), 'utf8');
    const expectedCases = Object.keys(fakeProviders).flatMap((adapter) => expectationNames
      .map((expectation) => `llm contract [${adapter} fake] › ${expectation}`));

    expect(source).toMatch(/import\s*\{\s*defineBoundaryContract\s*\}\s*from\s*['"]\.\/boundary-contract\.js['"]/);
    for (const expectation of expectationNames) expect(source).toContain(`name: '${expectation}'`);
    expect(llmContract.expectations.map(({ name }) => name)).toEqual(expectationNames);
    const cases = await registeredFakeLegCases();
    expect(cases).toHaveLength(12);
    expect(cases).toEqual(expectedCases);
  });

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
