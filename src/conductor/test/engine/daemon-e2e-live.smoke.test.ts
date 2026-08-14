import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { describe, expect, it, vi } from 'vitest';
import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { runDaemon } from '../../src/engine/daemon.js';
import type { StepName } from '../../src/types/steps.js';
import { dumpPipelineDiagnostics } from './daemon-e2e-fixture.test.js';
import {
  assertSuccessfulCredentialedRun,
  assertTokenCap,
  dispatchAfterLivePreflight,
  liveProviderAvailable,
  ProvisionedHome,
  runLiveE2ERunBody,
  TokenMeter,
} from '../fixtures/live-e2e-run-body.js';
import { LIVE_E2E_PROVIDERS } from '../fixtures/live-e2e-providers.js';

const smokeCapability = 'credentialed';

/**
 * The documented default keeps this manually-dispatched smoke bounded while
 * allowing operators to lower it with DAEMON_E2E_LIVE_TOKEN_CAP.
 */
const tokenCap = Number(process.env.DAEMON_E2E_LIVE_TOKEN_CAP ?? '100000');

async function hasSuccessfulTerminalState(worktreeDir: string, slug: string): Promise<boolean> {
  return existsSync(join(worktreeDir, '.pipeline/DONE')) &&
    !existsSync(join(worktreeDir, '.pipeline/HALT')) &&
    !existsSync(join(worktreeDir, `.daemon/parked/${slug}`));
}

const advisoryProbe = process.env.DAEMON_E2E_LIVE_ADVISORY_PROBE === '1';

