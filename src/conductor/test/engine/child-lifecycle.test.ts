// Covers: task:6,7
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeChild,
  moveLeaf,
  startChild,
  switchToChild,
  type StartChildGitRunner,
} from '../../src/engine/child-lifecycle.js';
import { parseChildId } from '../../src/engine/child-context.js';
import {
  writeCoverageBindingEnvelope,
  type CoverageBindingEnvelopeFilesystem,
} from '../../src/engine/coverage-binding-envelope.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);

const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

let repository: string;

async function git(args: string[], cwd = repository): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout;
}

async function commit(message: string): Promise<string> {
  await writeFile(join(repository, 'tracked.txt'), `${message}\n`);
  await git(['add', 'tracked.txt']);
  await git(['commit', '-qm', message]);
  return (await git(['rev-parse', 'HEAD'])).trim();
}

async function seal(positions: readonly number[]): Promise<void> {
  const taskSlices = Object.fromEntries(positions.map((position) => [String(position), position]));
  await writeCoverageBindingEnvelope(repository, {
    version: 1,
    slug: 'demo',
    runId: 'run-1',
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices, titles: positions.map((position) => `Child ${position}`) },
    storyOwnership: Object.fromEntries(positions.map((position) => [`S${position}`, position])),
  }, envelopeFilesystem);
}

async function configure(maxSlices: number): Promise<void> {
  await mkdir(join(repository, '.ai-conductor'), { recursive: true });
  await writeFile(join(repository, '.ai-conductor', 'config.yml'), [
    'stacked_prs:',
    '  enabled: true',
    `  max_slices: ${maxSlices}`,
    '',
  ].join('\n'));
}

async function installOriginMainAt(tip: string): Promise<void> {
  await git(['update-ref', 'refs/remotes/origin/main', tip]);
  await git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
}

async function commitConfig(): Promise<void> {
  await git(['add', '.ai-conductor/config.yml']);
  await git(['commit', '-qm', 'configure stack']);
}

function events(): { emitter: ConductorEventEmitter; emitted: unknown[] } {
  const emitter = new ConductorEventEmitter();
  const emitted: unknown[] = [];
  emitter.on('child_started', (event) => { emitted.push(event); });
  emitter.on('child_closed', (event) => { emitted.push(event); });
  emitter.on('child_switched', (event) => { emitted.push(event); });
  return { emitter, emitted };
}

beforeEach(async () => {
  repository = await mkdtemp(join(tmpdir(), 'child-lifecycle-'));
  await git(['init', '-q', '-b', 'feat/daemon-demo']);
  await git(['config', 'user.email', 'test@example.com']);
  await git(['config', 'user.name', 'Test User']);
  await writeFile(join(repository, '.git', 'info', 'exclude'), '.pipeline/\n');
  await commit('A');
});

afterEach(async () => {
  await rm(repository, { recursive: true, force: true });
});

