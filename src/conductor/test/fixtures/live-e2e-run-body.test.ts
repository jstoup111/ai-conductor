import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { AuthenticationReadiness, InvokeOptions, LLMProvider } from '../../src/execution/llm-provider.js';
import { dumpPipelineDiagnostics } from '../engine/daemon-e2e-fixture.test.js';
import { LIVE_E2E_PROVIDERS, type LiveE2EProviderDescriptor } from './live-e2e-providers.js';
import type { LiveE2ERunBodyDependencies } from './live-e2e-run-body.js';

vi.mock('../engine/daemon-e2e-fixture.test.js', () => ({
  dumpPipelineDiagnostics: vi.fn(),
}));

describe('ProvisionedHome', () => {
  it.each(['invoke', 'invokeInteractive'] as const)('injects its isolated self-host settings into %s', async (method) => {
    const { ProvisionedHome } = await import('./live-e2e-run-body.js') as {
      ProvisionedHome: new (provider: LLMProvider, selfHost: NonNullable<InvokeOptions['selfHost']>) => LLMProvider;
    };
    const provider: LLMProvider = {
      invoke: vi.fn(async () => ({ success: true, output: '', exitCode: 0 })),
      invokeInteractive: vi.fn(async () => ({ success: true, output: '', exitCode: 0 })),
    };
    const selfHost = {
      executable: 'selected-provider', env: { SELECTED_PROVIDER_HOME: '/tmp/provider-home' }, args: ['--isolated'], teardown: vi.fn(),
    };
    const provisioned = new ProvisionedHome(provider, selfHost);
    const options = {
      prompt: 'fixture', sessionId: 'fixture', resume: false,
      selfHost: { executable: 'wrong', env: {}, args: [], teardown: vi.fn() },
    } satisfies InvokeOptions;

    await provisioned[method](options);

    expect(provider[method]).toHaveBeenCalledWith({ ...options, selfHost });
  });

  it('transparently preserves absent optional provider capabilities while metering invokes', async () => {
    const { TokenMeter } = await import('./live-e2e-run-body.js') as {
      TokenMeter: new (provider: LLMProvider) => LLMProvider;
    };
    const provider: LLMProvider = {
      invoke: vi.fn(async () => ({ success: true, output: '', exitCode: 0 })),
      invokeInteractive: vi.fn(async () => undefined),
    };
    const meter = new TokenMeter(provider);

    await meter.invoke({ prompt: 'fixture', sessionId: 'fixture', resume: false });

    expect({
      readiness: meter.readiness,
      prepareSelfHostAuth: meter.prepareSelfHostAuth,
      resolveSelfHostExecutable: meter.resolveSelfHostExecutable,
      invokes: vi.mocked(provider.invoke).mock.calls.length,
    }).toEqual({
      readiness: undefined,
      prepareSelfHostAuth: undefined,
      resolveSelfHostExecutable: undefined,
      invokes: 1,
    });
  });
});

