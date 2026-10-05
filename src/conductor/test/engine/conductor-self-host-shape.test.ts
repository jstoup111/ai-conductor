// Covers: task:7, task:8
import { describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conductor, type StepRunResult, type StepRunner } from '../../src/engine/conductor.js';
import type { ProviderExecutionContext } from '../../src/engine/provider-execution.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import type { SelfHostGuardrails } from '../../src/engine/self-host/wiring.js';
import { ProviderSetupUnavailableError } from '../../src/engine/provider-setup-failure.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState } from '../../src/types/index.js';
import * as liveBoundary from '../../src/engine/self-host/live-boundary.js';

vi.mock('../../src/engine/self-host/live-boundary.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/self-host/live-boundary.js')>(),
  fingerprintLiveBoundary: vi.fn(async () => ({ measurements: [] })),
  verifyLiveBoundary: vi.fn(async () => ({ ok: true })),
}));

const SELF_HOST_STATE = { feature_desc: 'catalog-shape' } as ConductState;

function candidate(providerKey: 'claude' | 'codex' | 'pi', model: string) {
  return { step: 'build', providerKey, model, effort: 'high' } as const;
}

function guardrails(provisionProviderHome = vi.fn()): SelfHostGuardrails {
  return {
    resolveHarnessRoot: vi.fn(async () => '/live'),
    resolveInstalledHarnessRoot: vi.fn(async () => ({ status: 'ok' as const, root: '/live' })),
    relink: vi.fn(async () => {}),
    provisionSandbox: vi.fn(async () => ({
      configDir: '/scratch/claude', childEnv: () => ({ CLAUDE_CONFIG_DIR: '/scratch/claude' }), teardown: vi.fn(async () => {}),
    })),
    provisionProviderHome,
    versionGate: vi.fn(async () => ({ ok: true as const })),
    releaseGate: vi.fn(async () => ({ ok: true as const })),
  };
}

function conductor(
  providerExecution: ProviderExecutionContext,
  runner: StepRunner,
  selfHostGuardrails: SelfHostGuardrails,
  options: { projectRoot?: string; config?: object } = {},
) {
  return new Conductor({
    stateFilePath: `${options.projectRoot ?? '/worktree'}/conduct-state.json`, projectRoot: options.projectRoot ?? '/worktree', featureSlug: 'catalog-shape',
    events: new ConductorEventEmitter(), stepRunner: runner, providerExecution, selfHostGuardrails,
    daemon: true, selfHost: true, config: {
      llm_provider: 'pi', harness_self_host: { live_containment: false, build_auth: { mode: 'api-key' } },
      ...options.config,
    } as never,
  });
}

async function dispatch(conductor: Conductor): Promise<StepRunResult> {
  return (conductor as unknown as {
    runSelfBuildDispatch(step: 'build', state: ConductState): Promise<StepRunResult>;
  }).runSelfBuildDispatch('build', SELF_HOST_STATE);
}

