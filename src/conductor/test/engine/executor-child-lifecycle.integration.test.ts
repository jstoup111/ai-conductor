// Covers: task:8, task:9, task:10, task:11, task:12, task:13, task:14
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupFailureError } from '../../src/engine/worktree-prepare.js';

const seams = vi.hoisted(() => ({
  prepareWorktree: vi.fn(),
  acquireFeatureDispatchLease: vi.fn(),
  resumeRebaseFirst: vi.fn(),
  stackPreflightCompleted: false,
  finishPublicationBaseBranches: [] as string[],
  ghCalls: [] as string[][],
  observeMemorySetup: vi.fn(),
}));

vi.mock('../../src/engine/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/config.js')>();
  return {
    ...actual,
    loadMergedConfig: async () => ({ ok: true as const, config: { llm_provider: 'codex' }, warnings: [] }),
  };
});

vi.mock('../../src/engine/provider-discovery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/provider-discovery.js')>();
  return {
    ...actual,
    discoverInstalledProviders: async () => ({ installed: ['codex'], missing: [] }),
  };
});

vi.mock('../../src/engine/provider-model-probe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/provider-model-probe.js')>();
  return {
    ...actual,
    validateConfiguredProviderModels: async () => {},
    resolveProviderModelTiers: async () => {},
  };
});

vi.mock('../../src/engine/worktree-prepare.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/worktree-prepare.js')>();
  return { ...actual, prepareWorktree: seams.prepareWorktree };
});

vi.mock('../../src/engine/memory-cli.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/memory-cli.js')>();
  return { ...actual, observeMemorySetup: seams.observeMemorySetup };
});

vi.mock('../../src/engine/feature-dispatch-lease.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/feature-dispatch-lease.js')>();
  return {
    ...actual,
    acquireFeatureDispatchLease: async (...args: Parameters<typeof actual.acquireFeatureDispatchLease>) => {
      seams.acquireFeatureDispatchLease(...args);
      return actual.acquireFeatureDispatchLease(...args);
    },
  };
});

vi.mock('../../src/engine/daemon-rekick.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/daemon-rekick.js')>();
  return {
    ...actual,
    resumeRebaseFirst: async (...args: Parameters<typeof actual.resumeRebaseFirst>) => {
      seams.resumeRebaseFirst(...args);
      return actual.resumeRebaseFirst(...args);
    },
  };
});

vi.mock('../../src/engine/restack/stack-preflight.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/restack/stack-preflight.js')>();
  return {
    ...actual,
    runStackPreflight: async (...args: Parameters<typeof actual.runStackPreflight>) => {
      const result = await actual.runStackPreflight(...args);
      seams.stackPreflightCompleted = true;
      return result;
    },
  };
});

vi.mock('../../src/engine/finish-publication-production.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/finish-publication-production.js')>();
  return {
    ...actual,
    createProductionFinishPublicationCoordinator: (...args: Parameters<typeof actual.createProductionFinishPublicationCoordinator>) => {
      seams.finishPublicationBaseBranches.push(args[0].baseBranch);
      return actual.createProductionFinishPublicationCoordinator(...args);
    },
  };
});

vi.mock('../../src/engine/tracker-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/tracker-client.js')>();
  return {
    ...actual,
    makeProductionGh: () => async (args: string[]) => {
      seams.ghCalls.push(args);
      if (args.join(' ') === 'api user --jq .login') return { stdout: 'jstoup111\n' };
      if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ body: 'Implementation summary.' }) };
      if (args[0] === 'pr' && args[1] === 'edit') return { stdout: '' };
      throw new Error(`unexpected gh invocation: ${args.join(' ')}`);
    },
  };
});

vi.mock('../../src/engine/pr-labels.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/pr-labels.js')>();
  return {
    ...actual,
    // Keep the provenance path real against this test's local repository;
    // only the GitHub transport is faked above.
    makeProductionGit: () => async (
      args: string[],
      opts: { cwd: string; credential?: 'operator' | 'write'; endpoint?: 'https' | 'ssh'; input?: string },
    ) => {
      const result = await execa('git', args, { cwd: opts.cwd, input: opts.input });
      return { exitCode: 0, stdout: result.stdout };
    },
  };
});

