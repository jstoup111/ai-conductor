import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { deriveEffectiveBuildReviewVerdict } from '../../src/engine/build-review-aggregate.js';

const { runCopyEquivalence } = vi.hoisted(() => ({
  runCopyEquivalence: vi.fn(),
}));

vi.mock('../../src/engine/copy-equivalence.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/copy-equivalence.js')>(),
  runCopyEquivalence,
}));

describe('build_review copy equivalence', () => {
  let projectDir: string;
  let planPath: string;
  let pinnedPlanBody: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'step-runners-copy-equivalence-'));
    planPath = join(projectDir, '.docs', 'plans', 'feature.md');
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await mkdir(join(projectDir, '.docs', 'plans'), { recursive: true });
    pinnedPlanBody = '';
    runCopyEquivalence.mockReset();
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  function runner(invoke?: LLMProvider['invoke']) {
    const defaultInvoke: LLMProvider['invoke'] = async (options) => {
      const projection = JSON.parse(options.prompt.split('\n\n').at(-1)!);
      return {
        success: true,
        output: JSON.stringify({
          kind: 'judged', rubric: projection.rubric, lapId: projection.lapId,
          snapshotDigest: projection.snapshotDigest, contractVersion: 'v3', findings: [],
        }),
        exitCode: 0,
      };
    };
    const providerInvoke = invoke ?? vi.fn(defaultInvoke);
    const provider: LLMProvider = {
      invoke: providerInvoke,
    };
    const gitRunner = async (args: string[]) => {
      if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { exitCode: 0, stdout: 'fixture-head\n', stderr: '' };
      if (args[0] === 'merge-base') return { exitCode: 0, stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'diff' && args.includes('--name-status')) {
        return { exitCode: 0, stdout: 'M\u0000src/foo.ts\u0000M\u0000test/foo.test.ts\u0000', stderr: '' };
      }
      if (args[0] === 'diff') return { exitCode: 0, stdout: [
        'diff --git a/src/foo.ts b/src/foo.ts',
        'diff --git a/test/foo.test.ts b/test/foo.test.ts',
      ].join('\n'), stderr: '' };
      if (args[0] === 'show' && args[1]?.endsWith(':.docs/plans/feature.md')) {
        return { exitCode: 0, stdout: pinnedPlanBody, stderr: '' };
      }
      if (args[0] === 'show' && args[1]?.endsWith(':test/foo.test.ts')) {
        return { exitCode: 0, stdout: args[1].startsWith('fixture-head:')
          ? '// Covers: task:1\nit(\'covered\', () => {});\n'
          : 'it(\'covered\', () => {});\n', stderr: '' };
      }
      if (args[0] === 'show' && args[1]?.endsWith(':src/foo.ts')) {
        return { exitCode: 0, stdout: args[1].startsWith('fixture-head:')
          ? 'export const foo = true;\n'
          : 'export const foo = false;\n', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    };
    return {
      invoke: providerInvoke,
      runner: new DefaultStepRunner(provider, 'session', projectDir, {
        planPath,
        gitRunner,
        // The active test-quality rubric is opt-in; these tests exercise the
        // one-shot judged branch after the replication preflight.
        config: { build_review: { rubrics: { testQuality: { enabled: true } } } } as HarnessConfig,
        buildReviewInputOptions: {
          inspectTestSuite: async () => ({
            status: 'CURRENT', evidence: { provenanceHeadSha: 'fixture-head', outcome: 'PASS' },
          } as never),
        },
        buildReviewEffectiveResolver: async (_root, aggregate) => {
          const effective = deriveEffectiveBuildReviewVerdict(aggregate);
          return effective
            ? { ok: true as const, feature: { version: 'v1' as const, repository: projectDir, feature: 'fixture' }, effective }
            : { ok: false as const, reason: 'fixture aggregate is invalid' };
        },
      }),
    };
  }

  it('fails build_review when a resolved declaration does not match its derived target', async () => {
    pinnedPlanBody = [
      '**Pattern-source:** src/source-widget.ts',
      '**Rename-map:** source-widget -> target-widget',
    ].join('\n');
    await writeFile(planPath, pinnedPlanBody);
    await writeFile(join(projectDir, 'src/source-widget.ts'), 'export const widget = "source";\n');
    await writeFile(join(projectDir, 'src/target-widget.ts'), 'export const widget = "target";\n');
    runCopyEquivalence.mockResolvedValue({
      success: false,
      output: 'Copy equivalence content mismatch for src/target-widget.ts at line 1, column 24.',
    });
    const { invoke, runner: subject } = runner();

    const result = await subject.run('build_review', {});

    expect(result).toMatchObject({
      success: false,
      output: 'Copy equivalence content mismatch for src/target-widget.ts at line 1, column 24.',
    });
    expect(runCopyEquivalence).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'resolved', sourcePath: 'src/source-widget.ts' }),
      'src/target-widget.ts',
      expect.any(Function),
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not invoke copy equivalence when the plan has no declaration', async () => {
    pinnedPlanBody = '# Plan\n\nNo declared replication.\n';
    await writeFile(planPath, pinnedPlanBody);
    const { invoke, runner: subject } = runner();

    const result = await subject.run('build_review', {});

    expect(result.success).toBe(true);
    expect(runCopyEquivalence).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('fails before equivalence or grading when the declaration is malformed', async () => {
    pinnedPlanBody = '**Pattern-source:** src/source-widget.ts\n';
    await writeFile(planPath, pinnedPlanBody);
    const { invoke, runner: subject } = runner();

    const result = await subject.run('build_review', {});

    expect(result).toMatchObject({
      success: false,
      output: 'Missing required **Rename-map:** line.',
    });
    expect(runCopyEquivalence).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
