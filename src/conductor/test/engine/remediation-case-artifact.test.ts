// Covers: task:1
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readRemediationCaseJudgement } from '../../src/engine/remediation-case-artifact.js';

const CASE_V1 = {
  mode: 'case-v1',
  domain: 'build_review',
  sourceOutcomes: [
    { sourceId: 'testQuality:finding-1', outcome: 'acted', caseRef: 'case-a' },
    { sourceId: 'testQuality:finding-2', outcome: 'deferred', caseRef: 'case-b' },
    { sourceId: 'testQuality:finding-3', outcome: 'rejected', caseRef: 'case-c' },
    { sourceId: 'testQuality:finding-4', outcome: 'merged', caseRef: 'case-a' },
  ],
  cases: [
    {
      caseRef: 'case-a',
      existingCaseId: 'remcase-existing-a',
      disposition: 'act',
      priority: 'high',
      rationale: 'The current test never observes the changed production branch.',
      confidence: 'high',
      effect: {
        kind: 'action',
        route: 'build',
        tasks: [{ title: 'src/widget.ts:20 — cover the changed branch.' }],
      },
    },
    {
      caseRef: 'case-b',
      disposition: 'defer',
      priority: 'low',
      rationale: 'The issue belongs to a follow-up that is outside the active plan.',
      confidence: 'medium',
      effect: {
        kind: 'deferral',
        title: 'Cover the follow-up widget branch',
        body: 'The behavior is outside the active plan.',
        exclusionRationale: 'No current plan task admits this follow-up behavior.',
      },
    },
    {
      caseRef: 'case-c',
      disposition: 'reject',
      priority: 'medium',
      rationale: 'The finding does not violate the governing rubric contract.',
      confidence: 'low',
      effect: { kind: 'none' },
    },
  ],
} as const;

const REFUTE_CASE = {
  caseRef: 'case-refuted',
  existingCaseId: 'remcase-existing-refuted',
  disposition: 'refute',
  priority: 'high',
  rationale: 'The finding is contradicted by the existing coverage.',
  confidence: 'high',
  effect: { kind: 'none' },
  refutation: {
    claim: 'The changed branch has no behavioral coverage.',
    assertions: [{
      assertion: 'The existing test invokes the changed branch.',
      verdict: 'refuted',
      evidence: [{ path: 'src/widget.test.ts', excerpt: 'it covers the changed branch' }],
    }],
  },
} as const;

const REFUTE_CASE_V1 = {
  mode: 'case-v1',
  domain: 'build_review',
  sourceOutcomes: [{ sourceId: 'testQuality:finding-refuted', outcome: 'refuted', caseRef: 'case-refuted' }],
  cases: [REFUTE_CASE],
} as const;

