// Test: restart-marker module (consume-once pending restart).
//
// Per adr-2026-07-04-pending-restart-queue: `.daemon/RESTART-PENDING` carries a
// single logical restart intent, is idempotent under repeated writes (one fire,
// refreshed payload), and is consumed exactly once — at the next boot — with an
// absent marker being a no-op rather than an error.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { writeRestartPending, consumeOnBoot, RESTART_MARKER } from '../../src/engine/restart-marker.js';

const tempRoots: string[] = [];
async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'restart-marker-'));
  tempRoots.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('RESTART_MARKER path', () => {
  it('is .daemon/RESTART-PENDING', () => {
    expect(RESTART_MARKER).toBe('.daemon/RESTART-PENDING');
  });
});

describe('writeRestartPending', () => {
  it('creates the marker file at .daemon/RESTART-PENDING', async () => {
    const repo = await tempRepo();
    await writeRestartPending(repo, { blockingSlug: 'f0' });

    const raw = await readFile(join(repo, RESTART_MARKER), 'utf-8');
    const payload = JSON.parse(raw);
    expect(payload.blockingSlug).toBe('f0');
    expect(typeof payload.requestedAt).toBe('string');
  });

  it('is idempotent: two writes still produce exactly one marker file (one logical intent)', async () => {
    const repo = await tempRepo();
    await writeRestartPending(repo, { blockingSlug: 'f0' });
    await writeRestartPending(repo, { blockingSlug: 'f0' });

    const entries = await readdir(join(repo, '.daemon'));
    expect(entries).toEqual(['RESTART-PENDING']);
  });

  it('a second write refreshes the informational payload (latest blockingSlug wins)', async () => {
    const repo = await tempRepo();
    await writeRestartPending(repo, { blockingSlug: 'f0', requestedBy: 'alice' });
    await writeRestartPending(repo, { blockingSlug: 'f1', requestedBy: 'bob' });

    const raw = await readFile(join(repo, RESTART_MARKER), 'utf-8');
    const payload = JSON.parse(raw);
    expect(payload.blockingSlug).toBe('f1');
    expect(payload.requestedBy).toBe('bob');
  });
});

describe('consumeOnBoot', () => {
  it('atomically removes the marker and returns the queued intent', async () => {
    const repo = await tempRepo();
    await writeRestartPending(repo, { blockingSlug: 'f0', requestedBy: 'alice' });

    const intent = await consumeOnBoot(repo);

    expect(intent).toBeTruthy();
    expect(intent?.blockingSlug).toBe('f0');
    expect(intent?.requestedBy).toBe('alice');
    await expect(readFile(join(repo, RESTART_MARKER), 'utf-8')).rejects.toThrow();
  });

  it('consume of an absent marker is a no-op that returns null', async () => {
    const repo = await tempRepo();
    const intent = await consumeOnBoot(repo);
    expect(intent).toBeNull();
  });

  it('a second consume after firing returns null — never fires twice', async () => {
    const repo = await tempRepo();
    await writeRestartPending(repo, { blockingSlug: 'f0' });

    const first = await consumeOnBoot(repo);
    const second = await consumeOnBoot(repo);

    expect(first).toBeTruthy();
    expect(second).toBeNull();
  });

  it('a corrupted marker is still consumed (removed) rather than left dangling', async () => {
    const repo = await tempRepo();
    await writeRestartPending(repo, { blockingSlug: 'f0' });
    // Corrupt the marker in place.
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(repo, RESTART_MARKER), '{not valid json', 'utf-8');

    const intent = await consumeOnBoot(repo);

    expect(intent).toBeTruthy();
    await expect(readFile(join(repo, RESTART_MARKER), 'utf-8')).rejects.toThrow();
  });
});
