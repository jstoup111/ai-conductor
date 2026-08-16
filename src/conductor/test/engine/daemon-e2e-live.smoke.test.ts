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
import type { StepName } from '../../src/types/steps.js';
import { dumpPipelineDiagnostics } from './daemon-e2e-fixture.test.js';
import { initTestRepo } from '../fixtures/git-repo.js';
import { dispatchableStepCommands } from '../fixtures/step-command-preflight.js';
import type { ProviderHome } from '../../src/engine/self-host/provider-home.js';

const smokeCapability = 'credentialed';

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
  totalTurns = 0;
  unmetered = 0;
  /**
   * Step attribution for every unmetered dispatch. A dispatch that reports no
   * token usage is only acceptable past the PR-creation boundary — see
   * assertSuccessfulCredentialedRun.
   */
  readonly unmeteredSteps: (StepName | 'unattributed')[] = [];

  constructor(
    private readonly provider: LLMProvider,
    private readonly currentStep: () => StepName | undefined = () => undefined,
  ) {
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
    if (!result.tokenUsage) {
      this.unmetered += 1;
      this.unmeteredSteps.push(this.currentStep() ?? 'unattributed');
      return;
    }
    this.totalTokens += result.tokenUsage.input + result.tokenUsage.output;
    this.totalTurns += result.tokenUsage.numTurns ?? 0;
  }
}

/** Test-local provider decorator that supplies the isolated home to every dispatch. */
class ProvisionedHome implements LLMProvider {
  readonly supportsSessionResume: boolean | undefined;
  readonly lifecycleCapability: LLMProvider['lifecycleCapability'];
  readonly readiness: LLMProvider['readiness'];
  readonly prepareSelfHostAuth: LLMProvider['prepareSelfHostAuth'];
  readonly resolveSelfHostExecutable: LLMProvider['resolveSelfHostExecutable'];
  dispatches = 0;

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
    this.dispatches += 1;
    return this.provider.invoke({ ...options, selfHost: this.selfHost });
  }

  invokeInteractive(options: InvokeOptions): Promise<InvokeResult | void> {
    this.dispatches += 1;
    return this.provider.invokeInteractive({ ...options, selfHost: this.selfHost });
  }
}

type LiveProviderPreflight = (homeDir: string, providerKey?: string) => Promise<void>;

/** Run the dispatch continuation only after every live-smoke command resolves. */
async function dispatchAfterLivePreflight(
  home: Pick<ProviderHome, 'homeDir'>,
  dispatch: () => Promise<void>,
  preflight: LiveProviderPreflight = dispatchableStepCommands.assertResolves,
): Promise<void> {
  await preflight(home.homeDir, 'claude');
  await dispatch();
}

function assertTokenCap(totalTokens: number, unmetered: number, cap: number): void {
  if (totalTokens > cap) {
    throw new Error(
      `Token cap ${cap} exceeded: observed ${totalTokens}; unmetered results: ${unmetered}`,
    );
  }
}

/**
 * Steps allowed to contribute an unmetered dispatch.
 *
 * The fixture worktree has no git remote, so publication cannot create a real
 * PR. `finish`'s bounded PR-prose judgment therefore has nothing to inspect and
 * comes back without token usage (observed as `{"kind":"provider_unavailable"}`,
 * `finish-publication.ts:987`). Operator decision, 2026-08-07: driving the
 * pipeline *up to* PR creation is the success criterion for this smoke; PR
 * creation itself failing in the fixture is expected, not a regression.
 *
 * This is deliberately an allow-list of one rather than a relaxed count. Every
 * step before the publication boundary must still report usage — an unmetered
 * `build` or `build_review` is the metering defect the assertion exists to
 * catch, and it stays caught.
 */
const STEPS_ALLOWED_UNMETERED: readonly StepName[] = ['finish'];

function assertSuccessfulCredentialedRun(
  provisioned: Pick<ProvisionedHome, 'dispatches'> | undefined,
  meter: Pick<TokenMeter, 'totalTurns' | 'totalTokens' | 'unmetered' | 'unmeteredSteps'>,
): void {
  expect(provisioned?.dispatches ?? 0).toBeGreaterThan(0);
  expect(meter.totalTurns).toBeGreaterThan(0);
  expect(meter.totalTokens).toBeGreaterThan(0);

  // Named so a failure says which step went unmetered instead of "expected 1 to be 0".
  const disallowed = meter.unmeteredSteps.filter(
    (step) => !STEPS_ALLOWED_UNMETERED.includes(step as StepName),
  );
  expect(disallowed).toEqual([]);
  // Attribution must be real: an unmetered dispatch we cannot attribute to a
  // step is itself a failure, so the allow-list can never be satisfied by a
  // missing step_started event.
  expect(meter.unmeteredSteps.length).toBe(meter.unmetered);
}

