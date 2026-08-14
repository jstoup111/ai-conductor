import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

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

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'step-runners-copy-equivalence-'));
    planPath = join(projectDir, '.docs', 'plans', 'feature.md');
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await mkdir(join(projectDir, '.docs', 'plans'), { recursive: true });
    runCopyEquivalence.mockReset();
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  function runner(invoke?: LLMProvider['invoke']) {
    const defaultInvoke: LLMProvider['invoke'] = async () => {
      await mkdir(join(projectDir, '.pipeline'), { recursive: true });
      await writeFile(
        join(projectDir, '.pipeline', 'build-review.json'),
        JSON.stringify({
          verdict: 'PASS',
          rubric: {
            tautology: false,
            scope: false,
            rootCause: false,
            completeness: false,
            },
        }),
      );
      return { success: true, output: '{"verdict":"PASS"}', exitCode: 0 };
    };
    const providerInvoke = invoke ?? vi.fn(defaultInvoke);
    const provider: LLMProvider = {
      invoke: providerInvoke,
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const gitRunner = async (args: string[]) => {
      if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
      if (args[0] === 'merge-base') return { exitCode: 0, stdout: 'abc123\n', stderr: '' };
      if (args[0] === 'diff') return { exitCode: 0, stdout: 'diff --git a/x b/x\n', stderr: '' };
      return { exitCode: 1, stdout: '', stderr: '' };
    };
    return { invoke: providerInvoke, runner: new DefaultStepRunner(provider, 'session', projectDir, { planPath, gitRunner }) };
  }

  it('fails build_review when a resolved declaration does not match its derived target', async () => {
    await writeFile(planPath, [
      '**Pattern-source:** src/source-widget.ts',
      '**Rename-map:** source-widget -> target-widget',
    ].join('\n'));
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
    await writeFile(planPath, '# Plan\n\nNo declared replication.\n');
    const { invoke, runner: subject } = runner();

    const result = await subject.run('build_review', {});

    expect(result.success).toBe(true);
    expect(runCopyEquivalence).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('rejects a legacy incomplete grader rubric before accepting the complete four-key verdict', async () => {
    await writeFile(planPath, '# Plan\n\nNo declared replication.\n');
    let rubric: Record<string, boolean> = {
      tautology: false,
      scope: false,
      rootCause: false,
    };
    const invoke = vi.fn(async () => {
      await mkdir(join(projectDir, '.pipeline'), { recursive: true });
      await writeFile(
        join(projectDir, '.pipeline', 'build-review.json'),
        JSON.stringify({ verdict: 'PASS', rubric }),
      );
      return { success: true, output: '{"verdict":"PASS"}', exitCode: 0 };
    });
    const { runner: subject } = runner(invoke);

    await expect(subject.run('build_review', {})).resolves.toMatchObject({
      success: false,
      output: expect.stringMatching(/rubric\.completeness/i),
    });

    rubric = { ...rubric, completeness: false };
    await expect(subject.run('build_review', {})).resolves.toMatchObject({
      success: true,
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(runCopyEquivalence).not.toHaveBeenCalled();
  });

  it('fails before equivalence or grading when the declaration is malformed', async () => {
    await writeFile(planPath, '**Pattern-source:** src/source-widget.ts\n');
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
