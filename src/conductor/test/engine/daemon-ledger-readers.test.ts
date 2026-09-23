// Covers: task:10
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLastExit, readLastMemorySample } from '../../src/engine/daemon-ledger-readers.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('daemon ledger readers', () => {
  it('returns the newest daemon memory sample', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-ledger-readers-'));
    roots.push(root);
    await mkdir(join(root, '.daemon'));
    const first = { type: 'daemon_memory_sample', rss: 100, pid: 1 };
    const latest = { type: 'daemon_memory_sample', rss: 200, pid: 1 };
    await writeFile(
      join(root, '.daemon', 'events.jsonl'),
      `${JSON.stringify(first)}\n${JSON.stringify(latest)}\n`,
      'utf8',
    );

    await expect(readLastMemorySample(root)).resolves.toEqual({ event: latest, skipped: 0 });
  });

  it('returns only the newest exit record for the requested pid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-ledger-readers-'));
    roots.push(root);
    await mkdir(join(root, '.daemon'));
    const otherPid = { type: 'daemon_exited', pid: 3, code: 1, signal: null, at: '2026-09-23T12:00:00.000Z' };
    const first = { type: 'daemon_exited', pid: 7, code: null, signal: 'SIGTERM', at: '2026-09-23T12:01:00.000Z' };
    const latest = { type: 'daemon_exited', pid: 7, code: 0, signal: null, at: '2026-09-23T12:02:00.000Z' };
    await writeFile(
      join(root, '.daemon', 'exit-events.jsonl'),
      `${JSON.stringify(otherPid)}\n${JSON.stringify(first)}\n${JSON.stringify(latest)}\n`,
      'utf8',
    );

    await expect(readLastExit(root, 7)).resolves.toEqual({ event: latest, skipped: 0 });
    await expect(readLastExit(root, 9)).resolves.toEqual({ event: null, skipped: 0 });
  });

  it('skips malformed lines while retaining the newest valid event', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-ledger-readers-'));
    roots.push(root);
    await mkdir(join(root, '.daemon'));
    const latest = { type: 'daemon_memory_sample', rss: 200, pid: 1 };
    await writeFile(
      join(root, '.daemon', 'events.jsonl'),
      `${JSON.stringify({ type: 'daemon_memory_sample', rss: 100, pid: 1 })}\nnot json\n${JSON.stringify(latest)}\n`,
      'utf8',
    );

    await expect(readLastMemorySample(root)).resolves.toEqual({ event: latest, skipped: 1 });
  });

  it('treats an absent ledger as empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-ledger-readers-'));
    roots.push(root);

    await expect(readLastExit(root, 7)).resolves.toEqual({ event: null, skipped: 0 });
    await expect(readLastMemorySample(root)).resolves.toEqual({ event: null, skipped: 0 });
  });

  it('returns an error result when a ledger cannot be read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-ledger-readers-'));
    roots.push(root);
    await mkdir(join(root, '.daemon', 'events.jsonl'), { recursive: true });

    await expect(readLastMemorySample(root)).resolves.toMatchObject({ error: expect.any(Error) });
  });
});
