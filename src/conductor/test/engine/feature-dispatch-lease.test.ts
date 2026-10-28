import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireFeatureDispatchLease,
  type FeatureDispatchLeaseOwner,
} from '../../src/engine/feature-dispatch-lease.js';

// Covers: task:1

const temporaryDirectories: string[] = [];

async function createRepository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'feature-dispatch-lease-'));
  temporaryDirectories.push(directory);
  return directory;
}

function leasePath(repositoryRoot: string, slug = 'demo'): string {
  return join(repositoryRoot, '.daemon', 'leases', slug);
}

function ownerPath(repositoryRoot: string, slug = 'demo'): string {
  return join(leasePath(repositoryRoot, slug), 'owner.json');
}

function leaseOptions(processStarts: Record<number, string | undefined>, token: string) {
  return {
    hostname: () => 'local-host',
    pid: 123,
    processStartTime: async (pid: number) => processStarts[pid],
    newToken: () => token,
  };
}

async function acquire(
  repositoryRoot: string,
  purpose: string,
  processStarts: Record<number, string | undefined> = { 123: 'current-start' },
  token = 'current-token',
) {
  return acquireFeatureDispatchLease(
    repositoryRoot,
    'demo',
    purpose,
    leaseOptions(processStarts, token),
  );
}

function expectAcquired(
  result: Awaited<ReturnType<typeof acquireFeatureDispatchLease>>,
): asserts result is Extract<Awaited<ReturnType<typeof acquireFeatureDispatchLease>>, { kind: 'acquired' }> {
  expect(result.kind).toBe('acquired');
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('feature dispatch lease', () => {
  it('writes the dispatch owner record for a free feature lease and removes it on release', async () => {
    const repositoryRoot = await createRepository();
    const acquired = await acquire(repositoryRoot, 'daemon dispatch');
    expectAcquired(acquired);

    await expect(readFile(ownerPath(repositoryRoot), 'utf8')).resolves.toSatisfy((serialized) => {
      expect(JSON.parse(serialized)).toEqual({
        host: 'local-host',
        pid: 123,
        processStartTime: 'current-start',
        token: 'current-token',
        purpose: 'daemon dispatch',
      } satisfies FeatureDispatchLeaseOwner);
      return true;
    });

    await expect(acquired.lease.release()).resolves.toEqual({ ok: true });
    await expect(readFile(ownerPath(repositoryRoot), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a live owner without changing its record', async () => {
    const repositoryRoot = await createRepository();
    const held = await acquire(repositoryRoot, 'operator stack land');
    expectAcquired(held);
    const before = await readFile(ownerPath(repositoryRoot), 'utf8');

    const refused = await acquire(repositoryRoot, 'daemon dispatch');

    expect(refused).toEqual({
      kind: 'live-owner',
      owner: {
        host: 'local-host',
        pid: 123,
        processStartTime: 'current-start',
        token: 'current-token',
        purpose: 'operator stack land',
      },
    });
    await expect(readFile(ownerPath(repositoryRoot), 'utf8')).resolves.toBe(before);
    await held.lease.release();
  });

  it('reclaims a lease from a dead pid', async () => {
    const repositoryRoot = await createRepository();
    const held = await acquireFeatureDispatchLease(
      repositoryRoot,
      'demo',
      'operator stack land',
      { ...leaseOptions({ 456: 'dead-owner-start' }, 'dead-owner-token'), pid: 456 },
    );
    expectAcquired(held);

    const reclaimed = await acquire(repositoryRoot, 'daemon dispatch', { 123: 'replacement-start' }, 'replacement-token');
    expectAcquired(reclaimed);
    await expect(readFile(ownerPath(repositoryRoot), 'utf8')).resolves.toContain('replacement-token');
    await reclaimed.lease.release();
  });

  it('reclaims a lease from a reused pid with a different process start time', async () => {
    const repositoryRoot = await createRepository();
    const held = await acquire(repositoryRoot, 'operator stack land');
    expectAcquired(held);

    const reclaimed = await acquire(repositoryRoot, 'daemon dispatch', { 123: 'replacement-start' }, 'replacement-token');
    expectAcquired(reclaimed);
    await expect(readFile(ownerPath(repositoryRoot), 'utf8')).resolves.toContain('replacement-token');
    await reclaimed.lease.release();
  });

  it('refuses an unreadable owner record without reclaiming its lease', async () => {
    const repositoryRoot = await createRepository();
    const directory = leasePath(repositoryRoot);
    await mkdir(directory, { recursive: true });
    await writeFile(ownerPath(repositoryRoot), 'this is not json');
    const before = await readFile(ownerPath(repositoryRoot), 'utf8');

    const refused = await acquire(repositoryRoot, 'daemon dispatch');

    expect(refused).toEqual({ kind: 'unreadable-owner', leasePath: directory });
    await expect(readFile(ownerPath(repositoryRoot), 'utf8')).resolves.toBe(before);
  });
});
