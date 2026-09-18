// Covers: task:9, task:10
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { classifyRetryDecision } from '../../src/engine/artifacts.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import { coordinateBuildReviewRubrics } from '../../src/engine/build-review-coordinator.js';

vi.mock('../../src/engine/build-review-coordinator.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-coordinator.js')>(),
  coordinateBuildReviewRubrics: vi.fn(),
}));

const state = {};
const plan = '# Plan\n\n### Task 1: Cover the thing\n**Files:** src/covered.ts\n';

describe('build_review oversized projection step', () => {
  let projectRoot: string;
  let planPath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'build-review-oversize-'));
    planPath = join(projectRoot, 'plan.md');
    await writeFile(planPath, plan, 'utf8');
    await mkdir(join(projectRoot, 'src'), { recursive: true });
    await mkdir(join(projectRoot, 'test'), { recursive: true });
    await writeFile(join(projectRoot, 'src/covered.ts'), 'export const covered = true;\n', 'utf8');
    await writeFile(join(projectRoot, 'test/covered.test.ts'), "// Covers: task:1\nit('covered', () => {});\n", 'utf8');
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('publishes an oversized lap once without consuming a mechanical fault and halts for a human', async () => {
    const runner = createRunner('projection-oversized: measured=1346093 bytes limit=1048576 bytes');
    const mechanicalFaultsBefore = (await readKickbackLedger(projectRoot)).gates.build_review?.mechanicalFaults ?? 0;
    const result = await runner.run('build_review', state);

    expect(result).toMatchObject({
      success: false,
      refusal: { kind: 'needs-human' },
    });
    expect(result.refusal?.reason).toContain('testQuality');
    expect(result.refusal?.reason).toContain('1346093');
    expect(result.refusal?.reason).toContain('1048576');
    const aggregate = JSON.parse(await readFile(join(projectRoot, '.pipeline', 'build-review.json'), 'utf8'));
    expect(aggregate.coverage.testQuality).toBe('infrastructure-failure');
    expect(aggregate.results.testQuality.reason).toBe('projection-oversized');
    expect(aggregate.reducedCoverageEvidence).toBe('reduced coverage recorded');
    const ledger = await readKickbackLedger(projectRoot);
    expect(ledger.gates.build_review?.mechanicalFaults ?? 0).toBe(mechanicalFaultsBefore);
  });

  it('halts with the reason alone when oversized detail has no measured bytes', async () => {
    const runner = createRunner('projection-oversized');
    const result = await runner.run('build_review', state);

    expect(result).toMatchObject({ success: false, refusal: { kind: 'needs-human' } });
    expect(result.refusal?.reason).toContain('projection-oversized');
    expect(result.refusal?.reason).not.toMatch(/measured=|limit=/);
  });

  it('keeps transient provider errors on the mechanical retry lane', async () => {
    const runner = createRunner('provider-error: grader transport disconnected', 'provider-error');

    const result = await runner.run('build_review', state);

    expect(result).toMatchObject({ success: false, currentLapMechanicalFault: true });
    const ledger = await readKickbackLedger(projectRoot);
    expect(ledger.gates.build_review?.mechanicalFaults).toBe(1);
  });

  it('routes an oversized refusal before a second build-review dispatch', async () => {
    const runner = createRunner('projection-oversized: measured=1346093 bytes limit=1048576 bytes');
    const dispatchesBefore = vi.mocked(coordinateBuildReviewRubrics).mock.calls.length;
    const result = await runner.run('build_review', state);

    expect(classifyRetryDecision({
      step: 'build_review',
      completion: { done: false },
      attempt: 1,
      inputsUnchanged: false,
      terminalRefusal: result.refusal?.kind,
    })).toEqual({ decision: 'route', signal: 'terminal-refusal' });
    expect(coordinateBuildReviewRubrics).toHaveBeenCalledTimes(dispatchesBefore + 1);
  });

  it('preserves a sibling judged finding while an oversized projection halts for a human', async () => {
    const runner = createRunner('projection-oversized: measured=1346093 bytes limit=1048576 bytes', 'projection-oversized', true);

    const result = await runner.run('build_review', state);

    expect(result).toMatchObject({ success: false, refusal: { kind: 'needs-human' } });
    expect(result.currentLapMechanicalFault).toBeUndefined();
    const aggregate = JSON.parse(await readFile(join(projectRoot, '.pipeline', 'build-review.json'), 'utf8'));
    expect(aggregate.results.security.findings).toEqual([
      expect.objectContaining({ summary: 'Credential committed to source.' }),
    ]);
    expect((await readKickbackLedger(projectRoot)).gates.build_review?.mechanicalFaults ?? 0).toBe(0);
  });

  function createRunner(
    detail: string,
    reason: 'projection-oversized' | 'provider-error' = 'projection-oversized',
    withSecurityFinding = false,
  ): DefaultStepRunner {
    vi.mocked(coordinateBuildReviewRubrics).mockResolvedValue({
      kind: 'ready',
      branches: [
        { kind: 'infrastructure-failure', rubric: 'testQuality', reason, detail },
        ...(withSecurityFinding ? [{ kind: 'dispatched', rubric: 'security' }] : []),
      ],
    } as never);
    const provider: LLMProvider = { invoke: vi.fn() };
    const runner = new DefaultStepRunner(provider, 'run-1', projectRoot, {
      planPath,
      gitRunner: git(),
      config: {
        test_suite: { scoped_command: 'true' },
        build_review: {
          enabled: true,
          rubrics: { testQuality: { enabled: true, max_projection_bytes: 1 } },
        },
      } as HarnessConfig,
      buildReviewInputOptions: {
        inspectTestSuite: async () => ({
          status: 'CURRENT', evidence: { provenanceHeadSha: 'head', outcome: 'PASS' },
        } as never),
      },
      buildReviewEffectiveResolver: vi.fn(async () => ({
        ok: true as const,
        feature: { version: 'v1' as const, repository: '/repo', feature: 'feature' },
        effective: {
          rawVerdict: 'FAIL' as const, verdict: 'FAIL' as const, acceptedFindingIds: [], unresolvedFindingIds: [],
          suppressedFindingIds: [], skippedRubrics: [], infrastructureFailureRubrics: ['testQuality'] as const,
          uncoveredInfrastructureFailureRubrics: ['testQuality'] as const,
        },
        reducedCoverageEvidence: 'reduced coverage recorded',
      })),
      buildReviewArtifactReader: withSecurityFinding
        ? async (_root, rubric, lapId, snapshotDigest) => ({
            version: 1,
            rubric,
            lapId,
            snapshotDigest,
            result: {
              kind: 'judged' as const,
              rubric: 'security' as const,
              lapId,
              snapshotDigest,
              contractVersion: 'v3' as const,
              findings: [{
                concernKind: 'committed-secret' as const,
                summary: 'Credential committed to source.',
                evidenceLocations: ['src/covered.ts:1'],
                anchor: {
                  rubric: 'security' as const,
                  locus: {
                    path: 'src/covered.ts',
                    contentHash: `sha256:${'a'.repeat(64)}`,
                    display: 'credential assignment',
                  },
                },
              }],
              verdict: 'FAIL' as const,
            },
            provenance: { kind: 'fresh' as const },
          })
        : undefined,
    });
    vi.spyOn(runner as any, 'runTautologyPreflight').mockResolvedValue({
      classification: 'approved-exception', exception: 'empty-test-set', cacheable: true, cacheProvenance: 'miss',
      changedPaths: [], changedTestSelectors: [], revertedProductionManifest: [],
      sourceIdentities: { mergeBase: 'base', headSha: 'head' },
    } as never);
    vi.spyOn(runner as any, 'resolveBuildReviewEngineIdentity').mockResolvedValue({
      engineStamp: 'dev', skillDigests: { testQuality: { kind: 'resolved', digest: 'sha256:skill' } },
    });
    return runner;
  }

  function git() {
    return async (args: string[]) => {
      if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
      if (args[0] === 'rev-parse') return { exitCode: 0, stdout: args[1] === 'HEAD' ? 'head\n' : 'base\n', stderr: '' };
      if (args[0] === 'merge-base') return { exitCode: 0, stdout: 'base\n', stderr: '' };
      if (args[0] === 'diff' && args.includes('--name-status')) return { exitCode: 0, stdout: 'M\0src/covered.ts\0M\0test/covered.test.ts\0', stderr: '' };
      if (args[0] === 'diff') return { exitCode: 0, stdout: 'diff --git a/src/covered.ts b/src/covered.ts\ndiff --git a/test/covered.test.ts b/test/covered.test.ts\n', stderr: '' };
      if (args[0] === 'show') {
        if (args[1]?.endsWith('.md')) return { exitCode: 0, stdout: plan, stderr: '' };
        if (args[1]?.endsWith('test/covered.test.ts')) return { exitCode: 0, stdout: "// Covers: task:1\nit('covered', () => {});\n", stderr: '' };
        return { exitCode: 0, stdout: 'export const covered = true;\n', stderr: '' };
      }
      if (args[0] === 'ls-tree') return { exitCode: 0, stdout: '', stderr: '' };
      return { exitCode: 1, stdout: '', stderr: '' };
    };
  }
});
