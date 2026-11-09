// Covers: task:8
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it, vi } from 'vitest';
import { createVitest, type RunnerTask, type RunnerTestCase } from 'vitest/node';
import type { InvokeOptions, InvokeResult } from '../../src/execution/llm-provider.js';
import { createClaudeProviderFake } from '../fixtures/claude-provider-fake.js';
import { createCodexProviderFake } from '../fixtures/codex-provider-fake.js';
import { createPiProviderFake } from '../fixtures/pi-provider-fake.js';
import { createDefaultLlmRealProvider, defineLlmRealLeg, meterLlmProvider } from './llm-real-leg.js';
import { assertTokenCap } from '../fixtures/live-e2e-run-body.js';

const providers = {
  claude: createClaudeProviderFake,
  codex: createCodexProviderFake,
  pi: createPiProviderFake,
} as const;

const meteringEmitted: string[] = [];

function collectTests(tasks: readonly RunnerTask[]): readonly RunnerTestCase[] {
  return tasks.flatMap((task) =>
    task.type === 'test' ? [task as RunnerTestCase] : task.tasks === undefined ? [] : collectTests(task.tasks),
  );
}

async function collectRealAndFakeContractCases(): Promise<readonly RunnerTestCase[]> {
  const root = await mkdtemp(join(tmpdir(), 'llm-real-leg-timeout-'));
  const fixture = join(root, 'llm-real-leg-timeout.fixture.test.ts');
  const realLegModule = fileURLToPath(new URL('./llm-real-leg.ts', import.meta.url));
  const fakeLegModule = fileURLToPath(new URL('./llm.contract.test.ts', import.meta.url));
  const fakeModule = fileURLToPath(new URL('../fixtures/claude-provider-fake.ts', import.meta.url));

  await writeFile(
    fixture,
    [
      `import { defineLlmRealLeg } from ${JSON.stringify(realLegModule)};`,
      `import { createClaudeProviderFake } from ${JSON.stringify(fakeModule)};`,
      `import ${JSON.stringify(fakeLegModule)};`,
      '',
      "defineLlmRealLeg('claude', { createProvider: () => createClaudeProviderFake().provider });",
    ].join('\n'),
  );

  const vitest = await createVitest('test', {
    root,
    config: false,
    include: [fixture],
    exclude: [],
    environment: 'node',
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: 4_321,
    silent: true,
  });

  const priorExitCode = process.exitCode;
  try {
    await vitest.start([fixture]);
    return collectTests(vitest.state.getFiles());
  } finally {
    // This fixture registers an intentionally failing case to inspect it.
    // Do not let the nested runner's status leak to the parent worker.
    process.exitCode = priorExitCode;
    await vitest.close();
    await rm(root, { recursive: true, force: true });
  }
}

interface ContractCaseResult {
  readonly name: string;
  readonly state: string | undefined;
}

async function runInjectedRealLegFixture(divergeOnDeniedPermit = false): Promise<readonly ContractCaseResult[]> {
  const root = await mkdtemp(join(tmpdir(), 'llm-real-leg-contract-'));
  const fixture = join(root, 'llm-real-leg-contract.fixture.test.ts');
  const realLegModule = fileURLToPath(new URL('./llm-real-leg.ts', import.meta.url));
  const fakeLegModule = fileURLToPath(new URL('./llm.contract.test.ts', import.meta.url));
  const claudeFakeModule = fileURLToPath(new URL('../fixtures/claude-provider-fake.ts', import.meta.url));
  const codexFakeModule = fileURLToPath(new URL('../fixtures/codex-provider-fake.ts', import.meta.url));
  const piFakeModule = fileURLToPath(new URL('../fixtures/pi-provider-fake.ts', import.meta.url));

  await writeFile(
    fixture,
    [
      `import { defineLlmRealLeg } from ${JSON.stringify(realLegModule)};`,
      `import { createClaudeProviderFake } from ${JSON.stringify(claudeFakeModule)};`,
      `import { createCodexProviderFake } from ${JSON.stringify(codexFakeModule)};`,
      `import { createPiProviderFake } from ${JSON.stringify(piFakeModule)};`,
      `import ${JSON.stringify(fakeLegModule)};`,
      '',
      'const claude = createClaudeProviderFake().provider;',
      "defineLlmRealLeg('claude', { createProvider: () => " +
        (divergeOnDeniedPermit
          ? "({ ...claude, invoke: async (options) => options.spawnPermit?.().permitted === false ? { success: true, output: 'x', exitCode: 0 } : claude.invoke(options) })"
          : 'claude') +
        ' });',
      "defineLlmRealLeg('codex', { createProvider: () => createCodexProviderFake().provider });",
      "defineLlmRealLeg('pi', { createProvider: () => createPiProviderFake().provider });",
    ].join('\n'),
  );

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

  const priorExitCode = process.exitCode;
  try {
    await vitest.start([fixture]);
    return collectTests(vitest.state.getFiles()).map((test) => ({
      name: test.fullTestName.replaceAll(' > ', ' › '),
      state: test.result?.state,
    }));
  } finally {
    // The divergent fixture is expected to fail one case; its result is data
    // for this test rather than a failure of this parent Vitest process.
    process.exitCode = priorExitCode;
    await vitest.close();
    await rm(root, { recursive: true, force: true });
  }
}

