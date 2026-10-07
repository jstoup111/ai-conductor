import { describe, expect, it } from 'vitest';

import {
  REMEDIATION_EXISTING_TASK_DISPOSITION,
  REMEDIATION_HALT_CATEGORIES,
  REMEDIATION_PUBLICATION_DISPOSITION,
  REMEDIATION_TARGET_STEPS,
} from '../../src/engine/artifacts.js';
import {
  REMEDIATION_PLAN_CONTRACT_VERSION,
  REMEDIATION_PLAN_SCHEMA,
  renderRemediationPlanShape,
  validateRemediationPlan,
} from '../../src/engine/remediation-plan-contract.js';
import type { RemediationProjection, RemediationRequiredReference } from '../../src/engine/remediation-projection.js';

const expectedDispositions = [
  ...REMEDIATION_TARGET_STEPS,
  REMEDIATION_PUBLICATION_DISPOSITION,
  REMEDIATION_EXISTING_TASK_DISPOSITION,
  'halt',
];

function projection(
  source: RemediationProjection['source'],
  requiredReferences: readonly RemediationRequiredReference[],
): RemediationProjection {
  return {
    version: 1,
    source,
    requiredReferences,
    tasks: [{ id: '7', title: 'Repair the finding', doneWhen: [] }],
    pendingAsBuiltFindings: [],
    priorLaps: [],
    refusals: [],
    vocabulary: {
      dispositions: expectedDispositions,
      haltCategories: REMEDIATION_HALT_CATEGORIES,
    },
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
    ...overrides,
  };
}

function expectRejected(result: ReturnType<typeof validateRemediationPlan>): readonly string[] {
  expect(result.kind).toBe('rejected');
  expect(Object.keys(result)).toEqual(['kind', 'diagnostics']);
  expect(result).not.toHaveProperty('dispositions');
  expect(result).not.toHaveProperty('verdict');
  expect(result).not.toHaveProperty('halt');
  expect(result).not.toHaveProperty('BLOCKED');
  return result.kind === 'rejected' ? result.diagnostics : [];
}

describe('remediation plan contract', () => {
  // Covers: task:1
  it('derives its disposition and halt-category vocabularies from the engine constants', () => {
    const disposition = REMEDIATION_PLAN_SCHEMA.properties.dispositions.items.properties.disposition;
    const category = REMEDIATION_PLAN_SCHEMA.properties.dispositions.items.properties.category.anyOf[0];

    expect(REMEDIATION_PLAN_CONTRACT_VERSION).toBe('v1');
    expect(disposition.enum).toEqual(expectedDispositions);
    expect(category.enum).toEqual(REMEDIATION_HALT_CATEGORIES);
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
      'reference', 'disposition', 'category', 'rationale', 'tasks', 'boundTaskIds',
    ]);
    expect(disposition.properties.reference).toMatchObject({
      type: 'object', additionalProperties: false, required: ['kind', 'id'],
    });
    expect(Object.keys(disposition.properties.reference.properties)).toEqual(['kind', 'id']);
    expect(disposition.properties.tasks.items).toMatchObject({
      type: 'object', additionalProperties: false, required: ['id', 'title'],
    });
    expect(Object.keys(disposition.properties.tasks.items.properties)).toEqual(['id', 'title']);

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
});
