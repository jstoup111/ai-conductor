// Covers: task:1, task:2, task:3
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';

import {
  AS_BUILT_VERDICT_CONTRACT_VERSION,
  AS_BUILT_VERDICT_SCHEMA,
  resolveAsBuiltReferences,
  validateAsBuiltVerdict,
} from '../src/engine/as-built-contract.js';
import type { AsBuiltVerdict } from '../src/engine/as-built-contract.js';

const dirs: string[] = [];

async function governingReferenceFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'as-built-contract-'));
  dirs.push(root);
  await mkdir(join(root, '.docs', 'decisions'), { recursive: true });
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await writeFile(join(root, '.docs', 'decisions', 'adr-approved.md'), [
    '# ADR: Approved architecture',
    '',
    'Status: APPROVED',
    '',
    '## Decision',
    '',
    '1. First decision.',
    '2. Second decision.',
    '3. Third decision.',
    '4. Fourth decision.',
    '5. Fifth decision, including D5.2 detail.',
    '',
    '### D5.2: Detail',
  ].join('\n'));
  await writeFile(join(root, '.docs', 'decisions', 'adr-superseded.md'), [
    '# ADR: Superseded architecture',
    '',
    'Status: SUPERSEDED',
    '',
    '## Decision',
    '',
    '1. Superseded decision.',
  ].join('\n'));
  await writeFile(join(root, '.docs', 'plans', 'feature.md'), [
    '### Task 1: First',
    '',
    '### Task 2: Second',
    '',
    '### Task 3: Third',
  ].join('\n'));
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

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

  it('rejects a PLAN_GAP without its boolean outcomeDelivered flag', () => {
    expect(validateAsBuiltVerdict({
      version: AS_BUILT_VERDICT_CONTRACT_VERSION,
      verdict: 'PLAN_GAP',
      reachability: [],
      driftNotes: [],
      affectedOutcome: 'The sealed criterion needs an unplanned delivery path.',
    })).toEqual({ ok: false, field: 'outcomeDelivered', requirement: 'a boolean is required' });
  });

  it('rejects findings on an APPROVED verdict', () => {
    expect(validateAsBuiltVerdict({
      version: AS_BUILT_VERDICT_CONTRACT_VERSION,
      verdict: 'APPROVED',
      reachability: [],
      driftNotes: [],
      findings: [],
    })).toEqual({
      ok: false,
      field: 'findings',
      requirement: 'findings are not permitted for an APPROVED verdict',
    });
  });

  it('rejects a REMEDIABLE finding without a governing reference', () => {
    expect(validateAsBuiltVerdict({
      version: AS_BUILT_VERDICT_CONTRACT_VERSION,
      verdict: 'BLOCKED',
      reachability: [],
      driftNotes: [],
      findings: [{ id: 'AB-1', class: 'REMEDIABLE', summary: 'The fix must follow an approved decision.' }],
      violations: 'The delivery violates an approved decision.',
      resolution: 'Apply the governing remediation.',
    })).toEqual({
      ok: false,
      field: 'findings[0].reference',
      requirement: 'a governing reference is required for a REMEDIABLE finding',
    });
  });

  it('rejects a dotted ADR decision identifier', () => {
    expect(validateAsBuiltVerdict({
      version: AS_BUILT_VERDICT_CONTRACT_VERSION,
      verdict: 'BLOCKED',
      reachability: [],
      driftNotes: [],
      findings: [{
        id: 'AB-1',
        class: 'REMEDIABLE',
        reference: { kind: 'adr-decision', stem: 'approved-design', decision: '5.2' },
        summary: 'The fix must follow an approved decision.',
      }],
      violations: 'The delivery violates an approved decision.',
      resolution: 'Apply the governing remediation.',
    })).toEqual({
      ok: false,
      field: 'findings[0].reference.decision',
      requirement: 'a whole-number decision id is required',
    });
  });

  it('rejects an unknown verdict with the admitted verdict values', () => {
    expect(validateAsBuiltVerdict({
      version: AS_BUILT_VERDICT_CONTRACT_VERSION,
      verdict: 'UNDECIDED',
      reachability: [],
      driftNotes: [],
    })).toEqual({
      ok: false,
      field: 'verdict',
      requirement: 'one of APPROVED, APPROVED WITH DRIFT NOTES, PLAN_GAP, BLOCKED is required',
    });
  });

  it('rejects an unknown finding class with the admitted finding classes', () => {
    expect(validateAsBuiltVerdict({
      version: AS_BUILT_VERDICT_CONTRACT_VERSION,
      verdict: 'BLOCKED',
      reachability: [],
      driftNotes: [],
      findings: [{ id: 'AB-1', class: 'UNSUPPORTED', summary: 'The declared class is not part of the contract.' }],
      violations: 'The delivery violates an approved decision.',
      resolution: 'Apply the governing remediation.',
    })).toEqual({
      ok: false,
      field: 'findings[0].class',
      requirement: 'one of REMEDIABLE or DESIGN is required',
    });
  });

  it('rejects an unknown top-level key with the admitted APPROVED keys', () => {
    expect(validateAsBuiltVerdict({
      version: AS_BUILT_VERDICT_CONTRACT_VERSION,
      verdict: 'APPROVED',
      reachability: [],
      driftNotes: [],
      unexplained: true,
    })).toEqual({
      ok: false,
      field: 'unexplained',
      requirement: 'only version, verdict, reachability, and driftNotes are permitted for an APPROVED verdict',
    });
  });

  it('resolves REMEDIABLE ADR and active-plan task references', async () => {
    const root = await governingReferenceFixture();
    const verdict: AsBuiltVerdict = {
      version: AS_BUILT_VERDICT_CONTRACT_VERSION,
      verdict: 'BLOCKED',
      reachability: [],
      driftNotes: [],
      findings: [
        { id: 'AB-ADR', class: 'REMEDIABLE', reference: { kind: 'adr-decision', stem: 'adr-approved', decision: 4 }, summary: 'Apply the approved fourth decision.' },
        { id: 'AB-TASK', class: 'REMEDIABLE', reference: { kind: 'plan-task', taskId: '2' }, summary: 'Complete the active second task.' },
      ],
      violations: 'The implementation misses both governing obligations.',
      resolution: 'Apply the approved ADR and active-plan task.',
    };

    await expect(resolveAsBuiltReferences(verdict, root)).resolves.toEqual({ ok: true, verdict });
  });

  it('rejects a reference to a SUPERSEDED ADR', async () => {
    const root = await governingReferenceFixture();
    const verdict: AsBuiltVerdict = {
      version: AS_BUILT_VERDICT_CONTRACT_VERSION,
      verdict: 'BLOCKED',
      reachability: [], driftNotes: [],
      findings: [{ id: 'AB-1', class: 'REMEDIABLE', reference: { kind: 'adr-decision', stem: 'adr-superseded', decision: 1 }, summary: 'Follow superseded work.' }],
      violations: 'The implementation is governed by a superseded ADR.',
      resolution: 'Use a current ADR.',
    };

    await expect(resolveAsBuiltReferences(verdict, root)).resolves.toEqual({
      ok: false,
      field: 'findings[0].reference.stem',
      requirement: 'an ADR with status APPROVED is required; adr-superseded has status SUPERSEDED',
    });
  });

  it('rejects an undeclared ADR decision with the declared decision ids', async () => {
    const root = await governingReferenceFixture();
    const verdict: AsBuiltVerdict = {
      version: AS_BUILT_VERDICT_CONTRACT_VERSION,
      verdict: 'BLOCKED',
      reachability: [], driftNotes: [],
      findings: [{ id: 'AB-1', class: 'REMEDIABLE', reference: { kind: 'adr-decision', stem: 'adr-approved', decision: 9 }, summary: 'Follow a missing decision.' }],
      violations: 'The implementation cites no declared decision.',
      resolution: 'Use a declared decision.',
    };

    await expect(resolveAsBuiltReferences(verdict, root)).resolves.toEqual({
      ok: false,
      field: 'findings[0].reference.decision',
      requirement: 'one of ADR adr-approved declared decision ids 1, 2, 3, 4, 5 is required',
    });
  });

  it('rejects a task absent from the active plan', async () => {
    const root = await governingReferenceFixture();
    const verdict: AsBuiltVerdict = {
      version: AS_BUILT_VERDICT_CONTRACT_VERSION,
      verdict: 'BLOCKED',
      reachability: [], driftNotes: [],
      findings: [{ id: 'AB-1', class: 'REMEDIABLE', reference: { kind: 'plan-task', taskId: '7' }, summary: 'Complete an absent task.' }],
      violations: 'The implementation cites no active task.',
      resolution: 'Use an active task.',
    };

    await expect(resolveAsBuiltReferences(verdict, root)).resolves.toEqual({
      ok: false,
      field: 'findings[0].reference.taskId',
      requirement: 'plan task 7 is not declared by the active plan',
    });
  });
});
