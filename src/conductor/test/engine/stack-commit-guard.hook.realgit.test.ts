// Covers: task:13
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { leafBranchFor } from '../../src/engine/feature-branch-identity.js';
import { closureRefFor } from '../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from './slice-topology-fixture.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
// global-setup builds this entry before workers start. Invoking it directly
// avoids compiling TypeScript once per Git hook under CI parallelism.
const engineIndex = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;
const fixtureFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(root: string, args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd: root })).stdout.trim();
}

async function writeHookLauncher(root: string): Promise<string> {
  const launcher = join(root, 'stack-commit-guard-launcher');
  await writeFile(launcher, `#!/bin/sh\nexec node ${JSON.stringify(engineIndex)} "$@"\n`, 'utf8');
  await chmod(launcher, 0o755);
  return launcher;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'stack-commit-guard-hook-'));
  roots.push(root);
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'stack-guard@example.test']);
  await git(root, ['config', 'user.name', 'Stack guard']);
  await writeFile(join(root, '.gitignore'), '.pipeline/\n');
  await git(root, ['add', '.gitignore']);
  await git(root, ['commit', '-qm', 'base']);
  await writeSliceTopologyFixture(root, {
    slug: 'demo',
    sliceMembership: { taskSlices: { T1: 1, T2: 2 }, titles: ['host', 'other'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, fixtureFilesystem);

  await git(root, ['checkout', '-qb', 'feat/c1/demo']);
  await writeFile(join(root, 'child.txt'), 'closed child\n');
  await git(root, ['add', 'child.txt']);
  await git(root, ['commit', '-qm', 'closed child']);
  const closure = await git(root, ['rev-parse', 'HEAD']);
  await git(root, ['update-ref', closureRefFor('demo', child), closure]);
  await writeFile(join(root, 'manual.txt'), 'reviewer edit\n');
  await git(root, ['add', 'manual.txt']);
  await git(root, ['commit', '-qm', 'reviewer edit']);
  await git(root, ['branch', 'feat/c2/demo', closure]);
  await git(root, ['checkout', '-qb', leafBranchFor('demo'), closure]);
  await git(root, ['commit', '--allow-empty', '-qm', 'leaf']);
  await git(root, ['checkout', '-q', 'feat/c1/demo']);
  await mkdir(join(root, '.pipeline', 'children', '1'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
  }));
  return root;
}

async function withHookModules<T>(root: string, action: (modules: {
  readonly writeGitHooksAndWire: (worktree: string) => Promise<void>;
  readonly openOperatorRound: typeof import('../../src/engine/routing/operator-round.js')['openOperatorRound'];
}) => Promise<T>): Promise<T> {
  const launcher = await writeHookLauncher(root);
  const previous = process.env.AI_CONDUCTOR_ENGINE_BIN;
  process.env.AI_CONDUCTOR_ENGINE_BIN = launcher;
  vi.resetModules();
  try {
    const [{ writeGitHooksAndWire }, { openOperatorRound }] = await Promise.all([
      import('../../src/engine/worktree-prepare.js'),
      import('../../src/engine/routing/operator-round.js'),
    ]);
    return await action({ writeGitHooksAndWire, openOperatorRound });
  } finally {
    if (previous === undefined) delete process.env.AI_CONDUCTOR_ENGINE_BIN;
    else process.env.AI_CONDUCTOR_ENGINE_BIN = previous;
    vi.resetModules();
  }
}

async function commit(root: string, file: string): Promise<void> {
  await writeFile(join(root, file), `${file}\n`);
  await git(root, ['add', file]);
  await git(root, ['commit', '-qm', `feat: ${file}`]);
}

describe('stack commit guard pre-commit hook (real local Git)', () => {
  it('refreshes the hook while opening a round and refuses non-host commits without a phase marker', async () => {
    const root = await fixture();

    await withHookModules(root, async ({ writeGitHooksAndWire, openOperatorRound }) => {
      await writeGitHooksAndWire(root);
      const hookPath = join(root, '.pipeline', 'git-hooks', 'pre-commit');
      const currentHook = await readFile(hookPath, 'utf8');
      await writeFile(hookPath, currentHook.replace(/^.*stack-commit-guard.*\n/m, ''));
      await expect(readFile(hookPath, 'utf8')).resolves.not.toContain('stack-commit-guard');

      await expect(openOperatorRound({
        worktree: root,
        slug: 'demo',
        roundId,
        host: child,
        reason: 'land reviewer edits in child one',
        operator: 'operator@example.test',
        carried: [],
        emitter: new ConductorEventEmitter(),
      })).resolves.toMatchObject({ kind: 'opened' });
      await expect(readFile(hookPath, 'utf8')).resolves.toContain('stack-commit-guard');

      await git(root, ['checkout', '-q', 'feat/c2/demo']);
      await expect(commit(root, 'wrong-child.txt')).rejects.toMatchObject({
        stderr: expect.stringContaining('stack-commit-guard: refusing tracked-file commit on feat/c2/demo'),
      });

      await git(root, ['reset', '--hard', 'HEAD']);
      await git(root, ['checkout', '-q', 'feat/c1/demo']);
      await expect(commit(root, 'host.txt')).resolves.toBeUndefined();
    });
  });
});
