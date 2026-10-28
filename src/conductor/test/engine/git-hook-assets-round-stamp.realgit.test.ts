// Covers: task:52
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from './slice-topology-fixture.js';
import { repairMarkerRefFor } from '../../src/engine/routing/routing-refs.js';
import { withGitArgvShim } from './n1-golden-shared.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const sourceIndex = fileURLToPath(new URL('../../src/index.ts', import.meta.url));
const envelopeFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(root: string, args: string[], input?: string): Promise<string> {
  return (await execFile('git', args, { cwd: root, ...(input === undefined ? {} : { input }) })).stdout.trim();
}

async function writeHookLauncher(root: string, failRoundStamp = false): Promise<string> {
  const launcher = join(root, 'round-stamp-launcher');
  const fail = failRoundStamp ? 'if [ "$1" = round-stamp ]; then exit 1; fi\n' : '';
  await writeFile(launcher, `#!/bin/sh\n${fail}exec node --import tsx ${JSON.stringify(sourceIndex)} "$@"\n`, 'utf8');
  await chmod(launcher, 0o755);
  return launcher;
}

async function installHooks(root: string, failRoundStamp = false): Promise<void> {
  const launcher = await writeHookLauncher(root, failRoundStamp);
  const previous = process.env.AI_CONDUCTOR_ENGINE_BIN;
  process.env.AI_CONDUCTOR_ENGINE_BIN = launcher;
  vi.resetModules();
  try {
    const { prepareWorktree } = await import('../../src/engine/worktree-prepare.js');
    await prepareWorktree(root);
  } finally {
    if (previous === undefined) delete process.env.AI_CONDUCTOR_ENGINE_BIN;
    else process.env.AI_CONDUCTOR_ENGINE_BIN = previous;
  }
}

function withoutGuardValve(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { CONDUCT_DAEMON_SESSION_UNSAFE_ALLOW: _valve, ...rest } = env;
  return rest;
}

async function writeRepairMarker(root: string, host: number, roundId: string): Promise<void> {
  const markerPath = join(root, '.pipeline', 'repair-marker.json');
  await writeFile(markerPath, JSON.stringify({ host, roundId }));
  const blob = await git(root, ['hash-object', '-w', markerPath]);
  await git(root, ['update-ref', repairMarkerRefFor('demo'), blob]);
}

async function commit(root: string, file: string, message: string): Promise<string> {
  await writeFile(join(root, file), `${file}\n`, 'utf8');
  await git(root, ['add', file]);
  await git(root, ['commit', '-qm', message]);
  return git(root, ['log', '-1', '--format=%B']);
}

async function routedFixture(options: { readonly failRoundStamp?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'round-stamp-hook-'));
  roots.push(root);
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'round-stamp@example.test']);
  await git(root, ['config', 'user.name', 'Round stamp']);
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await writeFile(join(root, '.gitignore'), '.pipeline/\n');
  await writeFile(join(root, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 2\n  route_whole_feature_fixes: true\n');
  await git(root, ['add', '.gitignore', '.ai-conductor/config.yml']);
  await git(root, ['commit', '-qm', 'base']);
  await writeSliceTopologyFixture(root, {
    version: 1,
    slug: 'demo',
    runId: 'round-stamp',
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { T1: 1, T2: 2 }, titles: ['child', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, envelopeFilesystem);
  await git(root, ['checkout', '-qb', 'feat/c1/demo']);
  await writeFile(join(root, 'child.txt'), 'child\n');
  await git(root, ['add', 'child.txt']);
  await git(root, ['commit', '-qm', 'child']);
  await git(root, ['update-ref', 'refs/conductor/demo/closed/c1', 'HEAD']);
  await git(root, ['checkout', '-qb', 'feat/daemon-demo']);
  await git(root, ['commit', '--allow-empty', '-qm', 'leaf']);
  await git(root, ['checkout', '-q', 'feat/c1/demo']);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'current-task'), 'T1\n');
  await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [{ id: 'T1', status: 'in_progress' }] }));
  await installHooks(root, options.failRoundStamp);
  return root;
}

describe('prepare-commit-msg round stamp (real local Git)', () => {
  it('keeps unrelated task commits permitted when round stamping is unavailable', async () => {
    const root = await routedFixture({ failRoundStamp: true });

    await expect(commit(root, 'member.txt', 'feat: permitted child task')).resolves.toContain('Task: T1');
  });

  it('adds one Task and Round trailer only for the marker host branch', async () => {
    const root = await routedFixture();
    await writeRepairMarker(root, 1, 'r1');

    await expect(commit(root, 'host.txt', 'feat: host repair')).resolves.toContain('Task: T1\nRound: r1');
    await git(root, ['checkout', '-q', 'feat/daemon-demo']);
    await expect(commit(root, 'leaf.txt', 'feat: leaf change')).resolves.not.toMatch(/^Round:/m);
    await git(root, ['checkout', '-q', 'feat/c1/demo']);
    const duplicate = await commit(root, 'duplicate.txt', 'feat: same round\n\nRound: r1');
    expect(duplicate.match(/^Round:/gm)).toHaveLength(1);
  });

  it('stamps the round on a commit made inside a daemon-managed maker session', async () => {
    const root = await routedFixture();
    await writeRepairMarker(root, 1, 'r1');
    await writeFile(join(root, 'session.txt'), 'session\n');
    await git(root, ['add', 'session.txt']);
    // The session guard refuses unsanctioned subcommands under this marker;
    // the hook's `|| true` would hide a refusal, so assert the trailer lands.
    await execFile('git', ['commit', '-qm', 'feat: daemon session repair'], {
      cwd: root,
      // test/setup.ts disables the guard suite-wide; drop that valve so the
      // hook runs under the real daemon-session policy.
      env: { ...withoutGuardValve(process.env), CONDUCT_DAEMON_SESSION: '1' },
    });

    await expect(git(root, ['log', '-1', '--format=%B'])).resolves.toMatch(/^Round: r1$/m);
  });

  it('leaves the message unchanged without a marker and preserves N=1 without routing-ref reads', async () => {
    const root = await routedFixture();
    await expect(commit(root, 'no-marker.txt', 'feat: no marker')).resolves.not.toMatch(/^Round:/m);

    const n1 = await mkdtemp(join(tmpdir(), 'round-stamp-n1-'));
    roots.push(n1);
    await git(n1, ['init', '-q', '-b', 'main']);
    await git(n1, ['config', 'user.email', 'round-stamp@example.test']);
    await git(n1, ['config', 'user.name', 'Round stamp']);
    await mkdir(join(n1, '.ai-conductor'), { recursive: true });
    await writeFile(join(n1, '.gitignore'), '.pipeline/\n');
    await writeFile(join(n1, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  route_whole_feature_fixes: true\n');
    await git(n1, ['add', '.gitignore', '.ai-conductor/config.yml']);
    await git(n1, ['commit', '-qm', 'base']);
    await git(n1, ['checkout', '-qb', 'feat/daemon-demo']);
    await installHooks(n1);

    const argv = await withGitArgvShim(n1, async () => {
      await expect(commit(n1, 'n1.txt', 'feat: flat feature')).resolves.toBe('feat: flat feature');
    });
    expect(argv.flat().some((arg) => /refs\/conductor\/demo\/(?:routes|repairing|revalidate)/.test(arg))).toBe(false);
  });
});
