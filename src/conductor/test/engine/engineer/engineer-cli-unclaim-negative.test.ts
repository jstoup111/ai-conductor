// Task 9/10: `engineer unclaim <ref>` negative paths.
//
// Story 4 (FR-6): unclaim on a non-claimed (terminal) entry refuses, directing the
// operator to resolve/forget, without mutating the entry — reported as a non-error.
// Story 5 (FR-7): unclaim on an unknown ref reports "not found" as a non-error.

import { describe, it, expect } from 'vitest';
import { dispatchEngineer } from '../../../src/engine/engineer-cli.js';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';

describe('engineer unclaim: negative paths (Task 9, 10)', () => {
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

  it('Task 9: unclaim on a `done` entry refuses, entry unchanged, exit 0, no stderr', async () => {
    const testDir = `/tmp/unclaim-neg-test-${Date.now()}-${Math.random()}`;
    try {
      const engDir = join(testDir, 'engineer');
      await mkdir(engDir, { recursive: true });
      const ledgerPath = join(engDir, 'ledger.json');

      const ledger = createLedger(ledgerPath);
      await ledger.record({ source: GITHUB_ISSUES_SOURCE, sourceRef: 'o/a#2' });
      await ledger.transition(GITHUB_ISSUES_SOURCE, 'o/a#2', 'claimed', {
        branch: 'spec/some-feature',
      });
      await ledger.transition(GITHUB_ISSUES_SOURCE, 'o/a#2', 'done', {});

      const beforeRaw = JSON.parse(await readFile(ledgerPath, 'utf8'));

      const { out, err, opts } = captureOut();
      const dispatch: Parameters<typeof dispatchEngineer>[0] = {
        kind: 'unclaim',
        sourceRef: 'o/a#2',
      };

      const code = await dispatchEngineer(dispatch, { ...opts(), engineerDir: engDir });

      expect(code).toBe(0);
      expect(err.length).toBe(0);
      expect(out.length).toBe(1);
      const parsed = JSON.parse(out[0]);
      expect(parsed.kind).toBe('unclaim');
      expect(parsed.sourceRef).toBe('o/a#2');
      expect(parsed.acted).toBe(false);
      // Must direct the operator to resolve/forget.
      expect(String(parsed.reason ?? '')).toMatch(/resolve|forget/i);

      const afterRaw = JSON.parse(await readFile(ledgerPath, 'utf8'));
      expect(afterRaw).toEqual(beforeRaw);
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('Task 10: unclaim on an unknown ref reports not-found as a non-error', async () => {
    const testDir = `/tmp/unclaim-neg-test-${Date.now()}-${Math.random()}`;
    try {
      const engDir = join(testDir, 'engineer');
      await mkdir(engDir, { recursive: true });

      const { out, err, opts } = captureOut();
      const dispatch: Parameters<typeof dispatchEngineer>[0] = {
        kind: 'unclaim',
        sourceRef: 'o/a#999',
      };

      const code = await dispatchEngineer(dispatch, { ...opts(), engineerDir: engDir });

      expect(code).toBe(0);
      expect(err.length).toBe(0);
      expect(out.length).toBe(1);
      const parsed = JSON.parse(out[0]);
      expect(parsed).toMatchObject({ kind: 'unclaim', sourceRef: 'o/a#999', found: false });
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
