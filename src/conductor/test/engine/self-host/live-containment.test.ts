import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Conductor } from '../../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../../src/engine/conductor.js';
import * as liveContainment from '../../../src/engine/self-host/live-containment.js';
import { LIVE_CHECKOUT_VOLATILE } from '../../../src/engine/self-host/live-boundary.js';
import type { ContainmentVerdict } from '../../../src/engine/self-host/live-containment.js';
import type { ProviderExecutionContext } from '../../../src/engine/provider-execution.js';
import { ProviderRuntimeSet } from '../../../src/engine/provider-runtime.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../../src/engine/model-availability.js';
import { writeState } from '../../../src/engine/state.js';
import type { SelfHostGuardrails } from '../../../src/engine/self-host/wiring.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import type { ConductState, StepName } from '../../../src/types/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createCheckout(): Promise<{ liveCheckout: string; worktreeRoot: string }> {
  const liveCheckout = await mkdtemp(join(tmpdir(), 'live-containment-'));
  temporaryDirectories.push(liveCheckout);
  const worktreeRoot = join(liveCheckout, '.worktrees', 'build');
  await mkdir(worktreeRoot, { recursive: true });
  return { liveCheckout, worktreeRoot };
}

const BUILD_ONLY: ConductState = {
  worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
  stories: 'done', conflict_check: 'done', plan: 'done', architecture_diagram: 'done',
  architecture_review: 'done', acceptance_specs: 'done', test_suite: 'done',
  build_review: 'done', wiring_check: 'done', manual_test: 'done', prd_audit: 'done',
  architecture_review_as_built: 'done', retro: 'done', rebase: 'done', finish: 'done',
  complexity_tier: 'M', track: 'technical', feature_desc: 'live-containment',
} as ConductState;

function fullSuiteVerifierStub() {
  return {
    ensure: vi.fn().mockResolvedValue({ status: 'REUSED', evidence: {} as never }),
    inspect: vi.fn().mockResolvedValue({ status: 'CURRENT', evidence: {} as never }),
  };
}

type Prepared = NonNullable<Awaited<ReturnType<NonNullable<ProviderExecutionContext['prepareCandidateSelfHost']>>>>;

