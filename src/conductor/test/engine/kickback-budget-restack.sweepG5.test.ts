// Covers: task:rem-prd-audit-R8, task:rem-prd-audit-rem-prd-audit-R25, task:rem-prd-audit-rem-prd-audit-R26
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { writeSliceTopologyFixture } from './slice-topology-fixture.js';
import {
  clearHaltForResume,
  clearMarker,
  consumeResumeAuthorizations,
  readKickbackHaltGeneration,
  readRawHaltClass,
} from '../../src/engine/daemon-rekick.js';
import { dispatchKickbackBudgetCommand } from '../../src/engine/kickback-budget-cli.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { cascadesRefFor, readCascadeCounts } from '../../src/engine/restack/cascade-cap.js';
import { runRestack } from '../../src/engine/restack/restack-executor.js';
import { runStackPreflight } from '../../src/engine/restack/stack-preflight.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const envelopeFilesystem = {
  readFile: (path: string) => readFile(path, 'utf8'),
  mkdir: (path: string) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path: string, contents: string) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

/**
 * A feature worktree at `<root>/.worktrees/demo` (leaf active) whose closed
 * child 1 has an appended operator commit and has already originated 3
 * repairs, so the due repair reaches a real cascade-cap halt.
 */
async function cascadeCapHalt() {
  const root = await mkdtemp(join(tmpdir(), 'kickback-budget-restack-sweep-g5-'));
  roots.push(root);
  const repo = join(root, '.worktrees', 'demo');
  const childWorktree = join(root, '.worktrees', 'c1');
  const git = async (args: string[], cwd = root) => (await execFile('git', args, { cwd })).stdout;
  const commit = async (message: string, path: string) => {
    await writeFile(join(childWorktree, path), `${message}\n`);
    await git(['add', path], childWorktree);
    await git(['commit', '-qm', message], childWorktree);
    return (await git(['rev-parse', 'HEAD'], childWorktree)).trim();
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'cascade@example.test']);
  await git(['config', 'user.name', 'Cascade sweep']);
  await writeFile(join(root, '.gitignore'), '.worktrees/\n.pipeline/\n');
  await writeFile(join(root, 'base.txt'), 'base\n');
  await git(['add', '.gitignore', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  await git(['worktree', 'add', '-qb', 'feat/c1/demo', childWorktree, 'main']);
  const closed = await commit('closed child', 'child.txt');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closed]);
  const repair = await commit('repair child', 'repair.txt');
  await git(['branch', 'feat/daemon-demo', closed]);
  await git(['worktree', 'add', '-q', repo, 'feat/daemon-demo']);
  await mkdir(join(repo, '.pipeline', 'children', '2'), { recursive: true });
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['Child 1', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, envelopeFilesystem);
  const blob = (await makeGitRunner(repo)(['hash-object', '-w', '--stdin'], {
    input: JSON.stringify({ version: 1, counts: { 1: 3 } }),
  })).stdout.trim();
  await git(['update-ref', cascadesRefFor('demo'), blob]);

  await expect(runRestack({ worktree: repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(repo) }))
    .resolves.toMatchObject({ kind: 'halted' });
  await expect(readFile(join(repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  return { root, repo, git, closed, repair };
}

type Subject = Awaited<ReturnType<typeof cascadeCapHalt>>;

async function kickbackBudget(subject: Subject, action: 'raise' | 'reset'): Promise<number> {
  return dispatchKickbackBudgetCommand(
    {
      kind: 'kickback-budget',
      action,
      feature: 'demo',
      gate: 'restack',
      child: '1',
      ...(action === 'raise' ? { by: 2 } : {}),
      rationale: `${action} the stopped cascade`,
      format: 'human',
    },
    {
      cwd: subject.root,
      resolveMainRoot: async () => subject.root,
      isInteractive: () => true,
      resolveOperator: () => 'operator',
      print: () => {},
    },
  );
}

/** The daemon's next resume: consume the staged authorization, then run the stack preflight. */
async function nextResume(subject: Subject) {
  const cleared = await consumeResumeAuthorizations({
    listHaltedWorktrees: async () => ['demo'],
    worktreePath: () => subject.repo,
    isOperatorParked: async () => false,
    readLiveHaltClass: () => readRawHaltClass(subject.repo),
    readLiveHaltGeneration: () => readKickbackHaltGeneration(subject.repo),
    clearHalt: (slug) => clearHaltForResume({ worktreePath: subject.repo, slug, clearMarker }),
  });
  const preflight = await runStackPreflight({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) });
  return { cleared, preflight };
}

async function expectRepairRan(subject: Subject): Promise<void> {
  expect((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).trim()).toBe(subject.repair);
  expect(await subject.git(['show', 'feat/daemon-demo:repair.txt'])).toBe('repair child\n');
  await expect(access(join(subject.repo, '.pipeline', 'HALT'))).rejects.toThrow();
}

describe('restack kickback budget sweep G5', () => {
  // Covers: S13.3, task:rem-prd-audit-R8, task:rem-prd-audit-rem-prd-audit-R25
  it('stores a raised restack limit for child 1 in the cascades ref and the next resume runs the repair', async () => {
    const subject = await cascadeCapHalt();

    expect(await kickbackBudget(subject, 'raise')).toBe(0);
    await expect(readCascadeCounts(subject.repo, 'demo')).resolves.toMatchObject({
      kind: 'counts', counts: { counts: { 1: 3 }, limits: { 1: 5 } },
    });
    expect((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).trim()).toBe(subject.closed);

    await expect(nextResume(subject)).resolves.toEqual({ cleared: ['demo'], preflight: { kind: 'repaired' } });
    await expectRepairRan(subject);
    await expect(readCascadeCounts(subject.repo, 'demo')).resolves.toMatchObject({
      kind: 'counts', counts: { counts: { 1: 4 }, limits: { 1: 5 } },
    });
  });

  // Covers: S13.4, task:rem-prd-audit-R8, task:rem-prd-audit-rem-prd-audit-R26
  it('resets child 1 restack cascade count to 0 and the next resume runs the repair', async () => {
    const subject = await cascadeCapHalt();

    expect(await kickbackBudget(subject, 'reset')).toBe(0);
    await expect(readCascadeCounts(subject.repo, 'demo')).resolves.toMatchObject({
      kind: 'counts', counts: { counts: { 1: 0 } },
    });
    expect((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).trim()).toBe(subject.closed);

    await expect(nextResume(subject)).resolves.toEqual({ cleared: ['demo'], preflight: { kind: 'repaired' } });
    await expectRepairRan(subject);
    await expect(readCascadeCounts(subject.repo, 'demo')).resolves.toMatchObject({
      kind: 'counts', counts: { counts: { 1: 1 } },
    });
  });
});
