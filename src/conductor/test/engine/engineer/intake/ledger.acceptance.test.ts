// Acceptance: durable intake ledger as SOLE dedup authority (FR-33/34, ADR-012, Stories 8).
// RED until intake/ledger.ts exists. Also asserts C2: intake/idempotency.ts is gone.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function loadLedger() {
  return import('../../../../src/engine/engineer/intake/ledger.js') as Promise<any>;
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ledger-acc-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FR-33 durable ledger lifecycle', () => {
  it('persists an entry across a fresh ledger over the same dir', async () => {
    const { createLedger } = await loadLedger();
    const a = createLedger(join(dir, 'ledger.json'));
    await a.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    const b = createLedger(join(dir, 'ledger.json'));
    expect(await b.known('github-issues', 'o/a#1')).toBe(true);
  });

  it('records lifecycle transitions with metadata', async () => {
    const { createLedger } = await loadLedger();
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    await l.transition('github-issues', 'o/a#1', 'claimed');
    await l.transition('github-issues', 'o/a#1', 'done', { prUrl: 'https://x/pr/1' });
    const entry = await l.get('github-issues', 'o/a#1');
    expect(entry.status).toBe('done');
    expect(entry.prUrl).toBe('https://x/pr/1');
  });
});

describe('FR-34 exactly-once / no false dedup', () => {
  it('treats cross-repo same-number issues as distinct', async () => {
    const { createLedger } = await loadLedger();
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    expect(await l.known('github-issues', 'o/b#1')).toBe(false);
  });

  it('does not dedup a re-filed idea under a new issue number', async () => {
    const { createLedger } = await loadLedger();
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    expect(await l.known('github-issues', 'o/a#2')).toBe(false);
  });
});

describe('C2 in-memory idempotency guard removed', () => {
  it('intake/idempotency.ts no longer exists', () => {
    const p = join(__dirname, '../../../../src/engine/engineer/intake/idempotency.ts');
    expect(existsSync(p)).toBe(false);
  });

  it('no source file references the removed guard', () => {
    // grep-zero gate: walk intake/ src and assert no `idempotency` references.
    const intakeSrc = join(__dirname, '../../../../src/engine/engineer/intake');
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of require('node:fs').readdirSync(d, { withFileTypes: true })) {
        const fp = join(d, e.name);
        if (e.isDirectory()) walk(fp);
        else if (e.name.endsWith('.ts') && /idempotency/.test(readFileSync(fp, 'utf8'))) {
          offenders.push(fp);
        }
      }
    };
    walk(intakeSrc);
    expect(offenders).toEqual([]);
  });
});
