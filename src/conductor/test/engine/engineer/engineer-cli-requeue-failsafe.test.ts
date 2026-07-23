// Task 13: Bulk requeue liveness is fail-safe on an unreadable issue state
// (Story 7 negative, FR-9). A `gh` error/unknown state for an entry NEVER
// forgets it — the error is surfaced for that entry, and the run continues
// for the rest of the batch.

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

describe('engineer requeue --stale: fail-safe liveness (Task 13)', () => {
  it('gh error for an entry never forgets it, error surfaced, batch continues', async () => {
    const testDir = `/tmp/requeue-failsafe-test-${Date.now()}-${Math.random()}`;
    try {
      const { engDir, ledgerPath, ledger } = await makeLedger(testDir);

      await ledger.record({ source: GITHUB_ISSUES_SOURCE, sourceRef: 'o/a#20' }); // gh errors
      await ledger.transition(GITHUB_ISSUES_SOURCE, 'o/a#20', 'claimed');
      await ledger.record({ source: GITHUB_ISSUES_SOURCE, sourceRef: 'o/a#21' }); // open, requeued fine
      await ledger.transition(GITHUB_ISSUES_SOURCE, 'o/a#21', 'claimed');

      const raw = JSON.parse(await readFile(ledgerPath, 'utf8'));
      const keyFor = (ref: string) => Object.keys(raw).find((k) => k.includes(ref))!;
      const errorKey = keyFor('o/a#20');
      const openKey = keyFor('o/a#21');
      const staleTs = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      raw[errorKey].lastSeenAt = staleTs;
      raw[openKey].lastSeenAt = staleTs;
      await writeFile(ledgerPath, JSON.stringify(raw, null, 2));

      const { out, opts } = captureOut();
      const gh = async (args: string[]) => {
        if (args.includes('20')) {
          throw new Error('gh: network error');
        }
        return { stdout: JSON.stringify({ state: 'OPEN' }) };
      };

      const code = await dispatchEngineer(
        { kind: 'requeue', stale: true, olderThan: '24h' },
        { ...opts(), engineerDir: engDir, gh },
      );

      expect(code).toBe(0);
      const parsed = JSON.parse(out[0]);
      expect(parsed.kind).toBe('requeue');
      expect(parsed.requeued).toEqual(['o/a#21']);
      expect(parsed.dropped ?? []).toEqual([]);
      expect(parsed.errors).toHaveLength(1);
      expect(parsed.errors[0].sourceRef).toBe('o/a#20');

      // Never forgotten — entry still present, still claimed (fail-safe: not
      // requeued either, since liveness could not be confirmed).
      const after = JSON.parse(await readFile(ledgerPath, 'utf8'));
      expect(after[errorKey]).toBeDefined();
      expect(after[errorKey].status).toBe('claimed');
      expect(after[openKey].status).toBe('pending');
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('unparseable sourceRef never forgets, surfaces error, run continues', async () => {
    const testDir = `/tmp/requeue-failsafe-unparse-${Date.now()}-${Math.random()}`;
    try {
      const { engDir, ledgerPath, ledger } = await makeLedger(testDir);

      await ledger.record({ source: GITHUB_ISSUES_SOURCE, sourceRef: 'not-a-valid-ref' });
      await ledger.transition(GITHUB_ISSUES_SOURCE, 'not-a-valid-ref', 'claimed');

      const raw = JSON.parse(await readFile(ledgerPath, 'utf8'));
      const key = Object.keys(raw)[0];
      raw[key].lastSeenAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      await writeFile(ledgerPath, JSON.stringify(raw, null, 2));

      const { out, opts } = captureOut();
      const gh = async () => ({ stdout: JSON.stringify({ state: 'OPEN' }) });

      const code = await dispatchEngineer(
        { kind: 'requeue', stale: true, olderThan: '24h' },
        { ...opts(), engineerDir: engDir, gh },
      );

      expect(code).toBe(0);
      const parsed = JSON.parse(out[0]);
      expect(parsed.requeued).toEqual([]);
      expect(parsed.dropped ?? []).toEqual([]);
      expect(parsed.errors).toHaveLength(1);
      expect(parsed.errors[0].sourceRef).toBe('not-a-valid-ref');

      const after = JSON.parse(await readFile(ledgerPath, 'utf8'));
      expect(after[key]).toBeDefined();
      expect(after[key].status).toBe('claimed');
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
