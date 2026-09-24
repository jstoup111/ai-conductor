// Covers: task:1
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  AS_BUILT_VERDICT_CONTRACT_VERSION,
  AS_BUILT_VERDICT_SCHEMA,
  validateAsBuiltVerdict,
} from '../src/engine/as-built-contract.js';
import type { AsBuiltVerdict } from '../src/engine/as-built-contract.js';

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected JSON Schema object');
  }
  return value as Record<string, unknown>;
}

function schemaWithConst(schema: unknown, value: string): Record<string, unknown> {
  const alternatives = object(schema).oneOf;
  if (!Array.isArray(alternatives)) throw new Error('expected oneOf alternatives');
  const match = alternatives.find((alternative) => {
    const properties = object(object(alternative).properties);
    return properties.kind !== undefined && object(properties.kind).const === value;
  });
  if (match === undefined) throw new Error(`expected ${value} alternative`);
  return object(match);
}

function everySchemaObjectIsClosed(schema: unknown): boolean {
  const source = object(schema);
  const nested = [
    ...Object.values(object(source.properties ?? {})),
    ...(source.items === undefined ? [] : [source.items]),
    ...(Array.isArray(source.oneOf) ? source.oneOf : []),
  ];
  return (source.type !== 'object' || source.additionalProperties === false)
    && nested.every(everySchemaObjectIsClosed);
}

describe('as-built verdict contract', () => {
  it('publishes a frozen, closed schema with only the accepted verdict and finding-reference vocabularies', () => {
    const schema = object(AS_BUILT_VERDICT_SCHEMA);
    const verdict = object(object(schema.properties).verdict);
    const finding = object(object(object(schema.properties).findings).items);
    const reference = object(finding.properties).reference;
    const adrDecision = schemaWithConst(reference, 'adr-decision');
    const planTask = schemaWithConst(reference, 'plan-task');
    const referenceAlternatives = object(reference).oneOf;

    expect({
      frozen: Object.isFrozen(AS_BUILT_VERDICT_SCHEMA),
      closed: everySchemaObjectIsClosed(schema),
      verdicts: verdict.enum,
      findingClasses: object(finding.properties).class === undefined
        ? undefined
        : object(object(finding.properties).class).enum,
      references: Array.isArray(referenceAlternatives) ? referenceAlternatives.length : undefined,
      adrDecision: {
        properties: Object.keys(object(adrDecision.properties)),
        decision: object(object(adrDecision.properties).decision),
      },
      planTask: Object.keys(object(planTask.properties)),
    }).toEqual({
      frozen: true,
      closed: true,
      verdicts: ['APPROVED', 'APPROVED WITH DRIFT NOTES', 'PLAN_GAP', 'BLOCKED'],
      findingClasses: ['REMEDIABLE', 'DESIGN'],
      references: 2,
      adrDecision: {
        properties: ['kind', 'stem', 'decision'],
        decision: { type: 'integer' },
      },
      planTask: ['kind', 'taskId'],
    });
  });

  it('accepts an APPROVED verdict with production reachability', () => {
    const verdict = {
      version: AS_BUILT_VERDICT_CONTRACT_VERSION,
      verdict: 'APPROVED',
      reachability: [{
        primitive: 'validateAsBuiltVerdict',
        callerChain: ['AsBuiltReviewStep.run', 'validateAsBuiltVerdict'],
      }],
      driftNotes: [],
    };

    expect(validateAsBuiltVerdict(verdict)).toEqual({ ok: true, verdict });
  });

  it('accepts drift notes that retain an UNEXERCISED primitive and observation signature', () => {
    const verdict = {
      version: AS_BUILT_VERDICT_CONTRACT_VERSION,
      verdict: 'APPROVED WITH DRIFT NOTES',
      reachability: [],
      driftNotes: [{
        note: 'The deployed event has not yet been observed.',
        unexercised: { primitive: 'emitVerdictFreshness', signature: 'verdict_freshness' },
      }],
    };

    expect(validateAsBuiltVerdict(verdict)).toMatchObject({
      ok: true,
      verdict: { driftNotes: [{ unexercised: { primitive: 'emitVerdictFreshness', signature: 'verdict_freshness' } }] },
    });
  });

  it('accepts a delivered PLAN_GAP with its affected outcome', () => {
    const verdict = {
      version: AS_BUILT_VERDICT_CONTRACT_VERSION,
      verdict: 'PLAN_GAP',
      reachability: [],
      driftNotes: [],
      outcomeDelivered: true,
      affectedOutcome: 'The sealed criterion needs an unplanned delivery path.',
    };

    expect(validateAsBuiltVerdict(verdict)).toMatchObject({
      ok: true,
      verdict: { verdict: 'PLAN_GAP', outcomeDelivered: true, affectedOutcome: verdict.affectedOutcome },
    });
  });

  it('accepts a DESIGN-only BLOCKED finding without a governing reference', () => {
    const verdict = {
      version: AS_BUILT_VERDICT_CONTRACT_VERSION,
      verdict: 'BLOCKED',
      reachability: [],
      driftNotes: [],
      findings: [{ id: 'AB-1', class: 'DESIGN', summary: 'The approved design cannot deliver the outcome.' }],
      violations: 'The approved design conflicts with the sealed outcome.',
      resolution: 'A human must approve a superseding design.',
    };

    expect(validateAsBuiltVerdict(verdict)).toMatchObject({
      ok: true,
      verdict: { verdict: 'BLOCKED', findings: [{ id: 'AB-1', class: 'DESIGN' }] },
    });
  });

  it('exports a verdict-discriminated union with arm-specific fields', () => {
    expectTypeOf<Extract<AsBuiltVerdict, { verdict: 'PLAN_GAP' }>>().toHaveProperty('outcomeDelivered');
    expectTypeOf<Extract<Exclude<AsBuiltVerdict, { verdict: 'PLAN_GAP' }>, Record<'outcomeDelivered', unknown>>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<AsBuiltVerdict, { verdict: 'BLOCKED' }>>().toHaveProperty('findings');
    expectTypeOf<Extract<Exclude<AsBuiltVerdict, { verdict: 'BLOCKED' }>, Record<'findings', unknown>>>().toEqualTypeOf<never>();
  });
});