async function prepareCandidate(
  providerKey: 'claude' | 'codex',
  containmentAvailable: boolean,
): Promise<{
  readonly prepared: Prepared;
  readonly unwrapped: Omit<Prepared, 'teardown'>;
  readonly providerTeardown: ReturnType<typeof vi.fn>;
  readonly bindSet: readonly string[];
}> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'live-containment-project-'));
  const liveCheckout = await mkdtemp(join(tmpdir(), 'live-containment-live-'));
  const fakeBin = await mkdtemp(join(tmpdir(), 'live-containment-bin-'));
  temporaryDirectories.push(projectRoot, liveCheckout, fakeBin);
  await Promise.all([
    mkdir(join(projectRoot, '.pipeline'), { recursive: true }),
    mkdir(join(liveCheckout, '.claude'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(projectRoot, 'VERSION'), '0.1.0\n', 'utf8'),
    writeFile(join(liveCheckout, 'VERSION'), '0.1.0\n', 'utf8'),
    writeFile(join(liveCheckout, '.claude', 'settings.local.json'), '{}\n', 'utf8'),
    writeFile(
      join(fakeBin, 'bwrap'),
      '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = "--" ]; then\n    shift\n    exec "$@"\n  fi\n  shift\ndone\nexit 2\n',
      { mode: 0o755 },
    ),
    writeState(join(projectRoot, 'conduct-state.json'), BUILD_ONLY),
  ]);
  if (!containmentAvailable) await rm(join(fakeBin, 'bwrap'));

  const policy = providerKey === 'claude' ? CLAUDE_MODEL_POLICY : CODEX_MODEL_POLICY;
  const env = providerKey === 'codex'
    ? { CODEX_HOME: join(projectRoot, '.daemon', 'scratch', 'codex-home') }
    : { CLAUDE_CONFIG_DIR: join(projectRoot, '.pipeline', 'sandbox-config') };
  const args = providerKey === 'codex' ? ['--isolated-home'] : [];
  const teardown = vi.fn(async () => {});
  const runtimes = new ProviderRuntimeSet([{
    key: providerKey,
    provider: {
      invoke: vi.fn(),
      invokeInteractive: vi.fn(async () => {}),
      prepareSelfHostAuth: vi.fn(async () => ({})),
      resolveSelfHostExecutable: vi.fn(async () => providerKey),
      lifecycleCapability: { synchronousSpawnPermit: true },
    },
    policy,
    builtIn: true,
    availability: new ModelAvailability(policy.modelFallbackLadder),
  }] as never);
  const providerExecution: ProviderExecutionContext = {
    runtimes,
    sessions: {} as never,
    configuredProviders: [providerKey],
  };
  let prepared: Prepared | undefined;
  const runner: StepRunner = {
    selfHostRunId: () => 'containment-red',
    run: async (step: StepName): Promise<StepRunResult> => {
      const prepare = providerExecution.prepareCandidateSelfHost;
      if (!prepare) throw new Error('self-host candidate preparation was not installed');
      prepared = await prepare(
        { step, providerKey, model: policy.modelFallbackLadder[0], effort: 'high' } as never,
        runtimes.get(providerKey) as never,
        { runId: 'containment-red', attempt: 1 },
      );
      if (!prepared) throw new Error('self-host candidate preparation returned no command');
      return { success: true, output: 'prepared' };
    },
  };
  const guardrails: SelfHostGuardrails = {
    resolveHarnessRoot: vi.fn(async () => liveCheckout),
    resolveInstalledHarnessRoot: vi.fn(async () => ({ status: 'ok' as const, root: liveCheckout })),
    relink: vi.fn(async () => {}),
    provisionSandbox: vi.fn(async () => ({
      configDir: join(projectRoot, '.pipeline', 'sandbox-config'),
      childEnv: () => env,
      teardown,
    })) as never,
    provisionProviderHome: vi.fn(async () => ({
      childEnv: () => env,
      childArgs: () => args,
      teardown,
    })) as never,
    versionGate: vi.fn(async () => ({ ok: true as const })),
    releaseGate: vi.fn(async () => ({ ok: true as const })),
  };
  const priorPath = process.env.PATH;
  process.env.PATH = containmentAvailable ? `${fakeBin}${delimiter}${priorPath ?? ''}` : fakeBin;
  await chmod(liveCheckout, 0o555);
  try {
    const conductor = new Conductor({
      stateFilePath: join(projectRoot, 'conduct-state.json'),
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      fromStep: 'build',
      mode: 'auto',
      daemon: true,
      selfHost: true,
      verifyArtifacts: false,
      maxRetries: 1,
      baseBranch: 'main',
      selfHostGuardrails: guardrails,
      escalateBuildFailure: async () => ({}),
      providerExecution,
      fullSuiteVerifier: fullSuiteVerifierStub(),
      sleepFn: vi.fn(async () => {}),
      config: {
        llm_provider: [providerKey],
        harness_self_host: { sandbox_build_env: true, build_auth: { mode: 'api-key' } },
        steps: { build: { llm_provider: providerKey } },
      } as never,
    });
    await (conductor as unknown as {
      runSelfBuildDispatch: (step: StepName, state: ConductState) => Promise<StepRunResult>;
    }).runSelfBuildDispatch('build', BUILD_ONLY);
  } finally {
    if (priorPath === undefined) delete process.env.PATH;
    else process.env.PATH = priorPath;
    await chmod(liveCheckout, 0o755);
  }
  if (!prepared) throw new Error('candidate was not prepared');
  return {
    prepared,
    unwrapped: { executable: providerKey, env, args },
    providerTeardown: teardown,
    bindSet: deriveBindSet(liveCheckout, projectRoot),
  };
}

