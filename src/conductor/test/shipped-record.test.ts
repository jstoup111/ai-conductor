import { describe, expect, it } from 'vitest';

import {
  appendRecordedShipmentFindings,
  recordedShipmentFindings,
} from '../src/engine/shipment-association.js';

describe('shipped-record recorded review findings', () => {
  it('carries an operator decision and its rationale into the record', () => {
    // ADR D8: a recorded accept/refuse must survive into the shipped record.
    // Keeping only `accepted` erased who decided what, and erased refusals.
    const findings = recordedShipmentFindings({
      prdAudit: [
        '**PRD:** present',
        '',
        '## Recorded Findings',
        '',
        '```json',
        JSON.stringify({ findings: [{
          gate: 'prd_audit',
          grade: 'OVER_SCOPE',
          criterion: 'S5.2',
          summary: 'The visible flag was not in the approved intent.',
          accepted: false,
          decision: 'refuse',
          rationale: 'Rework it inside the approved scope.',
        }, {
          gate: 'prd_audit',
          grade: 'OVER_SCOPE',
          criterion: 'S5.3',
          summary: 'The operator accepted the visible widening.',
          accepted: true,
          decision: 'accept',
          rationale: 'Cheaper than a second lap.',
        }] }),
        '```',
      ].join('\n'),
    });

    expect(findings).toEqual([
      {
        gate: 'prd_audit',
        grade: 'OVER_SCOPE',
        criterion: 'S5.2',
        summary: 'The visible flag was not in the approved intent.',
        accepted: false,
        decision: 'refuse',
        rationale: 'Rework it inside the approved scope.',
      },
      {
        gate: 'prd_audit',
        grade: 'OVER_SCOPE',
        criterion: 'S5.3',
        summary: 'The operator accepted the visible widening.',
        accepted: true,
        decision: 'accept',
        rationale: 'Cheaper than a second lap.',
      },
    ]);

    const rendered = appendRecordedShipmentFindings([
      '---',
      'slug: decision-findings',
      'spec_hash: digest',
      '---',
      '',
      '## Cost',
    ].join('\n'), findings);
    expect(rendered).toContain('    decision: refuse');
    expect(rendered).toContain('    rationale: "Rework it inside the approved scope."');
    expect(rendered).toContain('    decision: accept');
  });

  it('copies recorded non-blocking prd-audit and delivered as-built findings into frontmatter', () => {
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
        }, {
          gate: 'prd_audit',
          grade: 'OVER_SCOPE',
          criterion: 'S2.3',
          summary: 'The added diagnostic is harmless outside the approved intent.',
          accepted: false,
        }, {
          gate: 'prd_audit',
          grade: 'OVER_SCOPE',
          criterion: 'S2.4',
          summary: 'The operator accepted the visible optional behavior.',
          accepted: true,
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
        gate: 'prd_audit',
        grade: 'OVER_SCOPE',
        criterion: 'S2.3',
        summary: 'The added diagnostic is harmless outside the approved intent.',
        accepted: false,
      },
      {
        gate: 'prd_audit',
        grade: 'OVER_SCOPE',
        criterion: 'S2.4',
        summary: 'The operator accepted the visible optional behavior.',
        accepted: true,
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
      '  - gate: prd_audit',
      '    grade: OVER_SCOPE',
      '    criterion: S2.3',
      '    summary: "The added diagnostic is harmless outside the approved intent."',
      '    accepted: false',
      '  - gate: prd_audit',
      '    grade: OVER_SCOPE',
      '    criterion: S2.4',
      '    summary: "The operator accepted the visible optional behavior."',
      '    accepted: true',
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
