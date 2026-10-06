// Covers: task:9, task:6, task:7, task:8, task:10
import { describe, expect, it } from 'vitest';

import {
  PRD_AUDIT_JUDGMENT_SCHEMA,
  renderPrdAuditJudgmentShape,
  validatePrdAuditJudgment,
} from '../../src/engine/prd-audit-contract.js';

describe('PRD audit judgment contract', () => {
  it('names non-object judgment carriers while retaining independently valid siblings', () => {
    const valid = {
      criterion: { storyId: 'alpha', ordinal: 1 }, grade: 'PASS',
      evidence: 'The active criterion is satisfied.', rationale: 'The evidence is complete.',
      requirementAssociations: [], evidenceTaskIds: [],
    };
    expect(validatePrdAuditJudgment({
      version: 'v1', criterionJudgments: [valid, null], noOwnerObservations: ['not an object'],
    }, { criteria: [{ id: 'Salpha.1' }], taskIds: new Set(), requirements: [] })).toEqual({
      ok: false,
      judgment: {
        version: 'v1',
        criterionJudgments: [{ ...valid, criterionId: 'Salpha.1' }],
        noOwnerObservations: [],
      },
      diagnostics: [
        'criterionJudgments[1] must be a judgment object',
        'noOwnerObservations[0] must be a judgment object',
      ],
    });
  });
  it('resolves nested case-normalized criteria and annotated remediation citations', () => {
    const input = {
      version: 'v1',
      criterionJudgments: [{
        criterion: { storyId: 'FEATURE.A.2', ordinal: 3 },
        grade: 'FIXABLE',
        evidence: 'The bounded repair is owned by the remediation task.',
        rationale: 'The existing task resolves every cited repair reference.',
        requirementAssociations: [],
        evidenceTaskIds: ['rem-validate-1 (evidence)', 'task-a, task-b (verified)'],
        ownerTaskId: 'rem-validate-1 (repair)',
      }],
      noOwnerObservations: [],
    };

    expect(validatePrdAuditJudgment(input, {
      criteria: [{ id: 'Sfeature.a.2.3' }],
      taskIds: new Set(['rem-validate-1 (follow-up)', 'task-a', 'task-b']),
      requirements: [],
    })).toEqual({
      ok: true,
      judgment: {
        ...input,
        criterionJudgments: [{
          ...input.criterionJudgments[0],
          criterionId: 'Sfeature.a.2.3',
          evidenceTaskIds: ['rem-validate-1', 'task-a', 'task-b'],
          ownerTaskId: 'rem-validate-1',
        }],
      },
    });
  });

  it('names invalid criterion, task, requirement, and repair-owner citations', () => {
    const judgment = (criterion: { storyId: string; ordinal: number }) => ({
      criterion,
      grade: 'FIXABLE',
      evidence: 'The bounded repair must resolve only active references.',
      rationale: 'Every repair citation is independently checked.',
      requirementAssociations: [],
      evidenceTaskIds: [],
      ownerTaskId: 'task-a',
    });
    const inventedCriterion = judgment({ storyId: 'invented', ordinal: 1 });
    const unresolvedTask = { ...judgment({ storyId: 'alpha', ordinal: 1 }), evidenceTaskIds: ['missing-task'] };
    const unresolvedRequirement = {
      ...judgment({ storyId: 'beta', ordinal: 1 }),
      requirementAssociations: [{ path: '.docs/specs/a.md', requirementId: 'FR-404' }],
    };
    const missingOwner = { ...judgment({ storyId: 'gamma', ordinal: 1 }), ownerTaskId: ' ' };
    const multipleOwners = { ...judgment({ storyId: 'delta', ordinal: 1 }), ownerTaskId: 'task-a, task-b' };

    expect(validatePrdAuditJudgment({
      version: 'v1',
      criterionJudgments: [inventedCriterion, unresolvedTask, unresolvedRequirement, missingOwner, multipleOwners],
      noOwnerObservations: [],
    }, {
      criteria: [{ id: 'Salpha.1' }, { id: 'Sbeta.1' }, { id: 'Sgamma.1' }, { id: 'Sdelta.1' }],
      taskIds: new Set(['task-a', 'task-b']),
      requirements: [{ path: '.docs/specs/a.md', id: 'FR-7' }],
    })).toEqual({
      ok: false,
      diagnostics: [
        'criterionJudgments[0].criterion does not resolve active criterion Sinvented.1',
        'criterionJudgments[1].evidenceTaskIds[0] does not resolve active task missing-task',
        'criterionJudgments[2].requirementAssociations[0] does not resolve requirement .docs/specs/a.md:FR-404',
        'criterionJudgments[3].ownerTaskId must identify exactly one active task for FIXABLE',
        'criterionJudgments[4].ownerTaskId must identify exactly one active task for FIXABLE',
        'criterion Salpha.1 is missing a judgment',
        'criterion Sbeta.1 is missing a judgment',
        'criterion Sgamma.1 is missing a judgment',
        'criterion Sdelta.1 is missing a judgment',
        'requirement .docs/specs/a.md:FR-7 lacks a criterion association or valid PLAN_GAP evidence',
      ],
    });
  });

  it('retains valid siblings when a readable supported envelope has an invalid entry', () => {
    const valid = {
      criterion: { storyId: 'alpha', ordinal: 1 },
      grade: 'PASS',
      evidence: 'The delivered behavior meets the active criterion.',
      rationale: 'The observed evidence is sufficient.',
      requirementAssociations: [],
      evidenceTaskIds: [],
    };
    const secondValid = { ...valid, criterion: { storyId: 'beta', ordinal: 1 } };
    const invalid = { ...valid, criterion: { storyId: 'gamma', ordinal: 1 }, evidence: ' ' };

    expect(validatePrdAuditJudgment({
      version: 'v1',
      criterionJudgments: [valid, invalid, secondValid],
      noOwnerObservations: [],
    }, {
      criteria: [{ id: 'Salpha.1' }, { id: 'Sbeta.1' }, { id: 'Sgamma.1' }],
      taskIds: new Set(),
      requirements: [],
    })).toEqual({
      ok: false,
      diagnostics: [
        'criterionJudgments[1].evidence must be non-empty',
        'criterion Sgamma.1 is missing a judgment',
      ],
      judgment: {
        version: 'v1',
        criterionJudgments: [
          { ...valid, criterionId: 'Salpha.1' },
          { ...secondValid, criterionId: 'Sbeta.1' },
        ],
        noOwnerObservations: [],
      },
    });
  });

  it('rejects every normalized duplicate carrier while retaining unrelated entries', () => {
    const duplicate = {
      criterion: { storyId: 'ALPHA', ordinal: 1 },
      grade: 'PASS',
      evidence: 'The first carrier appears valid before duplicate validation.',
      rationale: 'The active criterion is independently resolved.',
      requirementAssociations: [],
      evidenceTaskIds: [],
    };
    const secondCarrier = { ...duplicate, criterion: { storyId: 'alpha', ordinal: 1 } };
    const unrelated = { ...duplicate, criterion: { storyId: 'beta', ordinal: 1 } };

    expect(validatePrdAuditJudgment({
      version: 'v1',
      criterionJudgments: [duplicate, secondCarrier, unrelated],
      noOwnerObservations: [],
    }, {
      criteria: [{ id: 'Salpha.1' }, { id: 'Sbeta.1' }],
      taskIds: new Set(),
      requirements: [],
    })).toEqual({
      ok: false,
      diagnostics: [
        'criterionJudgments[0].criterion duplicates normalized criterion Salpha.1',
        'criterionJudgments[1].criterion duplicates normalized criterion Salpha.1',
        'criterion Salpha.1 is missing a judgment',
      ],
      judgment: {
        version: 'v1',
        criterionJudgments: [{ ...unrelated, criterionId: 'Sbeta.1' }],
        noOwnerObservations: [],
      },
    });
  });

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

  it('names omitted criteria and invalid entries despite PLAN_GAP and accepted scope observations', () => {
    const alphaPlanGap = {
      criterion: { storyId: 'alpha', ordinal: 1 },
      grade: 'PLAN_GAP',
      evidence: 'The active criterion has no admitted task owner.',
      rationale: 'The gap remains a recorded negative-path finding.',
      requirementAssociations: [],
      evidenceTaskIds: [],
    };

    expect(validatePrdAuditJudgment({
      version: 'v1',
      criterionJudgments: [
        alphaPlanGap,
        { ...alphaPlanGap, criterion: { storyId: 'beta', ordinal: 1 }, grade: 'ACCEPTED' },
        { ...alphaPlanGap, criterion: { storyId: 'gamma', ordinal: 1 }, grade: 'OVER_SCOPE' },
        {
          ...alphaPlanGap,
          criterion: { storyId: 'delta', ordinal: 1 },
          grade: 'OVER_SCOPE',
          intentRelation: 'scope-accepted',
        },
      ],
      noOwnerObservations: [{
        grade: 'OVER_SCOPE',
        evidence: 'The scope observation has been recorded separately.',
        rationale: 'It cannot accept invalid criterion evidence.',
        intentRelation: 'within',
      }],
    }, {
      criteria: [{ id: 'Salpha.1' }, { id: 'Sbeta.1' }, { id: 'Sgamma.1' }, { id: 'Sdelta.1' }],
      taskIds: new Set(),
      requirements: [],
    })).toEqual({
      ok: false,
      judgment: {
        version: 'v1',
        criterionJudgments: [{ ...alphaPlanGap, criterionId: 'Salpha.1' }],
        noOwnerObservations: [{
          grade: 'OVER_SCOPE',
          evidence: 'The scope observation has been recorded separately.',
          rationale: 'It cannot accept invalid criterion evidence.',
          intentRelation: 'within',
          presentationOrdinal: 'NC-1',
        }],
      },
      diagnostics: [
        'criterionJudgments[1].grade must be one of PASS, FIXABLE, PLAN_GAP, OVER_SCOPE',
        'criterionJudgments[2].intentRelation is required for OVER_SCOPE',
        'criterionJudgments[3].intentRelation must be one of within, outside-harmless, outside-visible',
        'criterion Sbeta.1 is missing a judgment',
        'criterion Sgamma.1 is missing a judgment',
        'criterion Sdelta.1 is missing a judgment',
      ],
    });
  });

  it('blocks an uncovered requirement while allowing valid criterion PLAN_GAP evidence to account for it', () => {
    const alphaPass = {
      criterion: { storyId: 'alpha', ordinal: 1 },
      grade: 'PASS',
      evidence: 'The active criterion meets the requirement it covers.',
      rationale: 'The criterion is independently resolved.',
      requirementAssociations: [{ path: '.docs/specs/a.md', requirementId: 'FR-7' }],
      evidenceTaskIds: [],
    };
    const betaPlanGap = {
      ...alphaPass,
      criterion: { storyId: 'beta', ordinal: 1 },
      grade: 'PLAN_GAP',
      evidence: 'The untraced requirement has a valid existing plan-gap finding.',
      rationale: 'The engine records the evidence without manufacturing repair work.',
      requirementAssociations: [{ path: '.docs/specs/a.md', requirementId: 'FR-9' }],
    };
    const context = {
      criteria: [{ id: 'Salpha.1' }, { id: 'Sbeta.1' }],
      taskIds: new Set<string>(),
      requirements: [
        { path: '.docs/specs/a.md', id: 'FR-7' },
        { path: '.docs/specs/a.md', id: 'FR-9' },
      ],
    };

    expect({
      missing: validatePrdAuditJudgment({
        version: 'v1', criterionJudgments: [alphaPass, { ...betaPlanGap, requirementAssociations: [] }], noOwnerObservations: [],
      }, context),
      accounted: validatePrdAuditJudgment({
        version: 'v1', criterionJudgments: [alphaPass, betaPlanGap], noOwnerObservations: [],
      }, context),
    }).toEqual({
      missing: {
        ok: false,
        judgment: {
          version: 'v1',
          criterionJudgments: [
            { ...alphaPass, criterionId: 'Salpha.1' },
            { ...betaPlanGap, criterionId: 'Sbeta.1', requirementAssociations: [] },
          ],
          noOwnerObservations: [],
        },
        diagnostics: ['requirement .docs/specs/a.md:FR-9 lacks a criterion association or valid PLAN_GAP evidence'],
      },
      accounted: {
        ok: true,
        judgment: {
          version: 'v1',
          criterionJudgments: [
            { ...alphaPass, criterionId: 'Salpha.1' },
            { ...betaPlanGap, criterionId: 'Sbeta.1' },
          ],
          noOwnerObservations: [],
        },
      },
    });
  });

  it('keeps exact source mappings distinct while requiring a source-specific PLAN_GAP for the other duplicate', () => {
    const alphaPass = {
      criterion: { storyId: 'alpha', ordinal: 1 },
      grade: 'PASS',
      evidence: 'The criterion is complete for the mapped requirement.',
      rationale: 'The engine must retain the requirement source in its coverage comparison.',
      requirementAssociations: [{ path: '.docs/specs/a.md', requirementId: 'FR-1' }],
      evidenceTaskIds: [],
    };
    const betaPlanGap = {
      ...alphaPass,
      criterion: { storyId: 'beta', ordinal: 1 },
      grade: 'PLAN_GAP',
      evidence: 'The second source has explicit valid plan-gap evidence.',
      rationale: 'The exception applies only to the exact associated requirement source.',
      requirementAssociations: [{ path: '.docs/specs/b.md', requirementId: 'FR-1' }],
    };

    const context = {
      criteria: [{ id: 'Salpha.1', requirementAssociations: [{ path: '.docs/specs/a.md', requirementId: 'FR-1' }] }, { id: 'Sbeta.1', requirementAssociations: [] }],
      taskIds: new Set<string>(),
      requirements: [
        { path: '.docs/specs/a.md', id: 'FR-1' },
        { path: '.docs/specs/b.md', id: 'FR-1' },
      ],
    };

    expect({
      uncovered: validatePrdAuditJudgment({
        version: 'v1', criterionJudgments: [alphaPass, { ...betaPlanGap, grade: 'PASS', requirementAssociations: [] }], noOwnerObservations: [],
      }, context),
      accounted: validatePrdAuditJudgment({
        version: 'v1', criterionJudgments: [alphaPass, betaPlanGap], noOwnerObservations: [],
      }, context),
    }).toMatchObject({
      uncovered: {
        ok: false,
        diagnostics: ['requirement .docs/specs/b.md:FR-1 lacks a criterion association or valid PLAN_GAP evidence'],
      },
      accounted: { ok: true },
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

  it('keeps missing, malformed, and unsupported terminal roots unusable rather than incomplete', () => {
    const context = { criteria: [], taskIds: new Set<string>(), requirements: [] };

    for (const input of [
      undefined,
      { version: 'v1', criterionJudgments: [] },
      { version: 'v2', criterionJudgments: [], noOwnerObservations: [] },
    ]) {
      const result = validatePrdAuditJudgment(input, context);

      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty('judgment');
    }
  });

  it('never recovers a judgment from plausible chat or intermediate tool fields', () => {
    const plausibleJudgment = {
      version: 'v1',
      criterionJudgments: [{
        criterion: { storyId: 'alpha', ordinal: 1 },
        grade: 'PASS',
        evidence: 'Plausible prose says that the criterion was met.',
        rationale: 'The chat transcript looks complete but is not terminal output.',
        requirementAssociations: [],
        evidenceTaskIds: [],
      }],
      noOwnerObservations: [],
    };

    const result = validatePrdAuditJudgment({
      chatResponse: JSON.stringify(plausibleJudgment),
      intermediateToolResult: plausibleJudgment,
    }, {
      criteria: [{ id: 'Salpha.1' }],
      taskIds: new Set(),
      requirements: [],
    });

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('judgment');
  });

  it.each([
    ['accept', 'accept'],
    ['refuse', 'refuse'],
    ['engine identity', 'engineIdentity'],
    ['code stamp', 'codeStamp'],
    ['recorded disposition', 'recordedDisposition'],
  ])('names reviewer-supplied %s as an engine/operator authority violation', (_label, field) => {
    const result = validatePrdAuditJudgment({
      version: 'v1',
      criterionJudgments: [],
      noOwnerObservations: [],
      [field]: 'reviewer-claim',
    }, { criteria: [], taskIds: new Set(), requirements: [] });

    expect(result).toMatchObject({ ok: false });
    expect(result).not.toHaveProperty('judgment');
    expect(result).toMatchObject({
      diagnostics: [expect.stringMatching(new RegExp(`^root\\.${field}\\b.*(engine|operator|authority)`, 'i'))],
    });
  });
});