describe('startChild', () => {
  it('does not create a child ref or persist an event for the leaf position', async () => {
    await configure(2);
    await seal([1, 2]);
    const { emitter, emitted } = events();

    await expect(startChild(repository, 'demo', parseChildId(2)!, emitter)).resolves.toEqual({ kind: 'started' });

    await expect(git(['for-each-ref', '--format=%(refname)', 'refs/heads/feat/c'])).resolves.toBe('');
    await expect(readFile(join(repository, '.pipeline', 'children', '2'))).rejects.toMatchObject({ code: 'EISDIR' });
    expect(emitted).toEqual([]);
  });

  it('creates the first child at the leaf tip at region entry and seals the declared positions', async () => {
    await configure(2);
    await seal([1, 2]);
    const tip = await commit('H');
    const { emitter, emitted } = events();

    await expect(startChild(repository, 'demo', parseChildId(1)!, emitter)).resolves.toEqual({ kind: 'started' });

    await expect(git(['rev-parse', 'feat/c1/demo'])).resolves.toBe(`${tip}\n`);
    await expect(readFile(join(repository, '.pipeline', 'children', '1'))).rejects.toMatchObject({ code: 'EISDIR' });
    await expect(git(['cat-file', '-p', 'refs/conductor/demo/positions'])).resolves.toBe('[1,2]');
    expect(emitted).toEqual([]);
  });

  it('uses the previous declared child closure for a gap position', async () => {
    await configure(3);
    await seal([1, 3, 5]);
    const parentTip = await commit('B');
    await git(['update-ref', 'refs/conductor/demo/closed/c1', parentTip, '']);

    await expect(startChild(repository, 'demo', parseChildId(3)!, events().emitter)).resolves.toEqual({ kind: 'started' });

    await expect(git(['rev-parse', 'feat/c3/demo'])).resolves.toBe(`${parentTip}\n`);
    await expect(git(['show-ref', '--verify', '--quiet', 'refs/heads/feat/c2/demo'])).rejects.toMatchObject({ code: 1 });
  });

  it('refuses a reserved child namespace before creating the child branch', async () => {
    await configure(2);
    await seal([1, 2]);
    await git(['update-ref', 'refs/heads/feat/c1', 'HEAD']);

    await expect(startChild(repository, 'demo', parseChildId(1)!, events().emitter)).resolves.toMatchObject({
      kind: 'refused', reason: expect.stringContaining('refs/heads/feat/c1'),
    });

    await expect(git(['show-ref', '--verify', '--quiet', 'refs/heads/feat/c1/demo'])).rejects.toMatchObject({ code: 1 });
  });

  it('refuses when the fresh config maximum is below the sealed position count', async () => {
    await configure(2);
    await seal([1, 2, 3]);

    await expect(startChild(repository, 'demo', parseChildId(1)!, events().emitter)).resolves.toMatchObject({
      kind: 'refused', reason: expect.stringContaining('stacked_prs.max_slices'),
    });

    await expect(git(['show-ref', '--verify', '--quiet', 'refs/heads/feat/c1/demo'])).rejects.toMatchObject({ code: 1 });
  });

  it('refuses a compare-and-swap race without changing the existing child ref', async () => {
    await configure(3);
    await seal([1, 2, 3]);
    const parentTip = await commit('B');
    await git(['update-ref', 'refs/conductor/demo/closed/c1', parentTip, '']);
    const existing = await commit('C');
    await git(['update-ref', 'refs/heads/feat/c2/demo', existing, '']);

    await expect(startChild(repository, 'demo', parseChildId(2)!, events().emitter)).resolves.toMatchObject({
      kind: 'refused', reason: expect.stringContaining('refs/heads/feat/c2/demo'),
    });

    await expect(git(['rev-parse', 'feat/c2/demo'])).resolves.toBe(`${existing}\n`);
  });
});

