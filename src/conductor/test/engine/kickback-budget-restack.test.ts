// Covers: task:rem-prd-audit-rem-prd-audit-R27
// Covers: task:rem-prd-audit-rem-prd-audit-R26
// Covers: task:31.2
// Covers: task:rem-prd-audit-rem-prd-audit-R25
// Covers: task:6
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { detectKickbackBudgetCommand } from '../../src/cli.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { sealSliceTopologyPositions, writeSliceTopologyFixture } from './slice-topology-fixture.js';
import { dispatchKickbackBudgetCommand } from '../../src/engine/kickback-budget-cli.js';
import { appendCloseoutEvent } from '../../src/engine/closeout-events.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import {
  cascadeUpdateLines,
  cascadesRefFor,
  readCascadeCounts,
  updateCascadeLimit,
} from '../../src/engine/restack/cascade-cap.js';
import { runRestack } from '../../src/engine/restack/restack-executor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repos: string[] = [];
const envelopeFilesystem = {
  readFile: (path: string) => readFile(path, 'utf8'),
  mkdir: (path: string) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path: string, contents: string) => writeFile(path, contents, 'utf8'),
  rename,
};

function child(value: number) {
  const parsed = parseChildId(value);
  if (parsed === undefined) throw new Error('invalid child fixture');
  return parsed;
}

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'kickback-budget-restack-'));
  repos.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  await git(['init', '-q', '-b', 'main']);
  const update = await cascadeUpdateLines(repo, 'demo', [child(1)], { git: makeGitRunner(repo) });
  if (update.kind !== 'lines') throw new Error(update.detail);
  await makeGitRunner(repo)(['update-ref', '--stdin'], { input: ['start', ...update.lines, 'prepare', 'commit', ''].join('\n') });
  return repo;
}

async function realCascadeCapCliFixture(options: { tier?: 'M' | 'L'; charged?: number; originatingChild?: 1 | 2 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kickback-budget-restack-cli-'));
  repos.push(root);
  const repo = join(root, '.worktrees', 'demo');
  const childWorktree = join(root, '.worktrees', 'c1');
  const git = (args: string[], cwd = root) => execFile('git', args, { cwd });
  const commit = async (message: string, path: string) => {
    await writeFile(join(childWorktree, path), `${message}\n`);
    await git(['add', path], childWorktree);
    await git(['commit', '-qm', message], childWorktree);
    return (await git(['rev-parse', 'HEAD'], childWorktree)).stdout.trim();
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'cascade@example.test']);
  await git(['config', 'user.name', 'Cascade cap']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await writeFile(join(root, '.ai-conductor', 'config.yml'), [
    'stacked_prs:', '  enabled: true', '  route_whole_feature_fixes: true', '',
  ].join('\n'));
  await writeSliceTopologyFixture(root, {
    version: 1,
    slug: 'demo',
    runId: 'run-1',
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['Child 1', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2 },
    materializeTopologyCommit: true,
  }, envelopeFilesystem);
  await git(['worktree', 'add', '-qb', 'feat/c1/demo', childWorktree, 'main']);
  const closed = await commit('closed child', 'child.txt');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closed]);
  await commit('repair child', 'repair.txt');
  await git(['branch', 'feat/daemon-demo', closed]);
  await git(['worktree', 'add', '-q', repo, 'feat/daemon-demo']);
  await mkdir(join(repo, '.pipeline', 'children', '2'), { recursive: true });
  await sealSliceTopologyPositions(repo, {
    slug: 'demo',
    sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['Child 1', 'Leaf'] },
  });
  if (options.tier !== undefined) {
    await writeFile(join(repo, '.pipeline', 'conduct-state.json'), JSON.stringify({ complexity_tier: options.tier }));
  }
  const originatingChild = options.originatingChild ?? 1;
  const blob = (await makeGitRunner(repo)(
    ['hash-object', '-w', '--stdin'],
    { input: JSON.stringify({ version: 1, counts: { [originatingChild]: options.charged ?? 3 } }) },
  )).stdout.trim();
  await git(['update-ref', cascadesRefFor('demo'), blob]);
  return { root, repo };
}

