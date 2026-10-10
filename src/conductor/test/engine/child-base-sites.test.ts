// Covers: task:25
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import {
  deriveFullSuiteChangedSelection,
  deriveFullSuiteScopedSelection,
} from '../../src/engine/full-suite-verifier.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { listCommitsWithTrailers } from '../../src/engine/autoheal.js';
import { seedTaskStatus } from '../../src/engine/task-seed.js';
import { parseChildId } from '../../src/engine/child-context.js';

const roots: string[] = [];

async function git(root: string, args: string[]) {
  return execa('git', args, { cwd: root, reject: false });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'child-base-sites-'));
  roots.push(root);
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'test@example.com']);
  await git(root, ['config', 'user.name', 'Test']);
  await writeFile(join(root, 'README.md'), 'base\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'base']);
  await git(root, ['branch', 'feat/c1/demo']);
  await git(root, ['checkout', '-q', 'feat/c1/demo']);
  await writeFile(join(root, 'src-parent.ts'), 'export const parent = 1;\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'parent']);
  const parent = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(root, ['update-ref', 'refs/conductor/demo/closed/c1', parent]);
  await git(root, ['checkout', '-qb', 'feat/daemon-demo']);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'coverage-binding.json'), JSON.stringify({
    version: 1, slug: 'demo', runId: 'test', status: 'done', entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['parent', 'child'] },
  }));
  await writeFile(join(root, 'test-child.test.ts'), 'export const child = 2;\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'child\n\nTask: 2']);
  return { root, parent };
}

const childBase = { slug: 'demo', child: parseChildId(2)! };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('child-base consumers', () => {
  it('selects only the active child surface and aggregates when its parent is unavailable', async () => {
    const { root, parent } = await fixture();
    const runner = makeGitRunner(root);

    await expect(deriveFullSuiteScopedSelection(runner, { projectRoot: root, childBase }))
      .resolves.toEqual({ status: 'SELECTED', selectors: ['test-child.test.ts'] });
    await expect(deriveFullSuiteChangedSelection(runner, { projectRoot: root, childBase }))
      .resolves.toEqual({ status: 'CHANGED', base: parent });

    await git(root, ['branch', '-D', 'feat/c1/demo']);
    await expect(deriveFullSuiteScopedSelection(runner, { projectRoot: root, childBase }))
      .resolves.toEqual({ status: 'EMPTY' });
    await expect(deriveFullSuiteChangedSelection(runner, { projectRoot: root, childBase }))
      .resolves.toEqual({ status: 'EMPTY' });
  });

  it('does not widen trailer evidence or restored task progress past a missing parent', async () => {
    const { root } = await fixture();
    const planPath = join(root, '.docs', 'plans', 'demo.md');
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await writeFile(planPath, '## Task 2: child\n');

    await expect(listCommitsWithTrailers(root, undefined, childBase)).resolves.toHaveLength(1);
    await seedTaskStatus(root, planPath, undefined, { childBase });
    let status = JSON.parse(await (await import('node:fs/promises')).readFile(join(root, '.pipeline', 'task-status.json'), 'utf8'));
    expect(status.tasks[0]).toMatchObject({ id: '2', status: 'completed' });

    await git(root, ['branch', '-D', 'feat/c1/demo']);
    await expect(listCommitsWithTrailers(root, undefined, childBase)).resolves.toEqual([]);
    await rm(join(root, '.pipeline', 'task-status.json'));
    await seedTaskStatus(root, planPath, undefined, { childBase });
    status = JSON.parse(await (await import('node:fs/promises')).readFile(join(root, '.pipeline', 'task-status.json'), 'utf8'));
    expect(status.tasks[0]).toMatchObject({ id: '2', status: 'pending' });
  });
});
