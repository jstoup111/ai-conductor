import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';
import { Conductor } from '../../src/engine/conductor.js';
import { runDaemon } from '../../src/engine/daemon.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { dumpPipelineDiagnostics } from './daemon-e2e-fixture.test.js';
import { initTestRepo } from '../fixtures/git-repo.js';
import type { ProviderHome } from '../../src/engine/self-host/provider-home.js';

// TokenMeter accumulates every real Claude InvokeResult.tokenUsage value.
//
// Both the meter and the cap predicate are deliberately file-local and
// UNEXPORTED. This live smoke is their only consumer, so exporting them from a
// shared test fixture module would add a new exported surface that no
// production code reaches — exactly what the wiring-reachability gate's orphan
// backstop reports as a gap. Their contract is covered by the ungated
// self-check below, which the `daemon-e2e-live-agent-tier` acceptance test runs
// in the ordinary suite by invoking this file directly.

/** Test-local provider decorator that records the tokens used by this live smoke. */
class TokenMeter implements LLMProvider {
  readonly supportsSessionResume: boolean | undefined;
  readonly lifecycleCapability: LLMProvider['lifecycleCapability'];
  readonly readiness: LLMProvider['readiness'];
  readonly prepareSelfHostAuth: LLMProvider['prepareSelfHostAuth'];
  readonly resolveSelfHostExecutable: LLMProvider['resolveSelfHostExecutable'];
  totalTokens = 0;

  constructor(private readonly provider: LLMProvider) {
    this.supportsSessionResume = provider.supportsSessionResume;
    this.lifecycleCapability = provider.lifecycleCapability;
    this.readiness = provider.readiness?.bind(provider);
    this.prepareSelfHostAuth = provider.prepareSelfHostAuth?.bind(provider);
    this.resolveSelfHostExecutable = provider.resolveSelfHostExecutable?.bind(provider);
  }

  async invoke(options: InvokeOptions): Promise<InvokeResult> {
    const result = await this.provider.invoke(options);
    this.record(result);
    return result;
  }

  async invokeInteractive(options: InvokeOptions): Promise<InvokeResult | void> {
    const result = await this.provider.invokeInteractive(options);
    if (result) this.record(result);
    return result;
  }

  private record(result: InvokeResult): void {
    this.totalTokens += (result.tokenUsage?.input ?? 0) + (result.tokenUsage?.output ?? 0);
  }
}

/** Test-local provider decorator that supplies the isolated home to every dispatch. */
class ProvisionedHome implements LLMProvider {
  readonly supportsSessionResume: boolean | undefined;
  readonly lifecycleCapability: LLMProvider['lifecycleCapability'];
  readonly readiness: LLMProvider['readiness'];
  readonly prepareSelfHostAuth: LLMProvider['prepareSelfHostAuth'];
  readonly resolveSelfHostExecutable: LLMProvider['resolveSelfHostExecutable'];

  constructor(
    private readonly provider: LLMProvider,
    private readonly selfHost: NonNullable<InvokeOptions['selfHost']>,
  ) {
    this.supportsSessionResume = provider.supportsSessionResume;
    this.lifecycleCapability = provider.lifecycleCapability;
    this.readiness = provider.readiness?.bind(provider);
    this.prepareSelfHostAuth = provider.prepareSelfHostAuth?.bind(provider);
    this.resolveSelfHostExecutable = provider.resolveSelfHostExecutable?.bind(provider);
  }

  invoke(options: InvokeOptions): Promise<InvokeResult> {
    return this.provider.invoke({ ...options, selfHost: this.selfHost });
  }

  invokeInteractive(options: InvokeOptions): Promise<InvokeResult | void> {
    return this.provider.invokeInteractive({ ...options, selfHost: this.selfHost });
  }
}

function assertTokenCap(totalTokens: number, cap: number): void {
  if (totalTokens > cap) {
    throw new Error(`Token cap ${cap} exceeded: observed ${totalTokens}`);
  }
}