describe('conductor self-host catalog shape', () => {
  it('prepares catalog-shaped homes and fingerprints each selected auth path', async () => {
    const isolatedAuth = new Map<string, Record<string, { type: string; key: string }>>();
    const preparedEnvs: NodeJS.ProcessEnv[] = [];
    const provisionProviderHome = vi.fn(async (options: { provider: { id: string; prepareSelfHostAuth(context: { homeDir: string }): Promise<unknown> } }) => {
      const homeDir = `/worktree/.daemon/scratch/${options.provider.id}-${provisionProviderHome.mock.calls.length}`;
      await options.provider.prepareSelfHostAuth({ homeDir });
      const homeVariable = options.provider.id === 'pi' ? 'PI_CODING_AGENT_DIR' : 'CODEX_HOME';
      return {
        childEnv: () => ({ [homeVariable]: homeDir }), childArgs: () => [], teardown: vi.fn(async () => {}),
      };
    });
    const piAuth = vi.fn(async ({ model, homeDir }: { model: string; homeDir: string }) => {
      const provider = model.split('/')[0]!;
      isolatedAuth.set(homeDir, { [provider]: { type: 'api_key', key: provider } });
    });
    const runtimes = new ProviderRuntimeSet([
      { key: 'pi', provider: { invoke: vi.fn(), prepareSelfHostAuth: piAuth, resolveSelfHostExecutable: vi.fn(async () => 'pi') }, policy: {} },
      { key: 'codex', provider: { invoke: vi.fn(), prepareSelfHostAuth: vi.fn(async () => undefined), resolveSelfHostExecutable: vi.fn(async () => 'codex') }, policy: {} },
      { key: 'claude', provider: { invoke: vi.fn() }, policy: {} },
    ] as never);
    const providerExecution = { runtimes, sessions: {} as never, configuredProviders: ['pi', 'codex', 'claude'] } as ProviderExecutionContext;
    const runner: StepRunner = { run: async () => {
      for (const [index, next] of [candidate('pi', 'openrouter/m'), candidate('pi', 'deepseek/m'), candidate('codex', 'gpt-6'), candidate('claude', 'opus')].entries()) {
        const prepared = await providerExecution.prepareCandidateSelfHost!(next, runtimes.get(next.providerKey) as never, { runId: 'catalog-shape', attempt: index + 1 });
        expect(prepared).toBeDefined();
        preparedEnvs.push(prepared!.env);
        await prepared!.teardown();
      }
      return { success: true, output: 'done' };
    } };

    await expect(dispatch(conductor(providerExecution, runner, guardrails(provisionProviderHome)))).resolves.toMatchObject({ success: true });

    expect(provisionProviderHome).toHaveBeenCalledTimes(3);
    expect(piAuth.mock.calls.map(([context]) => context)).toEqual([
      expect.objectContaining({ model: 'openrouter/m', provider: 'pi', homeDir: '/worktree/.daemon/scratch/pi-1' }),
      expect.objectContaining({ model: 'deepseek/m', provider: 'pi', homeDir: '/worktree/.daemon/scratch/pi-2' }),
    ]);
    expect(isolatedAuth.get('/worktree/.daemon/scratch/pi-1')).toEqual({ openrouter: { type: 'api_key', key: 'openrouter' } });
    expect(isolatedAuth.get('/worktree/.daemon/scratch/pi-2')).toEqual({ deepseek: { type: 'api_key', key: 'deepseek' } });
    expect(preparedEnvs.slice(0, 2)).toEqual([
      { PI_CODING_AGENT_DIR: '/worktree/.daemon/scratch/pi-1' },
      { PI_CODING_AGENT_DIR: '/worktree/.daemon/scratch/pi-2' },
    ]);
    expect(vi.mocked(liveBoundary.fingerprintLiveBoundary).mock.calls.map(([options]) => options.selectedAuthPaths)).toEqual([
      ['auth.json'], ['auth.json'], ['auth.json'], ['.credentials.json'],
    ]);
  });

  it('refuses missing Pi self-host seams before fingerprinting or provisioning', async () => {
    const provisionProviderHome = vi.fn();
    const runtimes = new ProviderRuntimeSet([{ key: 'pi', provider: { invoke: vi.fn() }, policy: {} }] as never);
    const providerExecution = { runtimes, sessions: {} as never, configuredProviders: ['pi'] } as ProviderExecutionContext;
    const runner: StepRunner = { run: async () => providerExecution.prepareCandidateSelfHost!(candidate('pi', 'openrouter/m'), runtimes.get('pi') as never, { runId: 'catalog-shape', attempt: 1 }).then(() => ({ success: true })) };
    const fingerprint = vi.mocked(liveBoundary.fingerprintLiveBoundary);
    fingerprint.mockClear();

    await expect(dispatch(conductor(providerExecution, runner, guardrails(provisionProviderHome)))).rejects.toMatchObject({
      name: ProviderSetupUnavailableError.name,
      setupUnavailable: expect.objectContaining({ provider: 'pi', capability: 'self-host-isolation' }),
    });
    expect(fingerprint).not.toHaveBeenCalled();
    expect(provisionProviderHome).not.toHaveBeenCalled();
  });

  it('lets a Pi daemon-token dispatch with no token file reach candidate preparation', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-pi-daemon-token-'));
    let candidatePrepared = false;
    try {
      const runtimes = new ProviderRuntimeSet([
        { key: 'pi', provider: { invoke: vi.fn(), prepareSelfHostAuth: vi.fn(async () => undefined), resolveSelfHostExecutable: vi.fn(async () => 'pi') }, policy: {} },
      ] as never);
      const providerExecution = { runtimes, sessions: {} as never, configuredProviders: ['pi'] } as ProviderExecutionContext;
      const runner: StepRunner = { run: async () => {
        await providerExecution.prepareCandidateSelfHost!(candidate('pi', 'openrouter/m'), runtimes.get('pi') as never, { runId: 'catalog-shape', attempt: 1 });
        candidatePrepared = true;
        return { success: true };
      } };
      await dispatch(conductor(providerExecution, runner, guardrails(vi.fn(async () => ({ childEnv: () => ({}), childArgs: () => [], teardown: vi.fn(async () => {}) }))), {
        projectRoot,
        config: { harness_self_host: { live_containment: false, build_auth: { mode: 'daemon-token', token_path: join(projectRoot, 'missing-token') } } },
      }));
      let buildTokenHalt = false;
      try {
        await access(join(projectRoot, '.pipeline/HALT'));
        buildTokenHalt = true;
      } catch { /* absent halt is the expected Pi outcome */ }

      expect({ candidatePrepared, buildTokenHalt }).toEqual({ candidatePrepared: true, buildTokenHalt: false });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('does not inspect expired Claude credentials for a Pi dispatch without build auth', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-pi-credentials-'));
    const priorClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    try {
      await writeFile(join(projectRoot, '.credentials.json'), JSON.stringify({ claudeAiOauth: { expiresAt: 0 } }));
      process.env.CLAUDE_CONFIG_DIR = projectRoot;
      const runtimes = new ProviderRuntimeSet([
        { key: 'pi', provider: { invoke: vi.fn() }, policy: {} },
      ] as never);
      const providerExecution = { runtimes, sessions: {} as never, configuredProviders: ['pi'] } as ProviderExecutionContext;
      const instance = conductor(providerExecution, { run: vi.fn(async () => ({ success: true })) }, guardrails(), {
        projectRoot,
        config: { harness_self_host: { live_containment: false } },
      });
      const preflight = vi.spyOn(instance as never, 'preflightCredentialsCheck');

      await dispatch(instance);

      expect(preflight).not.toHaveBeenCalled();
    } finally {
      if (priorClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = priorClaudeConfigDir;
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('keeps the daemon-token HALT for a Claude dispatch with no token file', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-claude-daemon-token-'));
    try {
      const runtimes = new ProviderRuntimeSet([
        { key: 'claude', provider: { invoke: vi.fn() }, policy: {} },
      ] as never);
      const providerExecution = { runtimes, sessions: {} as never, configuredProviders: ['claude'] } as ProviderExecutionContext;
      const result = await dispatch(conductor(providerExecution, { run: vi.fn(async () => ({ success: true })) }, guardrails(), {
        projectRoot,
        config: { llm_provider: 'claude', harness_self_host: { live_containment: false, build_auth: { mode: 'daemon-token', token_path: join(projectRoot, 'missing-token') } } },
      }));

      expect({ success: result.success, halt: await access(join(projectRoot, '.pipeline/HALT')).then(() => true, () => false) })
        .toEqual({ success: false, halt: true });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('authenticates a Claude candidate sandbox when the step prefers a provider-home provider', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-mixed-daemon-token-'));
    try {
      const tokenPath = join(projectRoot, 'daemon-token');
      await writeFile(tokenPath, 'tok-claude-rubric');
      const runtimes = new ProviderRuntimeSet([
        { key: 'codex', provider: { invoke: vi.fn(), prepareSelfHostAuth: vi.fn(async () => undefined), resolveSelfHostExecutable: vi.fn(async () => 'codex') }, policy: {} },
        { key: 'claude', provider: { invoke: vi.fn() }, policy: {} },
      ] as never);
      const providerExecution = { runtimes, sessions: {} as never, configuredProviders: ['codex', 'claude'] } as ProviderExecutionContext;
      let claudeEnv: NodeJS.ProcessEnv | undefined;
      const runner: StepRunner = { run: async () => {
        const prepared = await providerExecution.prepareCandidateSelfHost!(candidate('claude', 'opus'), runtimes.get('claude') as never, { runId: 'catalog-shape', attempt: 0, member: 'testQuality' });
        claudeEnv = prepared!.env;
        await prepared!.teardown();
        return { success: true };
      } };

      await dispatch(conductor(providerExecution, runner, guardrails(), {
        projectRoot,
        config: { llm_provider: ['codex', 'claude'], harness_self_host: { live_containment: false, build_auth: { mode: 'daemon-token', token_path: tokenPath } } },
      }));

      expect(claudeEnv).toMatchObject({ CLAUDE_CONFIG_DIR: '/scratch/claude', CLAUDE_CODE_OAUTH_TOKEN: 'tok-claude-rubric' });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