describe('switchToChild', () => {
  const firstChild = { child: parseChildId(1)!, position: parseChildId(1)!, branch: 'feat/c1/demo' };
  const leafChild = { child: parseChildId(2)!, position: parseChildId(2)!, branch: 'feat/daemon-demo' };

  it('refuses dirty paths without altering the worktree or stash', async () => {
    await git(['branch', firstChild.branch]);
    await mkdir(join(repository, 'src'), { recursive: true });
    await writeFile(join(repository, 'src', 'a.ts'), 'committed work\n');
    await git(['add', 'src/a.ts']);
    await git(['commit', '-qm', 'track child source']);
    await writeFile(join(repository, 'src', 'a.ts'), 'uncommitted work\n');
    const stashBefore = await git(['stash', 'list']);

    await expect(switchToChild(repository, firstChild, events().emitter)).resolves.toMatchObject({
      kind: 'refused', reason: expect.stringContaining('src/a.ts'),
    });

    await expect(readFile(join(repository, 'src', 'a.ts'), 'utf8')).resolves.toBe('uncommitted work\n');
    await expect(git(['stash', 'list'])).resolves.toBe(stashBefore);
    await expect(git(['branch', '--show-current'])).resolves.toBe('feat/daemon-demo\n');
  });

  it('switches only a clean tree, clears the task stamp, and persists ordered lifecycle events', async () => {
    await git(['branch', firstChild.branch]);
    await mkdir(join(repository, '.pipeline'), { recursive: true });
    await writeFile(join(repository, '.pipeline', 'current-task'), '7\n');
    const entered = events();

    await expect(switchToChild(repository, firstChild, entered.emitter)).resolves.toEqual({ kind: 'completed' });

    await expect(git(['branch', '--show-current'])).resolves.toBe('feat/c1/demo\n');
    await expect(readFile(join(repository, '.pipeline', 'current-task'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(entered.emitted).toEqual([
      { type: 'child_started', child: 1, position: 1, branch: 'feat/c1/demo' },
    ]);

    await writeFile(join(repository, '.pipeline', 'current-task'), '7\n');
    const switched = events();
    await expect(switchToChild(repository, leafChild, switched.emitter, firstChild)).resolves.toEqual({ kind: 'completed' });

    await expect(git(['branch', '--show-current'])).resolves.toBe('feat/daemon-demo\n');
    await expect(readFile(join(repository, '.pipeline', 'current-task'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(switched.emitted).toEqual([
      { type: 'child_switched', from: 1, to: 2, position: 2, branch: 'feat/daemon-demo' },
      { type: 'child_started', child: 2, position: 2, branch: 'feat/daemon-demo' },
    ]);
  });

  it('never asks the Git boundary to stash or autostash on either outcome', async () => {
    const calls: string[][] = [];
    let statusChecks = 0;
    const gitRunner: StartChildGitRunner = async (args) => {
      calls.push(args);
      if (args[0] === 'status') {
        statusChecks += 1;
        return { exitCode: 0, stdout: statusChecks === 1 ? ' M src/a.ts\n' : '', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    await expect(switchToChild(repository, firstChild, events().emitter, undefined, { git: gitRunner }))
      .resolves.toMatchObject({ kind: 'refused', reason: expect.stringContaining('src/a.ts') });
    await expect(switchToChild(repository, firstChild, events().emitter, undefined, { git: gitRunner }))
      .resolves.toEqual({ kind: 'completed' });

    expect(calls).toContainEqual(['status', '--porcelain']);
    expect(calls).toContainEqual(['switch', 'feat/c1/demo']);
    expect(calls.flat()).not.toContain('stash');
    expect(calls.flat()).not.toContain('--autostash');
  });
});

describe('closeChild and moveLeaf', () => {
  const firstChild = { child: parseChildId(1)!, position: parseChildId(1)!, branch: 'feat/c1/demo' };
  const secondChild = { child: parseChildId(2)!, position: parseChildId(2)!, branch: 'feat/c2/demo' };

  async function startFirstChild(): Promise<void> {
    await configure(2);
    await seal([1, 2]);
    await commitConfig();
    await startChild(repository, 'demo', firstChild.child, events().emitter);
    await switchToChild(repository, firstChild, events().emitter);
  }

  it('closes child 1 at its tip and moves the two-child leaf without creating a child 2 ref', async () => {
    const base = (await git(['rev-parse', 'HEAD'])).trim();
    await installOriginMainAt(base);
    await startFirstChild();
    const childTip = await commit('C1');
    const closed = events();

    await expect(closeChild(repository, 'demo', firstChild, closed.emitter)).resolves.toEqual({ kind: 'completed' });
    await expect(moveLeaf(repository, 'demo', childTip)).resolves.toEqual({ kind: 'completed' });

    await expect(git(['rev-parse', 'refs/conductor/demo/closed/c1'])).resolves.toBe(`${childTip}\n`);
    await expect(git(['rev-parse', 'feat/daemon-demo'])).resolves.toBe(`${childTip}\n`);
    await expect(git(['show-ref', '--verify', '--quiet', 'refs/heads/feat/c2/demo'])).rejects.toMatchObject({ code: 1 });
    expect(closed.emitted).toEqual([
      { type: 'child_closed', child: 1, position: 1, branch: 'feat/c1/demo', tip: childTip },
    ]);
  });

  it('persists child close, switch, and start in order before work begins on the next child', async () => {
    await configure(3);
    await seal([1, 2, 3]);
    await commitConfig();
    await startChild(repository, 'demo', firstChild.child, events().emitter);
    await switchToChild(repository, firstChild, events().emitter);
    await commit('C1');
    const lifecycle = events();

    await expect(closeChild(repository, 'demo', firstChild, lifecycle.emitter)).resolves.toEqual({ kind: 'completed' });
    await expect(startChild(repository, 'demo', secondChild.child, lifecycle.emitter)).resolves.toEqual({ kind: 'started' });
    await expect(switchToChild(repository, secondChild, lifecycle.emitter, firstChild)).resolves.toEqual({ kind: 'completed' });

    expect(lifecycle.emitted.map((event) => (event as { type: string }).type)).toEqual([
      'child_closed', 'child_switched', 'child_started',
    ]);
    expect(lifecycle.emitted).toMatchObject([
      { child: 1, position: 1, branch: 'feat/c1/demo' },
      { from: 1, to: 2, position: 2, branch: 'feat/c2/demo' },
      { child: 2, position: 2, branch: 'feat/c2/demo' },
    ]);
  });

  it('refuses to move a leaf carrying a commit outside the child and origin main', async () => {
    const base = (await git(['rev-parse', 'HEAD'])).trim();
    await installOriginMainAt(base);
    await startFirstChild();
    const childTip = await commit('C1');
    await git(['switch', 'feat/daemon-demo']);
    const strayTip = await commit('stray leaf work');

    await expect(moveLeaf(repository, 'demo', childTip)).resolves.toMatchObject({
      kind: 'refused', reason: expect.stringContaining(strayTip),
    });
    await expect(git(['rev-parse', 'feat/daemon-demo'])).resolves.toBe(`${strayTip}\n`);
  });

  it('refuses a leaf compare-and-swap race and retains the concurrently written tip', async () => {
    const base = (await git(['rev-parse', 'HEAD'])).trim();
    await installOriginMainAt(base);
    await startFirstChild();
    const childTip = await commit('C1');
    await git(['switch', 'feat/daemon-demo']);
    const concurrentTip = await commit('concurrent leaf work');
    await git(['reset', '--hard', base]);
    const leafRef = 'refs/heads/feat/daemon-demo';
    const gitRunner: StartChildGitRunner = async (args) => {
      if (args[0] === 'update-ref' && args[1] === leafRef) {
        await git(['update-ref', leafRef, concurrentTip]);
        return { exitCode: 1, stdout: '', stderr: 'cannot lock ref' };
      }
      try {
        return { exitCode: 0, stdout: await git(args), stderr: '' };
      } catch (error: unknown) {
        return { exitCode: (error as { code?: number }).code ?? 1, stdout: '', stderr: '' };
      }
    };

    await expect(moveLeaf(repository, 'demo', childTip, { git: gitRunner })).resolves.toMatchObject({
      kind: 'refused', reason: expect.stringContaining('concurrent update'),
    });
    await expect(git(['rev-parse', 'feat/daemon-demo'])).resolves.toBe(`${concurrentTip}\n`);
  });

  it('moves from a pre-region halt-record tip once the child closes', async () => {
    await configure(2);
    await seal([1, 2]);
    await commitConfig();
    const base = (await git(['rev-parse', 'HEAD'])).trim();
    await installOriginMainAt(base);
    const haltTip = await commit('H');
    await startChild(repository, 'demo', firstChild.child, events().emitter);
    await switchToChild(repository, firstChild, events().emitter);
    const childTip = await commit('C1');

    await expect(moveLeaf(repository, 'demo', childTip)).resolves.toEqual({ kind: 'completed' });
    expect(haltTip).not.toBe(childTip);
    await expect(git(['rev-parse', 'feat/daemon-demo'])).resolves.toBe(`${childTip}\n`);
  });
});
