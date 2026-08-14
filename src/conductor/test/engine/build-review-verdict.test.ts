import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BUILD_REVIEW_VERDICT,
  canonicalizeBuildReviewGraderVerdict,
  validateBuildReviewVerdict,
} from '../../src/engine/artifacts.js';
import { checkGateCompletion } from '../../src/engine/gate-verdicts.js';

describe('engine/build-review verdict wiring contract', () => {
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
        wiring: false,
      },
    });
  });

  it('derives only named failures and preserves their structured findings', () => {
    expect(canonicalizeBuildReviewGraderVerdict({
      reasons: ['Wiring is unreachable.'],
      failedRubrics: ['wiring'],
      findings: { wiring: ['The configured entry point cannot reach the new surface.'] },
    })).toEqual({
      ok: true,
      verdict: 'FAIL',
      reasons: ['Wiring is unreachable.'],
      findings: { wiring: ['The configured entry point cannot reach the new surface.'] },
      rubric: {
        tautology: false,
        scope: false,
        rootCause: false,
        completeness: false,
        wiring: true,
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

  it('does not judge or satisfy a PASS verdict that omits rubric.wiring', async () => {
    const verdict = {
      verdict: 'PASS',
      rubric: { tautology: false, scope: false, rootCause: false, completeness: false },
    };
    const dir = await writeVerdict(verdict);

    expect(validateBuildReviewVerdict(verdict)).toEqual({
      ok: false,
      reason: expect.stringMatching(/rubric\.wiring/i),
    });
    await expect(checkGateCompletion(dir, 'build_review')).resolves.toMatchObject({
      done: false,
      reason: expect.stringMatching(/rubric\.wiring/i),
    });
  });

  it('fails closed when rubric.wiring is not a boolean', () => {
    expect(validateBuildReviewVerdict({
      verdict: 'PASS',
      rubric: { tautology: false, scope: false, rootCause: false, completeness: false, wiring: 'false' },
    })).toEqual({
      ok: false,
      reason: expect.stringMatching(/rubric\.wiring.*boolean/i),
    });
  });

  it.each([undefined, []])('fails closed and names missing findings when rubric.wiring is true and findings.wiring is %j', (wiring) => {
    expect(validateBuildReviewVerdict({
      verdict: 'FAIL',
      rubric: { tautology: false, scope: false, rootCause: false, completeness: false, wiring: true },
      findings: wiring === undefined ? {} : { wiring },
    })).toEqual({
      ok: false,
      reason: expect.stringMatching(/findings\.wiring/i),
    });
  });

  it('validates and satisfies a PASS verdict that judges all five rubric items', async () => {
    const verdict = {
      verdict: 'PASS',
      rubric: { tautology: false, scope: false, rootCause: false, completeness: false, wiring: false },
      findings: { wiring: [] },
    };
    const dir = await writeVerdict(verdict);

    const validated = validateBuildReviewVerdict(verdict);
    expect(validated).toEqual({ ok: true, ...verdict });
    expect(validated).toMatchObject({
      rubric: { wiring: false },
      findings: { wiring: [] },
    });
    await expect(checkGateCompletion(dir, 'build_review')).resolves.toMatchObject({ done: true });
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

  it.each(['tautology', 'scope', 'rootCause', 'completeness', 'wiring'] as const)(
    'rejects PASS when rubric.%s reports a failure',
    (failedRubric) => {
      const rubric = { tautology: false, scope: false, rootCause: false, completeness: false, wiring: false };
      rubric[failedRubric] = true;
      expect(validateBuildReviewVerdict({ verdict: 'PASS', rubric, findings: failedRubric === 'wiring' ? { wiring: ['Named wiring failure.'] } : undefined })).toEqual({
        ok: false,
        reason: expect.stringMatching(new RegExp(`PASS requires every rubric flag.*${failedRubric}`, 'i')),
      });
    },
  );

  it('rejects FAIL when all five rubric flags pass', () => {
    expect(validateBuildReviewVerdict({
      verdict: 'FAIL',
      rubric: { tautology: false, scope: false, rootCause: false, completeness: false, wiring: false },
    })).toEqual({
      ok: false,
      reason: expect.stringMatching(/FAIL requires at least one rubric flag/i),
    });
  });

  it('validates a wiring failure with findings but leaves the gate unsatisfied', async () => {
    const verdict = {
      verdict: 'FAIL',
      rubric: { tautology: false, scope: false, rootCause: false, completeness: false, wiring: true },
      findings: { wiring: ['The configured entry point is unreachable.'] },
    };
    const dir = await writeVerdict(verdict);

    expect(validateBuildReviewVerdict(verdict)).toEqual({ ok: true, ...verdict });
    await expect(checkGateCompletion(dir, 'build_review')).resolves.toMatchObject({
      done: false,
      reason: expect.stringContaining('[wiring] The configured entry point is unreachable.'),
    });
  });
});
