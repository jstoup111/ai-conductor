/**
 * Phase 6 — daemon-loop wiring of the self-host guardrail bundle.
 *
 * These drive a real Conductor with an injected SPY guardrail bundle (sandbox /
 * version+release gates) and a fake step runner, proving that for a
 * self-build (`daemon && selfHost`):
 *   - no operator-global relink runs; the sandbox is provisioned directly;
 *   - `process.env.CLAUDE_CONFIG_DIR` is scoped to the sandbox DURING the build
 *     step and restored afterward — no bleed to later steps (e.g. finish), on
 *     both the pass and the throw branch;
 *   - the sandbox is torn down on every exit path;
 *   - the VERSION + release gates run BEFORE finish dispatches, and a failing
 *     gate parks the feature without opening a PR;
 *   - and that a non-self-build activates NONE of it (byte-for-byte unchanged).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, access, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

// Never fork real git/execa (WorktreeManager etc. consume it transitively).
vi.mock('execa', () => ({ execa: vi.fn() }));

// Mock the build auth preflight check so tests don't fail on missing token.
// The real tests for this function are in build-auth-preflight.test.ts.
vi.mock('../../../src/engine/self-host/build-auth-preflight.js', () => ({
  preflightBuildAuthCheck: vi.fn().mockResolvedValue(undefined),
}));

import type { ConductState } from '../../../src/types/index.js';
import type { StepName } from '../../../src/types/index.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { writeState } from '../../../src/engine/state.js';
import type { StepRunner } from '../../../src/engine/conductor.js';
import type { SelfHostGuardrails } from '../../../src/engine/self-host/wiring.js';
import type { SandboxBuildEnv } from '../../../src/engine/self-host/sandbox-build-env.js';
import {
  runReleaseArtifactGate,
  type ReleaseGateOptions,
} from '../../../src/engine/self-host/release-gate.js';
import type { GhRunner, GitRunner } from '../../../src/engine/pr-labels.js';
import { Conductor } from '../../test-conductor.js';

const NOOP_ESCALATION = async () => ({});
const SANDBOX_DIR = '/tmp/harness-selfbuild-TESTDIR';

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** All steps before `build` stamped done so `fromStep: 'build'` drives build→finish. */
function preBuildDoneState(): ConductState {
  return {
    worktree: 'done',
    memory: 'done',
    explore: 'done',
    complexity: 'done',
    stories: 'done',
    conflict_check: 'done',
    plan: 'done',
    architecture_diagram: 'done',
    architecture_review: 'done',
    acceptance_specs: 'done',
    test_suite: 'done',
    build_review: 'done',
    wiring_check: 'done',
    manual_test: 'done',
    prd_audit: 'done',
    architecture_review_as_built: 'done',
    retro: 'done',
    rebase: 'done',
    complexity_tier: 'S',
    track: 'technical', // no PRD/prd_audit — keeps the SHIP tail minimal
    feature_desc: 'self-build-feat',
    worktree_branch: 'feat/self-build-feat',
  } as ConductState;
}

