// Covers: task:6
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startChild } from '../../src/engine/child-lifecycle.js';
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

function events(): { emitter: ConductorEventEmitter; emitted: unknown[] } {
  const emitter = new ConductorEventEmitter();
  const emitted: unknown[] = [];
  emitter.on('child_started', (event) => emitted.push(event));
  emitter.on('child_closed', (event) => emitted.push(event));
  emitter.on('child_switched', (event) => emitted.push(event));
  return { emitter, emitted };
}

beforeEach(async () => {
  repository = await mkdtemp(join(tmpdir(), 'child-lifecycle-'));
  await git(['init', '-q', '-b', 'feat/daemon-demo']);
  await git(['config', 'user.email', 'test@example.com']);
  await git(['config', 'user.name', 'Test User']);
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
