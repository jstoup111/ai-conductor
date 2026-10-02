// Covers: task:6
import { describe, expect, it } from 'vitest';

import {
  PRD_AUDIT_JUDGMENT_SCHEMA,
  renderPrdAuditJudgmentShape,
  validatePrdAuditJudgment,
} from '../../src/engine/prd-audit-contract.js';

describe('PRD audit judgment contract', () => {
  it('accepts every legitimate grade with independently resolved criteria and engine-owned NC ordinals', () => {
    const input = {
      version: 'v1',
      criterionJudgments: [
        {
          criterion: { storyId: 'alpha.1', ordinal: 1 },
          grade: 'PASS',
          evidence: 'The delivered behavior meets the criterion.',
          rationale: 'The observed result matches the obligation.',
          requirementAssociations: [{ path: '.docs/specs/a.md', requirementId: 'FR-7' }],
          evidenceTaskIds: [],
        },
        {
          criterion: { storyId: 'beta.2', ordinal: 1 },
          grade: 'FIXABLE',
          evidence: 'The repair is bounded to the active task.',
          rationale: 'The task owns the remaining work.',
          requirementAssociations: [{ path: '.docs/specs/a.md', requirementId: 'FR-7' }],
          evidenceTaskIds: [],
          ownerTaskId: 'task-a',
        },
        {
          criterion: { storyId: 'gamma.3', ordinal: 1 },
          grade: 'PLAN_GAP',
          evidence: 'The requested behavior has no admitted plan task.',
          rationale: 'Resolving it requires a human plan decision.',
          requirementAssociations: [{ path: '.docs/specs/a.md', requirementId: 'FR-7' }],
          evidenceTaskIds: [],
        },
        {
          criterion: { storyId: 'delta.4', ordinal: 1 },
          grade: 'OVER_SCOPE',
          evidence: 'The delivered behavior exceeds the active criterion.',
          rationale: 'It is independently resolved to an active criterion.',
          requirementAssociations: [{ path: '.docs/specs/a.md', requirementId: 'FR-7' }],
          evidenceTaskIds: [],
          intentRelation: 'outside-visible',
        },
      ],
      noOwnerObservations: [
        {
          grade: 'OVER_SCOPE',
          evidence: 'An outlying change remains within the declared intent.',
          rationale: 'It needs no repair owner.',
          intentRelation: 'within',
        },
        {
          grade: 'OVER_SCOPE',
          evidence: 'A second observation is outside intent without user impact.',
          rationale: 'It remains a closed no-owner observation.',
          intentRelation: 'outside-harmless',
        },
      ],
    };

    expect(validatePrdAuditJudgment(input, {
      criteria: [
        { id: 'Salpha.1.1' },
        { id: 'Sbeta.2.1' },
        { id: 'Sgamma.3.1' },
        { id: 'Sdelta.4.1' },
      ],
      taskIds: new Set(['task-a']),
      requirements: [{ path: '.docs/specs/a.md', id: 'FR-7' }],
    })).toEqual({
      ok: true,
      judgment: {
        ...input,
        criterionJudgments: [
          { ...input.criterionJudgments[0], criterionId: 'Salpha.1.1' },
          { ...input.criterionJudgments[1], criterionId: 'Sbeta.2.1' },
          { ...input.criterionJudgments[2], criterionId: 'Sgamma.3.1' },
          { ...input.criterionJudgments[3], criterionId: 'Sdelta.4.1' },
        ],
        noOwnerObservations: [
          { ...input.noOwnerObservations[0], presentationOrdinal: 'NC-1' },
          { ...input.noOwnerObservations[1], presentationOrdinal: 'NC-2' },
        ],
      },
    });
  });

  it('exports a frozen schema and renders its contract shape', () => {
    expect(Object.isFrozen(PRD_AUDIT_JUDGMENT_SCHEMA)).toBe(true);

    const shape = renderPrdAuditJudgmentShape(PRD_AUDIT_JUDGMENT_SCHEMA);
    const schemaWithReviewerContext = {
      ...PRD_AUDIT_JUDGMENT_SCHEMA,
      properties: {
        ...PRD_AUDIT_JUDGMENT_SCHEMA.properties,
        reviewerContext: { type: 'string' },
      },
    };

    expect(shape).toContain('criterionJudgments');
    expect(shape).toContain('noOwnerObservations');
    expect(shape).toContain('PASS');
    expect(shape).toContain('FIXABLE');
    expect(shape).toContain('PLAN_GAP');
    expect(shape).toContain('OVER_SCOPE');
    expect(shape).toContain('v1');
    expect(shape).not.toContain('presentationOrdinal');
    expect(renderPrdAuditJudgmentShape(schemaWithReviewerContext)).toContain('reviewerContext');
  });

  it('rejects reviewer-supplied no-owner presentation ordinals', () => {
    expect(validatePrdAuditJudgment({
      version: 'v1',
      criterionJudgments: [
        {
          criterion: { storyId: 'alpha.1', ordinal: 1 },
          grade: 'PASS',
          evidence: 'The delivered behavior meets the criterion.',
          rationale: 'The observed result matches the obligation.',
          requirementAssociations: [],
          evidenceTaskIds: [],
        },
      ],
      noOwnerObservations: [
        {
          grade: 'OVER_SCOPE',
          evidence: 'An outlying change remains within the declared intent.',
          rationale: 'It needs no repair owner.',
          intentRelation: 'within',
          presentationOrdinal: 'NC-99',
        },
      ],
    }, {
      criteria: [{ id: 'Salpha.1.1' }],
      taskIds: new Set(),
      requirements: [],
    })).toMatchObject({
      ok: false,
      diagnostics: [expect.stringMatching(/presentationOrdinal/)],
    });
  });
});
