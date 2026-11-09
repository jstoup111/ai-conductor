// Covers: S1.1, S1.2, S1.3, S1.4, S1.5
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { createVitest, type RunnerTask, type RunnerTestCase } from 'vitest/node';

const harnessModule = fileURLToPath(new URL('./boundary-contract.ts', import.meta.url));

interface ContractRun {
  readonly names: readonly string[];
  readonly results: readonly {
    readonly name: string;
    readonly state: string | undefined;
    readonly errors: readonly string[];
    readonly timeout: number;
  }[];
}

function collectTests(tasks: readonly RunnerTask[]): readonly RunnerTestCase[] {
  return tasks.flatMap((task) => task.type === 'test'
    ? [task as RunnerTestCase]
    : task.tasks === undefined ? [] : collectTests(task.tasks));
}

async function runContractFixture(source: string, testTimeout = 5_000): Promise<ContractRun> {
  const root = await mkdtemp(join(tmpdir(), 'boundary-contract-'));
  const fixture = join(root, 'boundary-contract.fixture.test.ts');
  await writeFile(fixture, source);
  const vitest = await createVitest('test', {
    root,
    config: false,
    include: [fixture],
    exclude: [],
    environment: 'node',
    pool: 'forks',
    maxWorkers: 1,
    testTimeout,
    silent: true,
  });

  const priorExitCode = process.exitCode;
  try {
    await vitest.start([fixture]);
    const tests = collectTests(vitest.state.getFiles());
    return {
      names: tests.map((test) => test.fullTestName.replace(' > ', ' › ')),
      results: tests.map((test) => ({
        name: test.fullTestName.replace(' > ', ' › '),
        state: test.result?.state,
        errors: (test.result?.errors ?? []).map((error) => String(error.message)),
        timeout: test.timeout,
      })),
    };
  } finally {
    // Child fixtures deliberately contain failed cases. Vitest records those
    // correctly in its state, but also marks this parent worker as failed.
    process.exitCode = priorExitCode;
    await vitest.close();
    await rm(root, { recursive: true, force: true });
  }
}

function fixtureSource({ leg = 'fake', secondExpectation = 'subject.ready === true', factory = '() => ({ ready: true })', timeoutMs }: {
  readonly leg?: 'fake' | 'real';
  readonly secondExpectation?: string;
  readonly factory?: string;
  readonly timeoutMs?: number;
} = {}): string {
  return [
    "import { expect } from 'vitest';",
    `import { defineBoundaryContract, runBoundaryContract } from ${JSON.stringify(harnessModule)};`,
    '',
    "const contract = defineBoundaryContract({ boundary: 'llm', expectations: [",
    "  { name: 'declares the adapter capabilities', run: (subject: { ready: boolean }) => expect(subject.ready).toBe(true) },",
    `  { name: 'completes a minimal invocation', run: (subject: { ready: boolean }) => expect(${secondExpectation}).toBe(true) },`,
    '] });',
    `runBoundaryContract(contract, { adapter: 'claude', leg: '${leg}', create: ${factory}${timeoutMs === undefined ? '' : `, timeoutMs: ${timeoutMs}`} });`,
  ].join('\n');
}

describe('boundary contract harness', () => {
  it('runs one ordered contract unchanged for fake and real legs with one case per named expectation', async () => {
    const fake = await runContractFixture(fixtureSource());
    const real = await runContractFixture(fixtureSource({ leg: 'real' }));

    expect(fake.names).toEqual([
      'llm contract [claude fake] › declares the adapter capabilities',
      'llm contract [claude fake] › completes a minimal invocation',
    ]);
    expect(real.names).toEqual([
      'llm contract [claude real] › declares the adapter capabilities',
      'llm contract [claude real] › completes a minimal invocation',
    ]);
    expect(fake.results.map(({ state }) => state)).toEqual(['pass', 'pass']);
    expect(real.results.map(({ state }) => state)).toEqual(['pass', 'pass']);
  });

  it('reports one independently failed expectation while the other case passes', async () => {
    const run = await runContractFixture(fixtureSource({ secondExpectation: 'subject.ready === false' }));

    expect(run.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'llm contract [claude fake] › declares the adapter capabilities', state: 'pass' }),
      expect.objectContaining({ name: 'llm contract [claude fake] › completes a minimal invocation', state: 'fail' }),
    ]));
    expect(run.results.filter(({ state }) => state === 'fail')).toHaveLength(1);
  });

  // Covers: task:11
  it('registers an explicit timeout for every case and otherwise keeps the configured default', async () => {
    const explicit = await runContractFixture(fixtureSource({ timeoutMs: 1_200_000 }), 4_321);
    const defaulted = await runContractFixture(fixtureSource(), 4_321);

    expect(explicit.results.map(({ timeout }) => timeout)).toEqual([1_200_000, 1_200_000]);
    expect(defaulted.results.map(({ timeout }) => timeout)).toEqual([4_321, 4_321]);
  });

  it('rejects empty and duplicate expectation definitions with the boundary named before registering cases', async () => {
    const { defineBoundaryContract } = await import('./boundary-contract.js');
    const contract = defineBoundaryContract({
      boundary: 'llm',
      expectations: [
        { name: 'first', run: () => undefined },
        { name: 'second', run: () => undefined },
      ],
    });

    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.expectations)).toBe(true);
    expect(contract.expectations.map(({ name }) => name)).toEqual(['first', 'second']);
    expect(() => defineBoundaryContract({ boundary: 'llm', expectations: [] })).toThrow(/llm.*empty/i);
    expect(() => defineBoundaryContract({
      boundary: 'llm',
      expectations: [
        { name: 'duplicate', run: () => undefined },
        { name: 'duplicate', run: () => undefined },
      ],
    })).toThrow(/llm.*duplicate/i);
  });

  it('makes every case fail with the factory error rather than passing without assertions', async () => {
    const run = await runContractFixture(fixtureSource({ factory: "() => { throw new Error('factory boom'); }" }));

    expect(run.results).toHaveLength(2);
    expect(run.results.every(({ state }) => state === 'fail')).toBe(true);
    expect(run.results.every(({ errors }) => errors.join('\n').includes('factory boom'))).toBe(true);
  });
});
