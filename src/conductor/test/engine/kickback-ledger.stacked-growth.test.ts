// Covers: task:66
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const routing = vi.hoisted(() => ({
  resolveActiveChild: vi.fn(),
}));

vi.mock('../../src/engine/child-cursor.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/child-cursor.js')>(),
  resolveActiveChild: routing.resolveActiveChild,
}));

import { readGrowthAccounting } from '../../src/engine/kickback-ledger.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { createRouteRecord } from '../../src/engine/routing/route-record-store.js';
import { routeRecordRefFor } from '../../src/engine/routing/routing-refs.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';

const roots: string[] = [];
const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;

afterEach(async () => {
  routing.resolveActiveChild.mockReset();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kickback-ledger-stacked-growth-'));
  roots.push(root);
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await mkdir(join(root, '.pipeline', 'children', '1'), { recursive: true });
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({ feature_desc: 'demo' }));
  await writeFile(join(root, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 2\n  route_whole_feature_fixes: true\n');
  await writeFile(join(root, '.docs', 'plans', 'demo.md'), Array.from(
    { length: 12 },
    (_, index) => `### Task ${index + 1}: Authored work`,
  ).join('\n'));
  const created = await createRouteRecord(root, 'demo', {
    roundId,
    sealedAuthored: 12,
    kind: 'audit',
    items: [{ findingId: 'finding', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [] }],
    allocation: { [child]: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-T1\n'] } },
  }, { git });
  if (created.kind !== 'created') throw new Error(created.kind);
  routing.resolveActiveChild.mockResolvedValue({ kind: 'active', child, position: 1, isLeaf: true, branch: 'feat/demo' });
  return { root, git };
}

describe('stacked routed growth accounting', () => {
  it('resolves routing context once and derives pending allocations and the denominator from one route snapshot', async () => {
    const subject = await fixture();

    await expect(readGrowthAccounting(subject.root, 4, { persist: false })).resolves.toEqual({
      growth: { authored: 12, added: 0, byGate: {}, remaining: 4 },
      authoredSource: 'plan',
    });
    expect(routing.resolveActiveChild).toHaveBeenCalledTimes(1);
    await expect(readGrowthAccounting(subject.root, 4, { persist: true })).resolves.toMatchObject({
      growth: { authored: 12, added: 0 },
    });
  });

  it('fails closed for both routed accounting inputs when a route record is unreadable', async () => {
    const subject = await fixture();
    const malformed = await subject.git(['hash-object', '-w', '--stdin'], { input: '{not-json' });
    await subject.git(['update-ref', routeRecordRefFor('demo', roundId), malformed.stdout.trim()]);

    await expect(readGrowthAccounting(subject.root, 4, { persist: true }))
      .rejects.toThrow('routed sealed growth denominator is unreadable: route receipt unreadable');
    await expect(access(join(subject.root, '.pipeline', 'kickback-ledger.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(routing.resolveActiveChild).toHaveBeenCalledTimes(1);
  });

  it('fails closed rather than reconciling a routed stored zero denominator', async () => {
    const subject = await fixture();
    await writeFile(join(subject.root, '.pipeline', 'kickback-ledger.json'), JSON.stringify({
      version: 1, gates: {}, growth: { authored: 0, added: 0, byGate: {} },
    }));

    await expect(readGrowthAccounting(subject.root, 4, { persist: false }))
      .rejects.toThrow('stored authored denominator 0 disagrees with routed sealed denominator 12');
  });
});
