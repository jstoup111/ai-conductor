import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export interface TautologyPathClassification {
  /** Executable changed tests: kept at HEAD and passed to the scoped command. */
  readonly tests: readonly string[];
  /** Changed test fixtures, helpers, and runners: kept at HEAD, never selectors. */
  readonly testSupport: readonly string[];
  /** Changed runtime paths: restored to their merge-base form. */
  readonly production: readonly string[];
}

export interface RemovalMaintenanceSelectorEvidence {
  readonly selector: string;
  readonly removals: readonly string[];
}

/**
 * A selector list is deliberately accompanied by the exact removal evidence
 * that made each selector eligible.  The array remains usable as a scoped
 * command selector list while the evidence travels into persisted preflight
 * output for the Tautology projection.
 */
export type RemovalMaintenanceSelectors = readonly string[] & {
  readonly eligibleSelectorRemovals: readonly RemovalMaintenanceSelectorEvidence[];
};

export type TautologyScopedRunResult =
  | { readonly exitCode: 0; readonly stdout: string; readonly stderr: string }
  /** A changed test executed and an assertion failed under the reverted production bytes. */
  | { readonly kind: 'test-failure'; readonly exitCode: number; readonly stdout: string; readonly stderr: string }
  /** The selector matched no executable test; it is not counterfactual RED evidence. */
  | { readonly kind: 'no-tests'; readonly exitCode: number; readonly stdout: string; readonly stderr: string }
  /** Test discovery or collection failed before an assertion could run. */
  | { readonly kind: 'collection-failure'; readonly exitCode: number; readonly stdout: string; readonly stderr: string }
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
  /** Removes an added path from the disposable HEAD checkout. */
  readonly removeFile?: (path: string) => Promise<void>;
  /** Executes precisely the supplied changed-test selectors; never an aggregate fallback. */
  readonly runScoped: (cwd: string, selectors: readonly string[], signal: AbortSignal) => Promise<TautologyScopedRunResult>;
  /** Removes the disposable checkout on every outcome. */
  readonly removeCheckout: (path: string) => Promise<void>;
  /** Bounded exact-input cache seam. Infrastructure outcomes are never written. */
  readonly readCache?: (key: string) => Promise<TautologyCompletedPreflight | undefined>;
  readonly writeCache?: (key: string, evidence: TautologyCompletedPreflight) => Promise<void>;
  readonly approvedException?: 'empty-test-set' | 'removal-maintenance';
  /** Changed test selectors individually eligible for removal-maintenance. */
  readonly removalMaintenanceSelectors?: RemovalMaintenanceSelectors;
  /** Exact scoped-command template used for the counterfactual. */
  readonly scopedCommand?: string | null;
  /** Identity of the CURRENT aggregate green proof this preflight relies on. */
  readonly currentGreenProofIdentity?: string | null;
  /** Cancels the isolated command only; the disposable checkout is still cleaned up. */
  readonly abortSignal?: AbortSignal;
}

/**
 * By-reference identity of one changed production file whose merge-base form
 * was materialized into the counterfactual checkout. Content never travels in
 * this structure: a grader recovers it with `git show <mergeBase>:<path>`.
 */
export interface RevertedProductionFileReference {
  readonly path: string;
  /** Git blob identity of the merge-base form (`git rev-parse <mergeBase>:<path>`). */
  readonly mergeBaseBlobSha: string;
}

/**
 * The engine-derived, exit-code-based verdict of the reverted-tree scoped
 * run. Every field is bounded by construction: fixed-size scalars, the
 * selector list actually executed, and a capped head+tail output excerpt.
 * Raw stdout/stderr never travel wholesale.
 */
