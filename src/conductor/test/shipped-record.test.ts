import { describe, expect, it } from 'vitest';

import {
  appendRecordedShipmentFindings,
  recordedShipmentFindings,
} from '../src/engine/shipment-association.js';

describe('shipped-record recorded review findings', () => {
  it('copies recorded prd-audit and delivered as-built PLAN_GAP findings into frontmatter', () => {
    const findings = recordedShipmentFindings({
      prdAudit: [
        '**PRD:** present',
        '',
        '## Recorded Findings',
        '',
        '```json',
        JSON.stringify({ findings: [{
          gate: 'prd_audit',
          grade: 'PLAN_GAP',
          criterion: 'S2.2',
          summary: 'The retry edge case is outside the approved plan.',
        }] }),
        '```',
      ].join('\n'),
      asBuilt: [
        'Verdict: PLAN_GAP',
        'Outcome delivered: yes',
        '',
        '## Recorded Findings',
        '- Outcome: Retry status remains eventually consistent.',
        '- Summary: The approved architecture deliberately has no synchronous status channel.',
      ].join('\n'),
    });

    expect(findings).toEqual([
      {
        gate: 'prd_audit',
        grade: 'PLAN_GAP',
        criterion: 'S2.2',
        summary: 'The retry edge case is outside the approved plan.',
      },
      {
        gate: 'architecture_review_as_built',
        grade: 'PLAN_GAP',
        outcome: 'Retry status remains eventually consistent.',
        summary: 'The approved architecture deliberately has no synchronous status channel.',
      },
    ]);

    expect(appendRecordedShipmentFindings([
      '---',
      'slug: review-findings',
      'spec_hash: digest',
      '---',
      '',
      '## Cost',
    ].join('\n'), findings)).toContain([
      'findings:',
      '  - gate: prd_audit',
      '    grade: PLAN_GAP',
      '    criterion: S2.2',
      '    summary: "The retry edge case is outside the approved plan."',
      '  - gate: architecture_review_as_built',
      '    grade: PLAN_GAP',
      '    outcome: "Retry status remains eventually consistent."',
    ].join('\n'));
  });

  it('omits findings when neither report contains a recorded non-blocking finding', () => {
    const record = '---\nslug: clean\n---\n';
    const findings = recordedShipmentFindings({
      prdAudit: '**PRD:** present\n',
      asBuilt: 'Verdict: APPROVED\n',
    });

    expect(findings).toEqual([]);
    expect(appendRecordedShipmentFindings(record, findings)).toBe(record);
  });
});
