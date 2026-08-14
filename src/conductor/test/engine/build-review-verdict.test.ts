import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BUILD_REVIEW_VERDICT,
  canonicalizeBuildReviewGraderVerdict,
  validateBuildReviewVerdict,
} from '../../src/engine/artifacts.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { checkGateCompletion } from '../../src/engine/gate-verdicts.js';

describe('engine/build-review verdict rubric contract', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function writeVerdict(verdict: unknown): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'build-review-verdict-'));
    dirs.push(dir);
    const path = join(dir, BUILD_REVIEW_VERDICT);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(verdict));
    return dir;
  }

  it('derives the canonical all-pass rubric from an empty failed-rubric list', () => {
    expect(canonicalizeBuildReviewGraderVerdict({
      reasons: [],
      failedRubrics: [],
    })).toEqual({
      ok: true,
      verdict: 'PASS',
      reasons: [],
      rubric: {
        tautology: false,
        scope: false,
        rootCause: false,
        completeness: false,
        },
    });
  });

  it('derives only named failures and preserves their structured findings', () => {
    expect(canonicalizeBuildReviewGraderVerdict({
      reasons: ['Wiring is unreachable.'],
      failedRubrics: ['completeness'],
      findings: { completeness: ['Task 3 has no implementation in the diff.'] },
    })).toEqual({
      ok: true,
      verdict: 'FAIL',
      reasons: ['Wiring is unreachable.'],
      findings: { completeness: ['Task 3 has no implementation in the diff.'] },
      rubric: {
        tautology: false,
        scope: false,
        rootCause: false,
        completeness: true,
      },
    });
  });

  it('rejects a grader-authored outer verdict', () => {
    expect(canonicalizeBuildReviewGraderVerdict({
      verdict: 'PASS',
      reasons: [],
      failedRubrics: [],
    })).toEqual({
      ok: false,
      reason: expect.stringMatching(/grader output must not include.*verdict/i),
    });
  });

  it('rejects findings for a rubric that is not named as failed', () => {
    expect(canonicalizeBuildReviewGraderVerdict({
      reasons: [],
      failedRubrics: [],
      findings: { tautology: ['The changed test is tautological.'] },
    })).toEqual({
      ok: false,
      reason: expect.stringMatching(/findings\.tautology.*not named.*failedRubrics/i),
    });
  });

  it.each([undefined, []])('rejects a named failed rubric when its findings are %j', (scope) => {
    expect(canonicalizeBuildReviewGraderVerdict({
      reasons: ['Scope failed.'],
      failedRubrics: ['scope'],
      findings: scope === undefined ? {} : { scope },
    })).toEqual({
      ok: false,
      reason: expect.stringMatching(/findings\.scope.*non-empty.*failedRubrics/i),
    });
  });

  it('rejects unknown finding keys instead of dropping their evidence', () => {
    expect(canonicalizeBuildReviewGraderVerdict({
      reasons: [],
      failedRubrics: [],
      findings: { root_cause: ['The change addresses only a symptom.'] },
    })).toEqual({
      ok: false,
      reason: expect.stringMatching(/findings.*unknown rubric.*root_cause/i),
    });
  });

  it('does not judge or satisfy a PASS verdict that omits rubric.completeness', async () => {
    const verdict = {
      verdict: 'PASS',
      rubric: { tautology: false, scope: false, rootCause: false },
    };
    const dir = await writeVerdict(verdict);

    expect(validateBuildReviewVerdict(verdict)).toEqual({
      ok: false,
      reason: expect.stringMatching(/rubric\.completeness/i),
    });
    await expect(checkGateCompletion(dir, 'build_review')).resolves.toMatchObject({
      done: false,
      reason: expect.stringMatching(/rubric\.completeness/i),
    });
  });

  it('fails closed when rubric.completeness is not a boolean', () => {
    expect(validateBuildReviewVerdict({
      verdict: 'PASS',
      rubric: { tautology: false, scope: false, rootCause: false, completeness: 'false' },
    })).toEqual({
      ok: false,
      reason: expect.stringMatching(/rubric\.completeness.*boolean/i),
    });
  });

  it('validates and satisfies a PASS verdict that judges all four rubric items', async () => {
    const verdict = {
      verdict: 'PASS',
      rubric: { tautology: false, scope: false, rootCause: false, completeness: false },
      findings: { completeness: [] },
    };
    const dir = await writeVerdict(verdict);

    const validated = validateBuildReviewVerdict(verdict);
    expect(validated).toEqual({ ok: true, ...verdict });
    expect(validated).toMatchObject({
      rubric: { completeness: false },
      findings: { completeness: [] },
    });
    await expect(checkGateCompletion(dir, 'build_review')).resolves.toMatchObject({ done: true });
  });

  it('accepts a current strict raw aggregate through the legacy predicate but rejects a malformed envelope', async () => {
    const lapId = parseBuildReviewLapId('lap-current')!;
    const judged = (rubric: 'tautology' | 'scope' | 'rootCause' | 'completeness' | 'wiring') => ({
      kind: 'judged' as const, rubric, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v1' as never,
      findings: [], verdict: 'PASS' as const,
    });
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot', codeStamp: 'head',
      results: { tautology: judged('tautology'), scope: judged('scope'), rootCause: judged('rootCause'), completeness: judged('completeness'), wiring: judged('wiring') },
    });

    expect(validateBuildReviewVerdict(aggregate)).toMatchObject({ ok: true, verdict: 'PASS', codeStamp: 'head' });
    await expect(checkGateCompletion(await writeVerdict(aggregate), 'build_review')).resolves.toMatchObject({ done: true });
    expect(validateBuildReviewVerdict({ ...aggregate, results: { ...aggregate.results, wiring: undefined } })).toEqual({
      ok: false, reason: expect.stringMatching(/aggregate.*incomplete/i),
    });
  });

  it('rejects PASS for failed rubric flags before requiring wiring findings', () => {
    expect(validateBuildReviewVerdict({
      verdict: 'PASS',
      reasons: [],
      rubric: { tautology: true, scope: true, rootCause: true, completeness: true, wiring: true },
    })).toEqual({
      ok: false,
      reason: expect.stringMatching(/PASS requires every rubric flag/i),
    });
  });

  it.each(['tautology', 'scope', 'rootCause', 'completeness'] as const)(
    'rejects PASS when rubric.%s reports a failure',
    (failedRubric) => {
      const rubric = { tautology: false, scope: false, rootCause: false, completeness: false };
      rubric[failedRubric] = true;
      expect(validateBuildReviewVerdict({ verdict: 'PASS', rubric })).toEqual({
        ok: false,
        reason: expect.stringMatching(new RegExp(`PASS requires every rubric flag.*${failedRubric}`, 'i')),
      });
    },
  );

  it('rejects FAIL when all four rubric flags pass', () => {
    expect(validateBuildReviewVerdict({
      verdict: 'FAIL',
      rubric: { tautology: false, scope: false, rootCause: false, completeness: false },
    })).toEqual({
      ok: false,
      reason: expect.stringMatching(/FAIL requires at least one rubric flag/i),
    });
  });

  it('validates a completeness failure with findings but leaves the gate unsatisfied', async () => {
    const verdict = {
      verdict: 'FAIL',
      rubric: { tautology: false, scope: false, rootCause: false, completeness: true },
      findings: { completeness: ['Task 3 has no implementation in the diff.'] },
    };
    const dir = await writeVerdict(verdict);

    expect(validateBuildReviewVerdict(verdict)).toEqual({ ok: true, ...verdict });
    await expect(checkGateCompletion(dir, 'build_review')).resolves.toMatchObject({
      done: false,
      reason: expect.stringContaining('[completeness] Task 3 has no implementation in the diff.'),
    });
  });
});
