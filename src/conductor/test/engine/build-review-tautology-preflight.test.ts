import { describe, expect, it, vi } from 'vitest';

import {
  materializeTautologyPreflight,
  classifyTautologyPaths,
} from '../../src/engine/build-review-tautology-preflight.js';

describe('build-review Tautology preflight', () => {
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
      runScoped: async (cwd, selectors) => { calls.push(`run:${cwd}:${selectors.join(',')}`); return { exitCode: 1, stdout: 'RED', stderr: '' }; },
      removeCheckout: async (path) => { calls.push(`remove:${path}`); },
    });

    expect(classifyTautologyPaths(result.changedPaths)).toEqual({ tests: ['test/a.test.ts'], production: ['src/a.ts'] });
    expect(result).toMatchObject({
      classification: 'red', changedTestSelectors: ['test/a.test.ts'],
      sourceIdentities: { mergeBase: 'base-sha', headSha: 'head-sha' },
      revertedProductionPatch: [{ path: 'src/a.ts', mergeBaseContent: 'BASE production' }],
    });
    expect(calls).toEqual([
      'checkout:/feature/.pipeline/build-review-preflight/head-sha:head-sha',
      'write:/feature/.pipeline/build-review-preflight/head-sha/src/a.ts:BASE production',
      'run:/feature/.pipeline/build-review-preflight/head-sha:test/a.test.ts',
      'remove:/feature/.pipeline/build-review-preflight/head-sha',
    ]);
    expect(JSON.stringify(rootSnapshot)).toBe(featureSnapshot);
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

  it('cleans up a partially-created checkout and reports materialization failure as infrastructure', async () => {
    const removeCheckout = vi.fn(async () => {});
    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head', diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout: async () => { throw new Error('disk full'); }, readMergeBaseFile: async () => undefined, writeFile: async () => {},
      runScoped: async () => ({ exitCode: 1, stdout: '', stderr: '' }), removeCheckout,
    });
    expect(result).toMatchObject({ classification: 'infrastructure-failure', reason: 'materialization-failed' });
    expect(removeCheckout).toHaveBeenCalledWith('/feature/.pipeline/build-review-preflight/head');
  });
});
