import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { AuthenticationReadiness, InvokeOptions, LLMProvider } from '../../src/execution/llm-provider.js';
import { LIVE_E2E_PROVIDERS, type LiveE2EProviderDescriptor } from './live-e2e-providers.js';
import type { LiveE2ERunBodyDependencies } from './live-e2e-run-body.js';

vi.mock('../engine/daemon-e2e-fixture.test.js', () => ({
  dumpPipelineDiagnostics: vi.fn(),
}));

describe('runLiveE2ERunBody authentication source', () => {
  it('reports an absent Codex binary as an unmet toolchain requirement before provisioning a home', async () => {
    const { runLiveE2ERunBody } = await import('./live-e2e-run-body.js') as {
      runLiveE2ERunBody: (
        descriptor: LiveE2EProviderDescriptor,
        tokenCap: number,
        dependencies?: LiveE2ERunBodyDependencies,
      ) => Promise<void>;
    };
    const provisionProviderHome = vi.fn(async (): Promise<never> => {
      throw new Error('a missing binary must not provision a home');
    });
    const descriptor = {
      id: 'codex',
      binaryName: 'codex',
      credentialEnvVar: 'CODEX_API_KEY',
    } as unknown as LiveE2EProviderDescriptor;

    await expect(runLiveE2ERunBody(descriptor, 1, {
      binaryAvailable: () => false,
      provisionProviderHome,
    })).rejects.toThrow('Unmet toolchain requirement: codex binary is unavailable.');
    expect(provisionProviderHome).not.toHaveBeenCalled();
  });

  it('fails a credential-less Codex leg before any provider dispatch, naming the missing credential and cached-login path searched', async () => {
    const { runLiveE2ERunBody } = await import('./live-e2e-run-body.js') as {
      runLiveE2ERunBody: (
        descriptor: LiveE2EProviderDescriptor,
        tokenCap: number,
        dependencies?: LiveE2ERunBodyDependencies,
      ) => Promise<void>;
    };
    const codexHome = await mkdtemp(`${tmpdir()}/live-e2e-empty-codex-home-`);
    const priorKey = process.env.CODEX_API_KEY;
    const priorHome = process.env.CODEX_HOME;
    let dispatches = 0;
    const createProvider = vi.fn((): LLMProvider => ({
      invoke: vi.fn(async () => {
        dispatches += 1;
        throw new Error('provider must not dispatch');
      }),
      invokeInteractive: vi.fn(async () => {
        dispatches += 1;
        throw new Error('provider must not dispatch');
      }),
    }));
    const descriptor = {
      id: 'codex',
      binaryName: 'codex',
      credentialEnvVar: 'CODEX_API_KEY',
      createProvider,
    } as unknown as LiveE2EProviderDescriptor;

    try {
      delete process.env.CODEX_API_KEY;
      process.env.CODEX_HOME = codexHome;

      await expect(runLiveE2ERunBody(descriptor, 1, { binaryAvailable: () => true })).rejects.toThrow(
        `Missing Codex credential: set CODEX_API_KEY or sign in at ${codexHome}/auth.json`,
      );
      expect({ providerConstructions: createProvider.mock.calls.length, dispatches }).toEqual({
        providerConstructions: 0,
        dispatches: 0,
      });
    } finally {
      if (priorKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = priorKey;
      if (priorHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = priorHome;
      await rm(codexHome, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'unusable',
      { provider: 'codex', source: 'api-key', state: 'unusable', remediation: 'Replace the API key.' },
      'Provider readiness is unusable: Replace the API key.',
    ],
    [
      'probe-failed',
      {
        provider: 'codex',
        source: 'api-key',
        state: 'probe-failed',
        probeFailure: { kind: 'timeout', facts: {} },
      },
      'Provider readiness is probe-failed: Retry the Codex readiness probe.',
    ],
  ] as const)('stops a %s provider before any paid dispatch and reports remediation', async (_state, readiness, expectedError) => {
    const { runLiveE2ERunBody } = await import('./live-e2e-run-body.js') as {
      runLiveE2ERunBody: (
        descriptor: LiveE2EProviderDescriptor,
        tokenCap: number,
        dependencies?: LiveE2ERunBodyDependencies,
      ) => Promise<void>;
    };
    const priorKey = process.env.CODEX_API_KEY;
    let dispatches = 0;
    const readinessCheck = vi.fn(async (): Promise<AuthenticationReadiness> => readiness);
    const provider: LLMProvider = {
      readiness: readinessCheck,
      invoke: vi.fn(async () => {
        dispatches += 1;
        throw new Error('provider must not dispatch');
      }),
      invokeInteractive: vi.fn(async () => {
        dispatches += 1;
        throw new Error('provider must not dispatch');
      }),
    };
    const createProvider = vi.fn(() => provider);
    const provisionProviderHome = vi.fn(async (): Promise<never> => {
      throw new Error('an unready provider must not provision a home');
    });
    const descriptor = {
      id: 'codex',
      binaryName: 'codex',
      credentialEnvVar: 'CODEX_API_KEY',
      createProvider,
      expectedAuthenticationSource: 'api-key',
      resolveAuthenticationSource: async (candidate: LLMProvider) => {
        const result = await candidate.readiness?.();
        if (!result) throw new Error('Codex provider must expose readiness');
        return result.source;
      },
    } as unknown as LiveE2EProviderDescriptor;

    try {
      process.env.CODEX_API_KEY = 'live-codex-key';

      await expect(runLiveE2ERunBody(descriptor, 1, {
        binaryAvailable: () => true,
        provisionProviderHome,
      })).rejects.toThrow(expectedError);
      expect({
        providerConstructions: createProvider.mock.calls.length,
        readinessChecks: readinessCheck.mock.calls.length,
        provisionAttempts: provisionProviderHome.mock.calls.length,
        dispatches,
      }).toEqual({
        providerConstructions: 1,
        readinessChecks: 2,
        provisionAttempts: 0,
        dispatches: 0,
      });
    } finally {
      if (priorKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = priorKey;
    }
  });

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

describe('withProvisionedLiveProviderHome', () => {
  it.each([
    ['successful', undefined],
    ['failed', new Error('simulated live-provider failure')],
  ] as const)('removes the provisioned Codex home after a %s run without changing the checkout', async (_outcome, runError) => {
    const { withProvisionedLiveProviderHome } = await import('./live-e2e-run-body.js') as {
      withProvisionedLiveProviderHome: <T>(
        sourceRoot: string,
        credential: string | undefined,
        provision: NonNullable<LiveE2ERunBodyDependencies['provisionProviderHome']>,
        run: (home: { homeDir: string }) => Promise<T>,
      ) => Promise<T>;
    };
    const checkoutDir = await mkdtemp(`${tmpdir()}/live-e2e-checkout-`);
    const homesDir = await mkdtemp(`${tmpdir()}/live-e2e-codex-homes-`);
    const checkoutFile = join(checkoutDir, 'tracked-fixture.txt');
    const homeDir = join(homesDir, 'provisioned-codex-home');
    const teardown = vi.fn(async () => { await rm(homeDir, { recursive: true, force: true }); });
    const provision = vi.fn(async () => {
      await writeFile(homeDir, 'isolated provider state');
      return {
        provider: 'codex' as const,
        homeDir,
        childEnv: () => ({ CODEX_HOME: homeDir }),
        childArgs: () => [],
        teardown,
      };
    });

    try {
      await writeFile(checkoutFile, 'checkout bytes must remain unchanged');
      const before = await readFile(checkoutFile);

      const outcome = await withProvisionedLiveProviderHome(
        checkoutDir,
        'live-codex-key',
        provision,
        async (home) => {
          expect(home.homeDir).toBe(homeDir);
          expect(existsSync(home.homeDir)).toBe(true);
          if (runError) throw runError;
          return 'completed';
        },
      ).then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error }),
      );

      expect({
        outcome: outcome.error instanceof Error ? outcome.error.message : outcome.value,
        provisionCalls: provision.mock.calls.length,
        teardownCalls: teardown.mock.calls.length,
        homeExists: existsSync(homeDir),
        checkoutBytes: await readFile(checkoutFile),
      }).toEqual({
        outcome: runError?.message ?? 'completed',
        provisionCalls: 1,
        teardownCalls: 1,
        homeExists: false,
        checkoutBytes: before,
      });
    } finally {
      await rm(checkoutDir, { recursive: true, force: true });
      await rm(homesDir, { recursive: true, force: true });
    }
  });
});

describe('live E2E shared spend policy', () => {
  it('fails unmetered and unattributable dispatches for every provider instead of silently dropping unknown usage', async () => {
    const { assertSuccessfulCredentialedRun, TokenMeter } = await import('./live-e2e-run-body.js');
    const unknownUsageProvider: LLMProvider = {
      invoke: vi.fn().mockResolvedValue({
        success: true,
        output: 'done',
        exitCode: 0,
        tokenUsage: { prompt_tokens: 12, completion_tokens: 3 },
      }),
      invokeInteractive: vi.fn(),
    };
    const meter = new TokenMeter(unknownUsageProvider, () => 'build');

    await meter.invoke({ prompt: 'live meter validation' } as InvokeOptions);

    expect({
      totalTokens: meter.totalTokens,
      totalTurns: meter.totalTurns,
      unmetered: meter.unmetered,
      unmeteredSteps: meter.unmeteredSteps,
    }).toEqual({
      totalTokens: 0,
      totalTurns: 0,
      unmetered: 1,
      unmeteredSteps: ['build'],
    });
    expect(() => assertSuccessfulCredentialedRun({ dispatches: 1 }, meter)).toThrow(
      'Unmetered dispatch at build before publication boundary.',
    );
    expect(() => assertSuccessfulCredentialedRun(
      { dispatches: 1 },
      { totalTurns: 1, totalTokens: 1, unmetered: 2, unmeteredSteps: ['finish', 'unattributed'] },
    )).toThrow('Unattributable unmetered dispatch cannot be allow-listed.');
  });

  it('uses one default and documented override for every descriptor, then reports observed spend', async () => {
    const {
      DEFAULT_LIVE_E2E_TOKEN_CAP,
      reportLiveE2ESpend,
      resolveLiveE2ETokenCap,
    } = await import('./live-e2e-run-body.js') as {
      DEFAULT_LIVE_E2E_TOKEN_CAP: number;
      resolveLiveE2ETokenCap: (environment?: NodeJS.ProcessEnv) => number;
      reportLiveE2ESpend: (
        metrics: { totalTokens: number; dispatches: number },
        cap: number,
        report?: (message: string) => void,
      ) => void;
    };
    const report = vi.fn();
    const sharedBodySource = await readFile(
      fileURLToPath(new URL('./live-e2e-run-body.ts', import.meta.url)),
      'utf8',
    );

    const caps = LIVE_E2E_PROVIDERS.map(() => ({
      defaultCap: resolveLiveE2ETokenCap({}),
      overrideCap: resolveLiveE2ETokenCap({ DAEMON_E2E_LIVE_TOKEN_CAP: '321' }),
    }));
    reportLiveE2ESpend({ totalTokens: 123, dispatches: 4 }, 321, report);

    expect({
      defaultCap: DEFAULT_LIVE_E2E_TOKEN_CAP,
      caps,
      report: report.mock.calls,
      sharedBodyWiring: {
        allRegisteredLegs: LIVE_E2E_PROVIDERS.map((descriptor) => descriptor.id),
        resolvesTheCapAtRunEntry: sharedBodySource.includes('tokenCap = resolveLiveE2ETokenCap()'),
        legsEnterWithoutALocalCap: sharedBodySource.includes('await runLiveE2ERunBody(descriptor);'),
        reportsFromTheSharedRun: sharedBodySource.includes('reportLiveE2ESpend({'),
      },
    }).toEqual({
      defaultCap: 100000,
      caps: [
        { defaultCap: 100000, overrideCap: 321 },
        { defaultCap: 100000, overrideCap: 321 },
      ],
      report: [['daemon E2E live smoke observed total: 123; dispatch count: 4; cap: 321']],
      sharedBodyWiring: {
        allRegisteredLegs: ['claude', 'codex'],
        resolvesTheCapAtRunEntry: true,
        legsEnterWithoutALocalCap: true,
        reportsFromTheSharedRun: true,
      },
    });
  });

  it.each([
    ['successful', undefined],
    ['failed', new Error('the live leg failed first')],
  ] as const)('rejects an over-cap %s leg with cap, observed total, and unmetered count', async (_branch, runError) => {
    const { enforceLiveE2ETokenCap } = await import('./live-e2e-run-body.js') as {
      enforceLiveE2ETokenCap: <T>(
        run: () => Promise<T>,
        metrics: () => { totalTokens: number; unmetered: number },
        cap: number,
      ) => Promise<T>;
    };

    await expect(enforceLiveE2ETokenCap(
      async () => {
        if (runError) throw runError;
        return 'completed';
      },
      () => ({ totalTokens: 322, unmetered: 7 }),
      321,
    )).rejects.toThrow('Token cap 321 exceeded: observed 322; unmetered results: 7');
  });
});
