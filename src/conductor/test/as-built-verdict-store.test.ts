import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { persistAsBuiltVerdict, readAsBuiltVerdict, AS_BUILT_REPORT_PATH, AS_BUILT_VERDICT_PATH } from '../src/engine/as-built-verdict-store.js';
import type { AsBuiltPolicy } from '../src/engine/as-built-policy.js';

const dirs: string[] = [];
const policy: AsBuiltPolicy = {
  reachability: { enabled: true, reason: 'all tiers' },
  planGap: { enabled: true, reason: 'all tiers' },
  adrCompliance: { enabled: false, reason: 'no approved ADRs' },
  diagramDrift: { enabled: false, reason: 'no diagrams' },
};

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('as-built typed verdict store', () => {
  it('atomically persists the typed authority and a derived report', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'as-built-store-'));
    dirs.push(dir);
    await persistAsBuiltVerdict(dir, {
      version: 'v1', verdict: 'BLOCKED', reachability: [], driftNotes: [],
      findings: [{ id: 'AB-1', class: 'DESIGN', summary: 'needs a decision' }],
      violations: 'the decision is unresolved', resolution: 'choose a design',
    }, { attemptId: 'attempt-1', codeStamp: 'abc123', policy });

    const stored = await readAsBuiltVerdict(dir);
    expect(stored).toMatchObject({
      kind: 'present', value: { attemptId: 'attempt-1', codeStamp: 'abc123', verdict: { verdict: 'BLOCKED' } },
    });
    expect(await readFile(join(dir, AS_BUILT_REPORT_PATH), 'utf8')).toContain('| AB-1 | DESIGN | none | needs a decision |');
  });

  it('fails closed for an unreadable envelope and never reads the report as authority', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'as-built-store-'));
    dirs.push(dir);
    await mkdir(join(dir, '.pipeline'));
    await writeFile(join(dir, AS_BUILT_VERDICT_PATH), '{not json', 'utf8');
    await writeFile(join(dir, '.pipeline', 'architecture-review-as-built.md'), 'Verdict: APPROVED\n', 'utf8');

    expect(await readAsBuiltVerdict(dir)).toMatchObject({ kind: 'unreadable' });
  });
});