const fixturePlanPath = fileURLToPath(
  new URL('../fixtures/daemon-e2e/plan.md', import.meta.url),
);
const fixtureStoriesPath = fileURLToPath(
  new URL('../fixtures/daemon-e2e/stories.md', import.meta.url),
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
const shouldRun = claudeBinaryAvailable() && !!hostToken;
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
      { homeDir: '/tmp/home' }, dispatch, preflight,
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
        preflight,
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
    let provisioned: ProvisionedHome | undefined;
    let baselineSha: string | undefined;

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
      // Task 1's deliverable is deliberately NOT seeded. Seeding it made the
      // baseline commit already satisfy the plan, so a live agent correctly
      // declined to redo finished work and the run ended with no task commit
      // at all — a fixture bug that read as a product failure.
      const { provisionLiveProviderHome } = await import('../fixtures/live-provider-home.js');
      providerHome = await provisionLiveProviderHome(
        fileURLToPath(new URL('../../../../', import.meta.url)),
        hostToken,
      );
      provisioned = new ProvisionedHome(provider, {
        executable: 'claude',
        env: providerHome.childEnv(),
        args: providerHome.childArgs(),
        teardown: () => providerHome?.teardown() ?? Promise.resolve(),
      });
      // Tracks the running step so the meter can attribute an unmetered
      // dispatch. Populated from the conductor's own step_started events.
      const stepTracker: { current: StepName | undefined } = { current: undefined };
      meter = new TokenMeter(provisioned, () => stepTracker.current);
      await dispatchAfterLivePreflight(providerHome, async () => {
      await execa('git', ['add', '-A'], { cwd: worktreeDir });
      await execa('git', ['commit', '-m', 'test: seed live daemon E2E fixture', '-m', 'Task: T0'], {
        cwd: worktreeDir,
      });
      const { stdout: seededBaselineSha } = await execa('git', ['rev-parse', 'HEAD'], {
        cwd: worktreeDir,
      });
      baselineSha = seededBaselineSha;
      // Fails here rather than 5 minutes and one live dispatch later if the
      // baseline ever ships Task 1's deliverable again.
      const { stdout: seededFiles } = await execa(
        'git', ['ls-tree', '--name-only', '-r', 'HEAD'], { cwd: worktreeDir },
      );
      expect(seededFiles.split('\n')).not.toContain('test/fixtures/daemon-e2e/touched.txt');
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
        // Parity with the scripted fixture (daemon-e2e-fixture.test.ts): this
        // fixture has no runnable scoped-test command in its isolated
        // temporary repository, so the tautology preflight (#1618) fails
        // instantly with missing-scoped-configuration and the infrastructure
        // failure blocks the effective verdict — the walk then never writes
        // DONE (release-gate failure on the 0.102.0 merge, both attempts).
        // Disable only the tautology branch; the other three fan-out branches
        // still run against the live provider.
        config: { build_review: { maxParallel: 4, rubrics: { tautology: { enabled: false } } } },
        buildReviewInputOptions: {
          inspectTestSuite: async () => ({
            status: 'CURRENT',
            evidence: {
              provenanceHeadSha: (await execa('git', ['rev-parse', 'HEAD'], { cwd: worktreeDir })).stdout.trim(),
            },
          } as never),
        },
      });
      await runDaemon(
        {
          discoverBacklog: async () => [{ slug, tier: 'S', track: 'technical' }],
          runFeature: async (item) => {
            const events = new ConductorEventEmitter();
            events.on('step_started', (event) => {
              if (event.type === 'step_started') stepTracker.current = event.step;
            });
            const conductor = new Conductor({
              stateFilePath: statePath,
              stepRunner: runner,
              events,
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
      });

      const { stdout: commitSha } = await execa('git', ['rev-parse', 'HEAD'], {
        cwd: worktreeDir,
      });
      const { stdout: commitBody } = await execa('git', ['log', '-1', '--format=%B'], {
        cwd: worktreeDir,
      });
      const { stdout: changedFiles } = await execa(
        'git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], { cwd: worktreeDir },
      );

      assertSuccessfulCredentialedRun(provisioned, meter);

      expect({
        terminal: await hasSuccessfulTerminalState(worktreeDir, slug),
        madeCommit: commitSha.trim() !== baselineSha?.trim(),
        touchedFixture: changedFiles.split('\n').includes('test/fixtures/daemon-e2e/touched.txt'),
        taskTrailer: /(?:^|\n)Task:\s*1\s*$/m.test(commitBody),
      }).toEqual({ terminal: true, madeCommit: true, touchedFixture: true, taskTrailer: true });
    } catch (error) {
      const dump = await dumpPipelineDiagnostics(worktreeDir);
      // Embed the dump in the failure itself: CI's smoke reporter keeps
      // failureMessages but drops console output.
      if (error instanceof Error) {
        error.message += `\n\n--- pipeline diagnostics ---\n${dump}`;
      }
      throw error;
    } finally {
      console.info(
        `daemon E2E live smoke total tokens: ${meter.totalTokens}; ` +
        `dispatches: ${provisioned?.dispatches ?? 0}; cap: ${tokenCap}`,
      );
      assertTokenCap(meter.totalTokens, meter.unmetered, tokenCap);
      await providerHome?.teardown();
      await rm(worktreeDir, { recursive: true, force: true });
    }
  }, 20 * 60_000);
});
