import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  materializeTautologyPreflight,
  classifyTautologyPaths,
  deriveRemovalMaintenanceSelectors,
  boundedHeadTailExcerpt,
  scopedRunFailure,
  TAUTOLOGY_EXCERPT_CAP_BYTES,
  type TautologyScopedRunResult,
} from '../../src/engine/build-review-tautology-preflight.js';
import { toTautologyScopedRunResult } from '../../src/engine/step-runners.js';

describe('build-review Tautology preflight', () => {
  it.each([
    ['RSpec', '3 examples, 1 failure', ''],
    ['go test', '--- FAIL: TestCounterfactual', 'FAIL\texample.com/project\t0.002s'],
    ['Vitest', '', 'FAIL test/a.test.ts > counterfactual'],
    ['pytest', '=========================== short test summary info ============================', 'FAILED test_a.py::test_counterfactual'],
    ['unstructured runner', 'runner exited unsuccessfully', ''],
  ])('classifies a nonzero scoped %s exit without parsing its output', (_runner, stdout, stderr) => {
    expect(toTautologyScopedRunResult(1, null, stdout, stderr)).toEqual({
      kind: 'nonzero-exit', exitCode: 1, stdout, stderr,
    });
  });

  it('classifies a zero scoped exit as success', () => {
    expect(toTautologyScopedRunResult(0, null, 'passed', '')).toEqual({
      exitCode: 0, stdout: 'passed', stderr: '',
    });
  });

  it('maps only process-level scoped-run failures to infrastructure reasons', () => {
    expect(scopedRunFailure({ kind: 'launch-error', stdout: '', stderr: '' })).toBe('scoped-run-launch-failed');
    expect(scopedRunFailure({ kind: 'timeout', stdout: '', stderr: '' })).toBe('scoped-run-timeout');
    expect(scopedRunFailure({ kind: 'signal', signal: 'SIGTERM', stdout: '', stderr: '' })).toBe('scoped-run-signaled');
    expect(scopedRunFailure({ kind: 'nonzero-exit', exitCode: 1, stdout: 'RED', stderr: '' })).toBeUndefined();
  });

  it('accepts a nonzero process exit as counterfactual RED evidence', async () => {
    const nonzeroExit: TautologyScopedRunResult = { kind: 'nonzero-exit', exitCode: 1, stdout: 'RED', stderr: '' };
    expectTypeOf(nonzeroExit).toMatchTypeOf<TautologyScopedRunResult>();

    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout: async () => {}, readMergeBaseFile: async () => 'BASE', writeFile: async () => {},
      runScoped: async () => nonzeroExit,
      removeCheckout: async () => {},
    });

    expect(result).toMatchObject({
      classification: 'red',
      scopedRun: { exitCode: 1, runKind: 'nonzero-exit' },
    });
  });

  it('derives removal-maintenance eligibility per changed selector rather than per diff', () => {
    const diff = [
      'diff --git a/src/old.ts b/src/old.ts', '-export function retired() {}',
      'diff --git a/test/retired.test.ts b/test/retired.test.ts', '+expect(retired).toBeUndefined()',
      'diff --git a/test/new.test.ts b/test/new.test.ts', '+expect(newBehavior()).toBe(true)',
    ].join('\n');
    const eligible = deriveRemovalMaintenanceSelectors(diff, ['test/retired.test.ts', 'test/new.test.ts'], {
      deletedFiles: [], removedDeclarations: ['retired'], removedMembers: [],
    });
    expect(eligible).toEqual(['test/retired.test.ts']);
    expect(eligible.eligibleSelectorRemovals).toEqual([
      { selector: 'test/retired.test.ts', removals: ['retired'] },
    ]);
  });

  it('keeps a term-only removal match normally measured when it adds a surviving-behavior assertion', async () => {
    const diff = [
      'diff --git a/src/old.ts b/src/old.ts', '-export function retired() {}',
      'diff --git a/test/retired.test.ts b/test/retired.test.ts',
      '+expect(retired).toBeUndefined()',
      '+expect(newBehavior()).toBe(true)',
    ].join('\n');
    const eligible = deriveRemovalMaintenanceSelectors(diff, ['test/retired.test.ts'], {
      deletedFiles: [], removedDeclarations: ['retired'], removedMembers: [],
    });
    const runScoped = vi.fn(async () => ({ kind: 'nonzero-exit' as const, exitCode: 1, stdout: 'RED', stderr: '' }));

    expect(eligible).toEqual([]);
    await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head', diff,
      approvedException: 'removal-maintenance', removalMaintenanceSelectors: eligible,
      createCheckout: async () => {}, readMergeBaseFile: async () => 'BASE', writeFile: async () => {}, runScoped, removeCheckout: async () => {},
    });
    expect(runScoped).toHaveBeenCalledWith(expect.any(String), ['test/retired.test.ts'], expect.any(AbortSignal));
  });
  it('keeps HEAD tests while replacing only changed production files in a nested disposable checkout', async () => {
    const rootSnapshot = { 'src/a.ts': 'HEAD production', 'test/a.test.ts': 'HEAD test' };
    const featureSnapshot = JSON.stringify(rootSnapshot);
    const calls: string[] = [];
    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature',
      mergeBase: 'base-sha',
      headSha: 'head-sha',
      diff: [
        'diff --git a/src/a.ts b/src/a.ts',
        'diff --git a/test/a.test.ts b/test/a.test.ts',
      ].join('\n'),
      createCheckout: async (path, head) => { calls.push(`checkout:${path}:${head}`); },
      readMergeBaseFile: async (path) => path === 'src/a.ts' ? 'BASE production' : undefined,
      writeFile: async (path, content) => { calls.push(`write:${path}:${content}`); },
      runScoped: async (cwd, selectors) => { calls.push(`run:${cwd}:${selectors.join(',')}`); return { kind: 'nonzero-exit' as const, exitCode: 1, stdout: 'RED', stderr: '' }; },
      removeCheckout: async (path) => { calls.push(`remove:${path}`); },
    });

    expect(classifyTautologyPaths(result.changedPaths)).toEqual({
      tests: ['test/a.test.ts'], testSupport: [], production: ['src/a.ts'],
    });
    expect(result).toMatchObject({
      classification: 'red', changedTestSelectors: ['test/a.test.ts'],
      sourceIdentities: { mergeBase: 'base-sha', headSha: 'head-sha' },
      // Content-free manifest: the sha is git's own blob identity for
      // 'BASE production' (pinned via `git hash-object`), never the bytes.
      revertedProductionManifest: [{ path: 'src/a.ts', mergeBaseBlobSha: '6d072882cd6d41f5e04eda24ee5bbafac54c2c77' }],
    });
    // The merge-base file content must not survive anywhere in the completed evidence.
    expect(JSON.stringify(result)).not.toContain('BASE production');
    expect(calls).toEqual([
      'checkout:/feature/.pipeline/build-review-preflight/head-sha:head-sha',
      'write:/feature/.pipeline/build-review-preflight/head-sha/src/a.ts:BASE production',
      'run:/feature/.pipeline/build-review-preflight/head-sha:test/a.test.ts',
      'remove:/feature/.pipeline/build-review-preflight/head-sha',
    ]);
    expect(JSON.stringify(rootSnapshot)).toBe(featureSnapshot);
  });

  it('reverts a renamed production file to its merge-base path before running the counterfactual', async () => {
    const calls: string[] = [];
    const removeFile = vi.fn(async (path: string) => { calls.push(`remove:${path}`); });
    const writeFile = vi.fn(async (path: string) => { calls.push(`write:${path}`); });
    const runScoped = vi.fn(async () => {
      calls.push('run');
      return { kind: 'nonzero-exit' as const, exitCode: 1, stdout: 'RED', stderr: '' };
    });
    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: [
        'diff --git a/.docs/conflicts/original.md b/.docs/conflicts/renamed.md',
        'similarity index 100%',
        'rename from .docs/conflicts/original.md',
        'rename to .docs/conflicts/renamed.md',
        'diff --git a/test/a.test.ts b/test/a.test.ts',
      ].join('\n'),
      createCheckout: async () => {},
      readMergeBaseFile: async (path: string) => path === '.docs/conflicts/original.md' ? 'old content' : undefined,
      writeFile, removeFile,
      runScoped, removeCheckout: async () => {},
    });

    expect(result).toMatchObject({
      classification: 'red',
      revertedProductionManifest: [{ path: '.docs/conflicts/original.md' }],
    });
    expect(calls).toEqual([
      'write:/feature/.pipeline/build-review-preflight/head/.docs/conflicts/original.md',
      'remove:/feature/.pipeline/build-review-preflight/head/.docs/conflicts/renamed.md',
      'run',
    ]);
  });

  it('still fails closed when a renamed file has no merge-base content at its old path', async () => {
    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: [
        'diff --git a/src/old.ts b/src/new.ts',
        'rename from src/old.ts',
        'rename to src/new.ts',
        'diff --git a/test/a.test.ts b/test/a.test.ts',
      ].join('\n'),
      createCheckout: async () => {}, readMergeBaseFile: async () => undefined, writeFile: async () => {}, removeFile: async () => {},
      runScoped: vi.fn(), removeCheckout: async () => {},
    });

    expect(result).toMatchObject({ classification: 'infrastructure-failure', reason: 'missing-merge-base-file' });
  });

  it('does not run an aggregate fallback for absent or unclassifiable test selectors', async () => {
    const runScoped = vi.fn();
    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head', diff: 'not a git diff',
      createCheckout: async () => {}, readMergeBaseFile: async () => undefined, writeFile: async () => {}, runScoped,
      removeCheckout: async () => {},
    });
    expect(result).toMatchObject({ classification: 'infrastructure-failure', reason: 'no-changed-tests' });
    expect(runScoped).not.toHaveBeenCalled();
  });

  it('classifies executable tests, test support, and production separately', () => {
    expect(classifyTautologyPaths([
      'test/engine/memory-writer-helper.ts',
      'test/fixtures/claude-envelopes/successful-command.json',
      'test/acceptance/build-review-rubric-fanout.red-runner.mjs',
      'test/engine/build-review-cli.test.ts',
      'tests/unit/runner.spec.mts',
      'spec/models/widget_test.rb',
      'src/engine/build-review.ts',
    ])).toEqual({
      tests: ['spec/models/widget_test.rb', 'test/engine/build-review-cli.test.ts', 'tests/unit/runner.spec.mts'],
      testSupport: [
        'test/acceptance/build-review-rubric-fanout.red-runner.mjs',
        'test/engine/memory-writer-helper.ts',
        'test/fixtures/claude-envelopes/successful-command.json',
      ],
      production: ['src/engine/build-review.ts'],
    });
  });

  it('keeps test support at HEAD and refuses a support-only counterfactual', async () => {
    const readMergeBaseFile = vi.fn(async () => 'BASE production');
    const writeFile = vi.fn(async () => {});
    const runScoped = vi.fn(async () => ({ kind: 'nonzero-exit' as const, exitCode: 1, stdout: 'RED', stderr: '' }));
    const diff = [
      'diff --git a/test/engine/memory-writer-helper.ts b/test/engine/memory-writer-helper.ts',
      'diff --git a/test/fixtures/claude-envelopes/successful-command.json b/test/fixtures/claude-envelopes/successful-command.json',
      'diff --git a/test/acceptance/build-review-rubric-fanout.red-runner.mjs b/test/acceptance/build-review-rubric-fanout.red-runner.mjs',
      'diff --git a/test/engine/build-review-cli.test.ts b/test/engine/build-review-cli.test.ts',
    ].join('\n');

    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head', diff,
      createCheckout: async () => {}, readMergeBaseFile, writeFile, runScoped, removeCheckout: async () => {},
    });

    expect(result).toMatchObject({
      classification: 'infrastructure-failure', reason: 'no-production-changes',
      changedTestSelectors: ['test/engine/build-review-cli.test.ts'],
    });
    expect(readMergeBaseFile).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(runScoped).not.toHaveBeenCalled();
  });

  it('reverts only true production while retaining changed test support at HEAD', async () => {
    const readMergeBaseFile = vi.fn(async (path: string) => path === 'src/engine/build-review.ts' ? 'BASE production' : undefined);
    const writeFile = vi.fn(async () => {});
    const runScoped = vi.fn(async () => ({ kind: 'nonzero-exit' as const, exitCode: 1, stdout: 'RED', stderr: '' }));
    const diff = [
      'diff --git a/src/engine/build-review.ts b/src/engine/build-review.ts',
      'diff --git a/test/engine/memory-writer-helper.ts b/test/engine/memory-writer-helper.ts',
      'diff --git a/test/fixtures/claude-envelopes/successful-command.json b/test/fixtures/claude-envelopes/successful-command.json',
      'diff --git a/test/acceptance/build-review-rubric-fanout.red-runner.mjs b/test/acceptance/build-review-rubric-fanout.red-runner.mjs',
      'diff --git a/test/engine/build-review-cli.test.ts b/test/engine/build-review-cli.test.ts',
    ].join('\n');

    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head', diff,
      createCheckout: async () => {}, readMergeBaseFile, writeFile, runScoped, removeCheckout: async () => {},
    });

    expect(result).toMatchObject({
      classification: 'red', changedTestSelectors: ['test/engine/build-review-cli.test.ts'],
      revertedProductionManifest: [{ path: 'src/engine/build-review.ts', mergeBaseBlobSha: '6d072882cd6d41f5e04eda24ee5bbafac54c2c77' }],
    });
    expect(readMergeBaseFile).toHaveBeenCalledTimes(1);
    expect(readMergeBaseFile).toHaveBeenCalledWith('src/engine/build-review.ts');
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith(
      '/feature/.pipeline/build-review-preflight/head/src/engine/build-review.ts',
      'BASE production',
    );
    expect(runScoped).toHaveBeenCalledWith(
      '/feature/.pipeline/build-review-preflight/head',
      ['test/engine/build-review-cli.test.ts'],
      expect.any(AbortSignal),
    );
  });

  it('treats every nonzero scoped process exit as RED evidence', async () => {
    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout: async () => {}, readMergeBaseFile: async () => 'BASE', writeFile: async () => {},
      runScoped: async () => ({ kind: 'nonzero-exit', exitCode: 1, stdout: '', stderr: 'no tests collected' }),
      removeCheckout: async () => {},
    });

    expect(result).toMatchObject({ classification: 'red', scopedRun: { runKind: 'nonzero-exit' } });
  });

  it('classifies a reverted-tree nonzero process exit as RED', async () => {
    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout: async () => {}, readMergeBaseFile: async () => 'BASE', writeFile: async () => {},
      runScoped: async () => ({ kind: 'nonzero-exit', exitCode: 1, stdout: '', stderr: 'Failed to load url ./added-module.ts' }),
      removeCheckout: async () => {},
    });

    expect(result).toMatchObject({ classification: 'red', cacheable: true });
  });

  it('cleans up a partially-created checkout and reports materialization failure as infrastructure', async () => {
    const removeCheckout = vi.fn(async () => {});
    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head', diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout: async () => { throw new Error('disk full'); }, readMergeBaseFile: async () => undefined, writeFile: async () => {},
      runScoped: async () => ({ kind: 'nonzero-exit' as const, exitCode: 1, stdout: '', stderr: '' }), removeCheckout,
    });
    expect(result).toMatchObject({ classification: 'infrastructure-failure', reason: 'materialization-failed' });
    expect(removeCheckout).toHaveBeenCalledWith('/feature/.pipeline/build-review-preflight/head');
  });

  it('keeps RED, stayed-green, and approved exceptions distinct and caches only completed evidence', async () => {
    const base = {
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout: vi.fn(async () => {}), readMergeBaseFile: vi.fn(async () => 'BASE'), writeFile: vi.fn(async () => {}),
      removeCheckout: vi.fn(async () => {}), readCache: vi.fn(async () => undefined), writeCache: vi.fn(async () => {}),
    };
    const red = await materializeTautologyPreflight({ ...base, runScoped: async () => ({ kind: 'nonzero-exit' as const, exitCode: 1, stdout: 'failed', stderr: '' }) });
    const stayedGreen = await materializeTautologyPreflight({ ...base, runScoped: async () => ({ exitCode: 0, stdout: 'passed', stderr: '' }) });
    const qualifyingDiff = 'diff --git a/src/a.ts b/src/a.ts\n-export function retired() {}\ndiff --git a/test/a.test.ts b/test/a.test.ts\n+expect(retired).toBeUndefined()';
    const eligible = deriveRemovalMaintenanceSelectors(qualifyingDiff, ['test/a.test.ts'], {
      deletedFiles: [], removedDeclarations: ['retired'], removedMembers: [],
    });
    const exception = await materializeTautologyPreflight({ ...base, diff: qualifyingDiff, approvedException: 'removal-maintenance', removalMaintenanceSelectors: eligible, runScoped: async () => ({ exitCode: 0, stdout: '', stderr: '' }) });

    expect(red).toMatchObject({ classification: 'red', cacheable: true });
    expect(stayedGreen).toMatchObject({ classification: 'stayed-green', cacheable: true });
    expect(exception).toMatchObject({ classification: 'approved-exception', exception: 'removal-maintenance', cacheable: true });
    expect(base.writeCache).toHaveBeenCalledTimes(3);
    expect(base.createCheckout).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['cache read', { readCache: async () => { throw new Error('cache unavailable'); } }, 'cache-read-failed'],
    ['cache write', { writeCache: async () => { throw new Error('cache unavailable'); } }, 'cache-write-failed'],
  ])('preserves the output-free %s infrastructure reason', async (_name, cache, reason) => {
    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout: async () => {}, readMergeBaseFile: async () => 'BASE', writeFile: async () => {},
      runScoped: async () => ({ kind: 'nonzero-exit', exitCode: 1, stdout: 'RED', stderr: '' }),
      removeCheckout: async () => {},
      ...cache,
    });

    expect(result).toMatchObject({ classification: 'infrastructure-failure', reason });
  });

  it.each([
    ['no changed tests', () => ({ diff: 'not a git diff' }), 'no-changed-tests'],
    ['no production changes', () => ({ diff: 'diff --git a/test/a.test.ts b/test/a.test.ts' }), 'no-production-changes'],
    ['missing scoped configuration', () => ({ scopedWorkingDirectory: ' ' }), 'missing-scoped-configuration'],
    ['materialization failure', () => ({ createCheckout: async () => { throw new Error('disk full'); } }), 'materialization-failed'],
    ['missing merge-base file', () => ({ readMergeBaseFile: async () => undefined }), 'missing-merge-base-file'],
    ['aborted run', () => {
      const controller = new AbortController();
      controller.abort();
      return { abortSignal: controller.signal };
    }, 'aborted'],
    ['cleanup failure', () => ({ removeCheckout: async () => { throw new Error('cleanup failed'); } }), 'cleanup-failed'],
    ['cache read failure', () => ({ readCache: async () => { throw new Error('cache unavailable'); } }), 'cache-read-failed'],
    ['cache write failure', () => ({ writeCache: async () => { throw new Error('cache unavailable'); } }), 'cache-write-failed'],
  ])('does not fabricate an excerpt for %s', async (_name, overrides, reason) => {
    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout: async () => {}, readMergeBaseFile: async () => 'BASE', writeFile: async () => {},
      runScoped: async () => ({ kind: 'nonzero-exit' as const, exitCode: 1, stdout: 'RED', stderr: '' }),
      removeCheckout: async () => {},
      ...overrides(),
    });

    expect(result).toMatchObject({ classification: 'infrastructure-failure', reason });
    expect(result).not.toHaveProperty('failureExcerpt');
  });

  it('reuses an exact cached completed result without another checkout or scoped command', async () => {
    const cached = { classification: 'red', cacheable: true, cacheProvenance: 'miss', changedPaths: ['src/a.ts', 'test/a.test.ts'], changedTestSelectors: ['test/a.test.ts'], revertedProductionManifest: [{ path: 'src/a.ts', mergeBaseBlobSha: 'e79120aab4682bfe81153595c7d2ec1ad3bd3dd8' }], sourceIdentities: { mergeBase: 'base', headSha: 'head' }, scopedRun: { exitCode: 1, runKind: 'nonzero-exit', ranSelectors: ['test/a.test.ts'], failureExcerpt: 'RED' } } as const;
    const createCheckout = vi.fn(async () => {});
    const runScoped = vi.fn(async () => ({ kind: 'nonzero-exit' as const, exitCode: 1, stdout: '', stderr: '' }));
    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head', diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout, readMergeBaseFile: async () => 'BASE', writeFile: async () => {}, runScoped, removeCheckout: async () => {},
      readCache: async () => cached, writeCache: async () => {},
    });
    expect(result).toMatchObject({ classification: 'red', cacheProvenance: 'hit' });
    expect(createCheckout).not.toHaveBeenCalled();
    expect(runScoped).not.toHaveBeenCalled();
  });

  it('invalidates cache reuse when the scoped command or CURRENT proof identity changes', async () => {
    const keys: string[] = [];
    const base = {
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout: async () => {}, readMergeBaseFile: async () => 'BASE', writeFile: async () => {},
      runScoped: async () => ({ kind: 'nonzero-exit' as const, exitCode: 1, stdout: 'RED', stderr: '' }), removeCheckout: async () => {},
      readCache: async (key: string) => { keys.push(key); return undefined; },
    };
    await materializeTautologyPreflight({ ...base, scopedCommand: 'run {selectors}', currentGreenProofIdentity: 'proof-a' });
    await materializeTautologyPreflight({ ...base, scopedCommand: 'other {selectors}', currentGreenProofIdentity: 'proof-a' });
    await materializeTautologyPreflight({ ...base, scopedCommand: 'run {selectors}', currentGreenProofIdentity: 'proof-b' });
    expect(new Set(keys).size).toBe(3);
  });

  it('runs the counterfactual for every changed test not individually eligible for removal maintenance', async () => {
    const runScoped = vi.fn(async () => ({ kind: 'nonzero-exit' as const, exitCode: 1, stdout: 'RED', stderr: '' }));
    await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: 'diff --git a/src/a.ts b/src/a.ts\n-export function retired() {}\ndiff --git a/test/a.test.ts b/test/a.test.ts\n+expect(retired).toBeUndefined()\ndiff --git a/test/b.test.ts b/test/b.test.ts\n+expect(newBehavior()).toBe(true)',
      approvedException: 'removal-maintenance', removalMaintenanceSelectors: deriveRemovalMaintenanceSelectors('diff --git a/src/a.ts b/src/a.ts\n-export function retired() {}\ndiff --git a/test/a.test.ts b/test/a.test.ts\n+expect(retired).toBeUndefined()\ndiff --git a/test/b.test.ts b/test/b.test.ts\n+expect(newBehavior()).toBe(true)', ['test/a.test.ts', 'test/b.test.ts'], { deletedFiles: [], removedDeclarations: ['retired'], removedMembers: [] }),
      createCheckout: async () => {}, readMergeBaseFile: async () => 'BASE', writeFile: async () => {}, runScoped, removeCheckout: async () => {},
    });
    expect(runScoped).toHaveBeenCalledWith(expect.any(String), ['test/b.test.ts'], expect.any(AbortSignal));
  });

  it.each([
    ['missing scoped configuration', async () => ({ scopedWorkingDirectory: '  ' }), 'missing-scoped-configuration'],
    ['launch error', async () => ({ runScoped: async () => ({ kind: 'launch-error' as const, stdout: '', stderr: 'spawn failed' }) }), 'scoped-run-launch-failed'],
    ['timeout', async () => ({ runScoped: async () => ({ kind: 'timeout' as const, stdout: '', stderr: '' }) }), 'scoped-run-timeout'],
    ['signal termination', async () => ({ runScoped: async () => ({ kind: 'signal' as const, signal: 'SIGTERM', stdout: '', stderr: '' }) }), 'scoped-run-signaled'],
    ['scoped command rejection', async () => ({ runScoped: async () => { throw new Error('command failed'); } }), 'scoped-run-failed'],
  ])('fails closed for %s without producing RED evidence', async (_name, overrides, reason) => {
    const removeCheckout = vi.fn(async () => {});
    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout: async () => {}, readMergeBaseFile: async () => 'BASE', writeFile: async () => {},
      runScoped: async () => ({ kind: 'nonzero-exit' as const, exitCode: 1, stdout: 'would be red', stderr: '' }), removeCheckout,
      ...await overrides(),
    });

    expect(result).toMatchObject({ classification: 'infrastructure-failure', reason });
    expect(result.classification).not.toBe('red');
    if (reason === 'missing-scoped-configuration') expect(removeCheckout).not.toHaveBeenCalled();
    else expect(removeCheckout).toHaveBeenCalledOnce();
  });

  it.each([
    ['launch', { kind: 'launch-error' as const, stdout: 'launch stdout', stderr: 'launch stderr' }, 'scoped-run-launch-failed'],
    ['timeout', { kind: 'timeout' as const, stdout: 'timeout stdout', stderr: 'timeout stderr' }, 'scoped-run-timeout'],
    ['signal', { kind: 'signal' as const, signal: 'SIGTERM', stdout: 'signal stdout', stderr: 'signal stderr' }, 'scoped-run-signaled'],
  ])('retains bounded combined output for a scoped %s infrastructure failure', async (_name, execution, reason) => {
    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout: async () => {}, readMergeBaseFile: async () => 'BASE', writeFile: async () => {},
      runScoped: async () => execution,
      removeCheckout: async () => {},
    });

    expect(result).toMatchObject({ classification: 'infrastructure-failure', reason, failureExcerpt: `${execution.stdout}\n${execution.stderr}` });
  });

  it('marks truncated scoped-run infrastructure output explicitly', async () => {
    const noise = 'x'.repeat(TAUTOLOGY_EXCERPT_CAP_BYTES * 2);
    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout: async () => {}, readMergeBaseFile: async () => 'BASE', writeFile: async () => {},
      runScoped: async () => ({ kind: 'timeout', stdout: `HEAD ${noise}`, stderr: 'TAIL' }),
      removeCheckout: async () => {},
    });

    if (result.classification !== 'infrastructure-failure') throw new Error('expected infrastructure failure');
    expect(Buffer.byteLength(result.failureExcerpt!, 'utf8')).toBeLessThanOrEqual(TAUTOLOGY_EXCERPT_CAP_BYTES);
    expect(result.failureExcerpt).toContain('HEAD');
    expect(result.failureExcerpt).toContain('TAIL');
    expect(result.failureExcerpt).toMatch(/\[\.\.\.truncated \d+ bytes\.\.\.\]/);
  });

  it('cleans up after an aborted scoped run and leaves live bytes unchanged', async () => {
    const controller = new AbortController();
    const liveBytes = JSON.stringify({ 'src/a.ts': 'HEAD production', 'test/a.test.ts': 'HEAD test' });
    const removeCheckout = vi.fn(async () => {});
    const runScoped = vi.fn(async (_cwd: string, _selectors: readonly string[], signal: AbortSignal) => {
      controller.abort();
      expect(signal.aborted).toBe(true);
      return { kind: 'nonzero-exit' as const, exitCode: 1, stdout: 'would be red', stderr: '' };
    });

    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout: async () => {}, readMergeBaseFile: async () => 'BASE', writeFile: async () => {},
      runScoped, removeCheckout, abortSignal: controller.signal,
    });

    expect(result).toMatchObject({ classification: 'infrastructure-failure', reason: 'aborted' });
    expect(removeCheckout).toHaveBeenCalledOnce();
    expect(JSON.stringify({ 'src/a.ts': 'HEAD production', 'test/a.test.ts': 'HEAD test' })).toBe(liveBytes);
  });

  it('projects the scoped-run verdict verbatim with a bounded failure excerpt instead of raw output', async () => {
    const noise = 'x'.repeat(40_000);
    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout: async () => {}, readMergeBaseFile: async () => 'BASE', writeFile: async () => {},
      runScoped: async () => ({ kind: 'nonzero-exit' as const, exitCode: 7, stdout: `HEAD-of-run ${noise}`, stderr: 'tail-of-run' }),
      removeCheckout: async () => {},
    });

    if (result.classification !== 'red') throw new Error('expected RED evidence');
    expect(result.scopedRun).toMatchObject({ exitCode: 7, runKind: 'nonzero-exit', ranSelectors: ['test/a.test.ts'] });
    const excerpt = result.scopedRun!.failureExcerpt;
    expect(excerpt).not.toBe('');
    expect(Buffer.byteLength(excerpt, 'utf8')).toBeLessThanOrEqual(TAUTOLOGY_EXCERPT_CAP_BYTES);
    expect(excerpt).toContain('HEAD-of-run');
    expect(excerpt).toContain('tail-of-run');
    expect(excerpt).toMatch(/\[\.\.\.truncated \d+ bytes\.\.\.\]/);
    // Raw stdout/stderr never travel wholesale.
    expect(JSON.stringify(result)).not.toContain(noise);
  });

  it('keeps a stayed-green result tiny: no failure excerpt even when the run printed output', async () => {
    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout: async () => {}, readMergeBaseFile: async () => 'BASE', writeFile: async () => {},
      runScoped: async () => ({ exitCode: 0, stdout: 'verbose reporter output '.repeat(4_096), stderr: '' }),
      removeCheckout: async () => {},
    });

    if (result.classification !== 'stayed-green') throw new Error('expected stayed-green evidence');
    expect(result.scopedRun).toEqual({ exitCode: 0, runKind: 'passed', ranSelectors: ['test/a.test.ts'], failureExcerpt: '' });
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThan(2_048);
  });

  it('bounds head+tail excerpts at the cap with an explicit truncation marker and passes small text through', () => {
    expect(boundedHeadTailExcerpt('short output')).toBe('short output');
    expect(boundedHeadTailExcerpt('exact', 5)).toBe('exact');

    const text = `${'H'.repeat(10_000)}${'M'.repeat(10_000)}${'T'.repeat(10_000)}`;
    const excerpt = boundedHeadTailExcerpt(text);
    expect(Buffer.byteLength(excerpt, 'utf8')).toBeLessThanOrEqual(TAUTOLOGY_EXCERPT_CAP_BYTES);
    expect(excerpt.startsWith('H')).toBe(true);
    expect(excerpt.endsWith('T')).toBe(true);
    const marker = /\[\.\.\.truncated (\d+) bytes\.\.\.\]/.exec(excerpt);
    expect(marker).not.toBeNull();
    // The marker accounts for every byte not retained by head or tail.
    const retained = Buffer.byteLength(excerpt.replace(/\n\[\.\.\.truncated \d+ bytes\.\.\.\]\n/, ''), 'utf8');
    expect(retained + Number(marker![1])).toBe(Buffer.byteLength(text, 'utf8'));

    const small = boundedHeadTailExcerpt(text, 2_048);
    expect(Buffer.byteLength(small, 'utf8')).toBeLessThanOrEqual(2_048);
    expect(small).toMatch(/\[\.\.\.truncated \d+ bytes\.\.\.\]/);
  });

  it('returns cleanup failure even when the underlying scoped run is RED', async () => {
    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout: async () => {}, readMergeBaseFile: async () => 'BASE', writeFile: async () => {},
      runScoped: async () => ({ kind: 'nonzero-exit' as const, exitCode: 1, stdout: 'RED', stderr: '' }),
      removeCheckout: async () => { throw new Error('cleanup failed'); },
    });

    expect(result).toMatchObject({ classification: 'infrastructure-failure', reason: 'cleanup-failed' });
  });
});
