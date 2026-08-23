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
import {
  MAX_MECHANICAL_FAULTS_BUILD_REVIEW,
  readKickbackLedger,
  writeKickbackLedger,
} from '../../src/engine/kickback-ledger.js';
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
        testQuality: false,
      },
    });
  });

  it('derives a named test-quality failure and preserves its structured finding', () => {
    expect(canonicalizeBuildReviewGraderVerdict({
      reasons: ['The changed test does not observe the behavior it claims to cover.'],
      failedRubrics: ['testQuality'],
      findings: { testQuality: ['The changed test does not observe the behavior it claims to cover.'] },
    })).toEqual({
      ok: true,
      verdict: 'FAIL',
      reasons: ['The changed test does not observe the behavior it claims to cover.'],
      findings: { testQuality: ['The changed test does not observe the behavior it claims to cover.'] },
      rubric: {
        testQuality: true,
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
      findings: { testQuality: ['The changed test is insensitive to the behavior it claims to cover.'] },
    })).toEqual({
      ok: false,
      reason: expect.stringMatching(/findings\.testQuality.*not named.*failedRubrics/i),
    });
  });

  it.each([undefined, []])('rejects a named failed rubric when its findings are %j', (testQuality) => {
    expect(canonicalizeBuildReviewGraderVerdict({
      reasons: ['Test quality failed.'],
      failedRubrics: ['testQuality'],
      findings: testQuality === undefined ? {} : { testQuality },
    })).toEqual({
      ok: false,
      reason: expect.stringMatching(/findings\.testQuality.*non-empty.*failedRubrics/i),
    });
  });

  it('rejects unknown finding keys instead of dropping their evidence', () => {
    expect(canonicalizeBuildReviewGraderVerdict({
      reasons: [],
      failedRubrics: [],
      findings: { unknownRubric: ['The result must not carry an unregistered finding.'] },
    })).toEqual({
      ok: false,
      reason: expect.stringMatching(/findings.*unknown rubric.*unknownRubric/i),
    });
  });

  it('fails closed when rubric.testQuality is not a boolean', () => {
    expect(validateBuildReviewVerdict({
      verdict: 'PASS',
      rubric: { testQuality: 'false' },
    })).toEqual({
      ok: false,
      reason: expect.stringMatching(/rubric\.testQuality.*boolean/i),
    });
  });

  it('validates and satisfies a PASS verdict that judges the registered rubric', async () => {
    const verdict = {
      verdict: 'PASS',
      rubric: { testQuality: false },
      findings: {},
    };
    const dir = await writeVerdict(verdict);

    const validated = validateBuildReviewVerdict(verdict);
    expect(validated).toEqual({ ok: true, ...verdict });
    expect(validated).toMatchObject({
      rubric: { testQuality: false },
      findings: {},
    });
    await expect(checkGateCompletion(dir, 'build_review')).resolves.toMatchObject({ done: true });
  });

  it('uses the effective reducer for a current strict aggregate and rejects a malformed envelope', async () => {
    const lapId = parseBuildReviewLapId('lap-current')!;
    const judged = () => ({
      kind: 'judged' as const, rubric: 'testQuality' as const, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as const,
      findings: [], verdict: 'PASS' as const,
    });
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot', codeStamp: 'head',
      results: { testQuality: judged() },
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
    expect(validateBuildReviewVerdict({ ...aggregate, results: {} })).toEqual({
      ok: false, reason: expect.stringMatching(/aggregate.*incomplete/i),
    });
  });

  it('completes a fresh raw failure when its one finding is exactly accepted', async () => {
    const lapId = parseBuildReviewLapId('lap-accepted')!;
    const finding = { concernKind: 'test-insensitive' as const, summary: 'Actionable finding summary', evidenceLocations: ['test/a.test.ts:1'], anchor: { rubric: 'testQuality' as const, locus: { path: 'test/a.test.ts', contentHash: 'sha256:fixture', display: 'fixture test' } } };
    const judged = () => ({
      kind: 'judged' as const, rubric: 'testQuality' as const, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as const,
      findings: [finding], verdict: 'FAIL' as const,
    });
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot', codeStamp: 'head',
      results: { testQuality: judged() },
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
    const judged = () => ({
      kind: 'judged' as const, rubric: 'testQuality' as const, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as const,
      findings: [], verdict: 'PASS' as const,
    });
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot',
      results: { testQuality: judged() },
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
          skippedRubrics: [], infrastructureFailureRubrics: ['testQuality'],
        },
      }),
    })).resolves.toMatchObject({ done: false, routeClass: 'named-route', reason: expect.stringMatching(/infrastructure.*testQuality/i) });
  });

  it('never consults dispositions for stale or scalar legacy evidence', async () => {
    const lapId = parseBuildReviewLapId('lap-stale')!;
    const judged = () => ({
      kind: 'judged' as const, rubric: 'testQuality' as const, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as const,
      findings: [], verdict: 'PASS' as const,
    });
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot',
      results: { testQuality: judged() },
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
      verdict: 'FAIL', rubric: { testQuality: true },
      reasons: ['legacy finding'],
    });
    await expect(checkGateCompletion(legacyDir, 'build_review', {
      buildReviewEffectiveResolver: resolver,
    })).resolves.toMatchObject({ done: false, reason: expect.stringMatching(/legacy finding/i) });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('rejects PASS for a failed rubric flag before requiring findings', () => {
    expect(validateBuildReviewVerdict({
      verdict: 'PASS',
      reasons: [],
      rubric: { testQuality: true },
    })).toEqual({
      ok: false,
      reason: expect.stringMatching(/PASS requires every rubric flag/i),
    });
  });

  it.each(['testQuality'] as const)(
    'rejects PASS when rubric.%s reports a failure',
    (failedRubric) => {
      const rubric = { testQuality: false };
      rubric[failedRubric] = true;
      expect(validateBuildReviewVerdict({ verdict: 'PASS', rubric })).toEqual({
        ok: false,
        reason: expect.stringMatching(new RegExp(`PASS requires every rubric flag.*${failedRubric}`, 'i')),
      });
    },
  );

  it('rejects FAIL when the registered rubric passes', () => {
    expect(validateBuildReviewVerdict({
      verdict: 'FAIL',
      rubric: { testQuality: false },
    })).toEqual({
      ok: false,
      reason: expect.stringMatching(/FAIL requires at least one rubric flag/i),
    });
  });

  it('validates a test-quality failure with findings but leaves the gate unsatisfied', async () => {
    const verdict = {
      verdict: 'FAIL',
      rubric: { testQuality: true },
      findings: { testQuality: ['The changed test does not observe the behavior it claims to cover.'] },
    };
    const dir = await writeVerdict(verdict);

    expect(validateBuildReviewVerdict(verdict)).toEqual({ ok: true, ...verdict });
    await expect(checkGateCompletion(dir, 'build_review')).resolves.toMatchObject({
      done: false,
      reason: expect.stringContaining('[testQuality] The changed test does not observe the behavior it claims to cover.'),
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
        { kind: 'infrastructure-failure', rubric: 'testQuality', reason: 'invalid-provider-result', detail: 'worker response unavailable' },
      ],
    });
    const provider: LLMProvider = { invoke: vi.fn(), invokeInteractive: vi.fn() };
    const runner = new DefaultStepRunner(provider, 'mechanical-lap', dir, {
      pipelineDir: join(dir, '.pipeline'),
      buildReviewArtifactReader: async (_root, rubric, lapId, snapshotDigest) => ({
        version: 1, rubric, lapId, snapshotDigest,
        result: { kind: 'judged', rubric, lapId, snapshotDigest, contractVersion: 'v3', findings: [], verdict: 'PASS' },
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

  it('does not consume the mechanical allowance when a judged lap publishes a finding', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'build-review-mixed-lap-'));
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
        { kind: 'dispatched', rubric: 'testQuality', result: { kind: 'judged', rubric: 'testQuality', lapId: parseBuildReviewLapId('mixed-lap')!, snapshotDigest: 'sha256:mixed-lap', contractVersion: 'v3', findings: [], verdict: 'PASS' } },
      ],
    });
    const provider: LLMProvider = { invoke: vi.fn(), invokeInteractive: vi.fn() };
    const runner = new DefaultStepRunner(provider, 'mixed-lap', dir, {
      pipelineDir: join(dir, '.pipeline'),
      buildReviewEffectiveResolver: async () => ({
        ok: true as const,
        feature: { version: 'v1' as const, repository: dir, feature: 'mixed-lap' },
        effective: {
          rawVerdict: 'FAIL' as const, verdict: 'FAIL' as const,
          acceptedFindingIds: [], unresolvedFindingIds: ['sha256:unresolved'],
          skippedRubrics: [], infrastructureFailureRubrics: [],
        },
      }),
      buildReviewArtifactReader: async (_root, rubric, lapId, snapshotDigest) => ({
        version: 1,
        rubric,
        lapId,
        snapshotDigest,
        result: {
          kind: 'judged' as const, rubric, lapId, snapshotDigest, contractVersion: 'v3' as const,
          findings: [{
            concernKind: 'test-insensitive' as const, summary: 'The changed test remains insensitive.', evidenceLocations: ['test/engine.test.ts:1'],
            anchor: { rubric: 'testQuality' as const, locus: { path: 'test/engine.test.ts', contentHash: 'sha256:fixture', display: 'fixture test' } },
          }], verdict: 'FAIL' as const,
        },
        provenance: { kind: 'fresh' as const },
      }),
    });
    const inputs = {
      sourceSnapshot: { headSha: 'mixed-lap', digest: 'sha256:mixed-lap', mergeBase: 'base' },
    } as BuildReviewFrozenInputs;

    const result = await (runner as unknown as {
      runRubricBuildReview: (inputs: BuildReviewFrozenInputs, config: ReturnType<typeof resolveBuildReviewConfig>) => Promise<{ success: boolean; currentLapMechanicalFault?: boolean }>;
    }).runRubricBuildReview(inputs, resolveBuildReviewConfig({ build_review: { enabled: true } } as HarnessConfig));

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(result.currentLapMechanicalFault).toBeUndefined();
    expect((await readKickbackLedger(dir)).gates.build_review.mechanicalFaults).toBe(0);
    await expect(readFile(join(dir, BUILD_REVIEW_VERDICT), 'utf8')).resolves.toContain('The changed test remains insensitive.');
  });

  it('clears a prior-lap aggregate instead of using it as a mechanical lap rework hint', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'build-review-mechanical-stale-aggregate-'));
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
    const previousLap = parseBuildReviewLapId('lap-previous')!;
    const previousAggregate = joinBuildReviewRubricOutcomes({
      lapId: previousLap,
      snapshotDigest: 'sha256:previous',
      results: {
        testQuality: { kind: 'judged', rubric: 'testQuality', lapId: previousLap, snapshotDigest: 'sha256:previous', contractVersion: 'v3', findings: [{ concernKind: 'test-insensitive', summary: 'Prior-lap finding', evidenceLocations: ['test/old.test.ts:1'], anchor: { rubric: 'testQuality', locus: { path: 'test/old.test.ts', contentHash: 'sha256:fixture', display: 'fixture test' } } }], verdict: 'FAIL' },
      },
    });
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, BUILD_REVIEW_VERDICT), JSON.stringify(previousAggregate));
    vi.mocked(coordinateBuildReviewRubrics).mockResolvedValue({
      kind: 'ready',
      branches: [
        { kind: 'infrastructure-failure', rubric: 'testQuality', reason: 'invalid-provider-result', detail: 'worker response unavailable' },
      ],
    });
    const provider: LLMProvider = { invoke: vi.fn(), invokeInteractive: vi.fn() };
    const runner = new DefaultStepRunner(provider, 'mechanical-stale-aggregate', dir, {
      pipelineDir: join(dir, '.pipeline'),
      buildReviewArtifactReader: async (_root, rubric, lapId, snapshotDigest) => ({
        version: 1, rubric, lapId, snapshotDigest,
        result: { kind: 'judged', rubric, lapId, snapshotDigest, contractVersion: 'v3', findings: [], verdict: 'PASS' },
        provenance: { kind: 'fresh' },
      }),
    });
    const inputs = {
      sourceSnapshot: { headSha: 'mechanical-stale-aggregate', digest: 'sha256:mechanical-stale-aggregate', mergeBase: 'base' },
    } as BuildReviewFrozenInputs;

    const result = await (runner as unknown as {
      runRubricBuildReview: (inputs: BuildReviewFrozenInputs, config: ReturnType<typeof resolveBuildReviewConfig>) => Promise<{ success: boolean; output: string }>;
    }).runRubricBuildReview(inputs, resolveBuildReviewConfig({ build_review: { enabled: true } } as HarnessConfig));

    expect({
      result,
      staleAggregate: await readFile(join(dir, BUILD_REVIEW_VERDICT), 'utf8').catch(() => null),
    }).toEqual({
      result: {
        success: false,
        output: 'build_review mechanical fault in testQuality (malformed-artifact): invalid-provider-result: worker response unavailable',
        currentLapMechanicalFault: true,
      },
      staleAggregate: null,
    });
  });

  it.each(['artifact-write-failed', 'cache-write-failed'] as const)(
    'consumes the mechanical allowance when the coordinator reports %s',
    async (reason) => {
      const dir = await mkdtemp(join(tmpdir(), `build-review-${reason}-`));
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
          { kind: 'infrastructure-failure', rubric: 'testQuality', reason, detail: 'disk became unavailable' },
        ],
      });
      const provider: LLMProvider = { invoke: vi.fn(), invokeInteractive: vi.fn() };
      const runner = new DefaultStepRunner(provider, 'mechanical-write-failure', dir, {
        pipelineDir: join(dir, '.pipeline'),
      });
      const inputs = {
        sourceSnapshot: { headSha: 'mechanical-write-failure', digest: 'sha256:mechanical-write-failure', mergeBase: 'base' },
      } as BuildReviewFrozenInputs;

      const result = await (runner as unknown as {
        runRubricBuildReview: (inputs: BuildReviewFrozenInputs, config: ReturnType<typeof resolveBuildReviewConfig>) => Promise<{ success: boolean; output: string }>;
      }).runRubricBuildReview(inputs, resolveBuildReviewConfig({ build_review: { enabled: true } } as HarnessConfig));

      expect(result).toMatchObject({ success: false, output: expect.stringContaining(reason) });
      expect((await readKickbackLedger(dir)).gates.build_review.mechanicalFaults).toBe(1);
      await expect(readFile(join(dir, BUILD_REVIEW_VERDICT), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it.each(['artifact-write-failed', 'cache-write-failed'] as const)(
    'publishes the terminal aggregate after %s exhausts the mechanical allowance',
    async (reason) => {
      const dir = await mkdtemp(join(tmpdir(), `build-review-exhausted-${reason}-`));
      dirs.push(dir);
      await writeKickbackLedger(dir, {
        version: 1,
        gates: {
          build_review: {
            count: 0, cumulative: 0, mechanicalFaults: MAX_MECHANICAL_FAULTS_BUILD_REVIEW - 1, treeHash: null,
            lastReason: '', priorVerdict: true, resolvedBefore: 0,
          },
        },
      });
      vi.mocked(coordinateBuildReviewRubrics).mockResolvedValue({
        kind: 'ready',
        branches: [
          { kind: 'infrastructure-failure', rubric: 'testQuality', reason, detail: 'disk became unavailable' },
        ],
      });
      const provider: LLMProvider = { invoke: vi.fn(), invokeInteractive: vi.fn() };
      const runner = new DefaultStepRunner(provider, 'mechanical-write-failure', dir, {
        pipelineDir: join(dir, '.pipeline'),
      });
      const inputs = {
        sourceSnapshot: { headSha: 'mechanical-write-failure', digest: 'sha256:mechanical-write-failure', mergeBase: 'base' },
      } as BuildReviewFrozenInputs;

      await (runner as unknown as {
        runRubricBuildReview: (inputs: BuildReviewFrozenInputs, config: ReturnType<typeof resolveBuildReviewConfig>) => Promise<{ success: boolean; output: string }>;
      }).runRubricBuildReview(inputs, resolveBuildReviewConfig({ build_review: { enabled: true } } as HarnessConfig));

      expect((await readKickbackLedger(dir)).gates.build_review.mechanicalFaults).toBe(MAX_MECHANICAL_FAULTS_BUILD_REVIEW);
      expect(JSON.parse(await readFile(join(dir, BUILD_REVIEW_VERDICT), 'utf8'))).toMatchObject({
        results: { testQuality: { kind: 'infrastructure-failure', reason: 'artifact-write-failed' } },
      });
    },
  );
});