/** A spy guardrail bundle + handles to assert against. */
function makeGuardrails(overrides: Partial<SelfHostGuardrails> = {}) {
  const teardown = vi.fn(async () => {});
  const sandbox: SandboxBuildEnv = {
    configDir: SANDBOX_DIR,
    childEnv: () => ({ ...process.env }),
    teardown,
  };
  const guardrails: SelfHostGuardrails = {
    resolveHarnessRoot: vi.fn(async () => '/installed/harness'),
    resolveInstalledHarnessRoot: vi.fn(async () => ({
      status: 'ok' as const,
      root: '/installed/harness',
    })),
    relink: vi.fn(async () => {}), // retained seam must stay unused by self-host builds
    provisionSandbox: vi.fn(async () => sandbox),
    versionGate: vi.fn(async () => ({ ok: true as const })),
    releaseGate: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
  return { guardrails, sandbox, teardown };
}

/** A runner that records the CLAUDE_CONFIG_DIR seen at dispatch time per step. */
function recordingRunner(onStep?: (step: StepName) => void | Promise<void>): {
  runner: StepRunner;
  seen: Array<{ step: StepName; configDir: string | undefined }>;
} {
  const seen: Array<{ step: StepName; configDir: string | undefined }> = [];
  const runner: StepRunner = {
    selfHostRunId: () => 'self-host-wiring-run',
    run: vi.fn(async (step: StepName) => {
      seen.push({ step, configDir: process.env.CLAUDE_CONFIG_DIR });
      await onStep?.(step);
      return { success: true };
    }),
  };
  return { runner, seen };
}

function releaseDispositionConfig(): Record<string, unknown> {
  return {
    steps: {
      'release-disposition': {
        after: 'rebase',
        skill: '.agents/skills/release-disposition/SKILL.md',
        enforcement: 'gating',
        completion_artifact: '.pipeline/release-disposition-pass',
      },
    },
  };
}

function releaseDispositionRunner(projectRoot: string) {
  return recordingRunner(async (step) => {
    if ((step as string) === 'release-disposition') {
      await writeFile(join(projectRoot, '.pipeline/release-disposition-pass'), 'PASS\n', 'utf8');
    }
  });
}

describe('self-host wiring — default bundle members forward to the real primitives', () => {
  it('resolveInstalledHarnessRoot is exposed on the bundle and forwards to the real function', async () => {
    const { defaultSelfHostGuardrails } = await import('../../../src/engine/self-host/wiring.js');
    const { resolveInstalledHarnessRoot } = await import(
      '../../../src/engine/install-freshness.js'
    );
    expect(defaultSelfHostGuardrails.resolveInstalledHarnessRoot).toBe(
      resolveInstalledHarnessRoot,
    );
  });

  it('releaseGate is exposed on the production bundle and forwards to the real composed gate', async () => {
    const { defaultSelfHostGuardrails } = await import('../../../src/engine/self-host/wiring.js');
    expect(defaultSelfHostGuardrails.releaseGate).toBe(runReleaseArtifactGate);
  });

  it('exposes the candidate-aware provider-home seam without replacing the legacy sandbox seam', async () => {
    const { defaultSelfHostGuardrails } = await import('../../../src/engine/self-host/wiring.js');
    expect(typeof defaultSelfHostGuardrails.provisionProviderHome).toBe('function');
    expect(typeof defaultSelfHostGuardrails.provisionSandbox).toBe('function');
  });

  it('keeps Codex self-host setup out of the #904 skill and AGENTS.md surface', async () => {
    const conductorSrc = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      'src',
      'engine',
      'conductor.ts',
    );
    const text = await readFile(conductorSrc, 'utf-8');
    const start = text.indexOf('runSelfBuildDispatch');
    const end = text.indexOf(
      '  /** Apply the existing safety authority to the actual resolved provider. */',
    );

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(text.slice(start, end)).not.toMatch(/\.agents\/skills|AGENTS\.md|discover(?:ed)?Skills/i);
  });
});

