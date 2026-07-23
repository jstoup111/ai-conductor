// Task 12: Bulk requeue liveness — closed issue is dropped, not requeued
// (Story 7, FR-9, #279). A stale `claimed` entry whose issue is closed is
// forgotten (dropped); one whose issue is open is requeued. The summary
// distinguishes requeued vs dropped.

import { describe, it, expect } from 'vitest';
import { dispatchEngineer } from '../../../src/engine/engineer-cli.js';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';

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

describe('engineer requeue --stale: liveness (Task 12)', () => {
  it('closed-issue stale entry is dropped (forgotten), open one is requeued', async () => {
    const testDir = `/tmp/requeue-liveness-test-${Date.now()}-${Math.random()}`;
    try {
      const { engDir, ledgerPath, ledger } = await makeLedger(testDir);

      await ledger.record({ source: GITHUB_ISSUES_SOURCE, sourceRef: 'o/a#10' }); // will be closed
      await ledger.transition(GITHUB_ISSUES_SOURCE, 'o/a#10', 'claimed');
      await ledger.record({ source: GITHUB_ISSUES_SOURCE, sourceRef: 'o/a#11' }); // will be open
      await ledger.transition(GITHUB_ISSUES_SOURCE, 'o/a#11', 'claimed');

      const raw = JSON.parse(await readFile(ledgerPath, 'utf8'));
      const keyFor = (ref: string) => Object.keys(raw).find((k) => k.includes(ref))!;
      const closedKey = keyFor('o/a#10');
      const openKey = keyFor('o/a#11');
      const staleTs = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      raw[closedKey].lastSeenAt = staleTs;
      raw[openKey].lastSeenAt = staleTs;
      await writeFile(ledgerPath, JSON.stringify(raw, null, 2));

      const { out, err, opts } = captureOut();
      const gh = async (args: string[]) => {
        if (args.includes('10')) {
          return { stdout: JSON.stringify({ state: 'CLOSED' }) };
        }
        return { stdout: JSON.stringify({ state: 'OPEN' }) };
      };

      const code = await dispatchEngineer(
        { kind: 'requeue', stale: true, olderThan: '24h' },
        { ...opts(), engineerDir: engDir, gh },
      );

      expect(code).toBe(0);
      expect(err.length).toBe(0);
      const parsed = JSON.parse(out[0]);
      expect(parsed.kind).toBe('requeue');
      expect(parsed.requeued).toEqual(['o/a#11']);
      expect(parsed.dropped).toEqual(['o/a#10']);

      const after = JSON.parse(await readFile(ledgerPath, 'utf8'));
      expect(after[closedKey]).toBeUndefined();
      expect(after[openKey].status).toBe('pending');
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
