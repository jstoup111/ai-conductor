// Covers: task:52
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from './slice-topology-fixture.js';
import { createRouteRecord } from '../../src/engine/routing/route-record-store.js';
import { repairMarkerRefFor } from '../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';
import { withGitArgvShim } from './n1-golden-shared.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
// global-setup builds this entry before workers start. Invoking it directly
// avoids compiling TypeScript once per Git hook, which can exceed this
// integration test's bounded timeout under CI parallelism.
const engineIndex = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
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
  await writeFile(launcher, `#!/bin/sh\n${fail}exec node ${JSON.stringify(engineIndex)} "$@"\n`, 'utf8');
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

async function writeRepairMarker(root: string, host: number, roundId: string, execution?: 'leaf'): Promise<void> {
  const parsedRoundId = parseRoundId(roundId);
  if (parsedRoundId === undefined) throw new Error(`invalid round id: ${roundId}`);
  const route = await createRouteRecord(root, 'demo', {
    roundId: parsedRoundId,
    sealedAuthored: 0,
    kind: 'audit',
    ...(execution === undefined ? {} : { execution }),
    items: [],
    allocation: { [host]: { remTaskIds: [], blockBodies: [] } },
  });
  if (route.kind !== 'created') throw new Error(`could not create route: ${route.kind}`);
  const markerPath = join(root, '.pipeline', 'repair-marker.json');
  await writeFile(markerPath, JSON.stringify({ host, roundId, ...(execution === undefined ? {} : { execution }) }));
  const blob = await git(root, ['hash-object', '-w', markerPath]);
  await git(root, ['update-ref', repairMarkerRefFor('demo'), blob]);
}

async function commit(root: string, file: string, message: string): Promise<string> {
  await writeFile(join(root, file), `${file}\n`, 'utf8');
  await git(root, ['add', file]);
  await git(root, ['commit', '-qm', message]);
  return git(root, ['log', '-1', '--format=%B']);
}

