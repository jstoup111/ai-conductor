// Covers: task:11, task:rem-prd-audit-11a
import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { canonicalizeBuildReviewFindingIdentity } from '../../src/engine/build-review-finding-identity.js';
import { resolveBuildReviewAcceptance } from '../../src/engine/build-review-acceptance-resolver.js';

const engineRoot = new URL('../../src/engine/', import.meta.url);
const permittedDirectMatchers = new Set([
  'build-review-dispositions.ts',
  'build-review-acceptance-resolver.ts',
]);

async function sourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const children = await Promise.all(entries.map(async (entry) => {
    const child = new URL(entry.name, directory);
    return entry.isDirectory() ? sourceFiles(new URL(`${entry.name}/`, directory)) : entry.name.endsWith('.ts') ? [child] : [];
  }));
  return children.flat();
}

describe('build-review acceptance consumers', () => {
  it('keeps direct disposition matching behind the shared acceptance resolver', async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(engineRoot)) {
      if (permittedDirectMatchers.has(file.pathname.split('/').at(-1)!)) continue;
      const source = await readFile(file, 'utf8');
      if (/matchesBuildReviewDisposition\s*\(/.test(source)) offenders.push(file.pathname.split('/').at(-1)!);
    }
    expect(offenders, `direct acceptance matching must use resolveBuildReviewAcceptance: ${offenders.join(', ')}`).toEqual([]);
  });

  it('keeps effective verdict, coordinator partitions, context, findings, and accepted-risk renderers on one carried-acceptance fixture', async () => {
    const feature = { version: 'v1' as const, repository: '/repo', feature: 'feature' };
    const origin = canonicalizeBuildReviewFindingIdentity({
      rubric: 'testQuality', contractVersion: 'v3', concernKind: 'test-insensitive',
      anchor: { rubric: 'testQuality', locus: { path: 'test/origin.test.ts', contentHash: `sha256:${'a'.repeat(64)}`, display: 'origin' } },
    });
    const carried = canonicalizeBuildReviewFindingIdentity({
      rubric: 'testQuality', contractVersion: 'v3', concernKind: 'test-insensitive',
      anchor: { rubric: 'testQuality', locus: { path: 'test/carried.test.ts', contentHash: `sha256:${'b'.repeat(64)}`, display: 'carried' } },
    });
    if (!origin || !carried) throw new Error('fixture identities are invalid');
    const resolution = resolveBuildReviewAcceptance(feature, carried, { ok: true, records: [{
      version: 'v1', feature, finding: origin, sourceLapId: 'lap-1' as never, acceptedAt: '2026-01-02T00:00:00.000Z',
      summary: 'Accepted.', rationale: 'Accepted.', operator: 'operator',
    }] }, { ok: true, state: { version: 'v1', feature, cases: [{
      id: 'accepted-case', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high', rationale: 'Accepted.', resolution: 'resolved',
      sources: [
        { sourceId: `testQuality:${origin.id}`, outcome: 'acted', recordedAt: '2026-01-01T00:00:00.000Z' },
        { sourceId: `testQuality:${carried.id}`, outcome: 'acted', recordedAt: '2026-01-03T00:00:00.000Z' },
      ], effect: { id: 'effect', kind: 'action', status: 'applied', workOrderId: 'order' },
    }] } }, 'lap-2' as never);
    expect(resolution).toMatchObject({ kind: 'carried', caseId: 'accepted-case', originFindingId: origin.id, originLapId: 'lap-1' });

    const consumers = [
      ['effective verdict', 'build-review-effective.ts', 'aggregate.lapId'],
      ['coordinator accepted set', 'build-review-adjudication-coordinator.ts', 'input.aggregate.lapId'],
      ['reuse partition', 'build-review-adjudication-coordinator.ts', 'resolveBuildReviewAcceptance'],
      ['decision-stop partition', 'build-review-adjudication-coordinator.ts', 'judgementWithoutCarried'],
      ['adjudication context', 'build-review-adjudication-context.ts', 'resolveBuildReviewAcceptance'],
      ['findings output', 'build-review-cli.ts', 'aggregate.lapId'],
      ['accepted-risk renderer', 'finish-publication-production.ts', 'currentLapId as never'],
      ['shipped accepted-risk renderer', 'shipped-record-cli.ts', 'currentLapId as never'],
    ] as const;
    for (const [consumer, file, contract] of consumers) {
      const source = await readFile(new URL(file, engineRoot), 'utf8');
      expect(source, `${consumer} diverged from the shared carried-acceptance contract`).toContain(contract);
      expect(source, `${consumer} bypassed the shared carried-acceptance resolver`).toContain('resolveBuildReviewAcceptance');
    }
  });
});
