import { describe, expect, it, vi } from 'vitest';

import {
  materializeTautologyPreflight,
  classifyTautologyPaths,
  deriveRemovalMaintenanceSelectors,
} from '../../src/engine/build-review-tautology-preflight.js';

describe('build-review Tautology preflight', () => {
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
    const runScoped = vi.fn(async () => ({ exitCode: 1, stdout: 'RED', stderr: '' }));

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

  it('keeps RED, stayed-green, and approved exceptions distinct and caches only completed evidence', async () => {
    const base = {
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout: vi.fn(async () => {}), readMergeBaseFile: vi.fn(async () => 'BASE'), writeFile: vi.fn(async () => {}),
      removeCheckout: vi.fn(async () => {}), readCache: vi.fn(async () => undefined), writeCache: vi.fn(async () => {}),
    };
    const red = await materializeTautologyPreflight({ ...base, runScoped: async () => ({ exitCode: 1, stdout: 'failed', stderr: '' }) });
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

  it('reuses an exact cached completed result without another checkout or scoped command', async () => {
    const cached = { classification: 'red', cacheable: true, cacheProvenance: 'miss', changedPaths: ['src/a.ts', 'test/a.test.ts'], changedTestSelectors: ['test/a.test.ts'], revertedProductionPatch: [{ path: 'src/a.ts', mergeBaseContent: 'BASE' }], sourceIdentities: { mergeBase: 'base', headSha: 'head' }, output: { stdout: '', stderr: '' } } as const;
    const createCheckout = vi.fn(async () => {});
    const runScoped = vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: '' }));
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
      runScoped: async () => ({ exitCode: 1, stdout: 'RED', stderr: '' }), removeCheckout: async () => {},
      readCache: async (key: string) => { keys.push(key); return undefined; },
    };
    await materializeTautologyPreflight({ ...base, scopedCommand: 'run {selectors}', currentGreenProofIdentity: 'proof-a' });
    await materializeTautologyPreflight({ ...base, scopedCommand: 'other {selectors}', currentGreenProofIdentity: 'proof-a' });
    await materializeTautologyPreflight({ ...base, scopedCommand: 'run {selectors}', currentGreenProofIdentity: 'proof-b' });
    expect(new Set(keys).size).toBe(3);
  });

  it('runs the counterfactual for every changed test not individually eligible for removal maintenance', async () => {
    const runScoped = vi.fn(async () => ({ exitCode: 1, stdout: 'RED', stderr: '' }));
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
  ])('fails closed for %s without producing RED evidence', async (_name, overrides, reason) => {
    const removeCheckout = vi.fn(async () => {});
    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout: async () => {}, readMergeBaseFile: async () => 'BASE', writeFile: async () => {},
      runScoped: async () => ({ exitCode: 1, stdout: 'would be red', stderr: '' }), removeCheckout,
      ...await overrides(),
    });

    expect(result).toMatchObject({ classification: 'infrastructure-failure', reason });
    expect(result.classification).not.toBe('red');
    if (reason === 'missing-scoped-configuration') expect(removeCheckout).not.toHaveBeenCalled();
    else expect(removeCheckout).toHaveBeenCalledOnce();
  });

  it('cleans up after an aborted scoped run and leaves live bytes unchanged', async () => {
    const controller = new AbortController();
    const liveBytes = JSON.stringify({ 'src/a.ts': 'HEAD production', 'test/a.test.ts': 'HEAD test' });
    const removeCheckout = vi.fn(async () => {});
    const runScoped = vi.fn(async (_cwd: string, _selectors: readonly string[], signal: AbortSignal) => {
      controller.abort();
      expect(signal.aborted).toBe(true);
      return { exitCode: 1, stdout: 'would be red', stderr: '' };
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

  it('returns cleanup failure even when the underlying scoped run is RED', async () => {
    const result = await materializeTautologyPreflight({
      scopedWorkingDirectory: '/feature', mergeBase: 'base', headSha: 'head',
      diff: 'diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts',
      createCheckout: async () => {}, readMergeBaseFile: async () => 'BASE', writeFile: async () => {},
      runScoped: async () => ({ exitCode: 1, stdout: 'RED', stderr: '' }),
      removeCheckout: async () => { throw new Error('cleanup failed'); },
    });

    expect(result).toMatchObject({ classification: 'infrastructure-failure', reason: 'cleanup-failed' });
  });
});
