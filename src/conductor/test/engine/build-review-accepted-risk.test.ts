import { describe, expect, it } from 'vitest';

import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { canonicalizeBuildReviewFindingIdentity } from '../../src/engine/build-review-finding-identity.js';
import {
  renderBuildReviewAcceptedRisk,
  upsertBuildReviewAcceptedRisk,
} from '../../src/engine/build-review-accepted-risk.js';
import type { BuildReviewDispositionRecord } from '../../src/engine/build-review-dispositions.js';

const finding = canonicalizeBuildReviewFindingIdentity({
  rubric: 'scope', contractVersion: 'v1', concernKind: 'unplanned-surface',
  anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'outside-plan' },
})!;

function record(id = finding.id): BuildReviewDispositionRecord {
  return {
    version: 'v1', feature: { version: 'v1', repository: 'github.com/acme/conductor', feature: 'review-rubrics' },
    finding: { ...finding, id }, sourceLapId: parseBuildReviewLapId('lap-7')!,
    summary: 'src/a.ts is outside the approved plan', rationale: 'Accepted temporary migration risk',
    operator: 'james', acceptedAt: '2026-08-14T12:00:00.000Z',
  };
}

describe('accepted build-review risk rendering', () => {
  it('renders deterministic full attribution for every accepted finding', () => {
    const secondFinding = canonicalizeBuildReviewFindingIdentity({
      rubric: 'scope', contractVersion: 'v1', concernKind: 'missing-approval',
      anchor: { rubric: 'scope', path: 'src/b.ts', relation: 'outside-plan' },
    })!;
    const rendered = renderBuildReviewAcceptedRisk([record(), { ...record(), finding: secondFinding, summary: 'second risk' }]);

    expect(rendered).toEqual({
      ok: true,
      section: expect.stringContaining(`## Accepted build-review risk\n\n- Finding: \`${finding.id}\``),
    });
    expect((rendered as { section: string }).section).toContain('**Rubric:** scope');
    expect((rendered as { section: string }).section).toContain('**Rationale:** Accepted temporary migration risk');
    expect((rendered as { section: string }).section).toContain('**Operator:** james');
    expect((rendered as { section: string }).section).toContain('**Accepted at:** 2026-08-14T12:00:00.000Z');
  });

  it('upserts the section idempotently and leaves a body with no findings unchanged', () => {
    const first = upsertBuildReviewAcceptedRisk('## Summary\n\nBody.', [record()]);
    const second = first.ok ? upsertBuildReviewAcceptedRisk(first.body, [record()]) : first;

    expect(first).toMatchObject({ ok: true, changed: true });
    expect(second).toMatchObject({ ok: true, changed: false, body: (first as { body: string }).body });
    expect(upsertBuildReviewAcceptedRisk('## Summary\n\nBody.', [])).toEqual({ ok: true, changed: false, body: '## Summary\n\nBody.' });
  });

  it('refuses known but unrenderable accepted-risk records', () => {
    expect(renderBuildReviewAcceptedRisk([{ ...record(), rationale: '' }])).toMatchObject({ ok: false });
  });
});
