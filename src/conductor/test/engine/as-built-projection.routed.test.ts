// Covers: task:67, task:rem-as-built-rem-as-built-e24e-7
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { readPendingAsBuiltRemediationFindings } from '../../src/engine/kickback-ledger.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { createRouteRecord, readRouteRecord, writeRouteRecord } from '../../src/engine/routing/route-record-store.js';
import { routeRecordRefFor } from '../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';

const roots: string[] = [];
const child = parseChildId(1)!;

async function fixture(): Promise<{ readonly root: string; readonly git: ReturnType<typeof makeGitRunner> }> {
  const root = await mkdtemp(join(tmpdir(), 'as-built-projection-routed-'));
  roots.push(root);
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'as-built@example.test']);
  await git(['config', 'user.name', 'As-built projection']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  await git(['branch', 'feat/c1/demo']);
  await git(['checkout', '-qb', 'feat/daemon-demo']);

  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await writeFile(join(root, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 2\n  route_whole_feature_fixes: true\n');
  await mkdir(join(root, '.pipeline'), { recursive: true });
  // conduct-state is deliberately absent: a recreated worktree derives its
  // feature slug from the durable feature branch instead.
  await writeFile(join(root, '.pipeline', 'coverage-binding.json'), JSON.stringify({
    version: 1,
    slug: 'demo',
    runId: 'run-1',
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['first', 'second'] },
    storyOwnership: { '1': 1, '2': 2 },
  }));
  return { root, git };
}

async function writeRoute(
  root: string,
  round: string,
  phase: 'open' | 'closed',
  finding: string,
): Promise<void> {
  const roundId = parseRoundId(round)!;
  const created = await createRouteRecord(root, 'demo', {
    roundId,
    sealedAuthored: 1,
    kind: 'audit',
    items: [],
    allocation: { [child]: { remTaskIds: [], blockBodies: [] } },
    pendingAsBuiltFindings: [{
      gate: 'architecture_review_as_built',
      finding,
      class: 'REMEDIABLE',
      governingClause: 'adr-demo decision 1',
      summary: `${finding} remains pending`,
      outcome: 'remediated',
    }],
  });
  if (created.kind !== 'created') throw new Error(`route record create failed: ${created.kind}`);
  const stored = await readRouteRecord(root, 'demo', roundId);
  if (stored.kind !== 'record') throw new Error('route record unavailable');
  const written = await writeRouteRecord(root, stored, {
    ...stored.record,
    phase,
    // This route has moved away from its original host. Pending as-built work
    // follows the round lifecycle, not this transitory host state.
    hosts: { ...stored.record.hosts, [child]: 'rerouted' },
  });
  if (written.kind !== 'updated') throw new Error(`route record update failed: ${written.kind}`);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('routed as-built projection', () => {
  it('keeps open rerouted findings after recreated-worktree recovery, excludes closed rounds, and fails closed for unreadable records', async () => {
    const { root, git } = await fixture();
    await writeRoute(root, 'r1', 'open', 'OPEN-REROUTED');
    await writeRoute(root, 'r2', 'closed', 'CLOSED-REROUTED');

    await expect(readPendingAsBuiltRemediationFindings(root)).resolves.toEqual({
      kind: 'ok',
      findings: [expect.objectContaining({ finding: 'OPEN-REROUTED' })],
    });

    const malformed = await git(['hash-object', '-w', '--stdin'], { input: '{not-json' });
    await git(['update-ref', routeRecordRefFor('demo', parseRoundId('r3')!), malformed.stdout.trim()]);

    await expect(readPendingAsBuiltRemediationFindings(root)).resolves.toMatchObject({
      kind: 'unreadable',
      reason: expect.stringContaining('route receipt unreadable'),
    });
  });
});
