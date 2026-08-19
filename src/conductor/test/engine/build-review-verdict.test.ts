import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BUILD_REVIEW_VERDICT,
  canonicalizeBuildReviewGraderVerdict,
  validateBuildReviewVerdict,
} from '../../src/engine/artifacts.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { checkGateCompletion } from '../../src/engine/gate-verdicts.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { resolveBuildReviewConfig } from '../../src/engine/resolved-config.js';
import { readKickbackLedger, writeKickbackLedger } from '../../src/engine/kickback-ledger.js';
import { coordinateBuildReviewRubrics } from '../../src/engine/build-review-coordinator.js';
import type { BuildReviewFrozenInputs } from '../../src/engine/build-review-inputs.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';

vi.mock('../../src/engine/build-review-coordinator.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-coordinator.js')>(),
  coordinateBuildReviewRubrics: vi.fn(),
}));

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
      },
    });
  });

  it('derives only named failures and preserves their structured findings', () => {
    expect(canonicalizeBuildReviewGraderVerdict({
      reasons: ['Scope is out of plan.'],
      failedRubrics: ['scope'],
      findings: { scope: ['The changed path is outside the approved plan.'] },
    })).toEqual({
      ok: true,
      verdict: 'FAIL',
      reasons: ['Scope is out of plan.'],
      findings: { scope: ['The changed path is outside the approved plan.'] },
      rubric: {
        tautology: false,
        scope: true,
        rootCause: false,
        completeness: false,
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
      findings: {},
    };
    const dir = await writeVerdict(verdict);

    const validated = validateBuildReviewVerdict(verdict);
    expect(validated).toEqual({ ok: true, ...verdict });
    expect(validated).toMatchObject({
      rubric: { completeness: false },
      findings: {},
    });
    await expect(checkGateCompletion(dir, 'build_review')).resolves.toMatchObject({ done: true });
  });

  it('uses the effective reducer for a current strict aggregate and rejects a malformed envelope', async () => {
    const lapId = parseBuildReviewLapId('lap-current')!;
    const judged = (rubric: 'tautology' | 'scope' | 'rootCause' | 'completeness') => ({
      kind: 'judged' as const, rubric, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as never,
      findings: [], verdict: 'PASS' as const,
    });
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot', codeStamp: 'head',
      results: { tautology: judged('tautology'), scope: judged('scope'), rootCause: judged('rootCause'), completeness: judged('completeness') },
    });

    expect(validateBuildReviewVerdict(aggregate)).toMatchObject({ ok: true, verdict: 'PASS', codeStamp: 'head' });
    await expect(checkGateCompletion(await writeVerdict(aggregate), 'build_review', {
      buildReviewEffectiveResolver: async () => ({
        ok: true as const,
        feature: { version: 'v1' as const, repository: '/repo', feature: 'feature' },
        effective: {
          rawVerdict: 'PASS' as const, verdict: 'PASS' as const,
          acceptedFindingIds: [], unresolvedFindingIds: [], skippedRubrics: [], infrastructureFailureRubrics: [],
        },
      }),
    })).resolves.toMatchObject({ done: true });
    expect(validateBuildReviewVerdict({ ...aggregate, results: { ...aggregate.results, completeness: undefined } })).toEqual({
      ok: false, reason: expect.stringMatching(/aggregate.*incomplete/i),
    });
  });

  it('completes a fresh raw failure when its one finding is exactly accepted', async () => {
    const lapId = parseBuildReviewLapId('lap-accepted')!;
    const finding = { concernKind: 'out-of-plan-change', summary: 'Actionable finding summary', evidenceLocations: ['src/a.ts:1'], anchor: { rubric: 'scope' as const, path: 'src/a.ts', relation: 'not-authorized-by-plan' } };
    const judged = (rubric: 'tautology' | 'scope' | 'rootCause' | 'completeness', findings = rubric === 'scope' ? [finding] : []) => ({
      kind: 'judged' as const, rubric, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as never,
      findings, verdict: findings.length ? 'FAIL' as const : 'PASS' as const,
    });
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot', codeStamp: 'head',
      results: { tautology: judged('tautology'), scope: judged('scope'), rootCause: judged('rootCause'), completeness: judged('completeness') },
    });
    const id = 'sha256:accepted-exact-payload';

    const dir = await writeVerdict(aggregate);
    const resolver = vi.fn(async () => ({
        ok: true as const,
        feature: { version: 'v1' as const, repository: '/repo', feature: 'feature' },
        effective: {
          rawVerdict: 'FAIL' as const, verdict: 'PASS' as const,
          acceptedFindingIds: [id], unresolvedFindingIds: [], skippedRubrics: [], infrastructureFailureRubrics: [],
        },
      }));
    await expect(checkGateCompletion(dir, 'build_review', {
      buildReviewEffectiveResolver: resolver,
    })).resolves.toMatchObject({ done: true });
    expect(resolver).toHaveBeenCalledWith(dir, aggregate);
  });

  it('routes unresolved siblings and infrastructure failures by their effective cause', async () => {
    const lapId = parseBuildReviewLapId('lap-blocked')!;
    const judged = (rubric: 'tautology' | 'scope' | 'rootCause' | 'completeness') => ({
      kind: 'judged' as const, rubric, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as never,
      findings: [], verdict: 'PASS' as const,
    });
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot',
      results: { tautology: judged('tautology'), scope: judged('scope'), rootCause: judged('rootCause'), completeness: judged('completeness') },
    });
    const dir = await writeVerdict(aggregate);

    await expect(checkGateCompletion(dir, 'build_review', {
      buildReviewEffectiveResolver: async () => ({
        ok: true as const,
        feature: { version: 'v1' as const, repository: '/repo', feature: 'feature' },
        effective: {
          rawVerdict: 'FAIL' as const, verdict: 'FAIL' as const,
          acceptedFindingIds: ['sha256:accepted'], unresolvedFindingIds: ['sha256:unresolved-sibling'],
          skippedRubrics: [], infrastructureFailureRubrics: [],
        },
      }),
    })).resolves.toMatchObject({ done: false, routeClass: 'named-route', reason: expect.stringMatching(/unresolved.*unresolved-sibling/i) });

    await expect(checkGateCompletion(dir, 'build_review', {
      buildReviewEffectiveResolver: async () => ({
        ok: true as const,
        feature: { version: 'v1' as const, repository: '/repo', feature: 'feature' },
        effective: {
          rawVerdict: 'FAIL' as const, verdict: 'FAIL' as const,
          acceptedFindingIds: [], unresolvedFindingIds: [],
          skippedRubrics: [], infrastructureFailureRubrics: ['scope'],
        },
      }),
    })).resolves.toMatchObject({ done: false, routeClass: 'named-route', reason: expect.stringMatching(/infrastructure.*scope/i) });
  });

  it('never consults dispositions for stale or scalar legacy evidence', async () => {
    const lapId = parseBuildReviewLapId('lap-stale')!;
    const judged = (rubric: 'tautology' | 'scope' | 'rootCause' | 'completeness') => ({
      kind: 'judged' as const, rubric, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as never,
      findings: [], verdict: 'PASS' as const,
    });
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot',
      results: { tautology: judged('tautology'), scope: judged('scope'), rootCause: judged('rootCause'), completeness: judged('completeness') },
    });
    const staleDir = await writeVerdict(aggregate);
    const stalePath = join(staleDir, BUILD_REVIEW_VERDICT);
    await utimes(stalePath, new Date(0), new Date(0));
    const resolver = vi.fn(async () => {
      throw new Error('stale evidence must not read state');
    });

    await expect(checkGateCompletion(staleDir, 'build_review', {
      sessionStartedAt: Date.now(), buildReviewEffectiveResolver: resolver,
    })).resolves.toMatchObject({ done: false, reason: expect.stringMatching(/not rewritten/i) });
    expect(resolver).not.toHaveBeenCalled();

    const legacyDir = await writeVerdict({
      verdict: 'FAIL', rubric: { tautology: true, scope: false, rootCause: false, completeness: false },
      reasons: ['legacy finding'],
    });
    await expect(checkGateCompletion(legacyDir, 'build_review', {
      buildReviewEffectiveResolver: resolver,
    })).resolves.toMatchObject({ done: false, reason: expect.stringMatching(/legacy finding/i) });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('rejects PASS for failed rubric flags before requiring findings', () => {
    expect(validateBuildReviewVerdict({
      verdict: 'PASS',
      reasons: [],
      rubric: { tautology: true, scope: true, rootCause: true, completeness: true },
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

  it('validates a scope failure with findings but leaves the gate unsatisfied', async () => {
    const verdict = {
      verdict: 'FAIL',
      rubric: { tautology: false, scope: true, rootCause: false, completeness: false },
      findings: { scope: ['The changed path is outside the approved plan.'] },
    };
    const dir = await writeVerdict(verdict);

    expect(validateBuildReviewVerdict(verdict)).toEqual({ ok: true, ...verdict });
    await expect(checkGateCompletion(dir, 'build_review')).resolves.toMatchObject({
      done: false,
      reason: expect.stringContaining('[scope] The changed path is outside the approved plan.'),
    });
  });

  it('leaves a mechanical lap verdict absent while its separate allowance remains', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'build-review-mechanical-lap-'));
    dirs.push(dir);
    await writeKickbackLedger(dir, {
      version: 1,
      gates: {
        build_review: {
          count: 0, cumulative: 0, mechanicalFaults: 0, treeHash: null,
          lastReason: '', priorVerdict: true, resolvedBefore: 0,
        },
      },
    });
    vi.mocked(coordinateBuildReviewRubrics).mockResolvedValue({
      kind: 'ready',
      branches: [
        { kind: 'infrastructure-failure', rubric: 'scope', reason: 'invalid-provider-result', detail: 'worker response unavailable' },
        ...(['tautology', 'rootCause', 'completeness'] as const).map((rubric) => ({ kind: 'dispatched' as const, rubric, result: {} as never })),
      ],
    });
    const provider: LLMProvider = { invoke: vi.fn(), invokeInteractive: vi.fn() };
    const runner = new DefaultStepRunner(provider, 'mechanical-lap', dir, {
      pipelineDir: join(dir, '.pipeline'),
      buildReviewArtifactReader: async (_root, rubric, lapId, snapshotDigest) => ({
        version: 1, rubric, lapId, snapshotDigest,
        result: { kind: 'judged', rubric, lapId, snapshotDigest, contractVersion: 'v3' as never, findings: [], verdict: 'PASS' },
        provenance: { kind: 'fresh' },
      }),
    });
    const inputs = {
      sourceSnapshot: { headSha: 'mechanical-lap', digest: 'sha256:mechanical-lap', mergeBase: 'base' },
    } as BuildReviewFrozenInputs;

    const result = await (runner as unknown as {
      runRubricBuildReview: (inputs: BuildReviewFrozenInputs, config: ReturnType<typeof resolveBuildReviewConfig>) => Promise<{ success: boolean }>;
    }).runRubricBuildReview(inputs, resolveBuildReviewConfig({ build_review: { enabled: true } } as HarnessConfig));

    expect(result.success).toBe(false);
    await expect(readFile(join(dir, BUILD_REVIEW_VERDICT), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readKickbackLedger(dir)).gates.build_review.mechanicalFaults).toBe(1);
  });
});