import { ALL_STEPS } from '../../src/engine/steps.js';
import { createChildProcessFeatureExecutor } from '../../src/engine/child-feature-executor.js';
import { Conductor } from '../../src/engine/conductor.js';
import { createExecutorBroker } from '../../src/engine/executor-broker.js';
import { ConductorEventEmitter } from '../../src/engine/conductor-event-emitter.js';
import { removeOperatorPark, writeOperatorPark } from '../../src/engine/park-marker.js';
import { createProviderAvailability } from '../../src/engine/provider-availability.js';
import { create as createRateLimitEpisode } from '../../src/engine/rate-limit-episode.js';
import { WorktreeLifecycleQueue } from '../../src/engine/worktree.js';
import type { WorkOrder } from '../../src/engine/work-order.js';
import { createInMemoryExecutorFork, useTempEngineStore } from '../fixtures/in-memory-executor-fork.js';
import { commitAll, initTestRepo } from '../fixtures/git-repo.js';
import { writeSliceTopologyFixture } from './slice-topology-fixture.js';

const roots: string[] = [];
let engineStore: Awaited<ReturnType<typeof useTempEngineStore>> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  seams.stackPreflightCompleted = false;
  seams.finishPublicationBaseBranches.length = 0;
  seams.ghCalls.length = 0;
  seams.observeMemorySetup.mockReset();
});

afterEach(async () => {
  await engineStore?.teardown();
  engineStore = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function completeConductorState(worktree: string, prUrl?: string): Promise<void> {
  await mkdir(join(worktree, '.pipeline'), { recursive: true });
  await writeFile(
    join(worktree, '.pipeline', 'conduct-state.json'),
    JSON.stringify({
      ...Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])),
      ...(prUrl === undefined ? {} : { pr_url: prUrl }),
    }),
  );
}

async function fixture(slug: string, { durableChildState = true }: { durableChildState?: boolean } = {}): Promise<{
  root: string;
  order: WorkOrder;
  rootEvents: ConductorEventEmitter;
  execute(): ReturnType<ReturnType<typeof createChildProcessFeatureExecutor>['execute']>;
}> {
  const root = await mkdtemp(join(tmpdir(), 'executor-child-lifecycle-'));
  roots.push(root);
  await initTestRepo(root);
  await writeFile(join(root, 'README.md'), 'base\n');
  await commitAll(root, 'initial');
  const baseSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  if (durableChildState) await mkdir(join(root, '.pipeline', 'children', 'first'), { recursive: true });
  engineStore = await useTempEngineStore();
  const rootEvents = new ConductorEventEmitter();
  const broker = createExecutorBroker({
    rateLimitEpisode: createRateLimitEpisode(),
    providerAvailability: createProviderAvailability({ now: () => Date.now() }),
    worktreeLifecycle: new WorktreeLifecycleQueue(),
    rootEvents,
    featureLogFor: () => () => {},
  });
  const order: WorkOrder = {
    schemaVersion: 1,
    repository: 'owner/repository',
    slug,
    baseSha,
    baseBranch: 'main',
    engineVersionId: '20261107T000000Z-0123456789ab' as WorkOrder['engineVersionId'],
    tier: 'S',
    track: 'technical',
    manifest: [],
  };
  const executor = createChildProcessFeatureExecutor({
    projectRoot: root,
    engineDirForOrder: () => engineStore!.engineRoot.ownEngineDir,
    supervisorEngineVersionId: order.engineVersionId,
    rootEvents,
    attachBroker: (feature, port, engineVersionId) => broker.attach(feature, port, engineVersionId),
    fork: createInMemoryExecutorFork({ projectRoot: root }),
    dispatchStartTimeoutMs: 100,
    teardownTimeoutMs: 1,
  });
  return { root, order, rootEvents, execute: () => executor.execute(order) };
}

async function prepareStackedRekick(subject: Awaited<ReturnType<typeof fixture>>): Promise<string> {
  const worktree = join(subject.root, '.worktrees', subject.order.slug);
  await mkdir(join(subject.root, '.worktrees'), { recursive: true });
  await execa('git', ['worktree', 'add', '-b', `feat/daemon-${subject.order.slug}`, worktree, subject.order.baseSha], {
    cwd: subject.root,
  });
  await mkdir(join(worktree, '.pipeline', 'children', '1'), { recursive: true });
  await writeFile(join(worktree, '.pipeline', 'REKICK'), '');
  await writeSliceTopologyFixture(worktree, {
    slug: subject.order.slug,
    sliceMembership: { taskSlices: { T1: 1, T2: 2 }, titles: ['First', 'Second'] },
    storyOwnership: { S1: 1, S2: 2 },
  });
  seams.prepareWorktree.mockResolvedValue(undefined);
  return worktree;
}

