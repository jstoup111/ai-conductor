// Covers: task:3
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import {
  activePublicationRecord,
  publicationRefFor,
  readPublicationRecord,
  writePublicationRecord,
  type PublicationRecord,
} from '../../src/engine/stack-publication-record.js';

const c1 = parseChildId(1)!;
const c3 = parseChildId(3)!;
const c5 = parseChildId(5)!;

const record: PublicationRecord = {
  version: 1,
  retarget: { from: 'main', to: 'feat/c3/demo', phase: 'intended' },
  stack: { number: 42, verified: false },
  members: [
    { position: c1, branch: 'feat/c1/demo', pr: 101 },
    { position: c3, branch: 'feat/c3/demo', pr: 103 },
    { position: c5, branch: 'feat/daemon-demo', pr: 500 },
  ],
};

let repository: string;

async function git(args: string[], input?: string) {
  return makeGitRunner(repository)(args, input === undefined ? undefined : { input });
}

async function writeRawRecord(value: unknown): Promise<string> {
  const blob = await git(['hash-object', '-w', '--stdin'], JSON.stringify(value));
  expect(blob.exitCode).toBe(0);
  const written = await git(['update-ref', publicationRefFor('demo'), blob.stdout.trim()]);
  expect(written.exitCode).toBe(0);
  return blob.stdout.trim();
}

beforeEach(async () => {
  repository = await mkdtemp(join(tmpdir(), 'stack-publication-record-'));
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'publication@example.invalid']);
  await git(['config', 'user.name', 'Publication record']);
  await writeFile(join(repository, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
});

afterEach(async () => {
  await rm(repository, { recursive: true, force: true });
});

describe('ref-backed stack publication record', () => {
  it('round-trips a versioned, sealed-position-ordered publication record through its ref', async () => {
    await expect(writePublicationRecord(repository, 'demo', undefined, record)).resolves.toEqual({ kind: 'updated' });

    const read = await readPublicationRecord(repository, 'demo');
    expect(read).toMatchObject({ kind: 'record', slug: 'demo', record });
    if (read.kind !== 'record') throw new Error('expected a stored publication record');
    expect(read.record.members.map((member) => member.position)).toEqual([c1, c3, c5]);
    await expect(git(['cat-file', '-p', publicationRefFor('demo')])).resolves.toMatchObject({
      exitCode: 0,
      stdout: JSON.stringify(record),
    });
  });

  it('refuses a stale compare-and-swap write without moving the ref', async () => {
    await writePublicationRecord(repository, 'demo', undefined, record);
    const stored = await readPublicationRecord(repository, 'demo');
    if (stored.kind !== 'record') throw new Error('expected a stored publication record');

    const competingBlob = await writeRawRecord({ ...record, retarget: { ...record.retarget!, phase: 'observed' } });
    await expect(writePublicationRecord(repository, 'demo', stored, { ...record, tornDown: true }))
      .resolves.toEqual({ kind: 'cas-failed' });
    await expect(git(['rev-parse', publicationRefFor('demo')])).resolves.toMatchObject({
      exitCode: 0,
      stdout: competingBlob,
    });
  });

  it('hides a torn-down record and lets a subsequent feature replace it', async () => {
    await writePublicationRecord(repository, 'demo', undefined, { ...record, tornDown: true });
    await expect(activePublicationRecord(repository, 'demo')).resolves.toBeUndefined();

    const tornDown = await readPublicationRecord(repository, 'demo');
    if (tornDown.kind !== 'record') throw new Error('expected a stored torn-down record');
    await expect(writePublicationRecord(repository, 'demo', tornDown, record)).resolves.toEqual({ kind: 'updated' });
    await expect(activePublicationRecord(repository, 'demo')).resolves.toMatchObject({ record });
  });

  it('reports named diagnostics for an unknown record version and a member without a PR number', async () => {
    await writeRawRecord({ ...record, version: 2 });
    await expect(readPublicationRecord(repository, 'demo')).resolves.toMatchObject({
      kind: 'unreadable', diagnostic: 'unknown-version',
    });

    await writeRawRecord({ ...record, members: [{ position: c1, branch: 'feat/c1/demo' }] });
    await expect(readPublicationRecord(repository, 'demo')).resolves.toMatchObject({
      kind: 'unreadable', diagnostic: 'member-pr-missing',
    });
  });
});
