// Covers: task:10
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDaemonTimeline, readLastExit } from '../../src/engine/daemon-ledger-readers.js';

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

    const timeline = await readDaemonTimeline(root);
    expect(timeline).toMatchObject({ skipped: 0 });
    if ('event' in timeline) expect(timeline.event?.at(-1)).toEqual(latest);
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

  it('selects the newest exit by timestamp when the ledger is physically out of order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-ledger-readers-'));
    roots.push(root);
    await mkdir(join(root, '.daemon'));
    const newest = { type: 'daemon_exited', pid: 7, code: 0, signal: null, at: '2026-09-23T12:02:00.000Z' };
    const older = { type: 'daemon_exited', pid: 7, code: null, signal: 'SIGTERM', at: '2026-09-23T12:01:00.000Z' };
    await writeFile(join(root, '.daemon', 'exit-events.jsonl'), `${JSON.stringify(newest)}\n${JSON.stringify(older)}\n`, 'utf8');

    await expect(readLastExit(root, 7)).resolves.toEqual({ event: newest, skipped: 0 });
  });

  it('interleaves both ledgers in timestamp order with a combined skipped count', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-ledger-readers-'));
    roots.push(root);
    await mkdir(join(root, '.daemon'));
    const exit = { type: 'daemon_exited', pid: 7, code: null, signal: 'SIGKILL', at: '2026-09-23T12:02:00.000Z' };
    const early = { type: 'daemon_memory_sample', pid: 7, rss: 100, ts: '2026-09-23T12:01:00.000Z' };
    const late = { type: 'daemon_memory_sample', pid: 7, rss: 200, ts: '2026-09-23T12:03:00.000Z' };
    await writeFile(join(root, '.daemon', 'exit-events.jsonl'), `not json\n${JSON.stringify(exit)}\n`, 'utf8');
    await writeFile(join(root, '.daemon', 'events.jsonl'), `${JSON.stringify(late)}\n${JSON.stringify(early)}\n`, 'utf8');

    await expect(readDaemonTimeline(root)).resolves.toEqual({ event: [early, exit, late], skipped: 1 });
  });

  it('skips malformed lines while retaining valid memory samples', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-ledger-readers-'));
    roots.push(root);
    await mkdir(join(root, '.daemon'));
    const latest = { type: 'daemon_memory_sample', rss: 200, pid: 1 };
    await writeFile(
      join(root, '.daemon', 'events.jsonl'),
      `${JSON.stringify({ type: 'daemon_memory_sample', rss: 100, pid: 1 })}\nnot json\n${JSON.stringify(latest)}\n`,
      'utf8',
    );

    await expect(readDaemonTimeline(root)).resolves.toEqual({
      event: [{ type: 'daemon_memory_sample', rss: 100, pid: 1 }, latest],
      skipped: 1,
    });
  });

  it('treats an absent ledger as empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-ledger-readers-'));
    roots.push(root);

    await expect(readLastExit(root, 7)).resolves.toEqual({ event: null, skipped: 0 });
    await expect(readDaemonTimeline(root)).resolves.toEqual({ event: [], skipped: 0 });
  });

  it('returns an error result when a ledger cannot be read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-ledger-readers-'));
    roots.push(root);
    await mkdir(join(root, '.daemon', 'events.jsonl'), { recursive: true });

    await expect(readDaemonTimeline(root)).resolves.toMatchObject({ error: expect.any(Error) });
  });
});