describe('runLiveE2ERunBody authentication source', () => {
  it('does not dispatch or report a successful terminal state when the live fixture is already halted', async () => {
    const { runLiveE2ERunBody } = await import('./live-e2e-run-body.js') as {
      runLiveE2ERunBody: (
        descriptor: LiveE2EProviderDescriptor,
        tokenCap: number,
        dependencies?: LiveE2ERunBodyDependencies,
      ) => Promise<void>;
    };
    const priorKey = process.env.CODEX_API_KEY;
    const provider: LLMProvider = {
      invoke: vi.fn(async () => ({ success: true, output: 'unexpected dispatch', exitCode: 0 })),
      invokeInteractive: vi.fn(async () => ({ success: true, output: 'unexpected dispatch', exitCode: 0 })),
    };
    const homeDir = await mkdtemp(`${tmpdir()}/live-e2e-prehalt-home-`);
    const teardown = vi.fn(async () => { await rm(homeDir, { recursive: true, force: true }); });
    const terminalStates: Array<{ done: boolean; halt: boolean; successful: boolean }> = [];
    const descriptor = {
      id: 'codex',
      binaryName: 'codex',
      credentialEnvVar: 'CODEX_API_KEY',
      providerKey: 'codex',
      selfHostExecutable: 'codex',
      createProvider: () => provider,
      assertCredentialAvailable: () => {},
      expectedAuthenticationSource: 'api-key',
      resolveAuthenticationSource: async () => 'api-key',
    } as unknown as LiveE2EProviderDescriptor;

    try {
      process.env.CODEX_API_KEY = 'live-codex-key';

      const runError = await runLiveE2ERunBody(descriptor, 1, {
        binaryAvailable: () => true,
        provisionProviderHome: async () => ({
          provider: 'codex', homeDir, childEnv: () => ({}), childArgs: () => [], teardown,
        }),
        preflight: async () => {},
        beforeRunDaemon: async (worktreeDir) => {
          await mkdir(join(worktreeDir, '.pipeline'), { recursive: true });
          await writeFile(join(worktreeDir, '.pipeline/HALT'), 'pre-halted fixture\n');
        },
        afterRunDaemon: async (worktreeDir) => {
          terminalStates.push({
            done: existsSync(join(worktreeDir, '.pipeline/DONE')),
            halt: existsSync(join(worktreeDir, '.pipeline/HALT')),
            successful: existsSync(join(worktreeDir, '.pipeline/DONE')) && !existsSync(join(worktreeDir, '.pipeline/HALT')),
          });
        },
      }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(runError).toBeInstanceOf(Error);
      expect((runError as Error).message).toBe('Live E2E fixture is already halted; refusing provider dispatch.');

      expect({
        providerDispatches: vi.mocked(provider.invoke).mock.calls.length + vi.mocked(provider.invokeInteractive).mock.calls.length,
        terminalStates,
      }).toEqual({
        providerDispatches: 0,
        terminalStates: [{ done: false, halt: true, successful: false }],
      });
    } finally {
      if (priorKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = priorKey;
      await rm(homeDir, { recursive: true, force: true });
    }
  });

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
      assertCredentialAvailable: (credential: string | undefined) => {
        if (credential?.trim()) return;
        throw new Error(`Missing Codex credential: set CODEX_API_KEY or sign in at ${codexHome}/auth.json`);
      },
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
    const stderr: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });
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
      assertCredentialAvailable: () => {},
      expectedAuthenticationSource: 'api-key',
      resolveAuthenticationSource: async (candidate: LLMProvider) => {
        const result = await candidate.readiness?.();
        if (!result) throw new Error('Codex provider must expose readiness');
        return result.source;
      },
    } as unknown as LiveE2EProviderDescriptor;

    try {
      process.env.CODEX_API_KEY = 'live-codex-key';
      vi.mocked(dumpPipelineDiagnostics).mockClear();
      vi.mocked(dumpPipelineDiagnostics).mockImplementation(async () => {
        console.error('pipeline readiness diagnostic:', process.env.CODEX_API_KEY);
        return '';
      });

      await expect(runLiveE2ERunBody(descriptor, 1, {
        binaryAvailable: () => true,
        provisionProviderHome,
      })).rejects.toThrow(expectedError);
      expect(dumpPipelineDiagnostics).toHaveBeenCalledTimes(1);
      expect({
        providerConstructions: createProvider.mock.calls.length,
        readinessChecks: readinessCheck.mock.calls.length,
        provisionAttempts: provisionProviderHome.mock.calls.length,
        dispatches,
        credentialWasEmitted: stderr.join('\n').includes('live-codex-key'),
      }).toEqual({
        providerConstructions: 1,
        readinessChecks: 2,
        provisionAttempts: 0,
        dispatches: 0,
        credentialWasEmitted: false,
      });
    } finally {
      errorSpy.mockRestore();
      vi.mocked(dumpPipelineDiagnostics).mockReset();
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

  it('rejects a Claude descriptor authentication-source mismatch from real provider state', async () => {
    const { assertDescriptorAuthenticationSource } = await import('./live-e2e-run-body.js') as {
      assertDescriptorAuthenticationSource: (
        descriptor: LiveE2EProviderDescriptor,
        provider: LLMProvider,
      ) => Promise<void>;
    };
    const { ClaudeProvider } = await import('../../src/execution/claude-provider.js');
    const priorToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

    try {
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      const provider = new ClaudeProvider();
      const descriptor = {
        id: 'claude',
        expectedAuthenticationSource: 'oauth-token',
        resolveAuthenticationSource: async (candidate: LLMProvider) => {
          if (!(candidate instanceof ClaudeProvider)) throw new Error('Claude descriptor requires ClaudeProvider');
          return candidate.authenticationSource();
        },
      } as unknown as LiveE2EProviderDescriptor;

      await expect(assertDescriptorAuthenticationSource(descriptor, provider))
        .rejects.toThrow('expected oauth-token, resolved missing');
    } finally {
      if (priorToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = priorToken;
    }
  });
});

describe('live E2E failure diagnostics', () => {
  it('captures a pre-worktree failure, redacts its rethrown error, and preserves the outcome', async () => {
    const { withLiveE2EFailureDiagnostics } = await import('./live-e2e-run-body.js') as {
      withLiveE2EFailureDiagnostics: <T>(
        worktreeDir: string | undefined,
        credentialValues: readonly string[],
        run: () => Promise<T>,
      ) => Promise<T>;
    };
    const credential = 'sk-live-e2e-pre-worktree-secret';
    const stderr: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });

    try {
      const outcome = await withLiveE2EFailureDiagnostics(
        undefined,
        [credential],
        async () => { throw new Error(`preflight failed with ${credential}`); },
      ).then(
        () => undefined,
        (error: unknown) => error,
      );

      expect({
        error: outcome instanceof Error ? outcome.message : String(outcome),
        diagnostics: stderr.join('\n'),
      }).toEqual({
        error: 'preflight failed with [redacted]',
        diagnostics: expect.stringContaining('live worktree was not created; pipeline diagnostics unavailable.'),
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('redacts a configured credential from diagnostic output while retaining presence-only failure reporting', async () => {
    const { dumpLiveE2EFailureDiagnostics, reportLiveE2ESpend } = await import('./live-e2e-run-body.js') as {
      dumpLiveE2EFailureDiagnostics: (worktreeDir: string, credentialValues?: readonly string[]) => Promise<void>;
      reportLiveE2ESpend: (
        metrics: { totalTokens: number; dispatches: number },
        cap: number,
        report?: (message: string) => void,
      ) => void;
    };
    const credential = 'sk-live-e2e-credential-value';
    const worktreeDir = await mkdtemp(`${tmpdir()}/live-e2e-redacted-diagnostics-`);
    const stderr: string[] = [];
    const summary = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });

    try {
      await mkdir(join(worktreeDir, '.daemon'), { recursive: true });
      vi.mocked(dumpPipelineDiagnostics).mockImplementation(async () => {
        console.error('pipeline failure: CODEX_API_KEY=', credential);
        throw new Error(`pipeline failure: CODEX_API_KEY=${credential}`);
      });

      await expect(dumpLiveE2EFailureDiagnostics(worktreeDir, [credential])).resolves.toBeUndefined();
      reportLiveE2ESpend({ totalTokens: 123, dispatches: 4 }, 321, summary);

      expect({
        emitted: `${stderr.join('\n')}\n${summary.mock.calls.map((call) => call.join(' ')).join('\n')}`,
        retainsRedactedPipelineState: stderr.join('\n').includes('pipeline failure: CODEX_API_KEY= [redacted]'),
        hidesCaughtFailureDetails: stderr.join('\n').includes('live E2E pipeline diagnostics failed; diagnostic details redacted.'),
        summary: summary.mock.calls,
      }).toEqual({
        emitted: expect.not.stringContaining(credential),
        retainsRedactedPipelineState: true,
        hidesCaughtFailureDetails: true,
        summary: [['daemon E2E live smoke observed total: 123; dispatch count: 4; cap: 321']],
      });
    } finally {
      errorSpy.mockRestore();
      vi.mocked(dumpPipelineDiagnostics).mockReset();
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });

  it('redacts credential-shaped text from an unavailable worktree diagnostic', async () => {
    const { dumpLiveE2EFailureDiagnostics } = await import('./live-e2e-run-body.js') as {
      dumpLiveE2EFailureDiagnostics: (worktreeDir: string, credentialValues?: readonly string[]) => Promise<void>;
    };
    const credential = 'sk-live-e2e-path-secret';
    const stderr: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });

    try {
      await dumpLiveE2EFailureDiagnostics(`/tmp/${credential}/missing-worktree`, [credential]);

      expect(stderr.join('\n')).toEqual(expect.stringContaining('live worktree not found at /tmp/[redacted]/missing-worktree'));
      expect(stderr.join('\n')).not.toContain(credential);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it.each([
    ['surviving absent worktree', 'absent'],
    ['surviving missing daemon log', 'missing-log'],
    ['surviving empty daemon log', 'empty-log'],
  ] as const)('reports a %s through the shared failure path without masking the original failure', async (_scenario, setup) => {
    const { withLiveE2EFailureDiagnostics } = await import('./live-e2e-run-body.js') as {
      withLiveE2EFailureDiagnostics: <T>(
        worktreeDir: string | undefined,
        credentialValues: readonly string[],
        run: () => Promise<T>,
      ) => Promise<T>;
    };
    const worktreeDir = await mkdtemp(`${tmpdir()}/live-e2e-diagnostics-`);
    const stderr: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });

    try {
      await rm(worktreeDir, { recursive: true, force: true });
      if (setup !== 'absent') {
        await mkdir(join(worktreeDir, '.daemon'), { recursive: true });
      }
      if (setup === 'empty-log') {
        await writeFile(join(worktreeDir, '.daemon/daemon.log'), '');
      }
      vi.mocked(dumpPipelineDiagnostics).mockClear();
      vi.mocked(dumpPipelineDiagnostics).mockImplementation(async () => {
        console.error('task status at the surviving pipeline path');
        return '';
      });

      const originalFailure = new Error('daemon outcome failed after preflight');
      await expect(withLiveE2EFailureDiagnostics(
        worktreeDir,
        [],
        async () => { throw originalFailure; },
      )).rejects.toThrow(originalFailure.message);

      const output = stderr.join('\n');
      expect({
        worktreeAbsent: output.includes(`live worktree not found at ${worktreeDir}`),
        daemonLogMissing: output.includes(`daemon log not found at ${worktreeDir}/.daemon/daemon.log`),
        daemonLogEmpty: output.includes(`daemon log is empty at ${worktreeDir}/.daemon/daemon.log`),
        pipelineState: output.includes('task status at the surviving pipeline path'),
        dumpCalls: vi.mocked(dumpPipelineDiagnostics).mock.calls.length,
      }).toEqual(setup === 'absent' ? {
        worktreeAbsent: true,
        daemonLogMissing: false,
        daemonLogEmpty: false,
        pipelineState: false,
        dumpCalls: 0,
      } : {
        worktreeAbsent: false,
        daemonLogMissing: setup === 'missing-log',
        daemonLogEmpty: setup === 'empty-log',
        pipelineState: true,
        dumpCalls: 1,
      });
    } finally {
      errorSpy.mockRestore();
      vi.mocked(dumpPipelineDiagnostics).mockReset();
      await rm(worktreeDir, { recursive: true, force: true });
    }
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
        descriptor: LiveE2EProviderDescriptor,
        provider: LLMProvider,
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
        { id: 'codex' } as LiveE2EProviderDescriptor,
        { invoke: vi.fn(), invokeInteractive: vi.fn() },
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

describe('live E2E preflight dispatch boundary', () => {
  it('runs the provider preflight before dispatch and does not dispatch after a failed preflight', async () => {
    const { dispatchAfterLivePreflight } = await import('./live-e2e-run-body.js') as {
      dispatchAfterLivePreflight: (
        home: { homeDir: string },
        dispatch: () => Promise<void>,
        providerKey: string,
        preflight: (homeDir: string, providerKey?: string) => Promise<void>,
      ) => Promise<void>;
    };
    const preflight = vi.fn(async () => { throw new Error('selected provider command unavailable'); });
    const dispatch = vi.fn(async () => {});

    await expect(dispatchAfterLivePreflight({ homeDir: '/tmp/live-home' }, dispatch, 'codex', preflight))
      .rejects.toThrow('selected provider command unavailable');
    expect({ preflight: preflight.mock.calls, dispatches: dispatch.mock.calls.length }).toEqual({
      preflight: [['/tmp/live-home', 'codex']],
      dispatches: 0,
    });
  });

  it('keeps a post-preflight outcome failure distinct from the successful preflight', async () => {
    const { dispatchAfterLivePreflight } = await import('./live-e2e-run-body.js') as {
      dispatchAfterLivePreflight: (
        home: { homeDir: string },
        dispatch: () => Promise<void>,
        providerKey: string,
        preflight: (homeDir: string, providerKey?: string) => Promise<void>,
      ) => Promise<void>;
    };
    const preflight = vi.fn(async () => {});
    const dispatch = vi.fn(async () => { throw new Error('daemon outcome failed after preflight'); });

    await expect(dispatchAfterLivePreflight({ homeDir: '/tmp/live-home' }, dispatch, 'claude', preflight))
      .rejects.toThrow('daemon outcome failed after preflight');
    expect({ preflight: preflight.mock.calls, dispatches: dispatch.mock.calls.length }).toEqual({
      preflight: [['/tmp/live-home', 'claude']],
      dispatches: 1,
    });
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