describe('remediation case artifact', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'remediation-case-artifact-'));
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function read(value: unknown) {
    await writeFile(join(projectRoot, '.pipeline/remediation.json'), JSON.stringify(value), 'utf8');
    return readRemediationCaseJudgement(projectRoot, Date.now() - 60_000);
  }

  it('returns every case-v1 source and case field without provider durable ids', async () => {
    const result = await read(CASE_V1);

    expect(result).toEqual({ ok: true, judgement: CASE_V1 });
  });

  it('parses a refute row and its typed refutation record', async () => {
    const result = await read(REFUTE_CASE_V1);

    expect(result).toEqual({ ok: true, judgement: REFUTE_CASE_V1 });
  });

  it('parses a refute row with a deferral effect', async () => {
    const judgement = {
      ...REFUTE_CASE_V1,
      cases: [{ ...REFUTE_CASE, effect: CASE_V1.cases[1].effect }],
    };
    const result = await read(judgement);

    expect(result).toEqual({ ok: true, judgement });
  });

  it.each(['line', 'lineNumber', 'hunk', 'sha', 'commit'])(
    'rejects refutation evidence carrying %s',
    async (forbiddenKey) => {
      const result = await read({
        ...REFUTE_CASE_V1,
        cases: [{
          ...REFUTE_CASE,
          refutation: {
            ...REFUTE_CASE.refutation,
            assertions: [{
              ...REFUTE_CASE.refutation.assertions[0],
              evidence: [{ ...REFUTE_CASE.refutation.assertions[0].evidence[0], [forbiddenKey]: 1 }],
            }],
          },
        }],
      });

      expect(result).toEqual({ ok: false, reason: 'malformed-refutation-evidence' });
    },
  );

  it.each([
    ['missing refutation', (({ refutation: _refutation, ...value }) => value)(REFUTE_CASE)],
    ['zero assertions', { ...REFUTE_CASE, refutation: { ...REFUTE_CASE.refutation, assertions: [] } }],
    ['unknown refutation key', { ...REFUTE_CASE, refutation: { ...REFUTE_CASE.refutation, unknown: true } }],
    ['missing assertion key', {
      ...REFUTE_CASE,
      refutation: { ...REFUTE_CASE.refutation, assertions: [(({
        verdict: _verdict,
        ...assertion
      }) => assertion)(REFUTE_CASE.refutation.assertions[0])] },
    }],
    ['unknown assertion key', {
      ...REFUTE_CASE,
      refutation: { ...REFUTE_CASE.refutation, assertions: [{ ...REFUTE_CASE.refutation.assertions[0], unknown: true }] },
    }],
    ['unknown assertion verdict', {
      ...REFUTE_CASE,
      refutation: { ...REFUTE_CASE.refutation, assertions: [{ ...REFUTE_CASE.refutation.assertions[0], verdict: 'uncertain' }] },
    }],
    ['too many assertions', {
      ...REFUTE_CASE,
      refutation: { ...REFUTE_CASE.refutation, assertions: Array.from({ length: 17 }, () => REFUTE_CASE.refutation.assertions[0]) },
    }],
  ])('rejects a refute row with %s', async (_name, caseRow) => {
    const result = await read({ ...REFUTE_CASE_V1, cases: [caseRow] });

    expect(result).toEqual({ ok: false, reason: 'invalid-refutation' });
  });

  it('rejects a refute row with malformed evidence keys', async () => {
    const evidence = (({ excerpt: _excerpt, ...entry }) => entry)(REFUTE_CASE.refutation.assertions[0].evidence[0]);
    const result = await read({
      ...REFUTE_CASE_V1,
      cases: [{
        ...REFUTE_CASE,
        refutation: {
          ...REFUTE_CASE.refutation,
          assertions: [{ ...REFUTE_CASE.refutation.assertions[0], evidence: Array.isArray(evidence) ? evidence : [evidence] }],
        },
      }],
    });

    expect(result).toEqual({ ok: false, reason: 'malformed-refutation-evidence' });
  });

  it('rejects a refute row with too many evidence entries', async () => {
    const result = await read({
      ...REFUTE_CASE_V1,
      cases: [{
        ...REFUTE_CASE,
        refutation: {
          ...REFUTE_CASE.refutation,
          assertions: [{
            ...REFUTE_CASE.refutation.assertions[0],
            evidence: Array.from({ length: 9 }, () => REFUTE_CASE.refutation.assertions[0].evidence[0]),
          }],
        },
      }],
    });

    expect(result).toEqual({ ok: false, reason: 'invalid-refutation' });
  });

  it('rejects a refute row with zero evidence entries', async () => {
    const result = await read({
      ...REFUTE_CASE_V1,
      cases: [{
        ...REFUTE_CASE,
        refutation: {
          ...REFUTE_CASE.refutation,
          assertions: [{ ...REFUTE_CASE.refutation.assertions[0], evidence: [] }],
        },
      }],
    });

    expect(result).toEqual({ ok: false, reason: 'invalid-refutation' });
  });

  it.each([
    ['missing exact top-level key', (({ cases, ...value }) => value)(CASE_V1), 'invalid-top-level-keys'],
    ['duplicate exact top-level key', { ...CASE_V1, dispositions: [] }, 'invalid-top-level-keys'],
    ['unknown mode', { ...CASE_V1, mode: 'case-v2' }, 'unknown-mode'],
    ['unknown domain', { ...CASE_V1, domain: 'prd_audit' }, 'unknown-domain'],
    ['unknown source outcome', {
      ...CASE_V1,
      sourceOutcomes: [{ ...CASE_V1.sourceOutcomes[0], outcome: 'ignored' }],
    }, 'invalid-source-outcome'],
    ['unknown case disposition', {
      ...CASE_V1,
      cases: [{ ...CASE_V1.cases[0], disposition: 'route' }],
    }, 'invalid-case-disposition'],
    ['unknown confidence', {
      ...CASE_V1,
      cases: [{ ...CASE_V1.cases[0], confidence: 'certain' }],
    }, 'invalid-case-confidence'],
    ['mixed legacy fields', { ...CASE_V1, dispositions: [] }, 'invalid-top-level-keys'],
    ['provider durable case id', {
      ...CASE_V1,
      cases: [{ ...CASE_V1.cases[0], caseId: 'provider-case-id' }],
    }, 'invalid-case-keys'],
    ['provider durable effect id', {
      ...CASE_V1,
      cases: [{ ...CASE_V1.cases[0], effectId: 'provider-effect-id' }],
    }, 'invalid-case-keys'],
    ['taskless action', {
      ...CASE_V1,
      cases: [{ ...CASE_V1.cases[0], effect: { kind: 'action', route: 'build', tasks: [] } }],
    }, 'invalid-action-effect'],
    ['unjustified deferral', {
      ...CASE_V1,
      cases: [{ ...CASE_V1.cases[1], effect: { ...CASE_V1.cases[1].effect, exclusionRationale: '' } }],
    }, 'invalid-deferral-effect'],
  ])('rejects %s without exposing partial rows', async (_name, value, reason) => {
    const result = await read(value);

    expect(result).toEqual({ ok: false, reason });
  });
});
