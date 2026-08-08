import { execa } from 'execa';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { checkStepCompletion } from '../../src/engine/artifacts.js';
import { FullSuiteVerifier } from '../../src/engine/full-suite-verifier.js';
import {
  runScopedCommand,
  type ScopedRunRunner,
} from '../../src/engine/scoped-run.js';

describe('runScopedCommand', () => {
  it('substitutes a selector into the configured template and returns the runner exit status', async () => {
    const runner = vi.fn<ScopedRunRunner>(async () => 7);

    const exitCode = await runScopedCommand({
      template: 'npx vitest run {selectors}',
      selectors: ['test/engine/scoped-run.test.ts'],
      runner,
    });

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(
      expect.stringContaining('test/engine/scoped-run.test.ts'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(exitCode.exitCode).toBe(7);
  });

  it('substitutes every selector at a mid-template placeholder', async () => {
    const runner = vi.fn<ScopedRunRunner>(async () => 0);

    await runScopedCommand({
      template: 'npx vitest run {selectors} --reporter=dot',
      selectors: ['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts'],
      runner,
    });

    expect(runner).toHaveBeenCalledWith(
      'npx vitest run test/a.test.ts test/b.test.ts test/c.test.ts --reporter=dot',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('delivers a space-bearing selector as one shell argument without changing ordinary path characters', async () => {
    const runner = vi.fn<ScopedRunRunner>(async () => 0);
    const selector = 'test/with space-_./~:.test.ts';

    await runScopedCommand({
      template: 'npx vitest run {selectors}',
      selectors: [selector],
      runner,
    });

    expect(runner).toHaveBeenCalledWith(
      "npx vitest run 'test/with space-_./~:.test.ts'",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('passes shell metacharacters, quotes, and leading hyphens as literal selector arguments', async () => {
    let stdout = '';
    const runner = vi.fn<ScopedRunRunner>(async (command) => {
      const result = await execa(command, { shell: true, reject: false });
      stdout = result.stdout;
      return result.exitCode ?? 1;
    });

    const result = await runScopedCommand({
      template: "printf '<%s>' {selectors}",
      selectors: ['; echo INJECTED', "test/quote'file.test.ts", '-leading-selector'],
      runner,
    });

    expect({ result, stdout, runnerCallCount: runner.mock.calls.length }).toEqual({
      result: { exitCode: 0, reason: 'passed', message: 'Selected tests passed.' },
      stdout: "<; echo INJECTED><test/quote'file.test.ts><-leading-selector>",
      runnerCallCount: 1,
    });
  });

  it('refuses an empty selector list before substituting or running a command', async () => {
    const runner = vi.fn<ScopedRunRunner>(async () => 0);

    const result = await runScopedCommand({
      template: 'npx vitest run {selectors}',
      selectors: [],
      runner,
    });

    expect(result).toMatchObject({
      exitCode: 1,
      reason: 'empty_selection',
      message: expect.stringMatching(/requires at least one selector/i),
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it('reports scoped running as unavailable when test_suite.scoped_command is unconfigured without running an aggregate fallback', async () => {
    const runner = vi.fn<ScopedRunRunner>(async () => 0);

    const result = await runScopedCommand({
      template: undefined,
      selectors: ['test/selected.test.ts'],
      runner,
    });

    expect({ result, runnerCallCount: runner.mock.calls.length }).toEqual({
      result: {
        exitCode: 1,
        reason: 'unavailable',
        message: expect.stringMatching(/test_suite\.scoped_command/),
      },
      runnerCallCount: 0,
    });
  });

  it('refuses all-whitespace selectors as an aggregate selection without running a command', async () => {
    const runner = vi.fn<ScopedRunRunner>(async () => 0);

    const result = await runScopedCommand({
      template: 'npx vitest run {selectors}',
      selectors: ['', '  '],
      runner,
    });

    expect({ result, runnerCallCount: runner.mock.calls.length }).toEqual({
      result: {
        exitCode: 1,
        reason: 'empty_selection',
        message: expect.stringMatching(/empty selection is an aggregate run.*shared aggregate verifier/i),
      },
      runnerCallCount: 0,
    });
  });

  it('reports a selected-test failure without invoking the aggregate command', async () => {
    const runner = vi.fn<ScopedRunRunner>(async () => 7);

    const result = await runScopedCommand({
      template: 'npx vitest run {selectors}',
      selectors: ['test/failing.test.ts'],
      runner,
    });

    expect(result).toMatchObject({
      exitCode: 7,
      reason: 'test_failure',
      message: expect.stringMatching(/selected test.*failed/i),
    });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(
      'npx vitest run test/failing.test.ts',
      expect.anything(),
    );
  });

  it('reports an unlaunchable scoped command by name without invoking the aggregate command', async () => {
    const runner = vi.fn<ScopedRunRunner>(async () => {
      throw Object.assign(new Error('spawn npx ENOENT'), { code: 'ENOENT' });
    });

    const result = await runScopedCommand({
      template: 'npx vitest run {selectors}',
      selectors: ['test/selected.test.ts'],
      runner,
    });

    expect(result).toMatchObject({
      exitCode: 1,
      reason: 'launch_failure',
      message: expect.stringContaining('npx vitest run test/selected.test.ts'),
    });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(
      'npx vitest run test/selected.test.ts',
      expect.anything(),
    );
  });

  it('terminates and reports a timed-out scoped run without invoking the aggregate command', async () => {
    let terminated = false;
    const runner = vi.fn<ScopedRunRunner>((_command, { signal }) => new Promise<number>((resolve) => {
      signal.addEventListener('abort', () => {
        terminated = true;
        resolve(1);
      });
    }));

    const result = await runScopedCommand({
      template: 'npx vitest run {selectors}',
      selectors: ['test/slow.test.ts'],
      runner,
      timeoutMs: 1,
      scheduleTimeout: (callback) => {
        callback();
        return () => undefined;
      },
    });

    expect(terminated).toBe(true);
    expect(result).toMatchObject({
      exitCode: 1,
      reason: 'timeout',
      message: expect.stringMatching(/timed out/i),
    });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(
      'npx vitest run test/slow.test.ts',
      expect.anything(),
    );
  });

  it('leaves pre-existing aggregate evidence byte-identical after a successful scoped run', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'scoped-run-evidence-'));
    const evidencePath = join(projectRoot, '.pipeline', 'test-suite-evidence.json');
    const priorEvidence = '{"aggregate":"evidence"}\n';
    const runner = vi.fn<ScopedRunRunner>(async () => 0);

    try {
      await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
      await writeFile(evidencePath, priorEvidence, 'utf8');

      await runScopedCommand({
        template: 'npx vitest run {selectors}',
        selectors: ['test/selected.test.ts'],
        runner,
      });

      expect(await readFile(evidencePath, 'utf8')).toBe(priorEvidence);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('cannot satisfy the aggregate test_suite gate when its successful run has no aggregate evidence', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'scoped-run-gate-'));
    const runner = vi.fn<ScopedRunRunner>(async () => 0);

    try {
      await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
      await writeFile(
        join(projectRoot, '.ai-conductor', 'config.yml'),
        'test_suite:\n  command: npx vitest run\n',
        'utf8',
      );
      await runScopedCommand({
        template: 'npx vitest run {selectors}',
        selectors: ['test/selected.test.ts'],
        runner,
      });
      const inspection = await new FullSuiteVerifier({
        projectRoot,
        fingerprint: async () => ({
          ok: true,
          fingerprint: {
            digest: 'sha256:scoped-run-test',
            headSha: 'scoped-run-head',
            categoryFingerprints: {
              additional_inputs: 'additional-inputs',
              dependencies: 'dependencies',
              environment: 'environment',
              migrations: 'migrations',
              project_config: 'project-config',
              source: 'source',
              test_infrastructure: 'test-infrastructure',
              tests: 'tests',
            },
          },
        }),
      }).inspect();

      await expect(checkStepCompletion(projectRoot, 'test_suite', {
        fullSuiteInspect: async () => inspection,
      })).resolves.toMatchObject({
        done: false,
        reason: expect.stringMatching(/PASS evidence is stale: missing/i),
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