export interface TautologyScopedRunEvidence {
  readonly exitCode: number;
  /** Portable across any runner: derived from exit code and closed run kinds. */
  readonly runKind: 'passed' | 'test-failure' | 'collection-failure';
  /** The counterfactual selectors the scoped command actually executed. */
  readonly ranSelectors: readonly string[];
  /**
   * Bounded head+tail excerpt of the combined stdout/stderr, present only for
   * failed runs so the grader can tell an assertion failure from infra flavor.
   * Empty on green runs. Capped at TAUTOLOGY_EXCERPT_CAP_BYTES with an
   * explicit `[...truncated N bytes...]` marker.
   */
  readonly failureExcerpt: string;
}

export interface TautologyCompletedPreflight {
      readonly classification: 'red' | 'stayed-green' | 'approved-exception';
      readonly exception?: 'empty-test-set' | 'removal-maintenance';
      readonly cacheable: true;
      readonly cacheProvenance: 'hit' | 'miss';
      readonly changedPaths: readonly string[];
      readonly changedTestSelectors: readonly string[];
      /** Content-free manifest of the reverted production files. */
      readonly revertedProductionManifest: readonly RevertedProductionFileReference[];
      /** Exact per-selector removal evidence used to exclude a changed test. */
      readonly eligibleSelectorRemovals?: readonly RemovalMaintenanceSelectorEvidence[];
      readonly sourceIdentities: { readonly mergeBase: string; readonly headSha: string };
      /** Absent when no counterfactual command ran (approved exceptions). */
      readonly scopedRun?: TautologyScopedRunEvidence;
}

export type TautologyPreflightResult = TautologyCompletedPreflight | {
      readonly classification: 'infrastructure-failure';
      readonly reason: 'no-changed-tests' | 'no-production-changes' | 'missing-scoped-configuration' | 'materialization-failed' | 'missing-merge-base-file' | 'scoped-run-failed' | 'scoped-run-launch-failed' | 'scoped-run-timeout' | 'scoped-run-signaled' | 'scoped-run-no-tests' | 'scoped-run-collection-failed' | 'aborted' | 'cleanup-failed' | 'cache-read-failed' | 'cache-write-failed';
      readonly changedPaths: readonly string[];
      readonly changedTestSelectors: readonly string[];
      readonly sourceIdentities: { readonly mergeBase: string; readonly headSha: string };
    };

/** Total byte cap for a scoped-run failure excerpt (head+tail combined). */
export const TAUTOLOGY_EXCERPT_CAP_BYTES = 16_384;
/** Reserved for the truncation marker so the excerpt never exceeds the cap. */
const EXCERPT_MARKER_RESERVE_BYTES = 64;

/**
 * Bound raw runner output by byte position only — never by parsing runner
 * structure — so the excerpt stays stack-agnostic across pytest/jest/go test/
 * anything. Over-cap input keeps its head and tail with an explicit
 * `[...truncated N bytes...]` marker in between; the result never exceeds
 * `capBytes`.
 */
export function boundedHeadTailExcerpt(text: string, capBytes = TAUTOLOGY_EXCERPT_CAP_BYTES): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.byteLength <= capBytes) return text;
  const half = Math.max(0, Math.floor((capBytes - EXCERPT_MARKER_RESERVE_BYTES) / 2));
  const truncated = bytes.byteLength - half * 2;
  const head = bytes.subarray(0, half).toString('utf8');
  const tail = bytes.subarray(bytes.byteLength - half).toString('utf8');
  return `${head}\n[...truncated ${truncated} bytes...]\n${tail}`;
}

/** Git blob identity of `content` — identical to `git hash-object` output. */
function gitBlobSha(content: string): string {
  return createHash('sha1')
    .update(`blob ${Buffer.byteLength(content, 'utf8')}\0`)
    .update(content, 'utf8')
    .digest('hex');
}

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

function addedPaths(diff: string): ReadonlySet<string> {
  const added = new Set<string>();
  const chunks = diff.split(/^diff --git /m);
  for (const chunk of chunks) {
    const header = /^a\/(.+) b\/(.+)$/m.exec(chunk);
    if (header && /^new file mode /m.test(chunk)) added.add(header[2]!);
  }
  return added;
}

