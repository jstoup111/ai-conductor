// `engineer requeue --stale` must honor a project-level `stale_claim_window_hours`
// override (`.ai-conductor/config.yml`) instead of always falling back to the 24h
// default — a real operator's override is dead if `dispatchEngineer`'s `requeue`
// case never loads/threads the resolved `HarnessConfig` into
// `resolveStaleClaimWindowMs`.
//
// This drives `dispatchEngineer` directly (the real production entry point) with
// `process.cwd()` pointed at a temp project root containing a config override that
// shrinks the window well below 24h, and proves an entry that is stale under the
// override (but NOT stale under the 24h default) gets requeued.

import { describe, it, expect } from 'vitest';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dispatchEngineer } from '../../../src/engine/engineer-cli.js';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';

const GITHUB_ISSUES_SOURCE = 'github-issues';

function captureOut() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err };
}

describe('engineer requeue --stale: honors stale_claim_window_hours config override', () => {
  it('requeues an entry stale under the override window but fresh under the 24h default', async () => {
    const testDir = `/tmp/requeue-config-override-test-${Date.now()}-${Math.random()}`;
    const originalCwd = process.cwd();
    try {
      const engDir = join(testDir, 'engineer');
      await mkdir(engDir, { recursive: true });
      await mkdir(join(testDir, '.ai-conductor'), { recursive: true });
      // Override the window to 2h — the entry below (3h stale) is stale under this
      // override but well within the 24h production default, so this only passes
      // if the config is actually loaded and threaded through.
      await writeFile(
        join(testDir, '.ai-conductor', 'config.yml'),
        'stale_claim_window_hours: 2\n',
        'utf8',
      );

      const ledgerPath = join(engDir, 'ledger.json');
      const ledger = createLedger(ledgerPath);
      await ledger.record({ source: GITHUB_ISSUES_SOURCE, sourceRef: 'o/a#900' });
      await ledger.transition(GITHUB_ISSUES_SOURCE, 'o/a#900', 'claimed');

      const raw = JSON.parse(await readFile(ledgerPath, 'utf8'));
      const key = Object.keys(raw).find((k) => k.includes('o/a#900'))!;
      raw[key].lastSeenAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      await writeFile(ledgerPath, JSON.stringify(raw, null, 2));

      const { out, err } = captureOut();
      const gh = async () => ({ stdout: JSON.stringify({ state: 'OPEN' }) });

      process.chdir(testDir);
      const code = await dispatchEngineer(
        { kind: 'requeue', stale: true },
        {
          engineerDir: engDir,
          print: (s) => out.push(s),
          printErr: (s) => err.push(s),
          gh,
        },
      );

      expect(code).toBe(0);
      const parsed = JSON.parse(out[0]);
      expect(parsed.requeued).toEqual(['o/a#900']);

      const after = JSON.parse(await readFile(ledgerPath, 'utf8'));
      expect(after[key].status).toBe('pending');
    } finally {
      process.chdir(originalCwd);
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