describe('llm real leg injected providers', () => {
  for (const adapter of ['claude', 'codex', 'pi'] as const) {
    const createFake = providers[adapter];
    defineLlmRealLeg(adapter, { createProvider: () => createFake().provider });
  }

  // Covers: task:8
  it('runs the same four passing contract cases for every injected real adapter', async () => {
    const cases = await runInjectedRealLegFixture();
    const expectationNames = [
      'declares the adapter capabilities',
      'refuses a denied spawn permit before spawning',
      'completes a minimal invocation',
      'returns a native-schema terminal result',
    ];

    for (const adapter of Object.keys(providers)) {
      const real = cases.filter(({ name }) => name.startsWith(`llm contract [${adapter} real] › `));
      const fake = cases.filter(({ name }) => name.includes(`llm contract [${adapter} fake] › `));

      expect(real.map(({ name }) => name)).toEqual(
        expectationNames.map((expectation) => `llm contract [${adapter} real] › ${expectation}`),
      );
      expect(real.map(({ state }) => state)).toEqual(['pass', 'pass', 'pass', 'pass']);
      expect(
        fake.map(({ name }) =>
          name
            .slice(name.indexOf(`llm contract [${adapter} fake]`))
            .replace(`llm contract [${adapter} fake]`, `llm contract [${adapter} real]`),
        ),
      ).toEqual(real.map(({ name }) => name));
    }
  });

  // Covers: task:8
  it('fails only the Claude real denied-permit case when its provider resolves instead', async () => {
    const cases = await runInjectedRealLegFixture(true);
    const deniedPermit = 'llm contract [claude real] › refuses a denied spawn permit before spawning';

    expect(cases.find(({ name }) => name === deniedPermit)).toEqual({ name: deniedPermit, state: 'fail' });
    expect(
      cases
        .filter(({ name }) => name.startsWith('llm contract [claude real] › ') && name !== deniedPermit)
        .map(({ state }) => state),
    ).toEqual(['pass', 'pass', 'pass']);
  });
});

describe('llm real leg metering', () => {
  defineLlmRealLeg('claude', {
    createProvider: () =>
      createClaudeProviderFake(() => ({
        success: true,
        output: 'metered',
        exitCode: 0,
        tokenUsage: { input: 200, output: 200 },
        finalStructuredResult: {},
      })).provider,
    environment: { DAEMON_E2E_LIVE_TOKEN_CAP: '900' },
    emit: (message) => meteringEmitted.push(message),
  });

  it('does not meter the denied-permit expectation or notify its spawn observer', async () => {
    const onSpawn = vi.fn();
    const provider = meterLlmProvider({
      ...createClaudeProviderFake().provider,
      invoke: async (options: InvokeOptions): Promise<InvokeResult> => {
        const permit = options.spawnPermit?.();
        if (permit && !permit.permitted) throw new Error(`denied: ${permit.reason}`);
        options.onSpawn?.();
        return { success: true, output: 'x', exitCode: 0, tokenUsage: { input: 400, output: 500 } };
      },
    });

    await expect(
      provider.invoke({
        prompt: 'one line',
        sessionId: 'metering-test',
        resume: false,
        onSpawn,
        spawnPermit: () => ({ permitted: false, reason: 'revoked' }),
      }),
    ).rejects.toThrow('revoked');
    expect(onSpawn).not.toHaveBeenCalled();
    expect(provider.totalTokens).toBe(0);
  });

  it('sums only input and output token usage', async () => {
    const provider = meterLlmProvider({
      ...createClaudeProviderFake().provider,
      invoke: async () => ({
        success: true,
        output: 'x',
        exitCode: 0,
        tokenUsage: { input: 400, output: 500, cacheRead: 100, cacheCreation: 50 },
      }),
    });

    await provider.invoke({ prompt: 'one line', sessionId: 'metering-test', resume: false });
    expect(provider.totalTokens).toBe(900);
    expect(() => assertTokenCap(provider.totalTokens, provider.unmetered, 500)).toThrow(
      'Token cap 500 exceeded: observed 900',
    );
  });
});

afterAll(() => {
  expect(meteringEmitted).toEqual(['llm contract [claude real] tokens: 800 (cap 900)']);
});

describe('llm real leg boundaries', () => {
  // Covers: task:11
  it('assigns its 20-minute timeout only to the real contract cases', async () => {
    const cases = await collectRealAndFakeContractCases();
    const real = cases.filter(({ fullTestName }) => fullTestName.includes('llm contract [claude real]'));
    const fake = cases.filter(({ fullTestName }) => fullTestName.includes('llm contract [claude fake]'));

    expect(real).toHaveLength(4);
    expect(real.map(({ timeout }) => timeout)).toEqual([1_200_000, 1_200_000, 1_200_000, 1_200_000]);
    expect(fake).toHaveLength(4);
    expect(fake.map(({ timeout }) => timeout)).toEqual([4_321, 4_321, 4_321, 4_321]);
  });

  it('uses the default descriptor factory for every adapter', () => {
    expect(createDefaultLlmRealProvider('claude').constructor.name).toBe('ClaudeProvider');
    expect(createDefaultLlmRealProvider('codex').constructor.name).toBe('CodexProvider');
    expect(createDefaultLlmRealProvider('pi').constructor.name).toBe('PiProvider');
  });

  it('keeps each smoke source credential-gated, contract-importing, and option-free', async () => {
    for (const adapter of Object.keys(providers)) {
      const source = await readFile(
        fileURLToPath(new URL(`./llm-${adapter}.contract.smoke.test.ts`, import.meta.url)),
        'utf8',
      );

      expect(source).toContain(`const smokeCapability = 'credentialed:${adapter}';`);
      expect(source).toContain("import './llm.contract.js';");
      expect(source).toContain(`defineLlmRealLeg('${adapter}');`);
      expect(source).not.toContain(`defineLlmRealLeg('${adapter}',`);
    }
  });
});