describe('self-host Phase 6 — daemon-loop wiring', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;
  let priorConfigDir: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'selfhost-wiring-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    // Make the "original" env deterministic so no-bleed assertions are exact.
    priorConfigDir = process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  afterEach(async () => {
    if (priorConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = priorConfigDir;
    await rm(dir, { recursive: true, force: true });
  });

  function selfBuildConductor(
    guardrails: SelfHostGuardrails,
    runner: StepRunner,
    opts: {
      selfHost?: boolean;
      daemon?: boolean;
      config?: Record<string, unknown>;
      gh?: GhRunner;
      runGh?: GhRunner;
      git?: GitRunner;
    } = {},
  ): Conductor {
    const configuredSteps = (opts.config?.steps ?? {}) as Record<string, unknown>;
    const configuredSelfHost = (opts.config?.harness_self_host ?? {}) as Record<string, unknown>;
    const draftUrl = 'https://github.com/acme/harness/pull/7';
    const gh = opts.gh ?? (async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify({ url: draftUrl, state: 'OPEN' }) };
      }
      return { stdout: '' };
    });
    const runGh = opts.runGh ?? (async () => ({
      stdout: JSON.stringify({ body: 'Release-Disposition: no-note' }),
    }));
    const git = opts.git ?? (async (args: string[]) => ({
      stdout: args[0] === 'rev-list' ? '1\n' : '',
    }));
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: opts.daemon ?? true,
      selfHost: opts.selfHost ?? true,
      // These tests isolate self-host wiring. The fake runner is the success
      // authority, so artifact-driven gates must not keep the conductor in
      // unrelated BUILD/SHIP retries.
      verifyArtifacts: false,
      fullSuiteVerifier: {
        ensure: async () => ({ status: 'REUSED' as const, evidence: {} as never }),
        inspect: async () => ({ status: 'CURRENT' as const, evidence: {} as never }),
      },
      baseBranch: 'main',
      fromStep: 'build',
      selfHostGuardrails: guardrails,
      gh,
      git,
      runGh,
      escalateBuildFailure: NOOP_ESCALATION,
      config: {
        ...opts.config,
        harness_self_host: {
          build_auth: { mode: 'api-key' },
          ...configuredSelfHost,
        },
        steps: {
          manual_test: { disable: true },
          ...configuredSteps,
        },
      } as never,
    });
  }

  it('activates the whole bundle as one unit and scopes env to the build step only', async () => {
    await writeState(statePath, preBuildDoneState());
    const { guardrails, teardown } = makeGuardrails();
    const { runner, seen } = recordingRunner();

    const completed: string[] = [];
    events.on('feature_complete', (e) => {
      if (e.type === 'feature_complete') completed.push(e.type);
    });

    await selfBuildConductor(guardrails, runner).run();

    // Self-host provisioning never repoints the operator-global skill catalog.
    expect(guardrails.relink).not.toHaveBeenCalled();
    expect(guardrails.provisionSandbox).toHaveBeenCalledTimes(1);
    expect(guardrails.versionGate).toHaveBeenCalledTimes(1);
    expect(guardrails.releaseGate).toHaveBeenCalledTimes(1);


    // Env scoped to the build step ONLY — sandbox during build, original after.
    const build = seen.find((s) => s.step === 'build');
    const finish = seen.find((s) => s.step === 'finish');
    expect(build?.configDir).toBe(SANDBOX_DIR);
    expect(finish).toBeDefined();
    expect(finish?.configDir).toBeUndefined(); // no bleed to finish
    for (const s of seen) {
      if (s.step !== 'build') expect(s.configDir).toBeUndefined();
    }

    // Gates ran before finish dispatched.
    const gateOrder = (guardrails.versionGate as any).mock.invocationCallOrder[0];
    const finishRunOrder = (runner.run as any).mock.calls
      .map((c: unknown[], i: number) => ({ step: c[0], i }))
      .find((x: { step: StepName }) => x.step === 'finish');
    expect(gateOrder).toBeLessThan(
      (runner.run as any).mock.invocationCallOrder[finishRunOrder.i],
    );

    // Teardown + env restore + clean completion.
    expect(teardown).toHaveBeenCalled();
    expect(process.env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(completed).toEqual(['feature_complete']);
    expect(await exists(join(dir, '.pipeline/HALT'))).toBe(false);
  });

  it('empty [Unreleased] passes through the real release gate and dispatches finish', async () => {
    await writeState(statePath, preBuildDoneState());
    const releaseGate = vi.fn(async (opts: ReleaseGateOptions) =>
      runReleaseArtifactGate({
        ...opts,
        readText: async () => `## [Unreleased]\n\n## [0.99.18]\n- old\n`,
        changedFiles: async () => [
          { status: 'M', path: 'src/conductor/src/engine/self-host/release-gate.ts' },
        ],
        access: async () => {},
        exec: async () => ({ code: 0, timedOut: false }),
      }),
    );
    const { guardrails } = makeGuardrails({ releaseGate });
    const { runner, seen } = recordingRunner();

    await selfBuildConductor(guardrails, runner).run();

    expect(releaseGate).toHaveBeenCalledTimes(1);
    expect(seen.find((s) => s.step === 'finish')).toBeDefined();
    expect(await exists(join(dir, '.pipeline', 'HALT'))).toBe(false);
  });

  it('passes runnable migration metadata from the retained draft PR to releaseGate', async () => {
    await writeState(statePath, preBuildDoneState());
    const { guardrails } = makeGuardrails();
    const { runner } = releaseDispositionRunner(dir);
    const prUrl = 'https://github.com/acme/harness/pull/42';
    const metadataBody = [
      'Release-Disposition: note',
      'Release-Category: Changed',
      'Release-Semver: major',
      'Release-Note: Preserve the migration contract.',
      '',
      '## Migration',
      '',
      '```bash migration',
      './bin/install --update',
      '```',
    ].join('\n');
    const gh: GhRunner = async (args) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify({ url: prUrl, state: 'OPEN' }) };
      }
      return { stdout: '' };
    };
    const runGh: GhRunner = async (args) => {
      expect(args).toEqual(['pr', 'view', prUrl, '--json', 'body']);
      return { stdout: JSON.stringify({ body: metadataBody }) };
    };

    await selfBuildConductor(guardrails, runner, {
      gh,
      runGh,
      config: releaseDispositionConfig(),
    }).run();

    expect(guardrails.releaseGate).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseMetadata: expect.objectContaining({
          disposition: 'note',
          migration: '```bash migration\n./bin/install --update\n```',
        }),
      }),
    );
  });

  it.each([
    ['unreachable GitHub', async () => { throw new Error('offline'); }, /unreachable/i],
    ['unresolved draft identity', undefined, /draft PR identity/i],
    ['absent disposition', async () => ({ stdout: JSON.stringify({ body: 'ordinary draft text' }) }), /Disposition/],
    ['malformed disposition', async () => ({ stdout: JSON.stringify({ body: 'Release-Disposition: note' }) }), /Category/],
  ] as const)('HALTs before finish when release metadata has %s', async (_caseName, runGh, reason) => {
    await writeState(statePath, preBuildDoneState());
    const { guardrails } = makeGuardrails();
    const { runner, seen } = releaseDispositionRunner(dir);
    const gh: GhRunner = async (args) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        if (_caseName === 'unresolved draft identity') throw new Error('no PR');
        return { stdout: JSON.stringify({ url: 'https://github.com/acme/harness/pull/42', state: 'OPEN' }) };
      }
      return { stdout: '' };
    };

    await selfBuildConductor(guardrails, runner, {
      gh,
      runGh,
      config: releaseDispositionConfig(),
    }).run();

    expect(guardrails.releaseGate).not.toHaveBeenCalled();
    expect(seen.find((entry) => entry.step === 'finish')).toBeUndefined();
    expect(await readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).toMatch(reason);
  });

  it('selecting Codex skips Claude-only self-build preparation while preserving shared release gates', async () => {
    await writeState(statePath, preBuildDoneState());
    const { preflightBuildAuthCheck } = await import(
      '../../../src/engine/self-host/build-auth-preflight.js'
    );
    vi.mocked(preflightBuildAuthCheck).mockClear();
    const { guardrails, teardown } = makeGuardrails();
    const { runner, seen } = recordingRunner();

    await selfBuildConductor(guardrails, runner, {
      config: { steps: { build: { llm_provider: 'codex' } } },
    }).run();

    expect(guardrails.relink).not.toHaveBeenCalled();
    expect(preflightBuildAuthCheck).not.toHaveBeenCalled();
    expect(guardrails.provisionSandbox).not.toHaveBeenCalled();
    expect(teardown).not.toHaveBeenCalled();
    expect(seen.find((entry) => entry.step === 'build')?.configDir).toBeUndefined();
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(guardrails.versionGate).toHaveBeenCalledTimes(1);
    expect(guardrails.releaseGate).toHaveBeenCalledTimes(1);
    expect(seen.find((entry) => entry.step === 'build')).toBeDefined();
  });

  it('passes the INSTALLED root (not the detection root) to provisionSandbox (#363 / TR-4)', async () => {
    await writeState(statePath, preBuildDoneState());
    // Detection root ≠ installed root — the sandbox must get the INSTALLED one,
    // otherwise settings retargeting (main → worktree) is a silent no-op.
    const { guardrails } = makeGuardrails({
      resolveHarnessRoot: vi.fn(async () => '/detector/root'),
      resolveInstalledHarnessRoot: vi.fn(async () => ({
        status: 'ok' as const,
        root: '/installed/main',
      })),
    });
    const { runner } = recordingRunner();

    await selfBuildConductor(guardrails, runner).run();

    expect(guardrails.provisionSandbox).toHaveBeenCalledTimes(1);
    expect(guardrails.provisionSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ harnessRoot: '/installed/main', worktreeRoot: dir }),
    );
  });

  it('resolver unresolved → provisionSandbox falls back to projectRoot (unchanged behavior)', async () => {
    await writeState(statePath, preBuildDoneState());
    const { guardrails } = makeGuardrails({
      resolveHarnessRoot: vi.fn(async () => '/detector/root'),
      resolveInstalledHarnessRoot: vi.fn(async () => ({ status: 'unresolved' as const })),
    });
    const { runner } = recordingRunner();

    await selfBuildConductor(guardrails, runner).run();

    expect(guardrails.provisionSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ harnessRoot: dir, worktreeRoot: dir }),
    );
  });

  it('resolver rejected → provisionSandbox falls back to projectRoot (relink HALT covers the dangerous case upstream)', async () => {
    await writeState(statePath, preBuildDoneState());
    const { guardrails } = makeGuardrails({
      resolveHarnessRoot: vi.fn(async () => '/detector/root'),
      resolveInstalledHarnessRoot: vi.fn(async () => ({
        status: 'rejected' as const,
        reason: 'worktree-root',
        detail: 'resolved root /x/.worktrees/y still sits under .worktrees/',
      })),
    });
    const { runner } = recordingRunner();

    await selfBuildConductor(guardrails, runner).run();

    expect(guardrails.provisionSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ harnessRoot: dir, worktreeRoot: dir }),
    );
  });

  it('restores env and tears down the sandbox when the build throws mid-dispatch', async () => {
    await writeState(statePath, preBuildDoneState());
    const { guardrails, teardown } = makeGuardrails();

    let buildEnvAtThrow: string | undefined;
    const runner: StepRunner = {
      selfHostRunId: () => 'self-host-wiring-run',
      run: vi.fn(async (step: StepName) => {
        if (step === 'build') {
          buildEnvAtThrow = process.env.CLAUDE_CONFIG_DIR;
          throw new Error('boom mid-build');
        }
        return { success: true };
      }),
    };

    // maxRetries:1 → build throws once and the run HALTs.
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      selfHost: true,
      baseBranch: 'main',
      fromStep: 'build',
      maxRetries: 1,
      selfHostGuardrails: guardrails,
      escalateBuildFailure: NOOP_ESCALATION,
      config: { harness_self_host: { build_auth: { mode: 'api-key' } } },
    });

    await conductor.run();

    expect(guardrails.provisionSandbox).toHaveBeenCalledTimes(1);
    expect(buildEnvAtThrow).toBe(SANDBOX_DIR); // env WAS set during build
    expect(teardown).toHaveBeenCalled(); // torn down on the throw branch
    expect(process.env.CLAUDE_CONFIG_DIR).toBeUndefined(); // restored on throw
    expect(await exists(join(dir, '.pipeline/HALT'))).toBe(true);
  });

  it('does not invoke a failing global relink collaborator during a self-host build', async () => {
    await writeState(statePath, preBuildDoneState());
    const { guardrails, teardown } = makeGuardrails({
      relink: vi.fn(async () => {
        const { InstallStaleError } = await import(
          '../../../src/engine/install-freshness.js'
        );
        throw new InstallStaleError('skill relink failed for the harness self-build');
      }),
    });
    const { runner, seen } = recordingRunner();

    await selfBuildConductor(guardrails, runner).run();

    expect(guardrails.relink).not.toHaveBeenCalled();
    expect(guardrails.provisionSandbox).toHaveBeenCalledTimes(1);
    expect(seen.find((s) => s.step === 'build')).toBeDefined();
    expect(teardown).toHaveBeenCalled();
    expect(process.env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(await exists(join(dir, '.pipeline/HALT'))).toBe(false);
  });

  it('a failing finish gate parks the feature without dispatching finish', async () => {
    await writeState(statePath, preBuildDoneState());
    const reason = 'VERSION-bump approval required (self-host version gate)';
    const { guardrails } = makeGuardrails({
      versionGate: vi.fn(async () => ({ ok: false as const, reason })),
    });
    const { runner, seen } = recordingRunner();

    const halts: string[] = [];
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') halts.push(e.reason);
    });
    const completed: string[] = [];
    events.on('feature_complete', (e) => {
      if (e.type === 'feature_complete') completed.push(e.type);
    });

    await selfBuildConductor(guardrails, runner).run();

    expect(guardrails.versionGate).toHaveBeenCalledTimes(1);
    expect(guardrails.releaseGate).not.toHaveBeenCalled(); // short-circuits on first fail
    expect(seen.find((s) => s.step === 'finish')).toBeUndefined(); // finish NOT dispatched
    expect(halts.some((r) => r.includes('VERSION-bump approval required'))).toBe(true);
    expect(completed).toEqual([]); // never completed
  });

  it('a non-self-build activates NONE of the bundle and never touches env', async () => {
    await writeState(statePath, preBuildDoneState());
    const { guardrails, teardown } = makeGuardrails();
    const { runner, seen } = recordingRunner();

    const completed: string[] = [];
    events.on('feature_complete', (e) => {
      if (e.type === 'feature_complete') completed.push(e.type);
    });

    // daemon true but selfHost FALSE → isSelfBuild() is false.
    await selfBuildConductor(guardrails, runner, { selfHost: false }).run();

    expect(guardrails.relink).not.toHaveBeenCalled();
    expect(guardrails.provisionSandbox).not.toHaveBeenCalled();
    expect(guardrails.versionGate).not.toHaveBeenCalled();
    expect(guardrails.releaseGate).not.toHaveBeenCalled();
    expect(teardown).not.toHaveBeenCalled();
    for (const s of seen) expect(s.configDir).toBeUndefined();
    expect(completed).toEqual(['feature_complete']);
  });

  it('the sandbox toggle denies unsafe work before any global relink', async () => {
    await writeState(statePath, preBuildDoneState());
    const { guardrails, teardown } = makeGuardrails();
    const { runner, seen } = recordingRunner();

    await new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      selfHost: true,
      baseBranch: 'main',
      fromStep: 'build',
      selfHostGuardrails: guardrails,
      escalateBuildFailure: NOOP_ESCALATION,
      config: {
        harness_self_host: {
          sandbox_build_env: false,
          build_auth: { mode: 'api-key' },
        },
      },
    }).run();

    expect(guardrails.relink).not.toHaveBeenCalled();
    expect(guardrails.provisionSandbox).not.toHaveBeenCalled(); // sandbox skipped
    expect(teardown).not.toHaveBeenCalled();
    expect(seen.find((s) => s.step === 'build')?.configDir).toBeUndefined(); // env untouched
    expect(guardrails.versionGate).not.toHaveBeenCalled();
    expect(guardrails.releaseGate).not.toHaveBeenCalled();
  });
});

// ── TR-12 (structural, wired path): the daemon never merges ──────────────────
describe('self-host wired path — non-autonomy (TR-12, ADR-005/ADR-010)', () => {
  const MERGE_PATTERNS = [/pr\s+merge/i, /mergePull/i, /\bmerge_pull_request\b/i, /gh\b.*\bmerge\b/i];

  it('the conductor self-build methods reference no merge entry point', async () => {
    const conductorSrc = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      'src',
      'engine',
      'conductor.ts',
    );
    const text = await readFile(conductorSrc, 'utf-8');
    // Scope to the self-build region (helpers added in Phase 6).
    const start = text.indexOf('runSelfBuildDispatch');
    const end = text.indexOf(
      'async run(): Promise<OperatorParkedTermination | undefined>',
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const region = text.slice(start, end);
    for (const re of MERGE_PATTERNS) expect(re.test(region)).toBe(false);
  });
});
