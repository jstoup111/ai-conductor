// Covers: tasks:62,63,67
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { createRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { settleRoundAtDispatch } from '../../../src/engine/routing/round-receipt.js';
import { routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';

const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'round-receipt-recovery-'));
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'receipt@example.test']);
  await git(['config', 'user.name', 'Receipt']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  const made = await createRouteRecord(root, 'demo', {
    roundId,
    kind: 'audit',
    items: [{ findingId: 'finding', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [] }],
    allocation: { [child]: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-T1\n'] } },
  });
  if (made.kind !== 'created') throw new Error(made.kind);
  return { root, git };
}

describe('round receipt recovery', () => {
  it('returns exhausted when reconciliation encounters a malformed stored route record', async () => {
    const subject = await fixture();
    try {
      const malformed = await subject.git(['hash-object', '-w', '--stdin'], { input: '{not-json' });
      await subject.git(['update-ref', routeRecordRefFor('demo', parseRoundId('r2')!), malformed.stdout.trim()]);

      await expect(settleRoundAtDispatch({
        projectRoot: subject.root,
        slug: 'demo',
        roundId,
        dispatchingChild: child,
        budgets: [{ gate: 'prd_audit', lapCap: 2, growthCap: 4, growth: { authored: 4, added: 0, byGate: {}, remaining: 4 }, authoredSource: 'plan' }],
        routing: { cursor: { kind: 'active' }, config: { stacked_prs: { route_whole_feature_fixes: true } } },
        git: subject.git,
      })).resolves.toMatchObject({ kind: 'exhausted' });
    } finally {
      await rm(subject.root, { recursive: true, force: true });
    }
  });
});
