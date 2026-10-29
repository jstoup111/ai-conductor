import { describe, expect, it } from 'vitest';

import {
  REMEDIATION_EXISTING_TASK_DISPOSITION,
  REMEDIATION_HALT_CATEGORIES,
  REMEDIATION_PUBLICATION_DISPOSITION,
  REMEDIATION_TARGET_STEPS,
  type RemediationDisposition,
} from '../../src/engine/artifacts.js';
import {
  REMEDIATION_PLAN_CONTRACT_VERSION,
  REMEDIATION_PLAN_SCHEMA,
  renderRemediationPlanShape,
  validateRemediationPlan,
} from '../../src/engine/remediation-plan-contract.js';
import type { RemediationProjection, RemediationRequiredReference } from '../../src/engine/remediation-projection.js';

const expectedDispositions: readonly RemediationDisposition[] = [
  ...REMEDIATION_TARGET_STEPS,
  REMEDIATION_PUBLICATION_DISPOSITION,
  REMEDIATION_EXISTING_TASK_DISPOSITION,
  'halt',
];

function projection(
  source: RemediationProjection['source'],
  requiredReferences: readonly RemediationRequiredReference[],
  tasks: RemediationProjection['tasks'] = [{ id: '7', title: 'Repair the finding', doneWhen: [] }],
  refusals: RemediationProjection['refusals'] = [],
  priorAsBuiltCases: RemediationProjection['priorAsBuiltCases'] = [],
): RemediationProjection {
  return {
    version: 1,
    source,
    requiredReferences,
    evidence: { excerpts: [], omittedFiles: [] },
    tasks,
    pendingAsBuiltFindings: [],
    priorAsBuiltCases,
    priorLaps: [],
    refusals,
    vocabulary: {
      dispositions: expectedDispositions,
      haltCategories: REMEDIATION_HALT_CATEGORIES,
    },
  };
}

function refusal(decisionId: string): RemediationProjection['refusals'][number] {
  return {
    key: 'S1.2',
    decisionId,
    revision: 1,
    rationale: 'The operator refused the widening offer.',
  };
}

function refusalReference(decisionId: string): RemediationRequiredReference {
  return {
    kind: 'refusal',
    id: decisionId,
    sourceGate: 'refusal-rework',
    revision: 1,
    rationale: 'The operator refused the widening offer.',
  };
}

function disposition(reference: { kind: string; id: string }, overrides: Record<string, unknown> = {}) {
  return {
    reference,
    disposition: 'build',
    category: null,
    rationale: 'The evidence identifies the repair.',
    tasks: [{ id: 'repair', title: 'Implement the repair.' }],
    boundTaskIds: [],
    ...(reference.kind === 'as-built-finding'
      ? { reconciliation: { relation: 'new', reason: 'This finding has no prior case.' } }
      : {}),
    ...overrides,
  };
}

function expectRejected(result: ReturnType<typeof validateRemediationPlan>): readonly string[] {
  expect(result.kind).toBe('rejected');
  expect(Object.keys(result)).toEqual(result.kind === 'rejected' && result.rejected === undefined
    ? ['kind', 'diagnostics']
    : ['kind', 'diagnostics', 'rejected']);
  if (result.kind === 'rejected' && result.rejected !== undefined) {
    expect(result.rejected).toEqual(expect.any(Array));
  }
  expect(result).not.toHaveProperty('dispositions');
  expect(result).not.toHaveProperty('verdict');
  expect(result).not.toHaveProperty('halt');
  expect(result).not.toHaveProperty('BLOCKED');
  return result.kind === 'rejected' ? result.diagnostics : [];
}