function deriveBindSet(liveCheckout: string, worktreeRoot: string): readonly string[] {
  const candidate: unknown = Reflect.get(liveContainment, 'deriveBindSet');
  if (typeof candidate !== 'function') throw new Error('deriveBindSet is not available');
  return (candidate as (live: string, worktree: string) => readonly string[])(liveCheckout, worktreeRoot);
}

type ProbeRunner = (executable: string, args: readonly string[]) => Promise<{
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}>;

function probeContainment(
  bindSet: readonly string[],
  liveCheckout: string,
  worktreeRoot: string,
  runner: ProbeRunner,
): Promise<ContainmentVerdict> {
  const candidate: unknown = Reflect.get(liveContainment, 'probeContainment');
  if (typeof candidate !== 'function') throw new Error('probeContainment is not available');
  return (candidate as (
    binds: readonly string[],
    live: string,
    worktree: string,
    commandRunner: ProbeRunner,
  ) => Promise<ContainmentVerdict>)(bindSet, liveCheckout, worktreeRoot, runner);
}

describe('ContainmentVerdict', () => {
  it('returns discriminated evidence or reason from containment probe outcomes', async () => {
    const { liveCheckout, worktreeRoot } = await createCheckout();
    const bindSet = deriveBindSet(liveCheckout, worktreeRoot);
    const contained = await probeContainment(bindSet, liveCheckout, worktreeRoot, async () => ({
      stdout: 'live-root-not-writable\nworktree-writable\n',
      stderr: '',
      exitCode: 0,
    }));
    const unavailable = await probeContainment(bindSet, liveCheckout, worktreeRoot, async () => {
      throw Object.assign(new Error('bwrap unavailable'), { code: 'ENOENT' });
    });

    expect(contained).toEqual({
      contained: true,
      evidence: 'probe confirmed live-root-not-writable and worktree-writable',
    });
    expect(unavailable).toEqual({
      contained: false,
      reason: 'containment unavailable: bwrap not found',
    });
  });
});

describe('deriveBindSet', () => {
  it('binds the host, live checkout, existing guard carve-outs, and node_modules in bwrap order', async () => {
    const { liveCheckout, worktreeRoot } = await createCheckout();
    await Promise.all([
      ...LIVE_CHECKOUT_VOLATILE
        .filter((path) => path !== 'src/conductor/dist-versions')
        .map((path) => mkdir(join(liveCheckout, path), { recursive: true })),
      mkdir(join(liveCheckout, 'node_modules'), { recursive: true }),
      mkdir(join(liveCheckout, 'src', 'conductor', 'node_modules'), { recursive: true }),
    ]);

    const bindSet = deriveBindSet(liveCheckout, worktreeRoot);
    const readOnlyLiveRoot = ['--ro-bind', liveCheckout, liveCheckout];
    const expectedReadWritePaths = [
      ...LIVE_CHECKOUT_VOLATILE
        .filter((path) => path !== 'src/conductor/dist-versions')
        .map((path) => join(liveCheckout, path)),
      join(liveCheckout, 'node_modules'),
      join(liveCheckout, 'src', 'conductor', 'node_modules'),
    ];

    expect(bindSet).toEqual([
      '--dev-bind', '/', '/',
      '--unshare-pid',
      '--proc', '/proc',
      ...readOnlyLiveRoot,
      '--bind', worktreeRoot, worktreeRoot,
      ...expectedReadWritePaths.flatMap((path) => ['--bind', path, path]),
    ]);
  });

  it('omits guard carve-outs that are absent from this checkout', async () => {
    const { liveCheckout, worktreeRoot } = await createCheckout();

    expect(deriveBindSet(liveCheckout, worktreeRoot)).not.toContain(join(liveCheckout, '.pipeline'));
  });

  it('does not discover node_modules below pruned volatile directories', async () => {
    const { liveCheckout, worktreeRoot } = await createCheckout();
    const discovered = join(liveCheckout, 'packages', 'widget', 'node_modules');
    const pruned = [
      join(liveCheckout, 'node_modules', 'nested', 'node_modules'),
      join(liveCheckout, '.git', 'objects', 'node_modules'),
      join(liveCheckout, '.worktrees', 'other', 'node_modules'),
    ];
    await Promise.all([
      mkdir(discovered, { recursive: true }),
      ...pruned.map((path) => mkdir(path, { recursive: true })),
    ]);

    const bindSet = deriveBindSet(liveCheckout, worktreeRoot);

    expect(bindSet).toEqual(expect.arrayContaining([
      '--bind', discovered, discovered,
    ]));
    for (const path of pruned) expect(bindSet).not.toContain(path);
  });
});

