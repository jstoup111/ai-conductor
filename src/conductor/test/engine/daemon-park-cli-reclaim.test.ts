import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  detectDaemonParkCommand,
  dispatchDaemonPark,
} from '../../src/engine/daemon-park-cli.js';

const execFile = promisify(execFileCb);
const roots: string[] = [];

describe('engine/daemon-park-cli reclaim-worktree', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('rejects a traversal slug before it can escape the retained-worktree directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-reclaim-traversal-'));
    roots.push(root);
    const git = (args: string[], cwd = root) => execFile('git', args, { cwd });
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'test@example.com']);
    await git(['config', 'user.name', 'Test']);
    await writeFile(join(root, 'README.md'), '# fixture\n');
    await git(['add', '.']);
    await git(['commit', '-q', '-m', 'fixture']);

    const outsidePath = join(root, 'outside-retained-dir');
    await git(['worktree', 'add', '-q', '-b', 'feat/outside', outsidePath, 'main']);
    const out: string[] = [];
    const code = await dispatchDaemonPark(
      { kind: 'reclaim-worktree', slug: '../outside-retained-dir' },
      { cwd: root, out: (line) => out.push(line) },
    );

    const exists = await access(outsidePath).then(
      () => true,
      () => false,
    );
    expect({ code, exists, out }).toEqual({
      code: 1,
      exists: true,
      out: ["Could not reclaim-worktree '../outside-retained-dir': invalid-slug"],
    });
  });

  it('rejects malformed, bulk, in-flight, unknown, and failed-removal targets without claiming success', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-reclaim-negative-'));
    roots.push(root);
    const activeSlug = 'active-run';
    const failedSlug = 'remove-fails';
    await mkdir(join(root, '.worktrees', activeSlug, '.pipeline'), { recursive: true });
    await writeFile(
      join(root, '.worktrees', activeSlug, '.pipeline', 'conduct-state.json'),
      JSON.stringify({ feature_desc: activeSlug, build: 'in_progress' }),
    );
    await mkdir(join(root, '.worktrees', failedSlug), { recursive: true });

    const cases: Array<{ slug: string; expected: string }> = [
      { slug: '*', expected: "Could not reclaim-worktree '*': invalid-slug" },
      { slug: 'nested/path', expected: "Could not reclaim-worktree 'nested/path': invalid-slug" },
      { slug: 'one,two', expected: "Could not reclaim-worktree 'one,two': invalid-slug" },
    ];
    const results: unknown[] = [];
    for (const { slug, expected } of cases) {
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'reclaim-worktree', slug },
        { cwd: root, out: (line) => out.push(line) },
      );
      results.push({ slug, code, out, expected });
    }

    const activeOut: string[] = [];
    const activeCode = await dispatchDaemonPark(
      { kind: 'reclaim-worktree', slug: activeSlug },
      { cwd: root, out: (line) => activeOut.push(line) },
    );
    const unknownOut: string[] = [];
    const unknownCode = await dispatchDaemonPark(
      { kind: 'reclaim-worktree', slug: 'unknown-slug' },
      { cwd: root, out: (line) => unknownOut.push(line) },
    );
    const failureOut: string[] = [];
    const failureCode = await dispatchDaemonPark(
      { kind: 'reclaim-worktree', slug: failedSlug },
      {
        cwd: root,
        out: (line) => failureOut.push(line),
        removeWorktree: async () => {
          throw new Error('simulated removal failure');
        },
      },
    );

    expect({
      malformed: results,
      multiple: detectDaemonParkCommand([
        'node',
        'conduct-ts',
        'daemon',
        'reclaim-worktree',
        'one',
        'two',
      ]),
      active: { code: activeCode, out: activeOut },
      unknown: { code: unknownCode, out: unknownOut },
      failure: { code: failureCode, out: failureOut },
      activeStillExists: await access(join(root, '.worktrees', activeSlug)).then(
        () => true,
        () => false,
      ),
      failedStillExists: await access(join(root, '.worktrees', failedSlug)).then(
        () => true,
        () => false,
      ),
    }).toEqual({
      malformed: cases.map(({ slug, expected }) => ({
        slug,
        code: 1,
        out: [expected],
        expected,
      })),
      multiple: {
        kind: 'reclaim-worktree',
        slug: 'one',
        invalidArgs: true,
      },
      active: {
        code: 1,
        out: [`Could not reclaim-worktree '${activeSlug}': in-progress`],
      },
      unknown: {
        code: 0,
        out: [`No retained worktree to reclaim for '${'unknown-slug'}'.`],
      },
      failure: {
        code: 1,
        out: [
          `Reclaiming retained worktree: ${join(root, '.worktrees', failedSlug)}`,
          `Could not reclaim-worktree '${failedSlug}': simulated removal failure`,
        ],
      },
      activeStillExists: true,
      failedStillExists: true,
    });
  });
});