async function routedFixture(options: { readonly failRoundStamp?: boolean; readonly leafPosition?: 2 | 3 } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'round-stamp-hook-'));
  roots.push(root);
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'round-stamp@example.test']);
  await git(root, ['config', 'user.name', 'Round stamp']);
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await writeFile(join(root, '.gitignore'), '.pipeline/\n');
  const leafPosition = options.leafPosition ?? 2;
  await writeFile(join(root, '.ai-conductor', 'config.yml'), `stacked_prs:\n  enabled: true\n  max_slices: ${leafPosition}\n  route_whole_feature_fixes: true\n`);
  await git(root, ['add', '.gitignore', '.ai-conductor/config.yml']);
  await git(root, ['commit', '-qm', 'base']);
  await writeSliceTopologyFixture(root, leafPosition === 3 ? {
    version: 1, slug: 'demo', runId: 'round-stamp', status: 'done', entries: [],
    sliceMembership: { taskSlices: { T1: 1, T2: 2, T3: 3 }, titles: ['child', 'middle', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  } : {
    version: 1, slug: 'demo', runId: 'round-stamp', status: 'done', entries: [],
    sliceMembership: { taskSlices: { T1: 1, T2: 2 }, titles: ['child', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, envelopeFilesystem);
  await git(root, ['checkout', '-qb', 'feat/c1/demo']);
  await writeFile(join(root, 'child.txt'), 'child\n');
  await git(root, ['add', 'child.txt']);
  await git(root, ['commit', '-qm', 'child']);
  await git(root, ['update-ref', 'refs/conductor/demo/closed/c1', 'HEAD']);
  if (leafPosition === 3) {
    await git(root, ['checkout', '-qb', 'feat/c2/demo']);
    await git(root, ['commit', '--allow-empty', '-qm', 'middle']);
    await git(root, ['update-ref', 'refs/conductor/demo/closed/c2', 'HEAD']);
  }
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
  it('rejects a leaf-executed commit when round stamping is unavailable', async () => {
    const root = await routedFixture({ failRoundStamp: true });
    await writeRepairMarker(root, 1, 'r1', 'leaf');
    await git(root, ['checkout', '-q', 'feat/daemon-demo']);

    await expect(commit(root, 'member.txt', 'feat: permitted child task')).rejects.toThrow(
      'leaf routed commit is missing its Round:/Owner: trailers',
    );
  });

  it('rejects a leaf-executed commit when its marker blob is unreadable', async () => {
    const root = await routedFixture();
    await writeRepairMarker(root, 1, 'r1', 'leaf');
    const malformedMarker = join(root, '.pipeline', 'malformed-marker.json');
    await writeFile(malformedMarker, '{not-json');
    const unreadable = await git(root, ['hash-object', '-w', malformedMarker]);
    await git(root, ['update-ref', repairMarkerRefFor('demo'), unreadable]);
    await git(root, ['checkout', '-q', 'feat/daemon-demo']);
    const before = await git(root, ['rev-parse', 'HEAD']);
    const message = join(root, '.pipeline', 'commit-message');
    await writeFile(message, 'feat: leaf repair\n');

    await expect(execFile('node', [engineIndex, 'round-stamp', '--verify', message], { cwd: root }))
      .rejects.toMatchObject({ code: 1 });

    await expect(commit(root, 'unreadable-marker.txt', 'feat: leaf repair')).rejects.toThrow(/marker is unreadable|missing its Round/);
    await expect(git(root, ['rev-parse', 'HEAD'])).resolves.toBe(before);
  });

  it('permits an unrelated commit when no repair marker exists', async () => {
    const root = await routedFixture();
    await expect(commit(root, 'no-marker.txt', 'feat: no marker')).resolves.not.toMatch(/^Round:/m);
  });

  it('adds one Task and Round trailer for the marker host and refuses a non-host commit', async () => {
    const root = await routedFixture();
    await writeRepairMarker(root, 1, 'r1');

    await expect(commit(root, 'host.txt', 'feat: host repair')).resolves.toContain('Task: T1\nRound: r1');
    await git(root, ['checkout', '-q', 'feat/daemon-demo']);
    await expect(commit(root, 'leaf.txt', 'feat: leaf change')).rejects.toThrow(/stack-commit-guard/);
    await git(root, ['checkout', '-q', 'feat/c1/demo']);
    const duplicate = await commit(root, 'duplicate.txt', 'feat: same round\n\nRound: r1');
    expect(duplicate.match(/^Round:/gm)).toHaveLength(1);
  });

  it('stamps a leaf c3 commit for a leaf-executed c1 host and replaces builder trailers', async () => {
    const root = await routedFixture({ leafPosition: 3 });
    await writeRepairMarker(root, 1, 'r1', 'leaf');
    await git(root, ['checkout', '-q', 'feat/daemon-demo']);

    const message = await commit(root, 'leaf-c3.txt', 'feat: leaf repair\n\nRound: r9\nOwner: c3');
    expect(message.match(/^Round:.*$/gm)).toEqual(['Round: r1']);
    expect(message.match(/^Owner:.*$/gm)).toEqual(['Owner: c1']);
  });

  it('rejects a leaf c3 commit when a repository hook strips c1 ownership', async () => {
    const root = await routedFixture({ leafPosition: 3 });
    await writeRepairMarker(root, 1, 'r1', 'leaf');
    await git(root, ['checkout', '-q', 'feat/daemon-demo']);
    const commonDir = await git(root, ['rev-parse', '--git-common-dir']);
    const hookPath = join(root, commonDir, 'hooks', 'commit-msg');
    await writeFile(hookPath, '#!/bin/sh\nsed -i "/^Owner:/d" "$1"\n');
    await chmod(hookPath, 0o755);

    const before = await git(root, ['rev-parse', 'HEAD']);
    await expect(commit(root, 'stripped-owner.txt', 'feat: leaf repair')).rejects.toThrow(
      'leaf routed commit is missing its Round:/Owner: trailers',
    );
    await expect(git(root, ['rev-parse', 'HEAD'])).resolves.toBe(before);
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

  it('preserves N=1 without routing-ref reads', async () => {
    const root = await routedFixture();
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
