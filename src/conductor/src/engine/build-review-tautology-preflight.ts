import { join } from 'node:path';

export interface TautologyPathClassification {
  readonly tests: readonly string[];
  readonly production: readonly string[];
}

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
  readonly runScoped: (cwd: string, selectors: readonly string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  /** Removes the disposable checkout on every outcome. */
  readonly removeCheckout: (path: string) => Promise<void>;
}

export type TautologyPreflightResult =
  | {
      readonly classification: 'red' | 'stayed-green';
      readonly changedPaths: readonly string[];
      readonly changedTestSelectors: readonly string[];
      readonly revertedProductionPatch: readonly { path: string; mergeBaseContent: string }[];
      readonly sourceIdentities: { readonly mergeBase: string; readonly headSha: string };
      readonly output: { readonly stdout: string; readonly stderr: string };
    }
  | {
      readonly classification: 'infrastructure-failure';
      readonly reason: 'no-changed-tests' | 'no-production-changes' | 'materialization-failed' | 'missing-merge-base-file' | 'scoped-run-failed' | 'cleanup-failed';
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
  if (classified.tests.length === 0) return failure('no-changed-tests', paths, classified.tests, sourceIdentities);
  if (classified.production.length === 0) return failure('no-production-changes', paths, classified.tests, sourceIdentities);

  const checkout = join(deps.scopedWorkingDirectory, '.pipeline', 'build-review-preflight', deps.headSha);
  let result: TautologyPreflightResult | undefined;
  try {
    await deps.createCheckout(checkout, deps.headSha);
    const patch: Array<{ path: string; mergeBaseContent: string }> = [];
    for (const path of classified.production) {
      const mergeBaseContent = await deps.readMergeBaseFile(path);
      if (mergeBaseContent === undefined) {
        result = failure('missing-merge-base-file', paths, classified.tests, sourceIdentities);
        break;
      }
      patch.push({ path, mergeBaseContent });
      await deps.writeFile(join(checkout, path), mergeBaseContent);
    }
    if (!result) {
      try {
        const execution = await deps.runScoped(checkout, classified.tests);
        result = {
          classification: execution.exitCode === 0 ? 'stayed-green' : 'red',
          changedPaths: paths,
          changedTestSelectors: classified.tests,
          revertedProductionPatch: patch,
          sourceIdentities,
          output: { stdout: execution.stdout, stderr: execution.stderr },
        };
      } catch {
        result = failure('scoped-run-failed', paths, classified.tests, sourceIdentities);
      }
    }
  } catch {
    result = failure('materialization-failed', paths, classified.tests, sourceIdentities);
  }

  try {
    await deps.removeCheckout(checkout);
  } catch {
    return failure('cleanup-failed', paths, classified.tests, sourceIdentities);
  }
  return result!;
}
