// Covers: task:rem-prd-audit-rem-prd-audit-R27
// Covers: task:rem-prd-audit-rem-prd-audit-R26
// Covers: task:31.2
// Covers: task:rem-prd-audit-rem-prd-audit-R25
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { detectKickbackBudgetCommand } from '../../src/cli.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { writeCoverageBindingEnvelope } from '../../src/engine/coverage-binding-envelope.js';
import { dispatchKickbackBudgetCommand } from '../../src/engine/kickback-budget-cli.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import {
  cascadeUpdateLines,
  cascadesRefFor,
  readCascadeCounts,
  updateCascadeLimit,
} from '../../src/engine/restack/cascade-cap.js';
import { runRestack } from '../../src/engine/restack/restack-executor.js';

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

async function realCascadeCapCliFixture() {
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
  await git(['worktree', 'add', '-qb', 'feat/c1/demo', childWorktree, 'main']);
  const closed = await commit('closed child', 'child.txt');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closed]);
  await commit('repair child', 'repair.txt');
  await git(['branch', 'feat/daemon-demo', closed]);
  await git(['worktree', 'add', '-q', repo, 'feat/daemon-demo']);
  await mkdir(join(repo, '.pipeline', 'children', '2'), { recursive: true });
  await writeCoverageBindingEnvelope(repo, {
    version: 1,
    slug: 'demo',
    runId: 'run-1',
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['Child 1', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, envelopeFilesystem);
  const blob = (await makeGitRunner(repo)(
    ['hash-object', '-w', '--stdin'],
    { input: JSON.stringify({ version: 1, counts: { 1: 3 } }) },
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
    })).resolves.toEqual({ kind: 'halted' });

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
  });

  it('resets the originating child cascade budget from a real cascade-cap halt', async () => {
    const subject = await realCascadeCapCliFixture();

    await expect(runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'feature-repair',
      git: makeGitRunner(subject.repo),
    })).resolves.toEqual({ kind: 'halted' });

    expect(await dispatchKickbackBudgetCommand(
      {
        kind: 'kickback-budget',
        action: 'reset',
        feature: 'demo',
        gate: 'restack',
        child: '1',
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
      counts: { counts: { 1: 0 } },
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

  it('raises the cascade budget after recreating the halted feature worktree without child 1 state', async () => {
    const subject = await realCascadeCapCliFixture();

    await expect(runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'feature-repair',
      git: makeGitRunner(subject.repo),
    })).resolves.toEqual({ kind: 'halted' });

    const activeLedger = await readFile(join(subject.repo, '.pipeline', 'children', '2', 'kickback-ledger.json'));
    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'));
    const haltClass = await readFile(join(subject.repo, '.pipeline', 'HALT.class'));
    await execFile('git', ['worktree', 'remove', '--force', subject.repo], { cwd: subject.root });
    await execFile('git', ['worktree', 'add', '-q', subject.repo, 'feat/daemon-demo'], { cwd: subject.root });

    await writeCoverageBindingEnvelope(subject.repo, {
      version: 1,
      slug: 'demo',
      runId: 'run-2',
      status: 'done',
      entries: [],
      sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['Child 1', 'Leaf'] },
      storyOwnership: { S1: 1, S2: 2 },
    }, envelopeFilesystem);
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