async function prepareRekick(subject: Awaited<ReturnType<typeof fixture>>): Promise<string> {
  const worktree = join(subject.root, '.worktrees', subject.order.slug);
  await mkdir(join(subject.root, '.worktrees'), { recursive: true });
  await execa('git', ['worktree', 'add', '-b', `feat/daemon-${subject.order.slug}`, worktree, subject.order.baseSha], {
    cwd: subject.root,
  });
  await mkdir(join(worktree, '.pipeline'), { recursive: true });
  await writeFile(join(worktree, '.pipeline', 'conduct-state.json'), JSON.stringify({ build: 'pending' }));
  await writeFile(join(worktree, '.pipeline', 'REKICK'), '');
  seams.prepareWorktree.mockResolvedValue(undefined);
  return worktree;
}

async function prepareIssueLinkProvenance(subject: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  await mkdir(join(subject.root, '.docs', 'intake'), { recursive: true });
  await writeFile(join(subject.root, '.docs', 'intake', `${subject.order.slug}.md`), 'Owner: jstoup111\n');
  await commitAll(subject.root, 'record intake ownership');
  subject.order.baseSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: subject.root })).stdout.trim();
  await execa('git', ['remote', 'add', 'origin', 'https://github.com/jstoup111/ai-conductor.git'], { cwd: subject.root });
  await execa('git', ['update-ref', 'refs/remotes/origin/main', subject.order.baseSha], { cwd: subject.root });
  await execa('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], { cwd: subject.root });
}

