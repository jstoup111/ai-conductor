import { join } from 'node:path';
import { createHash } from 'node:crypto';

export interface TautologyPathClassification {
  readonly tests: readonly string[];
  readonly production: readonly string[];
}

export type TautologyScopedRunResult =
  | { readonly exitCode: number; readonly stdout: string; readonly stderr: string }
  | { readonly kind: 'launch-error' | 'timeout'; readonly stdout: string; readonly stderr: string }
  | { readonly kind: 'signal'; readonly signal: string; readonly stdout: string; readonly stderr: string };

export interface TautologyPreflightDependencies {
  readonly scopedWorkingDirectory: string;
  readonly mergeBase: string;
  readonly headSha: string;
  readonly diff: string;
  /** Creates a disposable checkout at `path` from the current feature HEAD. */
  readonly createCheckout: (path: string, headSha: string) => Promise<void>;
  /** Reads exactly one changed production path from the merge base. */
  readonly readMergeBaseFile: (path: string) => Promise<string | undefined>;
  /** Writes only inside the disposable checkout. */
  readonly writeFile: (path: string, content: string) => Promise<void>;
  /** Executes precisely the supplied changed-test selectors; never an aggregate fallback. */
  readonly runScoped: (cwd: string, selectors: readonly string[], signal: AbortSignal) => Promise<TautologyScopedRunResult>;
  /** Removes the disposable checkout on every outcome. */
  readonly removeCheckout: (path: string) => Promise<void>;
  /** Bounded exact-input cache seam. Infrastructure outcomes are never written. */
  readonly readCache?: (key: string) => Promise<TautologyCompletedPreflight | undefined>;
  readonly writeCache?: (key: string, evidence: TautologyCompletedPreflight) => Promise<void>;
  readonly approvedException?: 'empty-test-set' | 'removal-maintenance';
  /** Changed test selectors individually eligible for removal-maintenance. */
  readonly removalMaintenanceSelectors?: readonly string[];
  /** Exact scoped-command template used for the counterfactual. */
  readonly scopedCommand?: string | null;
  /** Identity of the CURRENT aggregate green proof this preflight relies on. */
  readonly currentGreenProofIdentity?: string | null;
  /** Cancels the isolated command only; the disposable checkout is still cleaned up. */
  readonly abortSignal?: AbortSignal;
}

export interface TautologyCompletedPreflight {
      readonly classification: 'red' | 'stayed-green' | 'approved-exception';
      readonly exception?: 'empty-test-set' | 'removal-maintenance';
      readonly cacheable: true;
      readonly cacheProvenance: 'hit' | 'miss';
      readonly changedPaths: readonly string[];
      readonly changedTestSelectors: readonly string[];
      readonly revertedProductionPatch: readonly { path: string; mergeBaseContent: string }[];
      readonly sourceIdentities: { readonly mergeBase: string; readonly headSha: string };
      readonly output: { readonly stdout: string; readonly stderr: string };
}

export type TautologyPreflightResult = TautologyCompletedPreflight | {
      readonly classification: 'infrastructure-failure';
      readonly reason: 'no-changed-tests' | 'no-production-changes' | 'missing-scoped-configuration' | 'materialization-failed' | 'missing-merge-base-file' | 'scoped-run-failed' | 'scoped-run-launch-failed' | 'scoped-run-timeout' | 'scoped-run-signaled' | 'aborted' | 'cleanup-failed' | 'cache-read-failed' | 'cache-write-failed';
      readonly changedPaths: readonly string[];
      readonly changedTestSelectors: readonly string[];
      readonly sourceIdentities: { readonly mergeBase: string; readonly headSha: string };
    };

function changedPaths(diff: string): string[] {
  const paths = new Set<string>();
  for (const line of diff.split('\n')) {
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (!match) continue;
    const path = match[2]!;
    if (path !== '/dev/null') paths.add(path);
  }
  return [...paths].sort();
}

function isTestPath(path: string): boolean {
  return /(?:^|\/)(?:__tests__|tests?|spec)(?:\/|$)|\.(?:test|spec)\.[^/]+$/i.test(path);
}

/** Closed path classifier; unknown paths are production, never a broad test selector. */
export function classifyTautologyPaths(paths: readonly string[]): TautologyPathClassification {
  return {
    tests: paths.filter(isTestPath).sort(),
    production: paths.filter((path) => !isTestPath(path)).sort(),
  };
}

function failure(
  reason: Extract<TautologyPreflightResult, { classification: 'infrastructure-failure' }>['reason'],
  paths: readonly string[],
  selectors: readonly string[],
  sourceIdentities: { readonly mergeBase: string; readonly headSha: string },
): TautologyPreflightResult {
  return { classification: 'infrastructure-failure', reason, changedPaths: paths, changedTestSelectors: selectors, sourceIdentities };
}

function cacheKey(deps: TautologyPreflightDependencies, paths: readonly string[]): string {
  return `sha256:${createHash('sha256').update(JSON.stringify({
    version: 2, mergeBase: deps.mergeBase, headSha: deps.headSha, paths, diff: deps.diff,
    approvedException: deps.approvedException ?? null,
    removalMaintenanceSelectors: [...(deps.removalMaintenanceSelectors ?? [])].sort(),
    scopedCommand: deps.scopedCommand ?? null,
    currentGreenProofIdentity: deps.currentGreenProofIdentity ?? null,
  })).digest('hex')}`;
}

function aborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function scopedRunFailure(
  execution: Exclude<TautologyScopedRunResult, { readonly exitCode: number }>,
): Extract<TautologyPreflightResult, { classification: 'infrastructure-failure' }>['reason'] {
  switch (execution.kind) {
    case 'launch-error': return 'scoped-run-launch-failed';
    case 'timeout': return 'scoped-run-timeout';
    case 'signal': return 'scoped-run-signaled';
  }
}

/**
 * Runs the one missing Tautology counterfactual. The checkout starts at HEAD,
 * preserving changed tests, then only changed production files are replaced
 * with their merge-base bytes. No dependency can touch either live checkout.
 */
export async function materializeTautologyPreflight(
  deps: TautologyPreflightDependencies,
): Promise<TautologyPreflightResult> {
  const paths = changedPaths(deps.diff);
  const classified = classifyTautologyPaths(paths);
  const sourceIdentities = { mergeBase: deps.mergeBase, headSha: deps.headSha };
  if (deps.scopedWorkingDirectory.trim().length === 0) {
    return failure('missing-scoped-configuration', paths, classified.tests, sourceIdentities);
  }
  const signal = deps.abortSignal ?? new AbortController().signal;
  if (aborted(signal)) return failure('aborted', paths, classified.tests, sourceIdentities);
  const key = cacheKey(deps, paths);
  let cached: TautologyCompletedPreflight | undefined;
  try {
    cached = await deps.readCache?.(key);
  } catch {
    return failure('cache-read-failed', paths, classified.tests, sourceIdentities);
  }
  if (cached) return { ...cached, cacheProvenance: 'hit' };
  const eligibleRemovalSelectors = new Set(deps.removalMaintenanceSelectors ?? []);
  if (classified.tests.length === 0) return failure('no-changed-tests', paths, classified.tests, sourceIdentities);
  const counterfactualSelectors = deps.approvedException === 'removal-maintenance'
    ? classified.tests.filter((selector) => !eligibleRemovalSelectors.has(selector))
    : classified.tests;
  if (deps.approvedException === 'empty-test-set' && classified.tests.length === 0) {
    const completed: TautologyCompletedPreflight = {
      classification: 'approved-exception', exception: deps.approvedException, cacheable: true, cacheProvenance: 'miss',
      changedPaths: paths, changedTestSelectors: classified.tests, revertedProductionPatch: [], sourceIdentities,
      output: { stdout: '', stderr: '' },
    };
    try {
      await deps.writeCache?.(key, completed);
      return completed;
    } catch {
      return failure('cache-write-failed', paths, classified.tests, sourceIdentities);
    }
  }
  if (deps.approvedException === 'removal-maintenance' && counterfactualSelectors.length === 0) {
    const completed: TautologyCompletedPreflight = {
      classification: 'approved-exception', exception: 'removal-maintenance', cacheable: true, cacheProvenance: 'miss',
      changedPaths: paths, changedTestSelectors: classified.tests, revertedProductionPatch: [], sourceIdentities,
      output: { stdout: '', stderr: '' },
    };
    try { await deps.writeCache?.(key, completed); return completed; } catch { return failure('cache-write-failed', paths, classified.tests, sourceIdentities); }
  }
  if (classified.production.length === 0) return failure('no-production-changes', paths, classified.tests, sourceIdentities);

  const checkout = join(deps.scopedWorkingDirectory, '.pipeline', 'build-review-preflight', deps.headSha);
  let result: TautologyPreflightResult | undefined;
  try {
    await deps.createCheckout(checkout, deps.headSha);
    if (aborted(signal)) {
      result = failure('aborted', paths, classified.tests, sourceIdentities);
    }
    const patch: Array<{ path: string; mergeBaseContent: string }> = [];
    for (const path of result ? [] : classified.production) {
      const mergeBaseContent = await deps.readMergeBaseFile(path);
      if (aborted(signal)) {
        result = failure('aborted', paths, classified.tests, sourceIdentities);
        break;
      }
      if (mergeBaseContent === undefined) {
        result = failure('missing-merge-base-file', paths, classified.tests, sourceIdentities);
        break;
      }
      patch.push({ path, mergeBaseContent });
      await deps.writeFile(join(checkout, path), mergeBaseContent);
      if (aborted(signal)) {
        result = failure('aborted', paths, classified.tests, sourceIdentities);
        break;
      }
    }
    if (!result) {
      try {
        const execution = await deps.runScoped(checkout, counterfactualSelectors, signal);
        if (aborted(signal)) result = failure('aborted', paths, classified.tests, sourceIdentities);
        else if ('kind' in execution) result = failure(scopedRunFailure(execution), paths, classified.tests, sourceIdentities);
        else {
          result = {
            classification: execution.exitCode === 0 ? 'stayed-green' : 'red',
            cacheable: true,
            cacheProvenance: 'miss',
            changedPaths: paths,
            changedTestSelectors: classified.tests,
            revertedProductionPatch: patch,
            sourceIdentities,
            output: { stdout: execution.stdout, stderr: execution.stderr },
          };
        }
      } catch {
        result = failure(aborted(signal) ? 'aborted' : 'scoped-run-failed', paths, classified.tests, sourceIdentities);
      }
    }
  } catch {
    result = failure(aborted(signal) ? 'aborted' : 'materialization-failed', paths, classified.tests, sourceIdentities);
  } finally {
    try {
      await deps.removeCheckout(checkout);
    } catch {
      result = failure('cleanup-failed', paths, classified.tests, sourceIdentities);
    }
  }
  if (result!.classification === 'infrastructure-failure') return result!;
  try {
    await deps.writeCache?.(key, result!);
    return result!;
  } catch {
    return failure('cache-write-failed', paths, classified.tests, sourceIdentities);
  }
}
