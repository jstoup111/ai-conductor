import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import type { SelfHostGuardrails } from '../../src/engine/self-host/wiring.js';

const LEGACY_CONCURRENCY_REFUSAL =
  'LEGACY_NO_PROVIDER_EXECUTION_CONCURRENCY_REFUSAL: legacy no-providerExecution dispatch mutates process-global provider environment and cannot run with effective daemon concurrency 2 (requires 1).';

const BUILD_STATE = { feature_desc: 'env-guard-feature' } as ConductState;

type EnvMutation = { kind: 'set' | 'delete'; key: string; value?: string | undefined };

async function spyOnProcessEnvMutations<T>(
  invoke: () => Promise<T>,
): Promise<{ result: T; mutations: EnvMutation[] }> {
  const originalEnv = process.env;
  const mutations: EnvMutation[] = [];
  process.env = new Proxy(originalEnv, {
    set(target, key, value) {
      mutations.push({ kind: 'set', key: String(key), value: String(value) });
      return Reflect.set(target, key, value);
    },
    deleteProperty(target, key) {
      mutations.push({ kind: 'delete', key: String(key) });
      return Reflect.deleteProperty(target, key);
    },
  }) as NodeJS.ProcessEnv;
  try {
    return { result: await invoke(), mutations };
  } finally {
    process.env = originalEnv;
  }
}

describe('Conductor legacy provider-environment dispatch guard (Task 24)', () => {
  let projectRoot: string;
  let stateFilePath: string;
  let priorConfigDir: string | undefined;
  let priorToken: string | undefined;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'conductor-env-guard-'));
    stateFilePath = join(projectRoot, 'conduct-state.json');
    priorConfigDir = process.env.CLAUDE_CONFIG_DIR;
    priorToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  });

  afterEach(async () => {
    if (priorConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = priorConfigDir;
    if (priorToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = priorToken;
    await rm(projectRoot, { recursive: true, force: true });
  });

  function guardrails(): SelfHostGuardrails {
    return {
      resolveHarnessRoot: vi.fn(async () => projectRoot),
      resolveInstalledHarnessRoot: vi.fn(async () => ({ status: 'ok' as const, root: projectRoot })),
      relink: vi.fn(async () => {}),
      provisionSandbox: vi.fn(async () => ({
        configDir: '/tmp/task-24-provider-env',
        childEnv: () => ({ ...process.env }),
        teardown: vi.fn(async () => {}),
      })),
      versionGate: vi.fn(async () => ({ ok: true as const })),
      releaseGate: vi.fn(async () => ({ ok: true as const })),
    };
  }

  function conductor(input: {
    runner: StepRunner;
    guardrails?: SelfHostGuardrails;
    providerExecution?: object;
    daemonConcurrency?: number;
  }): Conductor {
    return new Conductor({
      stateFilePath,
      stepRunner: input.runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      daemon: true,
      selfHost: true,
      featureSlug: 'env-guard-feature',
      selfHostGuardrails: input.guardrails ?? guardrails(),
      providerExecution: input.providerExecution as never,
      config: {
        daemon_concurrency: input.daemonConcurrency,
        llm_provider: 'claude',
        harness_self_host: { build_auth: { mode: 'api-key' } },
      },
    });
  }

  it('refuses the legacy no-providerExecution branch at config-resolved concurrency 2 before build dispatch', async () => {
    const runner: StepRunner = {
      selfHostRunId: () => 'task-24-run',
      run: vi.fn(async () => ({ success: true })),
    };
    const selfHostGuardrails = guardrails();
    const subject = conductor({ runner, guardrails: selfHostGuardrails, daemonConcurrency: 2 });

    const result = await (subject as unknown as {
      runSelfBuildDispatch: (step: 'build', state: ConductState, hint?: string) => Promise<{ success: boolean; output?: string }>;
    }).runSelfBuildDispatch('build', BUILD_STATE);

    expect(result).toEqual({ success: false, output: LEGACY_CONCURRENCY_REFUSAL });
    expect(runner.run).not.toHaveBeenCalled();
    expect(selfHostGuardrails.provisionSandbox).not.toHaveBeenCalled();
  });

  it('keeps the legacy N=1 environment scope and restores it in finally', async () => {
    const seenConfigDirs: Array<string | undefined> = [];
    const runner: StepRunner = {
      selfHostRunId: () => 'task-24-run',
      run: vi.fn(async () => {
        seenConfigDirs.push(process.env.CLAUDE_CONFIG_DIR);
        return { success: true };
      }),
    };
    const subject = conductor({ runner, daemonConcurrency: 1 });

    const { result, mutations } = await spyOnProcessEnvMutations(() =>
      (subject as unknown as {
        runSelfBuildDispatch: (step: 'build', state: ConductState, hint?: string) => Promise<{ success: boolean }>;
      }).runSelfBuildDispatch('build', BUILD_STATE),
    );

    expect(result).toEqual({ success: true });
    expect(seenConfigDirs).toEqual(['/tmp/task-24-provider-env']);
    expect(process.env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(mutations).toEqual([
      { kind: 'set', key: 'CLAUDE_CONFIG_DIR', value: '/tmp/task-24-provider-env' },
      { kind: 'delete', key: 'CLAUDE_CONFIG_DIR' },
      { kind: 'delete', key: 'CLAUDE_CODE_OAUTH_TOKEN' },
    ]);
  });

  it('keeps provider environment process-global state untouched on the modern providerExecution path', async () => {
    const runner: StepRunner = {
      selfHostRunId: () => 'task-24-run',
      run: vi.fn(async () => ({ success: true })),
    };
    const subject = conductor({ runner, providerExecution: {} });

    const { result, mutations } = await spyOnProcessEnvMutations(() =>
      (subject as unknown as {
        runSelfBuildDispatch: (step: 'build', state: ConductState, hint?: string) => Promise<{ success: boolean }>;
      }).runSelfBuildDispatch('build', BUILD_STATE),
    );

    expect(result).toEqual({ success: true });
    expect(runner.run).toHaveBeenCalledWith('build', BUILD_STATE, { retryReason: undefined });
    expect(mutations).toEqual([]);
  });
});
