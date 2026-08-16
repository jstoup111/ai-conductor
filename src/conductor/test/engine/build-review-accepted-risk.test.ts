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
  it('renders only ids, rubrics, a count, and the disposition-store pointer', () => {
    const secondFinding = canonicalizeBuildReviewFindingIdentity({
      rubric: 'scope', contractVersion: 'v1', concernKind: 'missing-approval',
      anchor: { rubric: 'scope', path: 'src/b.ts', relation: 'outside-plan' },
    })!;
    const rendered = renderBuildReviewAcceptedRisk([record(), { ...record(), finding: secondFinding, summary: 'second risk' }]);

    expect(rendered).toMatchObject({ ok: true });
    const section = (rendered as { section: string }).section;
    expect(section).toContain('<!-- build-review-accepted-risk:start -->');
    expect(section).toContain('<!-- build-review-accepted-risk:end -->');
    expect(section).toContain('## Accepted build-review risk');
    expect(section).toContain('Accepted findings: 2');
    expect(section).toContain(`- Finding: \`${finding.id}\` — rubric: scope`);
    expect(section).toContain(`- Finding: \`${secondFinding.id}\` — rubric: scope`);
    expect(section).toContain("Details are retained in the feature's local build-review disposition store.");
  });

  it('never publishes summary, rationale, operator identity, or timestamps (#1614)', () => {
    const rendered = renderBuildReviewAcceptedRisk([record()]);

    expect(rendered).toMatchObject({ ok: true });
    const section = (rendered as { section: string }).section;
    expect(section).toContain(`\`${finding.id}\``);
    expect(section).toContain('rubric: scope');
    expect(section).not.toContain('src/a.ts is outside the approved plan');
    expect(section).not.toContain('Accepted temporary migration risk');
    expect(section).not.toContain('james');
    expect(section).not.toContain('2026-08-14T12:00:00.000Z');
    expect(section).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(section).not.toMatch(/\*\*(Summary|Rationale|Operator|Accepted at):\*\*/);
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
