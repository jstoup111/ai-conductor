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
} from '../../src/engine/remediation-plan-contract.js';

const expectedDispositions = [
  ...REMEDIATION_TARGET_STEPS,
  REMEDIATION_PUBLICATION_DISPOSITION,
  REMEDIATION_EXISTING_TASK_DISPOSITION,
  'halt',
];

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
});
