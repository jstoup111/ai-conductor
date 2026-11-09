// Covers: task:12
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { hasDurableChildState } from '../../src/engine/child-cursor.js';
import {
  appendHaltRecordRef,
  haltRecordRefFor,
  readHaltRecordRef,
} from '../../src/engine/halt-record-ref.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { deleteFeatureConductorRefs, featureConductorRefNames } from '../../src/engine/restack/restack-refs-cleanup.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'halt-record-ref-'));
  repositories.push(repo);
  const nativeGit = (args: string[]) => execFile('git', args, { cwd: repo });
  await nativeGit(['init', '-q', '-b', 'main']);
  await nativeGit(['config', 'user.email', 'halt-record@example.test']);
  await nativeGit(['config', 'user.name', 'Halt record']);
  await writeFile(join(repo, 'base.txt'), 'base\n');
  await nativeGit(['add', 'base.txt']);
  await nativeGit(['commit', '-qm', 'base']);
  return { repo, git: makeGitRunner(repo) };
}

describe('halt-record ref store (real local Git)', () => {
  it('appends a one-file record history without changing a branch', async () => {
    const subject = await fixture();
    const first = await appendHaltRecordRef(subject.repo, 'demo', 'Status: halted\n', undefined);
    if (first.kind !== 'updated') throw new Error('first append should update');
    const second = await appendHaltRecordRef(subject.repo, 'demo', 'Status: resolved\n', first.commit);
    if (second.kind !== 'updated') throw new Error('second append should update');

    await expect(subject.git(['rev-list', '--parents', '-n', '1', second.commit])).resolves.toMatchObject({
      stdout: `${second.commit} ${first.commit}`,
    });
    await expect(subject.git(['ls-tree', '-r', '--name-only', second.commit])).resolves.toMatchObject({
      stdout: '.docs/halted/demo.md',
    });
    await expect(subject.git(['log', '-p', haltRecordRefFor('demo')])).resolves.toMatchObject({
      stdout: expect.stringContaining('+Status: halted'),
    });
    await expect(readHaltRecordRef(subject.repo, 'demo')).resolves.toEqual({
      kind: 'record', source: 'ref', commit: second.commit, text: 'Status: resolved',
    });
  });

  it('reads the committed record when no halt-record ref exists', async () => {
    const subject = await fixture();
    const path = join(subject.repo, '.docs', 'halted', 'demo.md');
    await mkdir(join(subject.repo, '.docs', 'halted'), { recursive: true });
    await writeFile(path, 'Status: halted\n');
    await subject.git(['add', '.docs/halted/demo.md']);
    await subject.git(['commit', '-qm', 'legacy halt record']);
    const head = (await subject.git(['rev-parse', 'HEAD'])).stdout;

    await expect(readHaltRecordRef(subject.repo, 'demo')).resolves.toEqual({
      kind: 'record', source: 'head', commit: head, text: 'Status: halted',
    });
  });

  it('refuses an append when the observed ref value is stale', async () => {
    const subject = await fixture();
    const first = await appendHaltRecordRef(subject.repo, 'demo', 'Status: halted\n', undefined);
    if (first.kind !== 'updated') throw new Error('first append should update');
    const competing = await appendHaltRecordRef(subject.repo, 'demo', 'Status: competing\n', first.commit);
    if (competing.kind !== 'updated') throw new Error('competing append should update');

    await expect(appendHaltRecordRef(subject.repo, 'demo', 'Status: resolved\n', first.commit)).resolves.toEqual({ kind: 'stale' });
    await expect(subject.git(['rev-parse', haltRecordRefFor('demo')])).resolves.toMatchObject({ stdout: competing.commit });
  });

  it('joins the finite feature teardown list and is deleted with its feature refs', async () => {
    const subject = await fixture();
    const written = await appendHaltRecordRef(subject.repo, 'demo', 'Status: halted\n', undefined);
    if (written.kind !== 'updated') throw new Error('append should update');

    expect(featureConductorRefNames('demo')).toContain(haltRecordRefFor('demo'));
    await expect(deleteFeatureConductorRefs('demo', subject.git)).resolves.toBe(true);
    await expect(subject.git(['rev-parse', '-q', '--verify', haltRecordRefFor('demo')])).resolves.toMatchObject({ exitCode: 1 });
  });

  it('does not treat a halt-record ref alone as durable child state', async () => {
    const subject = await fixture();
    const written = await appendHaltRecordRef(subject.repo, 'demo', 'Status: halted\n', undefined);
    if (written.kind !== 'updated') throw new Error('append should update');

    await expect(hasDurableChildState(subject.repo, 'demo', { git: subject.git })).resolves.toBe(false);
  });
});
