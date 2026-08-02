// Task 11: `engineer requeue --stale [--older-than <dur>]` bulk verb — happy path.
//
// Bulk-requeues stale `claimed` ledger entries to `pending`, leaves newer ones
// untouched, and prints a JSON summary (Story 6, FR-8).

import { describe, it, expect } from 'vitest';
import { dispatchEngineer, detectEngineerCommand } from '../../../src/engine/engineer-cli.js';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';
import { createFileQueue } from '../../../src/engine/engineer/intake/queue.js';

const GITHUB_ISSUES_SOURCE = 'github-issues';

function captureOut() {
  const out: string[] = [];
  const err: string[] = [];
  const opts = (extra: Partial<Parameters<typeof dispatchEngineer>[1]>): Parameters<typeof dispatchEngineer>[1] => ({
    print: (s) => out.push(s),
    printErr: (s) => err.push(s),
    ...extra,
  });
  return { out, err, opts };
}

async function makeLedger(testDir: string) {
  const engDir = join(testDir, 'engineer');
  await mkdir(engDir, { recursive: true });
  const ledgerPath = join(engDir, 'ledger.json');
  return { engDir, ledgerPath, ledger: createLedger(ledgerPath) };
}

describe('detectEngineerCommand: requeue --stale', () => {
  it('parses --stale and --older-than', () => {
    const dispatch = detectEngineerCommand(['node', 'x', 'engineer', 'requeue', '--stale', '--older-than', '2d']);
    expect(dispatch).toMatchObject({ kind: 'requeue', stale: true, olderThan: '2d' });
  });

  it('parses --stale without --older-than', () => {
    const dispatch = detectEngineerCommand(['node', 'x', 'engineer', 'requeue', '--stale']);
    expect(dispatch).toMatchObject({ kind: 'requeue', stale: true, olderThan: undefined });
  });

  it('missing --stale → guide', () => {
    const dispatch = detectEngineerCommand(['node', 'x', 'engineer', 'requeue']);
    expect(dispatch).toMatchObject({ kind: 'guide' });
  });
});

describe('engineer requeue --stale: happy path (Task 11)', () => {
  it('requeues only entries older than the window, leaves newer ones untouched', async () => {
    const testDir = `/tmp/requeue-test-${Date.now()}-${Math.random()}`;
    try {
      const { engDir, ledgerPath, ledger } = await makeLedger(testDir);

      // Old stale entry (25h ago)
      await ledger.record({ source: GITHUB_ISSUES_SOURCE, sourceRef: 'o/a#1' });
      await ledger.transition(GITHUB_ISSUES_SOURCE, 'o/a#1', 'claimed');
      // New entry (1h ago) — within window
      await ledger.record({ source: GITHUB_ISSUES_SOURCE, sourceRef: 'o/a#2' });
      await ledger.transition(GITHUB_ISSUES_SOURCE, 'o/a#2', 'claimed');

      const raw = JSON.parse(await readFile(ledgerPath, 'utf8'));
      const keyFor = (ref: string) => Object.keys(raw).find((k) => k.includes(ref))!;
      const oldKey = keyFor('o/a#1');
      const newKey = keyFor('o/a#2');
      raw[oldKey].lastSeenAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      raw[newKey].lastSeenAt = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      await import('node:fs/promises').then((fs) => fs.writeFile(ledgerPath, JSON.stringify(raw, null, 2)));

      const { out, err, opts } = captureOut();
      // Issues are open — liveness (Task 12/13) never drops anything in this test.
      const gh = async () => ({ stdout: JSON.stringify({ state: 'OPEN' }) });

      const code = await dispatchEngineer(
        { kind: 'requeue', stale: true, olderThan: '24h' },
        { ...opts({}), engineerDir: engDir, gh },
      );

      expect(code).toBe(0);
      expect(err.length).toBe(0);
      expect(out.length).toBe(1);
      const parsed = JSON.parse(out[0]);
      expect(parsed.kind).toBe('requeue');
      expect(parsed.requeued).toEqual(['o/a#1']);
      expect(parsed.count).toBe(1);

      const after = JSON.parse(await readFile(ledgerPath, 'utf8'));
      expect(after[oldKey].status).toBe('pending');
      expect(after[newKey].status).toBe('claimed');
      expect(await createFileQueue(join(engDir, 'inbox')).list()).toEqual([
        expect.objectContaining({
          source: GITHUB_ISSUES_SOURCE,
          sourceRef: 'o/a#1',
          status: 'pending',
          receivedAt: after[oldKey].capturedAt,
        }),
      ]);
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('rejects a malformed --older-than duration instead of applying the default window', async () => {
    const testDir = `/tmp/requeue-invalid-duration-${Date.now()}-${Math.random()}`;
    try {
      const { engDir, ledgerPath, ledger } = await makeLedger(testDir);
      await ledger.record({ source: GITHUB_ISSUES_SOURCE, sourceRef: 'o/a#3' });
      await ledger.transition(GITHUB_ISSUES_SOURCE, 'o/a#3', 'claimed');

      const raw = JSON.parse(await readFile(ledgerPath, 'utf8'));
      const key = Object.keys(raw).find((candidate) => candidate.includes('o/a#3'))!;
      raw[key].lastSeenAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      await import('node:fs/promises').then((fs) => fs.writeFile(ledgerPath, JSON.stringify(raw, null, 2)));

      const { out, err, opts } = captureOut();
      const code = await dispatchEngineer(
        { kind: 'requeue', stale: true, olderThan: '24hours' },
        { ...opts({}), engineerDir: engDir, gh: async () => ({ stdout: JSON.stringify({ state: 'OPEN' }) }) },
      );

      expect(code).toBe(1);
      expect(out).toEqual([]);
      expect(err.join('\n')).toContain('invalid --older-than "24hours"');
      expect((await createLedger(ledgerPath).get(GITHUB_ISSUES_SOURCE, 'o/a#3'))?.status).toBe('claimed');
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