function isTestPath(path: string): boolean {
  return /(?:^|\/)(?:__tests__|tests?|spec)\/.*\.(?:test|spec)\.[^/]+$|\.(?:test|spec)\.[^/]+$/i.test(path)
    || /(?:^|\/)(?:__tests__|tests?|spec)\/.*(?:_test|_spec)\.[^/]+$/i.test(path);
}

function isTestSupportPath(path: string): boolean {
  return /(?:^|\/)(?:__tests__|tests?|spec)(?:\/|$)/i.test(path);
}

/** Closed three-way classifier; unknown paths are production, never a broad test selector. */
export function classifyTautologyPaths(paths: readonly string[]): TautologyPathClassification {
  return {
    tests: paths.filter(isTestPath).sort(),
    testSupport: paths.filter((path) => !isTestPath(path) && isTestSupportPath(path)).sort(),
    production: paths.filter((path) => !isTestPath(path) && !isTestSupportPath(path)).sort(),
  };
}

/**
 * Select only changed tests that name an engine-derived removal.  This is a
 * deliberately conservative mechanical prefilter: the rubric still checks
 * the closed three-part removal-maintenance contract, but unrelated changed
 * tests never inherit an exception merely because the same diff removes an
 * API surface.
 */
export function deriveRemovalMaintenanceSelectors(
  diff: string,
  selectors: readonly string[],
  removalContext: {
    readonly deletedFiles: readonly string[];
    readonly removedDeclarations: readonly string[];
    readonly removedMembers: readonly { readonly declaration: string; readonly member: string }[];
  },
): RemovalMaintenanceSelectors {
  const terms = [
    ...removalContext.deletedFiles,
    ...removalContext.removedDeclarations,
    ...removalContext.removedMembers.flatMap(({ declaration, member }) => [declaration, member]),
  ].filter((term) => term.length > 0);
  if (terms.length === 0) return withRemovalEvidence([]);
  const chunks = diff.split(/^diff --git /m);
  const evidence = selectors.flatMap((selector) => {
    const chunk = chunks.find((candidate) => candidate.startsWith(`a/${selector} b/${selector}`));
    if (chunk === undefined) return [];
    const removals = terms.filter((term) => chunk.includes(term)).sort();
    if (removals.length === 0) return [];
    // A removal term in a test is not enough: any added assertion that does
    // not name a removed surface is a surviving-behavior assertion and must
    // remain in the counterfactual.
    const addedAssertions = chunk.split('\n').filter((line) =>
      /^\+(?!\+\+)/.test(line) && /\b(?:expect|assert|should)\b/.test(line),
    );
    if (addedAssertions.some((line) => !removals.some((term) => line.includes(term)))) return [];
    return [{ selector, removals }];
  }).sort((left, right) => left.selector.localeCompare(right.selector));
  return withRemovalEvidence(evidence);
}