describe('remediation plan contract', () => {
  // Covers: task:4
  it('accepts every as-built reconciliation relation and retains it on each disposition', () => {
    const required = (id: string): RemediationRequiredReference => ({
      kind: 'as-built-finding', id, sourceGate: 'architecture_review_as_built',
      reference: { kind: 'adr-decision', stem: 'adr-boundary', decision: 1 }, summary: `Finding ${id}.`,
    });
    const c1 = {
      id: 'c1', status: 'open' as const, recurrenceCount: 1, sources: [], repairTasks: [],
    };
    const result = validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [
        disposition({ kind: 'as-built-finding', id: 'as-built:lap:1' }, {
          disposition: 'halt', category: 'architectural-clarity', tasks: [],
          reconciliation: { relation: 'same', priorCaseId: 'c1', reason: 'Same missing boundary.' },
        }),
        disposition({ kind: 'as-built-finding', id: 'as-built:lap:2' }, {
          disposition: 'halt', category: 'architectural-clarity', tasks: [],
          reconciliation: { relation: 'recurrence', priorCaseId: 'c1', reason: 'Repair was attempted.' },
        }),
        disposition({ kind: 'as-built-finding', id: 'as-built:lap:3' }, {
          reconciliation: { relation: 'materially-changed', priorCaseId: 'c1', reason: 'Cause changed.' },
        }),
        disposition({ kind: 'as-built-finding', id: 'as-built:lap:4' }),
      ],
    }, projection('as-built', [
      required('as-built:lap:1'), required('as-built:lap:2'),
      required('as-built:lap:3'), required('as-built:lap:4'),
    ], undefined, [], [c1]));

    expect(result).toMatchObject({
      kind: 'accepted',
      dispositions: [
        { reconciliation: { relation: 'same', priorCaseId: 'c1', reason: 'Same missing boundary.' } },
        { reconciliation: { relation: 'recurrence', priorCaseId: 'c1', reason: 'Repair was attempted.' } },
        { reconciliation: { relation: 'materially-changed', priorCaseId: 'c1', reason: 'Cause changed.' } },
        { reconciliation: { relation: 'new', reason: 'This finding has no prior case.' } },
      ],
    });
  });

  // Covers: task:4
  it('requires reconciliation only for as-built findings and rejects invalid reconciliation fields', () => {
    const asBuilt: RemediationRequiredReference = {
      kind: 'as-built-finding', id: 'as-built:lap:1', sourceGate: 'architecture_review_as_built',
      reference: { kind: 'adr-decision', stem: 'adr-boundary', decision: 1 }, summary: 'A finding.',
    };
    const context = projection('as-built', [asBuilt], undefined, [], [{
      id: 'c1', status: 'open', recurrenceCount: 1, sources: [], repairTasks: [],
    }]);

    expect(expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'as-built-finding', id: asBuilt.id }, { reconciliation: undefined })],
    }, context))).toContain('dispositions[0].reconciliation is required for as-built findings');
    expect(expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'as-built-finding', id: asBuilt.id }, {
        reconciliation: { relation: 'same', priorCaseId: 'c1', reason: '   ' },
      })],
    }, context))).toContain('dispositions[0].reconciliation.reason must be non-empty');
    expect(expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'as-built-finding', id: asBuilt.id }, {
        reconciliation: { relation: 'unknown', priorCaseId: 'c1', reason: 'Invalid relation.' },
      })],
    }, context))).toContain('dispositions[0].reconciliation.relation must be one of same, recurrence, materially-changed, new');
    expect(expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'as-built-finding', id: asBuilt.id }, {
        reconciliation: { relation: 'same', reason: 'Missing prior case.' },
      })],
    }, context))).toContain('dispositions[0].reconciliation.priorCaseId is required for same');
    expect(expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'as-built-finding', id: asBuilt.id }, {
        reconciliation: { relation: 'recurrence', priorCaseId: 'missing', reason: 'Unknown prior case.' },
      })],
    }, context))).toContain('dispositions[0].reconciliation.priorCaseId does not name projected as-built case missing');
    expect(expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'as-built-finding', id: asBuilt.id }, {
        reconciliation: { relation: 'new', priorCaseId: 'c1', reason: 'New cannot have a parent.' },
      })],
    }, context))).toContain('dispositions[0].reconciliation.priorCaseId is forbidden for new');

    const prd: RemediationRequiredReference = {
      kind: 'prd-criterion', id: 'S1.2', sourceGate: 'prd_audit', ownerTaskId: '7', summary: 'A criterion.',
    };
    expect(expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'prd-criterion', id: 'S1.2' }, {
        reconciliation: { relation: 'new', reason: 'Not permitted here.' },
      })],
    }, projection('prd-audit', [prd])))).toContain('dispositions[0].reconciliation applies only to as-built findings');
  });

  // Covers: task:5
  it('binds same and recurrence only to the named prior case repair tasks', () => {
    const finding: RemediationRequiredReference = {
      kind: 'as-built-finding', id: 'as-built:lap:1', sourceGate: 'architecture_review_as_built',
      reference: { kind: 'plan-task', taskId: '4' }, summary: 'A repeated task finding.',
    };
    const context = projection('as-built', [finding], [
      { id: '4', title: 'Owner', doneWhen: [] }, { id: 'rem-as-built-t1', title: 'Repair', doneWhen: [] },
      { id: 'other', title: 'Other', doneWhen: [] },
    ], [], [{ id: 'c1', status: 'open', recurrenceCount: 1, sources: [], repairTasks: [{ id: 'rem-as-built-t1', resolution: 'pending' }] }]);
    const accepted = validateRemediationPlan({ version: REMEDIATION_PLAN_CONTRACT_VERSION, dispositions: [disposition({ kind: 'as-built-finding', id: finding.id }, {
      disposition: 'existing-task', tasks: [], boundTaskIds: ['4', 'rem-as-built-t1'],
      reconciliation: { relation: 'recurrence', priorCaseId: 'c1', reason: 'It recurred.' },
    })] }, context);
    expect(accepted.kind).toBe('accepted');
  });

  // Covers: task:1
  it('derives its disposition and halt-category vocabularies from the engine constants', () => {
    const disposition = REMEDIATION_PLAN_SCHEMA.properties.dispositions.items.properties.disposition;
    const category = REMEDIATION_PLAN_SCHEMA.properties.dispositions.items.properties.category.anyOf[0];
    const referenceKind = REMEDIATION_PLAN_SCHEMA.properties.dispositions.items.properties.reference.properties.kind;

    expect(REMEDIATION_PLAN_CONTRACT_VERSION).toBe('v1');
    expect(disposition.enum).toEqual(expectedDispositions);
    expect(category.enum).toEqual(REMEDIATION_HALT_CATEGORIES);
    expect(referenceKind.enum).toEqual(['prd-criterion', 'as-built-finding', 'refusal', 'stall', 'test']);
  });

  // Covers: task:1
  it('keeps each disposition a strict, engine-judgment-only shape', () => {
    const root = REMEDIATION_PLAN_SCHEMA;
    const disposition = root.properties.dispositions.items;

    expect(root).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['version', 'dispositions'],
    });
    expect(Object.keys(root.properties)).toEqual(['version', 'dispositions']);
    expect(disposition).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['reference', 'disposition', 'category', 'rationale', 'tasks', 'boundTaskIds'],
    });
    expect(Object.keys(disposition.properties)).toEqual([
      'reference', 'disposition', 'category', 'rationale', 'tasks', 'boundTaskIds', 'reconciliation',
    ]);
    expect(disposition.properties.reference).toMatchObject({
      type: 'object', additionalProperties: false, required: ['kind', 'id'],
    });
    expect(Object.keys(disposition.properties.reference.properties)).toEqual(['kind', 'id']);
    expect(disposition.properties.tasks.items).toMatchObject({
      type: 'object', additionalProperties: false, required: ['id', 'title'],
    });
    expect(Object.keys(disposition.properties.tasks.items.properties)).toEqual(['id', 'title']);
    expect(disposition.properties.reconciliation).toMatchObject({
      type: 'object', additionalProperties: false, required: ['relation', 'reason'],
    });
    expect(Object.keys(disposition.properties.reconciliation.properties)).toEqual(['relation', 'priorCaseId', 'reason']);

    expect(Object.keys(disposition.properties)).not.toEqual(expect.arrayContaining([
      'status', 'attempt', 'stamp', 'admission', 'route',
    ]));
  });

  // Covers: task:1
  it('renders the provider shape from the supplied schema rather than a parallel template', () => {
    expect(Object.isFrozen(REMEDIATION_PLAN_SCHEMA)).toBe(true);

    const rendered = renderRemediationPlanShape();
    const copiedSchema = {
      ...REMEDIATION_PLAN_SCHEMA,
      properties: {
        ...REMEDIATION_PLAN_SCHEMA.properties,
        dispositions: {
          ...REMEDIATION_PLAN_SCHEMA.properties.dispositions,
          items: {
            ...REMEDIATION_PLAN_SCHEMA.properties.dispositions.items,
            properties: {
              ...REMEDIATION_PLAN_SCHEMA.properties.dispositions.items.properties,
              disposition: {
                ...REMEDIATION_PLAN_SCHEMA.properties.dispositions.items.properties.disposition,
                enum: expectedDispositions.filter((value) => value !== 'plan'),
              },
            },
          },
        },
      },
    };
    const changed = renderRemediationPlanShape(copiedSchema);

    for (const disposition of expectedDispositions) expect(rendered).toContain(disposition);
    for (const category of REMEDIATION_HALT_CATEGORIES) expect(rendered).toContain(category);
    expect(changed).not.toContain('"plan"');
    expect(changed).toContain('"build"');
  });

  // Covers: task:2
  it('accepts a complete PRD plan and links the disposition to its typed reference', () => {
    const required: RemediationRequiredReference = {
      kind: 'prd-criterion', id: 'S1.2', sourceGate: 'prd_audit', ownerTaskId: '7', summary: 'The criterion is unmet.',
    };

    const result = validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'prd-criterion', id: 'S1.2' })],
    }, projection('prd-audit', [required]));

    expect(result).toEqual({
      kind: 'accepted',
      dispositions: [expect.objectContaining({
        requiredReference: required,
        disposition: 'build',
        targetStep: 'build',
        category: null,
        rationale: 'The evidence identifies the repair.',
        tasks: [{ id: 'repair', title: 'Implement the repair.' }],
      })],
    });
  });

  // Covers: task:2
  it('accounts for the shuffled union of PRD and as-built typed references', () => {
    const prd: RemediationRequiredReference = {
      kind: 'prd-criterion', id: 'S1.2', sourceGate: 'prd_audit', ownerTaskId: '7', summary: 'The criterion is unmet.',
    };
    const asBuilt: RemediationRequiredReference = {
      kind: 'as-built-finding', id: 'as-built:attempt:1', sourceGate: 'architecture_review_as_built',
      reference: { kind: 'plan-task', taskId: '7' }, summary: 'The boundary is not reached.',
    };
    const raw = {
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [
        disposition({ kind: 'as-built-finding', id: 'as-built:attempt:1' }),
        disposition({ kind: 'prd-criterion', id: 'S1.2' }),
      ],
    };
    const context = projection('validation-group', [prd, asBuilt]);

    expect(validateRemediationPlan(raw, context)).toMatchObject({
      kind: 'accepted',
      dispositions: [
        { requiredReference: asBuilt, targetStep: 'build' },
        { requiredReference: prd, targetStep: 'build' },
      ],
    });
  });

  // Covers: task:2
  it('matches a typed PRD criterion under the shared lower-case normalization', () => {
    const required: RemediationRequiredReference = {
      kind: 'prd-criterion', id: 'S1.AbC', sourceGate: 'prd_audit', ownerTaskId: '7', summary: 'The criterion is unmet.',
    };

    expect(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'prd-criterion', id: 's1.abc' })],
    }, projection('prd-audit', [required]))).toMatchObject({
      kind: 'accepted', dispositions: [{ requiredReference: required }],
    });
  });

  // Covers: task:2
  it('accepts grammar-valid untyped stall and test plans without completeness accounting', () => {
    const stall = validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'stall', id: 'stall:task-progress' }, { tasks: [] })],
    }, projection('build-stall', []));
    const test = validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'test', id: 'test:engine-contract' }, {
        disposition: 'halt', category: 'unanswerable', tasks: [], rationale: 'The test evidence is insufficient.',
      })],
    }, projection('finish-verification', []));

    expect(stall).toMatchObject({
      kind: 'accepted',
      dispositions: [{ reference: { kind: 'stall', id: 'stall:task-progress' }, targetStep: 'build', tasks: [] }],
    });
    expect(test).toMatchObject({
      kind: 'accepted',
      dispositions: [{ reference: { kind: 'test', id: 'test:engine-contract' }, targetStep: 'halt', category: 'unanswerable' }],
    });
  });

  // Covers: task:35
  it('owns reference grammar, refusal identity, and halt categories in the schema and validator', () => {
    const decisionId = 'decision-owned';
    const schema = REMEDIATION_PLAN_SCHEMA.properties.dispositions.items.properties;
    const haltCategory = schema.category.anyOf[0];

    expect(schema.reference.properties.kind.enum).toContain('refusal');
    expect(haltCategory.enum).toEqual(REMEDIATION_HALT_CATEGORIES);

    const stall = validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'stall', id: 'stall:task-progress' }, { tasks: [] })],
    }, projection('build-stall', []));
    const test = validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'test', id: 'test:engine-contract' }, {
        disposition: 'halt', category: 'unanswerable', tasks: [],
      })],
    }, projection('finish-verification', []));

    expect(stall).toMatchObject({
      kind: 'accepted', dispositions: [{ reference: { kind: 'stall', id: 'stall:task-progress' } }],
    });
    expect(test).toMatchObject({
      kind: 'accepted',
      dispositions: [{ reference: { kind: 'test', id: 'test:engine-contract' }, category: 'unanswerable' }],
    });

    expect(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'refusal', id: decisionId })],
    }, projection('prd-audit', [refusalReference(decisionId)], undefined, [refusal(decisionId)]))).toMatchObject({
      kind: 'accepted',
      dispositions: [{ reference: refusalReference(decisionId), targetStep: 'build' }],
    });
  });

  // Covers: task:5
  it('rejects every unknown disposition vocabulary entry with its reference and full accepted set', () => {
    const result = validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [
        disposition({ kind: 'stall', id: 'stall:unknown-disposition' }, { disposition: 'unknown-disposition' }),
        disposition({ kind: 'stall', id: 'stall:unknown-category' }, {
          disposition: 'halt', category: 'unknown-category', tasks: [],
        }),
      ],
    }, projection('build-stall', []));

    expect(result).toEqual({
      kind: 'rejected',
      diagnostics: [
        `dispositions[0].disposition must be one of ${expectedDispositions.join(', ')}`,
        `dispositions[1].category must be null or one of ${REMEDIATION_HALT_CATEGORIES.join(', ')}`,
      ],
      rejected: [
        {
          gapId: 'stall:unknown-disposition',
          disposition: 'unknown-disposition',
          accepted: expectedDispositions,
          field: 'disposition',
        },
        {
          gapId: 'stall:unknown-category',
          disposition: 'unknown-category',
          accepted: REMEDIATION_HALT_CATEGORIES,
          field: 'category',
        },
      ],
    });
  });

  // Covers: task:5
  it.each([
    ['prd-audit', { kind: 'prd-criterion', id: 'S1.2' }],
    ['as-built', { kind: 'as-built-finding', id: 'as-built:lap-1:1' }],
    ['validation-group', { kind: 'prd-criterion', id: 'S1.2' }],
    ['finish-verification', { kind: 'test', id: 'test:engine-contract' }],
  ] as const)('rejects a taskless build on the %s source', (source, reference) => {
    const diagnostics = expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition(reference, { tasks: [] })],
    }, projection(source, [])));

    expect(diagnostics).toContain('dispositions[0].tasks requires at least one task for build');
  });

  // Covers: task:5
  it('rejects a halt without a category at the category field', () => {
    const diagnostics = expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'stall', id: 'stall:category-required' }, {
        disposition: 'halt', category: null,
      })],
    }, projection('build-stall', [])));

    expect(diagnostics).toContain('dispositions[0].category is required for halt');
  });

  // Covers: task:3
  it('rejects an omission with the disposition field and every missing typed reference named', () => {
    const prd: RemediationRequiredReference = {
      kind: 'prd-criterion', id: 'S1.2', sourceGate: 'prd_audit', ownerTaskId: '7', summary: 'The criterion is unmet.',
    };
    const asBuilt: RemediationRequiredReference = {
      kind: 'as-built-finding', id: 'as-built:lap-2:1', sourceGate: 'architecture_review_as_built',
      reference: { kind: 'plan-task', taskId: '7' }, summary: 'The boundary is not reached.',
    };

    const diagnostics = expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'prd-criterion', id: 'S1.2' })],
    }, projection('validation-group', [prd, asBuilt])));

    expect(diagnostics).toEqual(['dispositions missing required reference as-built-finding:as-built:lap-2:1']);
  });

  // Covers: task:3
  it('rejects a duplicate typed reference without choosing either disposition', () => {
    const required: RemediationRequiredReference = {
      kind: 'prd-criterion', id: 'S1.2', sourceGate: 'prd_audit', ownerTaskId: '7', summary: 'The criterion is unmet.',
    };

    const diagnostics = expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [
        disposition({ kind: 'prd-criterion', id: 'S1.2' }),
        disposition({ kind: 'prd-criterion', id: 'S1.2' }, { rationale: 'A second, conflicting answer.' }),
      ],
    }, projection('prd-audit', [required])));

    expect(diagnostics).toEqual(['dispositions[1].reference duplicates required reference prd-criterion:S1.2']);
  });

  // Covers: task:3
  it.each([
    ['an ADR stem', { kind: 'as-built-finding', id: 'adr-2026-08-25-as-built-remediable-findings-bounded-build-route' }],
    ['an as-built finding from another lap', { kind: 'as-built-finding', id: 'as-built:lap-1:1' }],
    ['a criterion from another feature', { kind: 'prd-criterion', id: 'S2.1' }],
  ])('rejects a foreign reference for %s', (_description, reference) => {
    const required: RemediationRequiredReference = {
      kind: 'as-built-finding', id: 'as-built:lap-2:1', sourceGate: 'architecture_review_as_built',
      reference: { kind: 'plan-task', taskId: '7' }, summary: 'The boundary is not reached.',
    };
    const diagnostics = expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition(reference)],
    }, projection('validation-group', [required])));

    expect(diagnostics).toEqual(expect.arrayContaining([
      `dispositions[0].reference does not resolve required reference ${reference.kind}:${reference.id}`,
    ]));
  });

  // Covers: task:4
  it('rejects a reference with a missing kind at its precise field path', () => {
    const diagnostics = expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'stall', id: 'stall:task-progress' }, {
        reference: { id: 'stall:task-progress' },
      })],
    }, projection('build-stall', [])));

    expect(diagnostics).toContain('dispositions[0].reference.kind must be non-empty');
  });

  // Covers: task:4
  it('rejects a reference with an empty id at its precise field path', () => {
    const diagnostics = expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'stall', id: '' }, { tasks: [] })],
    }, projection('build-stall', [])));

    expect(diagnostics).toContain('dispositions[0].reference.id must be non-empty');
  });

  // Covers: task:4
  it('rejects a stall reference whose id does not match the stall key grammar', () => {
    const diagnostics = expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'stall', id: 'stall:' }, { tasks: [] })],
    }, projection('build-stall', [])));

    expect(diagnostics).toContain('dispositions[0].reference.id must match stall:<slug>');
  });

  // Covers: task:4
  it('rejects a test reference whose id does not match the test key grammar', () => {
    const diagnostics = expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'test', id: 'test:bad/key' })],
    }, projection('finish-verification', [])));

    expect(diagnostics).toContain('dispositions[0].reference.id must match test:<stem>');
  });

  // Covers: task:4
  it('rejects an otherwise valid untyped reference when the source is typed', () => {
    const required: RemediationRequiredReference = {
      kind: 'prd-criterion', id: 'S1.2', sourceGate: 'prd_audit', ownerTaskId: '7', summary: 'The criterion is unmet.',
    };
    const diagnostics = expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'stall', id: 'stall:task-progress' })],
    }, projection('prd-audit', [required])));

    expect(diagnostics).toContain('dispositions[0].reference is only valid for build-stall source');
  });

  // Covers: task:7
  it('rejects a refusal reference whose decision id is not projected', () => {
    const decisionId = 'decision-owned';
    const diagnostics = expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'refusal', id: 'decision-foreign' })],
    }, projection('prd-audit', [refusalReference(decisionId)], undefined, [refusal(decisionId)])));

    expect(diagnostics).toEqual(['dispositions[0].reference does not resolve projected refusal decision-foreign']);
  });

  // Covers: task:7
  it('rejects a duplicate projected refusal reference', () => {
    const decisionId = 'decision-owned';
    const diagnostics = expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [
        disposition({ kind: 'refusal', id: decisionId }),
        disposition({ kind: 'refusal', id: decisionId }, { rationale: 'A conflicting rework.' }),
      ],
    }, projection('prd-audit', [refusalReference(decisionId)], undefined, [refusal(decisionId)])));

    expect(diagnostics).toEqual(['dispositions[1].reference duplicates projected refusal decision-owned']);
  });

  // Covers: task:7
  it('rejects an empty refusal decision id at the reference id field', () => {
    const diagnostics = expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'refusal', id: '' })],
    }, projection('prd-audit', [refusalReference('decision-owned')], undefined, [refusal('decision-owned')])));

    expect(diagnostics).toEqual(['dispositions[0].reference.id must be non-empty']);
  });

  // Covers: task:7
  it('accepts omission of a projected refusal for refusal admission to account for', () => {
    const decisionId = 'decision-owned';

    expect(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [],
    }, projection('prd-audit', [refusalReference(decisionId)], undefined, [refusal(decisionId)]))).toEqual({
      kind: 'accepted',
      dispositions: [],
    });
  });

  // Covers: task:6
  it('accepts an existing-task disposition bound to its typed finding owner with canonical ids', () => {
    const required: RemediationRequiredReference = {
      kind: 'prd-criterion', id: 'S1.2', sourceGate: 'prd_audit', ownerTaskId: '7', summary: 'The criterion is unmet.',
    };

    const result = validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'prd-criterion', id: 'S1.2' }, {
        disposition: REMEDIATION_EXISTING_TASK_DISPOSITION,
        tasks: [],
        boundTaskIds: ['7 (landed)'],
      })],
    }, projection('prd-audit', [required]));

    expect(result).toMatchObject({
      kind: 'accepted',
      dispositions: [{ requiredReference: required, boundTaskIds: ['7'] }],
    });
  });

  // Covers: task:6
  it('accepts an existing-task disposition bound to an as-built plan-task owner with canonical ids', () => {
    const required: RemediationRequiredReference = {
      kind: 'as-built-finding', id: 'as-built:lap-1:1', sourceGate: 'architecture_review_as_built',
      reference: { kind: 'plan-task', taskId: '7' }, summary: 'The boundary is not reached.',
    };

    const result = validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [disposition({ kind: 'as-built-finding', id: 'as-built:lap-1:1' }, {
        disposition: REMEDIATION_EXISTING_TASK_DISPOSITION,
        tasks: [],
        boundTaskIds: ['7 (landed)'],
      })],
    }, projection('as-built', [required]));

    expect(result).toMatchObject({
      kind: 'accepted',
      dispositions: [{ requiredReference: required, boundTaskIds: ['7'] }],
    });
  });

  // Covers: task:6
  it.each([
    ['a non-owner alone', ['8']],
    ['a non-owner alongside the owner', ['7', '8']],
  ])('rejects an existing-task disposition binding %s even beside a valid sibling', (_description, boundTaskIds) => {
    const required: RemediationRequiredReference = {
      kind: 'prd-criterion', id: 'S1.2', sourceGate: 'prd_audit', ownerTaskId: '7', summary: 'The criterion is unmet.',
    };
    const sibling: RemediationRequiredReference = {
      kind: 'prd-criterion', id: 'S1.3', sourceGate: 'prd_audit', ownerTaskId: '7', summary: 'The sibling criterion is unmet.',
    };
    const diagnostics = expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [
        disposition({ kind: 'prd-criterion', id: 'S1.2' }, {
          disposition: REMEDIATION_EXISTING_TASK_DISPOSITION, tasks: [], boundTaskIds,
        }),
        disposition({ kind: 'prd-criterion', id: 'S1.3' }, {
          disposition: REMEDIATION_EXISTING_TASK_DISPOSITION, tasks: [], boundTaskIds: ['7'],
        }),
      ],
    }, projection('prd-audit', [required, sibling], [
      { id: '7', title: 'Owns the repair', doneWhen: [] },
      { id: '8', title: 'Does not own the repair', doneWhen: [] },
    ])));

    expect(diagnostics).toContain('dispositions[0].boundTaskIds must not bind non-owner task 8; owner is 7');
  });

  // Covers: task:6
  it.each([
    ['an absent task id', ['99'], 'dispositions[0].boundTaskIds does not resolve active task 99'],
    ['an empty binding', [], 'dispositions[0].boundTaskIds requires at least one task id for existing-task'],
  ])('rejects an existing-task disposition with %s even beside a valid sibling', (_description, boundTaskIds, diagnostic) => {
    const required: RemediationRequiredReference = {
      kind: 'prd-criterion', id: 'S1.2', sourceGate: 'prd_audit', ownerTaskId: '7', summary: 'The criterion is unmet.',
    };
    const sibling: RemediationRequiredReference = {
      kind: 'prd-criterion', id: 'S1.3', sourceGate: 'prd_audit', ownerTaskId: '7', summary: 'The sibling criterion is unmet.',
    };
    const diagnostics = expectRejected(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [
        disposition({ kind: 'prd-criterion', id: 'S1.2' }, {
          disposition: REMEDIATION_EXISTING_TASK_DISPOSITION, tasks: [], boundTaskIds,
        }),
        disposition({ kind: 'prd-criterion', id: 'S1.3' }, {
          disposition: REMEDIATION_EXISTING_TASK_DISPOSITION, tasks: [], boundTaskIds: ['7'],
        }),
      ],
    }, projection('prd-audit', [required, sibling])));

    expect(diagnostics).toContain(diagnostic);
  });
});
