// Covers: task:5, task:23
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { commitDocsPruneDeletion, resolveDocsPruneSelection } from '../../src/engine/docs-prune.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const roots: string[] = [];
const execFile = promisify(execFileCb);
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'docs-prune-commit-'));
  roots.push(root);
  await initTestRepo(root);
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await writeFile(join(root, '.docs/plans/alpha.md'), 'alpha\n');
  await writeFile(join(root, 'keep.txt'), 'keep\n');
  const git = async (args: string[], options?: { cwd?: string }) => {
    const { stdout } = await execFile('git', args, { cwd: options?.cwd ?? root });
    return { stdout };
  };
  await git(['add', '-A']); await git(['commit', '-qm', 'base']);
  return { root, git };
}

it('commits exactly the removable deletions without changing the caller checkout', async () => {
  const { root, git } = await setup();
  const beforeStatus = (await git(['status', '--porcelain'])).stdout;
  const beforeMain = (await git(['rev-parse', 'main'])).stdout;
  const beforeKeep = await readFile(join(root, 'keep.txt'), 'utf8');
  const commit = await commitDocsPruneDeletion({ repoDir: root, startPoint: 'main', removable: ['.docs/plans/alpha.md'], git });
  expect((await git(['show', '--format=', '--name-status', commit])).stdout.trim()).toBe('D\t.docs/plans/alpha.md');
  expect((await git(['status', '--porcelain'])).stdout).toBe(beforeStatus);
  expect((await git(['rev-parse', 'main'])).stdout).toBe(beforeMain);
  await expect(readFile(join(root, 'keep.txt'), 'utf8')).resolves.toBe(beforeKeep);
  expect((await git(['worktree', 'list', '--porcelain'])).stdout.match(/^worktree /gm)).toHaveLength(1);
});

it('refuses an unexpected staged path and creates no deletion commit', async () => {
  const { root, git } = await setup();
  const before = (await git(['rev-parse', 'main'])).stdout;
  const injectedGit = async (args: string[], options?: { cwd?: string }) => {
    if (args.join(' ') === 'diff --cached --name-status' && options?.cwd && options.cwd !== root) {
      await writeFile(join(options.cwd, 'extra.md'), 'extra\n');
      await git(['add', 'extra.md'], { cwd: options.cwd });
    }
    return git(args, options);
  };
  await expect(commitDocsPruneDeletion({ repoDir: root, startPoint: 'main', removable: ['.docs/plans/alpha.md'], git: injectedGit as never })).rejects.toThrow(/unexpected staged path.*extra\.md/);
  expect((await git(['rev-parse', 'main'])).stdout).toBe(before);
});

it('removes a manifest-backed selection while retaining its stories and decision', async () => {
  const { root, git } = await setup();
  const manifestPath = '.docs/alpha/manifest.json';
  const planPath = '.docs/alpha/machine/plan.md';
  const storiesPath = '.docs/stories/alpha.md';
  const decisionPath = '.docs/decisions/adr-alpha.md';
  await mkdir(join(root, '.docs', 'alpha', 'machine'), { recursive: true });
  await mkdir(join(root, '.docs', 'shipped'), { recursive: true });
  await mkdir(join(root, '.docs', 'stories'), { recursive: true });
  await mkdir(join(root, '.docs', 'decisions'), { recursive: true });
  await writeFile(join(root, manifestPath), JSON.stringify({
    schemaVersion: 1,
    slug: 'alpha',
    artifacts: [
      { kind: 'plan', path: planPath },
      { kind: 'stories', path: storiesPath },
      { kind: 'decision', path: decisionPath },
    ],
  }));
  await writeFile(join(root, planPath), '# Alpha\n');
  await writeFile(join(root, '.docs/shipped/alpha.md'), 'shipped\n');
  await writeFile(join(root, storiesPath), '# Stories\n');
  await writeFile(join(root, decisionPath), '# Decision\n');
  await git(['add', '-A']);
  await git(['commit', '-qm', 'add manifest-backed artifacts']);
  const origin = join(root, 'origin.git');
  await git(['init', '--bare', '--initial-branch=main', origin]);
  await git(['remote', 'add', 'origin', origin]);
  await git(['push', '-u', 'origin', 'main']);

  const selection = await resolveDocsPruneSelection(root, git as never);
  const pruningCommit = await commitDocsPruneDeletion({
    repoDir: root,
    startPoint: 'main',
    removable: selection.removable,
    git,
  });
  await git(['update-ref', 'refs/heads/main', pruningCommit]);
  await git(['push', 'origin', 'main']);
  const mainTree = (await git(['ls-tree', '-r', '--name-only', 'origin/main'])).stdout.split('\n');

  expect(mainTree).not.toContain(manifestPath);
  expect(mainTree).not.toContain(planPath);
  expect(mainTree).toContain(storiesPath);
  expect(mainTree).toContain(decisionPath);
});