describe('executor child shared lifecycle', () => {
  it('uses its admitted stacked-dispatch lease once and runs the shared conductor', async () => {
    const subject = await fixture('stacked-child');
    const completions: string[] = [];
    subject.rootEvents.on('feature_complete', (event) => {
      if (event.type === 'feature_complete' && event.featureDesc !== undefined) completions.push(event.featureDesc);
    });
    seams.prepareWorktree.mockImplementation(async (worktree: string) => completeConductorState(worktree));

    const outcome = await subject.execute();

    expect(seams.acquireFeatureDispatchLease).toHaveBeenCalledTimes(1);
    expect(completions).toEqual([subject.order.slug]);
    expect(outcome).not.toMatchObject({ status: 'parked', reason: 'feature-lease-held' });
  });

  it('threads the daemon startup read-only review capability snapshot through the child lifecycle', async () => {
    const subject = await fixture('child-read-only-review-capability');
    const capabilities = Object.freeze({
      codex: { provider: 'codex', platform: process.platform, status: 'available' as const },
    });
    subject.order.readOnlyReviewCapabilities = capabilities;
    let observed: unknown;
    vi.spyOn(Conductor.prototype, 'run').mockImplementation(async function (this: Conductor) {
      observed = (this as unknown as { readOnlyReviewCapabilities?: unknown }).readOnlyReviewCapabilities;
    });

    await subject.execute();

    expect(observed).toBe(capabilities);
  });

  it('keeps ordinary setup and forced setup triage pinned to the order base', async () => {
    const subject = await fixture('pinned-base');
    const observedBaseShas: Array<string | undefined> = [];
    seams.prepareWorktree.mockImplementation(async (worktree: string, _log: unknown, options: { baseSha?: string; force?: boolean }) => {
      observedBaseShas.push(options.baseSha);
      if (!options.force) {
        await writeFile(join(worktree, 'README.md'), 'dirty setup state\n');
        throw new SetupFailureError('setup failed', 'setup failed');
      }
      await completeConductorState(worktree);
    });
    await writeFile(join(subject.root, 'advanced-base.txt'), 'B2\n');
    await commitAll(subject.root, 'advance configured base to B2');

    const outcome = await subject.execute();

    expect(outcome.status).not.toBe('parked');
    expect(observedBaseShas).toEqual([subject.order.baseSha, subject.order.baseSha]);
  });

  it('preserves REKICK and skips the conductor only while the claimed feature is operator-parked', async () => {
    const subject = await fixture('parked-rekick', { durableChildState: false });
    const worktree = join(subject.root, '.worktrees', subject.order.slug);
    await mkdir(join(subject.root, '.worktrees'), { recursive: true });
    await execa('git', ['worktree', 'add', '-b', `feat/daemon-${subject.order.slug}`, worktree, subject.order.baseSha], {
      cwd: subject.root,
    });
    const pipelineDir = join(worktree, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
    await writeFile(
      join(pipelineDir, 'conduct-state.json'),
      JSON.stringify({ build: 'pending' }),
    );
    const rekickPath = join(pipelineDir, 'REKICK');
    await writeFile(rekickPath, '');
    seams.prepareWorktree.mockResolvedValue(undefined);
    await writeOperatorPark(subject.root, subject.order.slug);
    const run = vi.spyOn(Conductor.prototype, 'run');
    run.mockResolvedValue(undefined);
    run.mockClear();

    const parked = await subject.execute();

    expect(parked).toMatchObject({ status: 'parked' });
    expect(run).not.toHaveBeenCalled();
    await expect(readFile(rekickPath, 'utf8')).resolves.toBe('');

    await removeOperatorPark(subject.root, subject.order.slug);
    const unparked = await subject.execute();

    expect(unparked.status).not.toBe('parked');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs stacked REKICK preflight before resumeRebaseFirst in the child lifecycle', async () => {
    const subject = await fixture('stacked-rekick-order');
    const worktree = await prepareStackedRekick(subject);
    const run = vi.spyOn(Conductor.prototype, 'run').mockResolvedValue(undefined);
    seams.resumeRebaseFirst.mockImplementation(() => {
      expect(seams.stackPreflightCompleted).toBe(true);
    });

    await subject.execute();

    expect(seams.resumeRebaseFirst).toHaveBeenCalledWith(expect.objectContaining({ worktreePath: worktree }));
    await expect(readFile(join(worktree, '.pipeline', 'REKICK'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('halts a refused stacked REKICK preflight with its detail before resumeRebaseFirst', async () => {
    const subject = await fixture('stacked-rekick-refusal');
    const worktree = await prepareStackedRekick(subject);
    await unlink(join(worktree, '.docs', 'plans', `${subject.order.slug}.md`));
    const run = vi.spyOn(Conductor.prototype, 'run').mockResolvedValue(undefined);

    const outcome = await subject.execute();

    const detail = 'cannot resolve stack cursor: plan-missing';
    expect(outcome).toMatchObject({ status: 'halted', reason: expect.stringContaining(detail) });
    await expect(readFile(join(worktree, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(detail);
    await expect(readFile(join(worktree, '.pipeline', 'REKICK'), 'utf8')).resolves.toBe('');
    expect(seams.resumeRebaseFirst).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(outcome.reason).not.toContain('loop ended without DONE or HALT marker');
  });

  it('runs rebase-first only for REKICK and consumes the marker before entering the conductor', async () => {
    const subject = await fixture('rekick-rebase-first', { durableChildState: false });
    const worktree = await prepareRekick(subject);
    const rekickPath = join(worktree, '.pipeline', 'REKICK');
    const run = vi.spyOn(Conductor.prototype, 'run').mockResolvedValue(undefined);

    await subject.execute();

    expect(seams.resumeRebaseFirst).toHaveBeenCalledWith(expect.objectContaining({ worktreePath: worktree }));
    expect(seams.resumeRebaseFirst.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]!);
    await expect(readFile(rekickPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    seams.resumeRebaseFirst.mockClear();
    run.mockClear();
    await subject.execute();

    expect(seams.resumeRebaseFirst).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rebases and targets finish publication at the order trunk base branch on REKICK', async () => {
    const subject = await fixture('trunk-rekick-publication', { durableChildState: false });
    subject.order.baseBranch = 'trunk';
    await execa('git', ['branch', 'trunk', subject.order.baseSha], { cwd: subject.root });
    await prepareRekick(subject);
    vi.spyOn(Conductor.prototype, 'run').mockResolvedValue(undefined);

    await subject.execute();

    expect(seams.resumeRebaseFirst).toHaveBeenCalledWith(expect.objectContaining({ localBase: 'trunk' }));
    expect(seams.finishPublicationBaseBranches).toEqual(['trunk']);
  });

  it('uses the origin default for REKICK rebase and finish publication when the order has no base branch', async () => {
    const subject = await fixture('origin-default-rekick-publication', { durableChildState: false });
    delete subject.order.baseBranch;
    await execa('git', ['branch', 'trunk', subject.order.baseSha], { cwd: subject.root });
    await execa('git', ['update-ref', 'refs/remotes/origin/trunk', subject.order.baseSha], { cwd: subject.root });
    await execa('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'], { cwd: subject.root });
    await prepareRekick(subject);
    vi.spyOn(Conductor.prototype, 'run').mockResolvedValue(undefined);

    await subject.execute();

    expect(seams.resumeRebaseFirst).toHaveBeenCalledWith(expect.objectContaining({ localBase: 'trunk' }));
    expect(seams.finishPublicationBaseBranches).toEqual(['trunk']);
  });

  it('adds the source issue Closes reference to the implementation PR', async () => {
    const subject = await fixture('source-ref-closes');
    subject.order.sourceRef = 'jstoup111/ai-conductor#42';
    await prepareIssueLinkProvenance(subject);
    seams.prepareWorktree.mockImplementation((worktree: string) => completeConductorState(
      worktree,
      'https://github.com/jstoup111/ai-conductor/pull/42',
    ));

    await subject.execute();

    expect(seams.ghCalls).toContainEqual([
      'pr', 'edit', '42', '-R', 'jstoup111/ai-conductor', '--body',
      'Implementation summary.\n\nCloses jstoup111/ai-conductor#42',
    ]);
  });

  it('does not edit the implementation PR body when the order has no source ref', async () => {
    const subject = await fixture('no-source-ref-closes');
    seams.prepareWorktree.mockImplementation((worktree: string) => completeConductorState(
      worktree,
      'https://github.com/jstoup111/ai-conductor/pull/42',
    ));

    await subject.execute();

    expect(seams.ghCalls.filter((args) => args[0] === 'pr' && args[1] === 'edit')).toEqual([]);
  });

  it('writes satisfied and unsatisfied gate verdicts to the child worktree audit trail', async () => {
    const subject = await fixture('child-gate-audit');
    vi.spyOn(Conductor.prototype, 'run').mockImplementation(async function (this: Conductor) {
      const events = (this as unknown as { events: ConductorEventEmitter }).events;
      await events.emit({ type: 'gate_verdict', step: 'plan', satisfied: true, reason: 'plan accepted' });
      await events.emit({ type: 'gate_verdict', step: 'stories', satisfied: false, reason: 'story rejected' });
    });

    await subject.execute();

    const worktreeAuditPath = join(
      subject.root,
      '.worktrees',
      subject.order.slug,
      '.pipeline',
      'audit-trail',
      'events.jsonl',
    );
    const records = (await readFile(worktreeAuditPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { origin: string; event: string; reason?: string });

    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ origin: 'plan', event: 'gate_pass', reason: 'plan accepted' }),
      expect.objectContaining({ origin: 'stories', event: 'gate_fail', reason: 'story rejected' }),
    ]));
    await expect(readFile(join(subject.root, '.pipeline', 'audit-trail', 'events.jsonl'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('prepares memory on the child feature bus and persists its event in the worktree ledger', async () => {
    const subject = await fixture('child-memory-setup');
    seams.observeMemorySetup.mockImplementation(async (_path: string, events: ConductorEventEmitter) => {
      await events.emit({ type: 'memory_setup', before: 'absent', canonical: true });
    });
    seams.prepareWorktree.mockImplementation((worktree: string) => completeConductorState(worktree));

    await subject.execute();

    expect(seams.observeMemorySetup).toHaveBeenCalledWith(
      join(subject.root, '.worktrees', subject.order.slug),
      expect.any(ConductorEventEmitter),
    );
    const ledger = await readFile(join(subject.root, '.worktrees', subject.order.slug, '.pipeline', 'events.jsonl'), 'utf8');
    expect(ledger).toContain('"type":"memory_setup"');
  });
});
