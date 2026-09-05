// Covers: S1.1, S4.1, S4.2, task:6, task:14
/**
 * Acceptance RED for #1346. The real daemon feature runner enters setup
 * triage over a real local Git repository. Only the provider/fix callback and
 * forced setup callback are injected; no external provider or setup process
 * is invoked.
 *
 * Pre-implementation RED reason: fixSession quarantines every successful
 * uncommitted repair and parks, so the normal conductor continuation is not
 * reached and no setup_repair event is persisted or rendered.
 */

import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderDaemonEvent } from '../../src/daemon-cli.js';
import {
  makeRunFeature,
  type FeatureRunnerDeps,
} from '../../src/engine/daemon-runner.js';
import { startFeatureEventPersistence } from '../../src/engine/event-persister.js';
import type { ProviderExecutionContext } from '../../src/engine/provider-execution.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import {
  fixSession,
  runSetupFailureTriage,
  type GitRunner,
  type TriageOutcome,
} from '../../src/engine/setup-triage.js';
import { SetupFailureError } from '../../src/engine/worktree-prepare.js';
import type { BacklogItem } from '../../src/engine/daemon.js';
import type { ConductorEvent } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const SLUG = 'bin-setup-repair-converges';

type FutureFixSession = (
  git: GitRunner,
  worktreePath: string,
  slug: string,
  dispatchFixSession: () => Promise<void>,
  runPrepare: (worktreePath: string) => Promise<void>,
  events?: ConductorEventEmitter,
) => Promise<TriageOutcome>;