afterEach(async () => { await Promise.all(repos.splice(0).map((repo) => rm(repo, { recursive: true, force: true }))); });

describe('restack kickback budget storage', () => {
  it('accepts the explicit restack child recovery command', () => {
    expect(detectKickbackBudgetCommand([
      'node', 'conduct', 'kickback-budget', 'raise', '--feature', 'demo', '--gate', 'restack',
      '--child', '1', '--by', '2', '--rationale', 'repair the stopped cascade',
    ])).toMatchObject({ action: 'raise', gate: 'restack', child: '1', by: 2 });
  });

  it('raises only the selected child limit and refuses a stale CAS', async () => {
    const repo = await fixture();
    const before = await readCascadeCounts(repo, 'demo');
    expect(before.kind).toBe('counts');
    if (before.kind !== 'counts') return;

    await expect(updateCascadeLimit(repo, 'demo', child(1), before.blob, (state) => ({
      version: 1,
      counts: state.counts,
      limits: { ...(state.limits ?? {}), 1: 5 },
    }))).resolves.toMatchObject({ kind: 'updated', counts: { counts: { 1: 1 }, limits: { 1: 5 } } });
    await expect(updateCascadeLimit(repo, 'demo', child(1), before.blob, (state) => ({
      version: 1,
      counts: state.counts,
      limits: { ...(state.limits ?? {}), 1: 7 },
    }))).resolves.toEqual({ kind: 'stale' });
    await expect(readCascadeCounts(repo, 'demo')).resolves.toMatchObject({ kind: 'counts', counts: { counts: { 1: 1 }, limits: { 1: 5 } } });
  });

  it('resets only the selected cascade count while preserving its raised limit', async () => {
    const repo = await fixture();
    const before = await readCascadeCounts(repo, 'demo');
    if (before.kind !== 'counts') throw new Error('unreadable fixture');
    await updateCascadeLimit(repo, 'demo', child(1), before.blob, (state) => ({
      version: 1,
      counts: { ...state.counts, 1: 0 },
      limits: { ...(state.limits ?? {}), 1: 5 },
    }));
    await expect(readCascadeCounts(repo, 'demo')).resolves.toMatchObject({
      kind: 'counts', counts: { counts: { 1: 0 }, limits: { 1: 5 } },
    });
  });

  it('raises the originating child cascade budget from a real cascade-cap halt', async () => {
    const subject = await realCascadeCapCliFixture();

    await expect(runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'feature-repair',
      git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'halted' });
    await mkdir(join(subject.repo, '.ai-conductor'), { recursive: true });
    await writeFile(join(subject.repo, '.ai-conductor', 'config.yml'), [
      'stacked_prs:', '  enabled: true', '  route_whole_feature_fixes: true', '',
    ].join('\n'));
    const marker = (await makeGitRunner(subject.repo)(['hash-object', '-w', '--stdin'], {
      input: JSON.stringify({ host: 1, roundId: 'r1' }),
    })).stdout.trim();
    await makeGitRunner(subject.repo)(['update-ref', 'refs/conductor/demo/repairing', marker]);

    expect(await dispatchKickbackBudgetCommand(
      {
        kind: 'kickback-budget',
        action: 'raise',
        feature: 'demo',
        gate: 'restack',
        child: '1',
        by: 2,
        rationale: 'repair the stopped cascade',
        format: 'human',
      },
      {
        cwd: subject.root,
        resolveMainRoot: async () => subject.root,
        isInteractive: () => true,
        resolveOperator: () => 'operator',
        print: () => {},
      },
    )).toBe(0);

    await expect(readCascadeCounts(subject.repo, 'demo')).resolves.toMatchObject({
      kind: 'counts',
      counts: { counts: { 1: 3 }, limits: { 1: 5 } },
    });
    await expect(readKickbackLedger(subject.repo, child(2))).resolves.toMatchObject({
      gates: {
        restack: {
          adjustments: [{ beforeConsumed: 3, afterConsumed: 3 }],
          resumeAuthorization: { consumed: false },
        },
      },
    });
    await expect(readKickbackLedger(subject.repo, child(1))).resolves.not.toMatchObject({
      gates: { restack: expect.anything() },
    });
  });

  it('uses the tier-L allowance for a raise from a real cascade-cap halt', async () => {
    const subject = await realCascadeCapCliFixture({ tier: 'L', charged: 8 });
    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'halted' });

    const events: unknown[] = [];
    expect(await dispatchKickbackBudgetCommand({
      kind: 'kickback-budget', action: 'raise', feature: 'demo', gate: 'restack', child: '1', by: 2,
      rationale: 'raise the tier L stopped cascade', format: 'human',
    }, {
      cwd: subject.root, resolveMainRoot: async () => subject.root, isInteractive: () => true,
      resolveOperator: () => 'operator', print: () => {}, appendEvent: (_worktree, event) => { events.push(event); },
    })).toBe(0);

    expect(events).toContainEqual(expect.objectContaining({
      type: 'kickback_budget_adjustment_authorized', beforeLimit: 8, afterLimit: 10,
    }));
    await expect(readCascadeCounts(subject.repo, 'demo')).resolves.toMatchObject({
      kind: 'counts', counts: { counts: { 1: 8 }, limits: { 1: 10 } },
    });

    await rm(join(subject.repo, '.pipeline', 'HALT'), { force: true });
    await rm(join(subject.repo, '.pipeline', 'HALT.class'), { force: true });
    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'applied' });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    const exhausted = await realCascadeCapCliFixture({ tier: 'L', charged: 10 });
    const exhaustedBlob = (await makeGitRunner(exhausted.repo)(['hash-object', '-w', '--stdin'], {
      input: JSON.stringify({ version: 1, counts: { 1: 10 }, limits: { 1: 10 } }),
    })).stdout.trim();
    await makeGitRunner(exhausted.repo)(['update-ref', cascadesRefFor('demo'), exhaustedBlob]);
    await expect(runRestack({
      worktree: exhausted.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(exhausted.repo),
    })).resolves.toMatchObject({ kind: 'halted' });
    await expect(readFile(join(exhausted.repo, '.pipeline', 'HALT'), 'utf8')).resolves
      .toContain('originating child 1 reached 10/10 cascades');

    const lowered = await realCascadeCapCliFixture({ tier: 'L', charged: 5 });
    const loweredBlob = (await makeGitRunner(lowered.repo)(['hash-object', '-w', '--stdin'], {
      input: JSON.stringify({ version: 1, counts: { 1: 5 }, limits: { 1: 5 } }),
    })).stdout.trim();
    await makeGitRunner(lowered.repo)(['update-ref', cascadesRefFor('demo'), loweredBlob]);
    const loweredEvents: Array<{ type: string; reason?: string; child?: number }> = [];
    const loweredEmitter = new ConductorEventEmitter();
    loweredEmitter.on('restack_refused', (event) => { loweredEvents.push(event); });
    await expect(runRestack({
      worktree: lowered.repo, slug: 'demo', cause: 'feature-repair', events: loweredEmitter, git: makeGitRunner(lowered.repo),
    })).resolves.toMatchObject({ kind: 'halted' });
    expect(loweredEvents).toMatchObject([{ type: 'restack_refused', reason: 'cascade-cap', child: 1 }]);
    await expect(readFile(join(lowered.repo, '.pipeline', 'HALT'), 'utf8')).resolves
      .toContain('originating child 1 reached 5/5 cascades');
  });

  it('refuses a restack raise when the tier allowance changed after the cap halt', async () => {
    const subject = await realCascadeCapCliFixture({ tier: 'M', charged: 3 });
    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'halted' });
    const before = await readCascadeCounts(subject.repo, 'demo');
    if (before.kind !== 'counts') throw new Error('unreadable cascades');
    await writeFile(join(subject.root, '.ai-conductor', 'config.yml'), [
      'stacked_prs:', '  enabled: true', '  route_whole_feature_fixes: true', '  max_restack_cascades:', '    M: 4', '',
    ].join('\n'));

    const printed: string[] = [];
    expect(await dispatchKickbackBudgetCommand({
      kind: 'kickback-budget', action: 'raise', feature: 'demo', gate: 'restack', child: '1', by: 1,
      rationale: 'recover only with current cap evidence', format: 'human',
    }, {
      cwd: subject.root, resolveMainRoot: async () => subject.root, isInteractive: () => true,
      resolveOperator: () => 'operator', print: (message) => { printed.push(message); },
    })).toBe(1);
    expect(printed.join('\n')).toContain('current cap evidence is missing or no longer matches the live halt');
    const after = await readCascadeCounts(subject.repo, 'demo');
    expect(after).toMatchObject({ kind: 'counts', blob: before.blob });
  });

  it('reconciles an authorized tier-L restack raise through inspect exactly once', async () => {
    const subject = await realCascadeCapCliFixture({ tier: 'L', charged: 8 });
    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'halted' });
    const before = await readCascadeCounts(subject.repo, 'demo');
    if (before.kind !== 'counts') throw new Error('unreadable cascades');
    const crashingAppend = (worktree: string, event: Parameters<typeof appendCloseoutEvent>[1]) => {
      appendCloseoutEvent(worktree, event);
      throw new Error('simulated crash after the authorization event');
    };

    expect(await dispatchKickbackBudgetCommand({
      kind: 'kickback-budget', action: 'raise', feature: 'demo', gate: 'restack', child: '1', by: 2,
      rationale: 'raise the tier L stopped cascade', format: 'human',
    }, {
      cwd: subject.root, resolveMainRoot: async () => subject.root, isInteractive: () => true,
      resolveOperator: () => 'operator', print: () => {}, appendEvent: crashingAppend,
    })).toBe(1);
    await expect(readCascadeCounts(subject.repo, 'demo')).resolves.toMatchObject({ kind: 'counts', blob: before.blob });

    const inspect = () => dispatchKickbackBudgetCommand({
      kind: 'kickback-budget', action: 'inspect', feature: 'demo', format: 'human',
    }, { cwd: subject.root, resolveMainRoot: async () => subject.root, print: () => {} });
    expect(await inspect()).toBe(0);
    const first = await readCascadeCounts(subject.repo, 'demo');
    expect(first).toMatchObject({ kind: 'counts', counts: { counts: { 1: 8 }, limits: { 1: 10 } } });
    if (first.kind !== 'counts') throw new Error('unreadable reconciled cascades');

    expect(await inspect()).toBe(0);
    await expect(readCascadeCounts(subject.repo, 'demo')).resolves.toMatchObject({ kind: 'counts', blob: first.blob });
  });

  it('resets the originating child cascade budget from a real cascade-cap halt', async () => {
    const subject = await realCascadeCapCliFixture({ tier: 'M', originatingChild: 2 });

    await expect(runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'feature-repair',
      originatingChildren: [child(2)],
      git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'halted' });

    expect(await dispatchKickbackBudgetCommand(
      {
        kind: 'kickback-budget',
        action: 'reset',
        feature: 'demo',
        gate: 'restack',
        child: '2',
        rationale: 'reset the stopped cascade',
        format: 'human',
      },
      {
        cwd: subject.root,
        resolveMainRoot: async () => subject.root,
        isInteractive: () => true,
        resolveOperator: () => 'operator',
        print: () => {},
      },
    )).toBe(0);

    await expect(readCascadeCounts(subject.repo, 'demo')).resolves.toMatchObject({
      kind: 'counts',
      counts: { counts: { 2: 0 } },
    });
    await expect(readKickbackLedger(subject.repo, child(2))).resolves.toMatchObject({
      gates: {
        restack: {
          adjustments: [{ beforeConsumed: 3, afterConsumed: 0 }],
          resumeAuthorization: { consumed: false },
        },
      },
    });
  });

  it('raises a second originating child after an earlier raise for a different child (#3475)', async () => {
    const subject = await realCascadeCapCliFixture();
    const raise = async (originating: string) => {
      const printed: string[] = [];
      const code = await dispatchKickbackBudgetCommand(
        {
          kind: 'kickback-budget', action: 'raise', feature: 'demo', gate: 'restack',
          child: originating, by: 1, rationale: `repair the stopped cascade from child ${originating}`, format: 'human',
        },
        {
          cwd: subject.root,
          resolveMainRoot: async () => subject.root,
          isInteractive: () => true,
          resolveOperator: () => 'operator',
          print: (message) => { printed.push(message); },
        },
      );
      return { code, printed: printed.join('\n') };
    };

    // Child 1 exhausts its cap first and the operator raises it 3 -> 4.
    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'halted' });
    await expect(raise('1')).resolves.toMatchObject({ code: 0 });

    // Child 2 has since originated three cascades of its own.
    const afterFirst = await readCascadeCounts(subject.repo, 'demo');
    if (afterFirst.kind !== 'counts') throw new Error('unreadable cascades');
    const blob = (await makeGitRunner(subject.repo)(['hash-object', '-w', '--stdin'], {
      input: JSON.stringify({ ...afterFirst.counts, counts: { ...afterFirst.counts.counts, 2: 3 } }),
    })).stdout.trim();
    await makeGitRunner(subject.repo)(['update-ref', cascadesRefFor('demo'), blob]);

    // Child 1's raise must not change the limit enforced for child 2, and the
    // halt reports the 3/3 budget that actually refused.
    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', originatingChildren: [child(2)],
      git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'halted' });
    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('originating child 2 reached 3/3 cascades');
    expect(halt).toContain('Kickback budget (restack): 3/3 consumed; 0 remaining');

    const second = await raise('2');
    expect(second.printed).not.toContain('refused');
    expect(second.code).toBe(0);
    expect(second.printed).toContain('Kickback budget (restack): 3/4 consumed; 1 remaining');
    await expect(readCascadeCounts(subject.repo, 'demo')).resolves.toMatchObject({
      kind: 'counts', counts: { counts: { 1: 3, 2: 3 }, limits: { 1: 4, 2: 4 } },
    });

    const tierL = await realCascadeCapCliFixture({ tier: 'L', charged: 8 });
    const tierLBlob = (await makeGitRunner(tierL.repo)(['hash-object', '-w', '--stdin'], {
      input: JSON.stringify({ version: 1, counts: { 1: 8 }, limits: { 2: 5 } }),
    })).stdout.trim();
    await makeGitRunner(tierL.repo)(['update-ref', cascadesRefFor('demo'), tierLBlob]);
    await expect(runRestack({
      worktree: tierL.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(tierL.repo),
    })).resolves.toMatchObject({ kind: 'halted' });
    const tierLEvents: unknown[] = [];
    expect(await dispatchKickbackBudgetCommand({
      kind: 'kickback-budget', action: 'raise', feature: 'demo', gate: 'restack', child: '1', by: 2,
      rationale: 'raise the tier-L stopped cascade', format: 'human',
    }, {
      cwd: tierL.root, resolveMainRoot: async () => tierL.root, isInteractive: () => true,
      resolveOperator: () => 'operator', print: () => {}, appendEvent: (_worktree, event) => { tierLEvents.push(event); },
    })).toBe(0);
    expect(tierLEvents).toContainEqual(expect.objectContaining({
      type: 'kickback_budget_adjustment_authorized', beforeLimit: 8, afterLimit: 10,
    }));
    await expect(readCascadeCounts(tierL.repo, 'demo')).resolves.toMatchObject({
      kind: 'counts', counts: { counts: { 1: 8 }, limits: { 1: 10, 2: 5 } },
    });

    const stale = await realCascadeCapCliFixture({ tier: 'M', charged: 3 });
    await expect(runRestack({
      worktree: stale.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(stale.repo),
    })).resolves.toMatchObject({ kind: 'halted' });
    const before = await readCascadeCounts(stale.repo, 'demo');
    if (before.kind !== 'counts') throw new Error('unreadable cascades');
    await writeFile(join(stale.root, '.ai-conductor', 'config.yml'), [
      'stacked_prs:', '  enabled: true', '  route_whole_feature_fixes: true', '  max_restack_cascades:', '    M: 4', '',
    ].join('\n'));
    const printed: string[] = [];
    expect(await dispatchKickbackBudgetCommand({
      kind: 'kickback-budget', action: 'raise', feature: 'demo', gate: 'restack', child: '1', by: 2,
      rationale: 'reject stale tier-M cap evidence', format: 'human',
    }, {
      cwd: stale.root, resolveMainRoot: async () => stale.root, isInteractive: () => true,
      resolveOperator: () => 'operator', print: (message) => { printed.push(message); },
    })).toBe(1);
    expect(printed.join('\n')).toContain('current cap evidence is missing or no longer matches the live halt');
    await expect(readCascadeCounts(stale.repo, 'demo')).resolves.toMatchObject({ kind: 'counts', blob: before.blob });
    await expect(readKickbackLedger(stale.repo, child(1))).resolves.not.toMatchObject({
      gates: { restack: { resumeAuthorization: expect.anything() } },
    });
  });

  it('raises the cascade budget after recreating the halted feature worktree without child 1 state', async () => {
    const subject = await realCascadeCapCliFixture();

    await expect(runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'feature-repair',
      git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'halted' });

    const activeLedger = await readFile(join(subject.repo, '.pipeline', 'children', '2', 'kickback-ledger.json'));
    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'));
    const haltClass = await readFile(join(subject.repo, '.pipeline', 'HALT.class'));
    await execFile('git', ['worktree', 'remove', '--force', subject.repo], { cwd: subject.root });
    await execFile('git', ['worktree', 'add', '-q', subject.repo, 'feat/daemon-demo'], { cwd: subject.root });

    await sealSliceTopologyPositions(subject.repo, {
      slug: 'demo',
      sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['Child 1', 'Leaf'] },
    });
    await mkdir(join(subject.repo, '.pipeline', 'children', '2'), { recursive: true });
    await writeFile(join(subject.repo, '.pipeline', 'children', '2', 'kickback-ledger.json'), activeLedger);
    await writeFile(join(subject.repo, '.pipeline', 'HALT'), halt);
    await writeFile(join(subject.repo, '.pipeline', 'HALT.class'), haltClass);
    await expect(access(join(subject.repo, '.pipeline', 'children', '1'))).rejects.toThrow();

    expect(await dispatchKickbackBudgetCommand(
      {
        kind: 'kickback-budget',
        action: 'raise',
        feature: 'demo',
        gate: 'restack',
        child: '1',
        by: 2,
        rationale: 'repair the recreated worktree cascade',
        format: 'human',
      },
      {
        cwd: subject.root,
        resolveMainRoot: async () => subject.root,
        isInteractive: () => true,
        resolveOperator: () => 'operator',
        print: () => {},
      },
    )).toBe(0);

    await expect(readCascadeCounts(subject.repo, 'demo')).resolves.toMatchObject({
      kind: 'counts',
      counts: { counts: { 1: 3 }, limits: { 1: 5 } },
    });
  });
});
