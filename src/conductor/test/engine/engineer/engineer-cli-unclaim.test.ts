// Task 8: `engineer unclaim <ref>` verb — happy path (single-idea recovery, FR-5).
//
// Dispatching `engineer unclaim owner/repo#N` on a `claimed` ledger entry requeues
// it back to `pending` (preserving capturedAt) and reports success.

import { describe, it, expect } from 'vitest';
import { dispatchEngineer } from '../../../src/engine/engineer-cli.js';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';

describe('engineer unclaim: happy path (Task 8)', () => {
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

  it('claimed entry → unclaim → becomes pending, capturedAt preserved, success reported', async () => {
    const testDir = `/tmp/unclaim-test-${Date.now()}-${Math.random()}`;
    try {
      const engDir = join(testDir, 'engineer');
      await mkdir(engDir, { recursive: true });
      const ledgerPath = join(engDir, 'ledger.json');

      const ledger = createLedger(ledgerPath);
      await ledger.record({ source: GITHUB_ISSUES_SOURCE, sourceRef: 'o/a#1' });
      await ledger.transition(GITHUB_ISSUES_SOURCE, 'o/a#1', 'claimed', {
        branch: 'spec/initial-feature',
      });

      const beforeRaw = JSON.parse(await readFile(ledgerPath, 'utf8'));
      const beforeKey = Object.keys(beforeRaw).find((k) => k.includes('o/a#1'))!;
      const capturedAt = beforeRaw[beforeKey].capturedAt;
      expect(beforeRaw[beforeKey].status).toBe('claimed');

      const { out, err, opts } = captureOut();
      const dispatch: Parameters<typeof dispatchEngineer>[0] = {
        kind: 'unclaim',
        sourceRef: 'o/a#1',
      };

      const code = await dispatchEngineer(dispatch, {
        ...opts(),
        engineerDir: engDir,
      });

      expect(code).toBe(0);
      expect(err.length).toBe(0);
      expect(out.length).toBe(1);
      const parsed = JSON.parse(out[0]);
      expect(parsed).toMatchObject({ kind: 'unclaim', sourceRef: 'o/a#1', acted: true });

      const afterRaw = JSON.parse(await readFile(ledgerPath, 'utf8'));
      expect(afterRaw[beforeKey].status).toBe('pending');
      expect(afterRaw[beforeKey].capturedAt).toBe(capturedAt);
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