describe('acceptance: setup fix-session repairs converge (#1346)', () => {
  let root: string;

  const git = async (...args: string[]): Promise<string> => {
    const { stdout } = await execFile('git', ['-C', root, ...args]);
    return stdout.trim();
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'setup-repair-acceptance-'));
    await execFile('git', ['init', '-q', '-b', 'main', root]);
    await git('config', 'user.email', 'acceptance@example.com');
    await git('config', 'user.name', 'Acceptance Test');
    await git('config', 'commit.gpgsign', 'false');
    await writeFile(join(root, '.gitignore'), '.pipeline/\n.daemon/\n', 'utf8');
    await writeFile(join(root, 'tracked.txt'), 'before\n', 'utf8');
    await git('add', '-A');
    await git('commit', '-q', '-m', 'initial fixture');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('emits no setup repair record for ordinary setup or stage-1-only recovery', async () => {
    for (const scenario of ['ordinary setup', 'stage-1-only recovery'] as const) {
      const globalEvents = new ConductorEventEmitter();
      const persistence = startFeatureEventPersistence(root, globalEvents);
      const rendered: string[] = [];
      const setupRepairType = 'setup_repair' as ConductorEvent['type'];
      persistence.events.on(setupRepairType, (event) => {
        renderDaemonEvent(event, (line) => rendered.push(line));
      });
      let conductorCalls = 0;
      let prepareCalls = 0;
      let fixSessionDispatches = 0;
      const runSetupTriage = vi.fn<NonNullable<FeatureRunnerDeps['runSetupTriage']>>(
        async (error, worktree, item, _providerExecution, _log, events) => runSetupFailureTriage(
          makeGitRunner(worktree.path),
          worktree.path,
          item.slug,
          error,
          async () => { prepareCalls += 1; },
          async () => { fixSessionDispatches += 1; },
          { log: () => {} },
          events,
        ),
      );
      const deps: FeatureRunnerDeps = {
        createWorktree: async () => ({ path: root, branch: `feat/${SLUG}` }),
        beginFeatureRun: async () => ({
          events: persistence.events,
          providerExecution: {} as ProviderExecutionContext,
          stop: persistence.stop,
        }),
        prepareWorktree: async () => {
          prepareCalls += 1;
          if (scenario === 'stage-1-only recovery') {
            await writeFile(join(root, 'tracked.txt'), 'stage-one residue\n', 'utf8');
            throw new SetupFailureError('setup failed', 'fixture compile failure');
          }
        },
        runSetupTriage,
        runConductor: async () => { conductorCalls += 1; },
        readOutcome: async () => ({ done: false, halted: false }),
        teardownWorktree: async () => {},
        markProcessed: async () => {},
        daemon: true,
        project: 'acceptance-project',
        projectRoot: root,
      };

      await makeRunFeature(deps)({ slug: SLUG } as BacklogItem);

      const eventText = await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8').catch(() => '');
      const setupRepairs = eventText
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { type: string })
        .filter((event) => event.type === 'setup_repair');
      expect(setupRepairs, scenario).toHaveLength(0);
      expect(rendered.filter((line) => line.includes('setup repair')), scenario).toHaveLength(0);
      expect(conductorCalls, scenario).toBe(1);
      expect(prepareCalls, scenario).toBe(scenario === 'ordinary setup' ? 1 : 2);
      expect(fixSessionDispatches, scenario).toBe(0);
      expect(runSetupTriage, scenario).toHaveBeenCalledTimes(scenario === 'ordinary setup' ? 0 : 1);
      if (scenario === 'stage-1-only recovery') {
        expect(runSetupTriage.mock.calls[0]?.[5]).toBe(persistence.events);
      }
    }
  });

  it('commits one setup-stable repair, continues dispatch, and records one engine-committed disposition', async () => {
    const originalHead = await git('rev-parse', 'HEAD');
    const globalEvents = new ConductorEventEmitter();
    const persistence = startFeatureEventPersistence(root, globalEvents);
    const rendered: string[] = [];
    const setupRepairType = 'setup_repair' as ConductorEvent['type'];
    persistence.events.on(setupRepairType, (event) => {
      renderDaemonEvent(event, (line) => rendered.push(line));
    });

    let fixCalls = 0;
    let forcedPrepareCalls = 0;
    let conductorCalls = 0;
    const runSetupTriage: NonNullable<FeatureRunnerDeps['runSetupTriage']> = async (
      _error,
      worktree,
      item,
      _providerExecution,
      _log,
      events,
    ) => (fixSession as unknown as FutureFixSession)(
      makeGitRunner(worktree.path),
      worktree.path,
      item.slug,
      async () => {
        fixCalls += 1;
        await writeFile(join(root, 'tracked.txt'), 'after\n', 'utf8');
        await writeFile(join(root, 'untracked.txt'), 'new\n', 'utf8');
      },
      async () => {
        forcedPrepareCalls += 1;
      },
      events,
    );

    const deps: FeatureRunnerDeps = {
      createWorktree: async () => ({ path: root, branch: `feat/${SLUG}` }),
      beginFeatureRun: async () => ({
        events: persistence.events,
        providerExecution: {} as ProviderExecutionContext,
        stop: persistence.stop,
      }),
      prepareWorktree: async () => {
        throw new SetupFailureError('setup failed', 'fixture compile failure');
      },
      runSetupTriage,
      runConductor: async () => {
        conductorCalls += 1;
        throw new Error('acceptance continuation sentinel');
      },
      readOutcome: async () => ({ done: false, halted: false }),
      teardownWorktree: async () => {},
      markProcessed: async () => {},
      daemon: true,
      project: 'acceptance-project',
      projectRoot: root,
    };

    await makeRunFeature(deps)({ slug: SLUG } as BacklogItem);

    expect(conductorCalls, 'verified repair must reach normal conductor dispatch').toBe(1);
    expect(fixCalls).toBe(1);
    expect(forcedPrepareCalls).toBe(1);
    expect(await git('rev-parse', 'HEAD^')).toBe(originalHead);
    expect(await git('show', 'HEAD:tracked.txt')).toBe('after');
    expect(await git('show', 'HEAD:untracked.txt')).toBe('new');
    expect(await git('status', '--porcelain')).toBe('');

    const persisted = (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; disposition?: string })
      .filter((event) => event.type === 'setup_repair');
    expect(persisted).toEqual([
      expect.objectContaining({ type: 'setup_repair', disposition: 'engine-committed' }),
    ]);
    expect(rendered.filter((line) => line.includes('engine-committed'))).toHaveLength(1);
  });

  it('proves no repair state was produced when the provider throws before touching the tree', async () => {
    const originalHead = await git('rev-parse', 'HEAD');
    const originalTree = await git('rev-parse', 'HEAD^{tree}');
    let fixCalls = 0;
    let conductorCalls = 0;
    let triageOutcome: TriageOutcome | undefined;

    const runSetupTriage: NonNullable<FeatureRunnerDeps['runSetupTriage']> = async (
      _error,
      worktree,
      item,
      _providerExecution,
      _log,
      events,
    ) => {
      triageOutcome = await fixSession(
        makeGitRunner(worktree.path),
        worktree.path,
        item.slug,
        async () => {
          fixCalls += 1;
          throw new Error('provider unavailable before repair');
        },
        async () => {
          throw new Error('forced setup must not run after provider failure');
        },
        events,
      );
      return triageOutcome;
    };

    const deps: FeatureRunnerDeps = {
      createWorktree: async () => ({ path: root, branch: `feat/${SLUG}` }),
      prepareWorktree: async () => {
        throw new SetupFailureError('setup failed', 'fixture compile failure');
      },
      runSetupTriage,
      runConductor: async () => {
        conductorCalls += 1;
      },
      readOutcome: async () => ({ done: false, halted: false }),
      teardownWorktree: async () => {},
      markProcessed: async () => {},
      daemon: true,
      project: 'acceptance-project',
      projectRoot: root,
    };

    const result = await makeRunFeature(deps)({ slug: SLUG } as BacklogItem);

    expect(result.status).toBe('error');
    expect(fixCalls).toBe(1);
    expect(conductorCalls).toBe(0);
    expect(triageOutcome).toMatchObject({
      kind: 'park',
      contractOutcome: 'provider-failure',
      treeUnchangedSinceDispatch: { before: originalTree, after: originalTree },
    });
    expect(await git('rev-parse', 'HEAD')).toBe(originalHead);
    expect(await git('rev-parse', 'HEAD^{tree}')).toBe(originalTree);
    expect(await git('status', '--porcelain')).toBe('');
    expect(await git('branch', '--list', `wip/setup-quarantine-${SLUG}`)).toBe('');

    const halt = await readFile(join(root, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('provider unavailable before repair');
    expect(halt).toContain('No repair state was preserved because none was produced');
    expect(halt).not.toContain('No quarantine ref exists (clean-HEAD case)');
  });

  it('keeps an unpreserved repair in the worktree and names the preservation failure', async () => {
    const quarantineRef = `wip/setup-quarantine-${SLUG}`;
    const occupiedWorktree = await mkdtemp(join(tmpdir(), 'setup-repair-occupied-ref-'));
    await rm(occupiedWorktree, { recursive: true, force: true });
    await git('branch', quarantineRef);
    await git('worktree', 'add', '-q', occupiedWorktree, quarantineRef);
    try {
      const deps: FeatureRunnerDeps = {
        createWorktree: async () => ({ path: root, branch: `feat/${SLUG}` }),
        prepareWorktree: async () => {
          throw new SetupFailureError('setup failed', 'fixture compile failure');
        },
        runSetupTriage: async (_error, worktree, item, _providerExecution, _log, events) => fixSession(
          makeGitRunner(worktree.path),
          worktree.path,
          item.slug,
          async () => {
            await writeFile(join(root, 'rejected-repair.txt'), 'still present\n', 'utf8');
          },
          async () => {
            throw new Error('forced setup still fails');
          },
          events,
        ),
        runConductor: async () => {
          throw new Error('must remain parked');
        },
        readOutcome: async () => ({ done: false, halted: false }),
        teardownWorktree: async () => {},
        markProcessed: async () => {},
        daemon: true,
        project: 'acceptance-project',
        projectRoot: root,
      };

      const result = await makeRunFeature(deps)({ slug: SLUG } as BacklogItem);

      expect(result.status).toBe('error');
      expect(await readFile(join(root, 'rejected-repair.txt'), 'utf8')).toBe('still present\n');
      const halt = await readFile(join(root, '.pipeline', 'HALT'), 'utf8');
      expect(halt).toContain('preserving the attempted repair failed');
      expect(halt).toContain(`cannot force update the branch '${quarantineRef}'`);
      expect(halt).toContain('Contract outcome: preservation-failed');
      expect(halt).not.toContain('No quarantine ref exists (clean-HEAD case)');
    } finally {
      await git('worktree', 'remove', '--force', occupiedWorktree);
      await rm(occupiedWorktree, { recursive: true, force: true });
    }
  });
});