function withRemovalEvidence(evidence: readonly RemovalMaintenanceSelectorEvidence[]): RemovalMaintenanceSelectors {
  const selectors = evidence.map(({ selector }) => selector);
  Object.defineProperty(selectors, 'eligibleSelectorRemovals', { value: Object.freeze(evidence), enumerable: false });
  return Object.freeze(selectors) as RemovalMaintenanceSelectors;
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
    eligibleSelectorRemovals: deps.removalMaintenanceSelectors?.eligibleSelectorRemovals ?? [],
    scopedCommand: deps.scopedCommand ?? null,
    currentGreenProofIdentity: deps.currentGreenProofIdentity ?? null,
  })).digest('hex')}`;
}

function aborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function scopedRunFailure(
  execution: Exclude<TautologyScopedRunResult, { readonly exitCode: 0 }>,
): Extract<TautologyPreflightResult, { classification: 'infrastructure-failure' }>['reason'] {
  switch (execution.kind) {
    case 'launch-error': return 'scoped-run-launch-failed';
    case 'timeout': return 'scoped-run-timeout';
    case 'signal': return 'scoped-run-signaled';
    case 'no-tests': return 'scoped-run-no-tests';
    case 'collection-failure': return 'scoped-run-collection-failed';
    case 'test-failure': return 'scoped-run-failed';
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
  const added = addedPaths(deps.diff);
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
  const eligibleSelectorRemovals = deps.removalMaintenanceSelectors?.eligibleSelectorRemovals ?? [];
  const eligibleRemovalSelectors = new Set(eligibleSelectorRemovals.map(({ selector }) => selector));
  if (classified.tests.length === 0) return failure('no-changed-tests', paths, classified.tests, sourceIdentities);
  const counterfactualSelectors = deps.approvedException === 'removal-maintenance'
    ? classified.tests.filter((selector) => !eligibleRemovalSelectors.has(selector))
    : classified.tests;
  if (deps.approvedException === 'empty-test-set' && classified.tests.length === 0) {
    const completed: TautologyCompletedPreflight = {
      classification: 'approved-exception', exception: deps.approvedException, cacheable: true, cacheProvenance: 'miss',
      changedPaths: paths, changedTestSelectors: classified.tests, revertedProductionManifest: [], eligibleSelectorRemovals, sourceIdentities,
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
      changedPaths: paths, changedTestSelectors: classified.tests, revertedProductionManifest: [], eligibleSelectorRemovals, sourceIdentities,
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
    // Merge-base bytes are needed only transiently, one file at a time, to
    // materialize the reverted checkout. Only the content-free manifest — path
    // plus git blob identity — survives into the completed preflight.
    const manifest: RevertedProductionFileReference[] = [];
    for (const path of result ? [] : classified.production) {
      const mergeBaseContent = await deps.readMergeBaseFile(path);
      if (aborted(signal)) {
        result = failure('aborted', paths, classified.tests, sourceIdentities);
        break;
      }
      if (mergeBaseContent === undefined) {
        if (!added.has(path)) {
          result = failure('missing-merge-base-file', paths, classified.tests, sourceIdentities);
          break;
        }
        await (deps.removeFile ?? ((target) => rm(target, { force: true })))(join(checkout, path));
        continue;
      }
      manifest.push({ path, mergeBaseBlobSha: gitBlobSha(mergeBaseContent) });
      await deps.writeFile(join(checkout, path), mergeBaseContent);
      if (aborted(signal)) {
        result = failure('aborted', paths, classified.tests, sourceIdentities);
        break;
      }
    }
    if (!result) {
      try {
        const execution = await deps.runScoped(checkout, counterfactualSelectors, signal);
        // A collection failure on the REVERTED tree is a valid counterfactual,
        // not infrastructure: the preflight's precondition is a current-HEAD
        // green proof, so changed tests that cannot even load once the diff's
        // production is reverted (unresolvable imports of added modules) have
        // demonstrably failed without the diff. Launch/timeout/signal/no-tests
        // remain infrastructure — they say nothing about the counterfactual.
        if ('kind' in execution && execution.kind !== 'test-failure' && execution.kind !== 'collection-failure') result = failure(scopedRunFailure(execution), paths, classified.tests, sourceIdentities);
        else if (aborted(signal)) result = failure('aborted', paths, classified.tests, sourceIdentities);
        else {
          result = {
            classification: execution.exitCode === 0 ? 'stayed-green' : 'red',
            cacheable: true,
            cacheProvenance: 'miss',
            changedPaths: paths,
            changedTestSelectors: classified.tests,
            revertedProductionManifest: manifest,
            eligibleSelectorRemovals,
            sourceIdentities,
            scopedRun: {
              exitCode: execution.exitCode,
              runKind: 'kind' in execution ? execution.kind : 'passed',
              ranSelectors: counterfactualSelectors,
              failureExcerpt: execution.exitCode === 0
                ? ''
                : boundedHeadTailExcerpt([execution.stdout, execution.stderr].filter((chunk) => chunk.length > 0).join('\n')),
            },
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