describe('wrapForContainment', () => {
  it('wraps the command with the bind set while preserving its environment', () => {
    const bindSet = ['--dev-bind', '/', '/', '--ro-bind', '/live', '/live'];
    const candidate: unknown = Reflect.get(liveContainment, 'wrapForContainment');
    if (typeof candidate !== 'function') throw new Error('wrapForContainment is not available');

    const wrapped = (candidate as (
      command: { executable: string; args: readonly string[]; env: Record<string, string> },
      binds: readonly string[],
    ) => { executable: string; args: readonly string[]; env: Record<string, string> })(
      { executable: 'claude', args: ['--x'], env: { A: '1' } },
      bindSet,
    );

    expect(wrapped).toEqual({
      executable: 'bwrap',
      args: [...bindSet, '--', 'claude', '--x'],
      env: { A: '1' },
    });
  });
});

describe('prepareCandidateSelfHost containment seam', () => {
  it.each([
    ['claude', 'claude'],
    ['codex', 'codex'],
  ] as const)('wraps the contained %s candidate without changing its provider environment', async (providerKey, executable) => {
    const { prepared, unwrapped, providerTeardown, bindSet } = await prepareCandidate(providerKey, true);

    expect(prepared.executable).toBe('bwrap');
    expect(prepared.args).toEqual([...bindSet, '--', executable, ...unwrapped.args]);
    expect(prepared.env).toEqual(unwrapped.env);
    if (providerKey === 'codex') expect(prepared.env.CODEX_HOME).toBe(unwrapped.env.CODEX_HOME);
    await prepared.teardown();
    expect(providerTeardown).toHaveBeenCalledOnce();
  });

  it.each(['claude', 'codex'] as const)(
    'leaves the %s candidate unwrapped with its teardown when containment is unavailable',
    async (providerKey) => {
      const { prepared, unwrapped, providerTeardown } = await prepareCandidate(providerKey, false);

      expect({ executable: prepared.executable, args: prepared.args, env: prepared.env }).toEqual(unwrapped);
      expect(prepared.env).toEqual(unwrapped.env);
      await expect(prepared.teardown()).resolves.toBeUndefined();
      expect(providerTeardown).toHaveBeenCalledOnce();
    },
  );
});

