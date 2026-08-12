import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BUILD_REVIEW_VERDICT,
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

  it.each([undefined, []])('fails closed and names missing findings when rubric.wiring is false and findings.wiring is %j', (wiring) => {
    expect(validateBuildReviewVerdict({
      verdict: 'FAIL',
      rubric: { tautology: false, scope: false, rootCause: false, completeness: false, wiring: false },
      findings: wiring === undefined ? {} : { wiring },
    })).toEqual({
      ok: false,
      reason: expect.stringMatching(/findings\.wiring/i),
    });
  });
});