const fixturePlanPath = fileURLToPath(
  new URL('../fixtures/daemon-e2e/plan.md', import.meta.url),
);
const fixtureStoriesPath = fileURLToPath(
  new URL('../fixtures/daemon-e2e/stories.md', import.meta.url),
);
const fixtureTouchedPath = fileURLToPath(
  new URL('../fixtures/daemon-e2e/touched.txt', import.meta.url),
);

/**
 * The documented default keeps this manually-dispatched smoke bounded while
 * allowing operators to lower it with DAEMON_E2E_LIVE_TOKEN_CAP.
 */
const tokenCap = Number(process.env.DAEMON_E2E_LIVE_TOKEN_CAP ?? '100000');

function claudeBinaryAvailable(): boolean {
  try {
    execFileSync('which', ['claude'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function hasSuccessfulTerminalState(worktreeDir: string, slug: string): Promise<boolean> {
  return existsSync(join(worktreeDir, '.pipeline/DONE')) &&
    !existsSync(join(worktreeDir, '.pipeline/HALT')) &&
    !existsSync(join(worktreeDir, `.daemon/parked/${slug}`));
}

const hostToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
const killSwitch = process.env.DAEMON_E2E_LIVE_SMOKE === '0';
const shouldRun = claudeBinaryAvailable() && !killSwitch && !!hostToken;
const advisoryProbe = process.env.DAEMON_E2E_LIVE_ADVISORY_PROBE === '1';

describe('daemon E2E live terminal guard', () => {
  it.skipIf(advisoryProbe)('skips an uncredentialed advisory run before provisioning a home', async () => {
    const homesRoot = await mkdtemp(join(tmpdir(), 'daemon-e2e-live-advisory-'));
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      AI_CONDUCTOR_NO_REAL_EXEC: '1',
      CLAUDE_CODE_OAUTH_TOKEN: '',
      DAEMON_E2E_LIVE_SMOKE: '0',
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
        .mockResolvedValueOnce({ success: true, output: 'done', exitCode: 0, tokenUsage: { input: 12, output: 3 } })
        .mockResolvedValueOnce({ success: true, output: 'done', exitCode: 0 }),
      invokeInteractive: vi.fn<LLMProvider['invokeInteractive']>()
        .mockResolvedValue({ success: true, output: 'done', exitCode: 0, tokenUsage: { input: 5, output: 7 } }),
    };
    const meter = new TokenMeter(provider);
    const options = { prompt: 'metered' } as InvokeOptions;

    await meter.invoke(options);
    await meter.invokeInteractive(options);
    await meter.invoke(options);

    expect({
      total: meter.totalTokens,
      forwardedInvoke: vi.mocked(provider.invoke).mock.calls.every(([sent]) => sent === options),
      forwardedInteractive: vi.mocked(provider.invokeInteractive).mock.calls
        .every(([sent]) => sent === options),
      atCapThrows: (() => {
        try {
          assertTokenCap(meter.totalTokens, 27);
          return false;
        } catch {
          return true;
        }
      })(),
    }).toEqual({
      total: 27,
      forwardedInvoke: true,
      forwardedInteractive: true,
      atCapThrows: false,
    });
    expect(() => assertTokenCap(meter.totalTokens, 26)).toThrow(
      'Token cap 26 exceeded: observed 27',
    );
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

describe.skipIf(!shouldRun)('daemon E2E with real Claude provider', () => {
  it('finishes a seeded daemon fixture with a trailered task commit', async () => {
    const worktreeDir = await mkdtemp(join(tmpdir(), 'daemon-e2e-live-'));
    const slug = 'daemon-e2e-live';
    const pipelineDir = join(worktreeDir, '.pipeline');
    const statePath = join(pipelineDir, 'conduct-state.json');
    const planPath = join(worktreeDir, `.docs/plans/${slug}.md`);
    const provider = new ClaudeProvider();
    let meter = new TokenMeter(provider);
    let providerHome: ProviderHome | undefined;

    try {
      // test/setup.ts enables this guard for the ordinary suite. This opt-in
      // smoke is the explicit exception immediately before real dispatch.
      delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
      expect(process.env.AI_CONDUCTOR_NO_REAL_EXEC).toBeUndefined();

      await initTestRepo(worktreeDir);
      await mkdir(join(worktreeDir, '.docs/plans'), { recursive: true });
      await mkdir(join(worktreeDir, '.docs/stories'), { recursive: true });
      await mkdir(join(worktreeDir, 'test/fixtures/daemon-e2e'), { recursive: true });
      await copyFile(fixturePlanPath, planPath);
      await copyFile(fixtureStoriesPath, join(worktreeDir, `.docs/stories/${slug}.md`));
      await copyFile(fixtureTouchedPath, join(worktreeDir, 'test/fixtures/daemon-e2e/touched.txt'));
      const { provisionLiveProviderHome } = await import('../fixtures/live-provider-home.js');
      providerHome = await provisionLiveProviderHome(
        fileURLToPath(new URL('../../../../', import.meta.url)),
        hostToken,
      );
      meter = new TokenMeter(new ProvisionedHome(provider, {
        executable: 'claude',
        env: providerHome.childEnv(),
        args: providerHome.childArgs(),
        teardown: () => providerHome?.teardown() ?? Promise.resolve(),
      }));
      await execa('git', ['add', '-A'], { cwd: worktreeDir });
      await execa('git', ['commit', '-m', 'test: seed live daemon E2E fixture', '-m', 'Task: T0'], {
        cwd: worktreeDir,
      });
      const { stdout: baselineSha } = await execa('git', ['rev-parse', 'HEAD'], {
        cwd: worktreeDir,
      });
      await execa('git', ['checkout', '-b', `feature/${slug}`], { cwd: worktreeDir });

      await mkdir(pipelineDir, { recursive: true });
      await writeFile(
        statePath,
        JSON.stringify({
          worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
          complexity_tier: 'S', track: 'technical', stories: 'done', conflict_check: 'done',
          plan: 'done', coherence_check: 'done', architecture_diagram: 'done',
          architecture_review: 'done', acceptance_specs: 'done',
        }),
      );

      const runner = new DefaultStepRunner(meter, 'daemon-e2e-live-session', worktreeDir, {
        featureDesc: slug,
        pipelineDir,
        planPath,
        providerKey: 'claude',
        mode: 'auto',
      });
      await runDaemon(
        {
          discoverBacklog: async () => [{ slug, tier: 'S', track: 'technical' }],
          runFeature: async (item) => {
            const conductor = new Conductor({
              stateFilePath: statePath,
              stepRunner: runner,
              events: new ConductorEventEmitter(),
              projectRoot: worktreeDir,
              fromStep: 'build',
              mode: 'auto',
              daemon: true,
              verifyArtifacts: false,
              fullSuiteVerifier: {
                ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
                inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
              },
              escalateBuildFailure: async () => ({}),
            });
            await conductor.run();
            return { slug: item.slug, status: 'done' };
          },
        },
        { concurrency: 1, once: true },
      );

      const { stdout: commitSha } = await execa('git', ['rev-parse', 'HEAD'], {
        cwd: worktreeDir,
      });
      const { stdout: commitBody } = await execa('git', ['log', '-1', '--format=%B'], {
        cwd: worktreeDir,
      });
      const { stdout: changedFiles } = await execa(
        'git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], { cwd: worktreeDir },
      );

      expect({
        terminal: await hasSuccessfulTerminalState(worktreeDir, slug),
        madeCommit: commitSha.trim() !== baselineSha.trim(),
        touchedFixture: changedFiles.split('\n').includes('test/fixtures/daemon-e2e/touched.txt'),
        taskTrailer: /(?:^|\n)Task:\s*1\s*$/m.test(commitBody),
      }).toEqual({ terminal: true, madeCommit: true, touchedFixture: true, taskTrailer: true });
    } catch (error) {
      await dumpPipelineDiagnostics(worktreeDir);
      throw error;
    } finally {
      console.info(`daemon E2E live smoke total tokens: ${meter.totalTokens}; cap: ${tokenCap}`);
      assertTokenCap(meter.totalTokens, tokenCap);
      await providerHome?.teardown();
      await rm(worktreeDir, { recursive: true, force: true });
    }
  }, 20 * 60_000);
});