describe('probeContainment', () => {
  it('proves both the live root is read-only and the worktree is writable in one bwrap probe', async () => {
    const { liveCheckout, worktreeRoot } = await createCheckout();
    const bindSet = ['--dev-bind', '/', '/', '--ro-bind', liveCheckout, liveCheckout];
    const calls: Array<{ executable: string; args: readonly string[] }> = [];
    const runner: ProbeRunner = async (executable, args) => {
      calls.push({ executable, args });
      return { stdout: 'live-root-not-writable\nworktree-writable\n', stderr: '', exitCode: 0 };
    };

    const verdict = await probeContainment(bindSet, liveCheckout, worktreeRoot, runner);

    expect(verdict).toEqual({
      contained: true,
      evidence: expect.stringContaining('live-root-not-writable'),
    });
    expect(verdict.contained && verdict.evidence).toContain('worktree-writable');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ executable: 'bwrap' });
    expect(calls[0]?.args.slice(0, bindSet.length)).toEqual(bindSet);
    expect(calls[0]?.args).toHaveLength(bindSet.length + 7);
    expect(calls[0]?.args.slice(bindSet.length)).toMatchObject([
      '--',
      '/bin/sh',
      '-c',
      expect.any(String),
      'containment-probe',
      liveCheckout,
      worktreeRoot,
    ]);
  });

  it('refuses containment when the probe reports the live checkout writable', async () => {
    const { liveCheckout, worktreeRoot } = await createCheckout();
    const runner: ProbeRunner = async () => ({
      stdout: 'live-root-writable\nworktree-writable\n',
      stderr: '',
      exitCode: 0,
    });

    const verdict = await probeContainment([], liveCheckout, worktreeRoot, runner);

    expect(verdict).toEqual({
      contained: false,
      reason: expect.stringContaining(liveCheckout),
    });
  });

  it('refuses containment when the probe reports the worktree is not writable', async () => {
    const { liveCheckout, worktreeRoot } = await createCheckout();
    const runner: ProbeRunner = async () => ({
      stdout: 'live-root-not-writable\nworktree-not-writable\n',
      stderr: '',
      exitCode: 0,
    });

    const verdict = await probeContainment([], liveCheckout, worktreeRoot, runner);

    expect(verdict).toEqual({
      contained: false,
      reason: expect.stringContaining(worktreeRoot),
    });
  });

  it('refuses containment unless the probe proves both assertions', async () => {
    const { liveCheckout, worktreeRoot } = await createCheckout();
    const runner: ProbeRunner = async () => ({ stdout: 'worktree-writable\n', stderr: '', exitCode: 0 });

    const verdict = await probeContainment([], liveCheckout, worktreeRoot, runner);

    expect(verdict).toEqual({
      contained: false,
      reason: expect.stringContaining(liveCheckout),
    });
  });

  it('collapses a missing bwrap executable to an unavailable verdict', async () => {
    const { liveCheckout, worktreeRoot } = await createCheckout();
    const missingBwrap = Object.assign(new Error('spawn bwrap ENOENT'), { code: 'ENOENT' });
    const runner: ProbeRunner = async () => { throw missingBwrap; };

    const verdict = await probeContainment([], liveCheckout, worktreeRoot, runner);

    expect(verdict).toEqual({
      contained: false,
      reason: expect.stringMatching(/bwrap.*not found/i),
    });
  });

  it('collapses a non-zero probe result to an unavailable verdict carrying stderr', async () => {
    const { liveCheckout, worktreeRoot } = await createCheckout();
    const runner: ProbeRunner = async () => ({
      stdout: 'live-root-not-writable\nworktree-writable\n',
      stderr: 'bwrap: Creating new namespace failed: Operation not permitted',
      exitCode: 1,
    });

    const verdict = await probeContainment([], liveCheckout, worktreeRoot, runner);

    expect(verdict).toEqual({
      contained: false,
      reason: expect.stringContaining('Operation not permitted'),
    });
  });

  it('collapses a timed-out probe to an unavailable verdict', async () => {
    const { liveCheckout, worktreeRoot } = await createCheckout();
    const timeout = Object.assign(new Error('probe timed out after 5000ms'), { timedOut: true });
    const runner: ProbeRunner = async () => { throw timeout; };

    const verdict = await probeContainment([], liveCheckout, worktreeRoot, runner);

    expect(verdict).toEqual({
      contained: false,
      reason: expect.stringMatching(/timed out/i),
    });
  });

  it('never promotes unparseable probe output to contained', async () => {
    const { liveCheckout, worktreeRoot } = await createCheckout();
    const runner: ProbeRunner = async () => ({
      stdout: 'live-root-not-writable\nworktree-writable\nunexpected-output\n',
      stderr: '',
      exitCode: 0,
    });

    const verdict = await probeContainment([], liveCheckout, worktreeRoot, runner);

    expect(verdict).toEqual({
      contained: false,
      reason: expect.stringMatching(/unparseable/i),
    });
  });
});