describe('daemon E2E live terminal guard', () => {
  it.skipIf(advisoryProbe)('skips an uncredentialed advisory run before provisioning a home', async () => {
    const homesRoot = await mkdtemp(join(tmpdir(), 'daemon-e2e-live-advisory-'));
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      AI_CONDUCTOR_NO_REAL_EXEC: '1',
      CLAUDE_CODE_OAUTH_TOKEN: '',
      DAEMON_E2E_LIVE_ADVISORY_PROBE: '1',
      TMPDIR: homesRoot,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    };
    delete childEnv.AI_CONDUCTOR_TEST_TMP_ROOT;

    try {
      const result = await execa(
        'npx',
        [
          'vitest', 'run', '--config', 'vitest.live-smoke.config.ts',
          'test/engine/daemon-e2e-live.smoke.test.ts', '--reporter=dot',
        ],
        { cwd: fileURLToPath(new URL('../..', import.meta.url)), env: childEnv, extendEnv: false },
      );

      expect(result.stdout).toMatch(/Tests\s+\d+ passed \| \d+ skipped/);
      expect((await readdir(homesRoot)).filter((entry) => entry.startsWith('self-host-'))).toEqual([]);
    } finally {
      await rm(homesRoot, { recursive: true, force: true });
    }
  });

  it('meters both provider methods and rejects totals above the configured cap', async () => {
    const provider: LLMProvider = {
      invoke: vi.fn<LLMProvider['invoke']>()
        .mockResolvedValueOnce({ success: true, output: 'done', exitCode: 0, tokenUsage: { input: 12, output: 3, numTurns: 4 } })
        .mockResolvedValueOnce({ success: true, output: 'done', exitCode: 0 }),
      invokeInteractive: vi.fn<LLMProvider['invokeInteractive']>()
        .mockResolvedValue({ success: true, output: 'done', exitCode: 0, tokenUsage: { input: 5, output: 7, numTurns: 2 } }),
    };
    const meter = new TokenMeter(provider);
    const options = { prompt: 'metered' } as InvokeOptions;

    await meter.invoke(options);
    await meter.invokeInteractive(options);
    await meter.invoke(options);

    expect({
      total: meter.totalTokens,
      turns: meter.totalTurns,
      unmetered: meter.unmetered,
      forwardedInvoke: vi.mocked(provider.invoke).mock.calls.every(([sent]) => sent === options),
      forwardedInteractive: vi.mocked(provider.invokeInteractive).mock.calls
        .every(([sent]) => sent === options),
      atCapThrows: (() => {
        try {
          assertTokenCap(meter.totalTokens, meter.unmetered, 27);
          return false;
        } catch {
          return true;
        }
      })(),
    }).toEqual({
      total: 27,
      turns: 6,
      unmetered: 1,
      forwardedInvoke: true,
      forwardedInteractive: true,
      atCapThrows: false,
    });
    expect(() => assertTokenCap(meter.totalTokens, meter.unmetered, 26)).toThrow(
      'Token cap 26 exceeded: observed 27; unmetered results: 1',
    );
  });

  it('requires successful credentialed runs to dispatch with reported turns, tokens, and no unmetered results', () => {
    expect(() => assertSuccessfulCredentialedRun(
      { dispatches: 1 },
      { totalTurns: 1, totalTokens: 1, unmetered: 0, unmeteredSteps: [] },
    )).not.toThrow();
    expect(() => assertSuccessfulCredentialedRun(
      { dispatches: 0 },
      { totalTurns: 1, totalTokens: 1, unmetered: 0, unmeteredSteps: [] },
    )).toThrow();
    expect(() => assertSuccessfulCredentialedRun(
      { dispatches: 1 },
      { totalTurns: 0, totalTokens: 1, unmetered: 0, unmeteredSteps: [] },
    )).toThrow();
    expect(() => assertSuccessfulCredentialedRun(
      { dispatches: 1 },
      { totalTurns: 1, totalTokens: 0, unmetered: 0, unmeteredSteps: [] },
    )).toThrow();
  });

  it('accepts an unmetered finish dispatch but no unmetered step before publication', () => {
    // The fixture has no remote, so finish's PR-prose judgment has nothing to
    // judge and reports no usage. That is the tolerated case.
    expect(() => assertSuccessfulCredentialedRun(
      { dispatches: 1 },
      { totalTurns: 1, totalTokens: 1, unmetered: 1, unmeteredSteps: ['finish'] },
    )).not.toThrow();

    // Everything before the publication boundary must still report usage.
    for (const step of ['build', 'build_review', 'manual_test'] as StepName[]) {
      expect(() => assertSuccessfulCredentialedRun(
        { dispatches: 1 },
        { totalTurns: 1, totalTokens: 1, unmetered: 1, unmeteredSteps: [step] },
      )).toThrow();
    }

    // An unmetered dispatch we cannot attribute is a failure, so a missing
    // step_started event can never buy its way into the allow-list.
    expect(() => assertSuccessfulCredentialedRun(
      { dispatches: 1 },
      { totalTurns: 1, totalTokens: 1, unmetered: 1, unmeteredSteps: ['unattributed'] },
    )).toThrow();

    // Attribution must account for every unmetered dispatch.
    expect(() => assertSuccessfulCredentialedRun(
      { dispatches: 1 },
      { totalTurns: 1, totalTokens: 1, unmetered: 2, unmeteredSteps: ['finish'] },
    )).toThrow();
  });

  it('wraps a provider transparently, preserving capability flags and optional members', async () => {
    const readiness = { state: 'ready', provider: 'codex', source: 'api-key' } as const;
    const preparation = { args: ['--auth'] };
    const provider: LLMProvider = {
      supportsSessionResume: true,
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn<LLMProvider['invoke']>()
        .mockResolvedValue({ success: true, output: 'done', exitCode: 0 }),
      invokeInteractive: vi.fn<LLMProvider['invokeInteractive']>()
        .mockResolvedValue({ success: true, output: 'done', exitCode: 0 }),
      readiness: vi.fn().mockResolvedValue(readiness),
      prepareSelfHostAuth: vi.fn().mockResolvedValue(preparation),
      resolveSelfHostExecutable: vi.fn().mockResolvedValue('claude'),
    };
    const meter = new TokenMeter(provider);

    expect({
      supportsSessionResume: meter.supportsSessionResume,
      lifecycleCapability: meter.lifecycleCapability,
      readiness: await meter.readiness?.(),
      preparation: await meter.prepareSelfHostAuth?.({ provider: 'codex', homeDir: '/tmp/home' }),
      executable: await meter.resolveSelfHostExecutable?.(),
      untouchedTotal: meter.totalTokens,
    }).toEqual({
      supportsSessionResume: true,
      lifecycleCapability: provider.lifecycleCapability,
      readiness,
      preparation,
      executable: 'claude',
      untouchedTotal: 0,
    });
  });

  it('injects the provisioned self-host invocation into both provider methods', async () => {
    const readiness = { state: 'ready', provider: 'codex', source: 'api-key' } as const;
    const preparation = { args: ['--auth'] };
    const selfHost = {
      executable: 'claude',
      env: { CLAUDE_CONFIG_DIR: '/tmp/provisioned-home', CLAUDE_CODE_OAUTH_TOKEN: 'token' },
      args: ['--provisioned'],
      teardown: vi.fn(async () => {}),
    };
    const provider: LLMProvider = {
      supportsSessionResume: true,
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn<LLMProvider['invoke']>()
        .mockResolvedValue({ success: true, output: 'done', exitCode: 0 }),
      invokeInteractive: vi.fn<LLMProvider['invokeInteractive']>()
        .mockResolvedValue({ success: true, output: 'done', exitCode: 0 }),
      readiness: vi.fn().mockResolvedValue(readiness),
      prepareSelfHostAuth: vi.fn().mockResolvedValue(preparation),
      resolveSelfHostExecutable: vi.fn().mockResolvedValue('claude'),
    };
    const provisioned = new ProvisionedHome(provider, selfHost);
    const options = {
      prompt: 'provisioned',
      sessionId: 'session',
      resume: false,
      systemPrompt: 'unchanged',
      selfHost: { executable: 'old', env: {}, args: [], teardown: async () => {} },
    } satisfies InvokeOptions;

    await provisioned.invoke(options);
    await provisioned.invokeInteractive(options);

    const expected = { ...options, selfHost };
    expect({
      invoke: vi.mocked(provider.invoke).mock.calls[0]?.[0],
      interactive: vi.mocked(provider.invokeInteractive).mock.calls[0]?.[0],
      supportsSessionResume: provisioned.supportsSessionResume,
      lifecycleCapability: provisioned.lifecycleCapability,
      readiness: await provisioned.readiness?.(),
      preparation: await provisioned.prepareSelfHostAuth?.({ provider: 'codex', homeDir: '/tmp/home' }),
      executable: await provisioned.resolveSelfHostExecutable?.(),
    }).toEqual({
      invoke: expected,
      interactive: expected,
      supportsSessionResume: true,
      lifecycleCapability: provider.lifecycleCapability,
      readiness,
      preparation,
      executable: 'claude',
    });
  });

  it('reports a failed command preflight before dispatching the live provider', async () => {
    const provider: LLMProvider = {
      invoke: vi.fn<LLMProvider['invoke']>(),
      invokeInteractive: vi.fn<LLMProvider['invokeInteractive']>(),
    };
    const provisioned = new ProvisionedHome(provider, {
      executable: 'claude', env: {}, args: [], teardown: async () => {},
    });
    const preflight = vi.fn().mockRejectedValue(new Error('Unable to resolve skills /build in /tmp/home/skills.'));

    const dispatch = vi.fn(async () => {
      await provisioned.invoke({ prompt: 'must not be dispatched' } as InvokeOptions);
    });
    const preflightFailure = await dispatchAfterLivePreflight(
      { homeDir: '/tmp/home' }, dispatch, 'claude', preflight,
    )
      .then(() => undefined, (error: unknown) => error);

    expect({
      preflight: preflightFailure instanceof Error ? preflightFailure.message : String(preflightFailure),
      preflightCall: vi.mocked(preflight).mock.calls[0],
      continued: vi.mocked(dispatch).mock.calls.length,
      dispatches: provisioned.dispatches,
    }).toEqual({
      preflight: 'Unable to resolve skills /build in /tmp/home/skills.',
      preflightCall: ['/tmp/home', 'claude'],
      continued: 0,
      dispatches: 0,
    });
  });

  it('keeps a post-preflight outcome failure distinct from an unresolved command and dumps diagnostics', async () => {
    const worktreeDir = await mkdtemp(join(tmpdir(), 'daemon-e2e-live-outcome-'));
    const provider: LLMProvider = {
      invoke: vi.fn<LLMProvider['invoke']>().mockResolvedValue({
        success: false,
        output: 'fixture task did not produce its required commit',
        exitCode: 1,
      }),
      invokeInteractive: vi.fn<LLMProvider['invokeInteractive']>(),
    };
    const provisioned = new ProvisionedHome(provider, {
      executable: 'claude', env: {}, args: [], teardown: async () => {},
    });
    const preflight = vi.fn(async () => {});
    const diagnostics: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      diagnostics.push(args.map(String).join(' '));
    });

    try {
      await mkdir(join(worktreeDir, '.daemon'), { recursive: true });
      await mkdir(join(worktreeDir, '.pipeline'), { recursive: true });
      await writeFile(join(worktreeDir, '.daemon', 'daemon.log'), 'outcome failure\n');
      await writeFile(join(worktreeDir, '.pipeline', 'HALT'), 'fixture task did not finish\n');
      let result: InvokeResult | undefined;
      await dispatchAfterLivePreflight(
        { homeDir: '/tmp/provisioned-home' },
        async () => { result = await provisioned.invoke({ prompt: '/pipeline' } as InvokeOptions); },
        'claude', preflight,
      );
      await dumpPipelineDiagnostics(worktreeDir);

      expect({
        preflightCalls: preflight.mock.calls.length,
        dispatches: provisioned.dispatches,
        terminal: await hasSuccessfulTerminalState(worktreeDir, 'daemon-e2e-live'),
        success: result?.success,
        commandUnresolved: result?.commandUnresolved,
        commandUnresolvedName: result?.commandUnresolvedName,
        diagnostics: diagnostics.join('\n'),
      }).toEqual({
        preflightCalls: 1,
        dispatches: 1,
        terminal: false,
        success: false,
        commandUnresolved: undefined,
        commandUnresolvedName: undefined,
        diagnostics: expect.stringMatching(/outcome failure[\s\S]*fixture task did not finish/),
      });
    } finally {
      errorSpy.mockRestore();
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });

  it('does not dispatch a pre-halted fixture', async () => {
    const worktreeDir = await mkdtemp(join(tmpdir(), 'daemon-e2e-live-halted-'));
    const slug = 'daemon-e2e-live';
    let dispatches = 0;

    try {
      await mkdir(join(worktreeDir, '.pipeline'), { recursive: true });
      await writeFile(join(worktreeDir, '.pipeline/HALT'), 'prewritten halt\n');

      expect(await hasSuccessfulTerminalState(worktreeDir, slug)).toBe(false);
      await runDaemon(
        {
          discoverBacklog: async () => [{ slug, tier: 'S', track: 'technical' }],
          runFeature: async (item) => {
            dispatches += 1;
            return { slug: item.slug, status: 'done' };
          },
          isHalted: async (candidate) =>
            candidate === slug && existsSync(join(worktreeDir, '.pipeline/HALT')),
        },
        { concurrency: 1, once: true },
      );

      expect(dispatches).toBe(0);
    } finally {
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });
});
