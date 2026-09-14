/** Production CI-fix sweep callback, kept injectable for one-tick daemon wiring tests. */
import {
  buildCiFixHint,
  enrichCiFixHint,
  productionCiFixRunner,
  runCiFix,
  type CiFixDispatcher,
  type CiFixOutcome,
  type CiFixRunner,
} from './ci-fix.js';
import type { WatchEntry } from './mergeable-sweep.js';
import type { PrMergeState } from './pr-labels.js';
import type { GhRunner } from './tracker-client.js';
import type { ResolveWorktreeLiveness } from './autoresolve.js';

export type CiFixDiagnostic = (input: {
  entry: WatchEntry;
  stage: 'branch' | 'context' | 'log-enrichment';
  reason: string;
}) => void | Promise<void>;

export interface DaemonCiFixDispatchDeps {
  gh: GhRunner;
  createDispatcher: (entry: WatchEntry) => CiFixDispatcher;
  liveness?: ResolveWorktreeLiveness;
  log?: (message: string) => void;
  diagnostic?: CiFixDiagnostic;
  run?: typeof runCiFix;
  fixRunner?: CiFixRunner;
}

/**
 * Make the exact dispatch callback supplied to `sweepMergeableLabels` by the
 * daemon. Required check context always comes from the sweep snapshot; the
 * only additional GitHub read is the canonical `gh pr view` branch lookup.
 */
export function createDaemonCiFixDispatch(deps: DaemonCiFixDispatchDeps) {
  const run = deps.run ?? runCiFix;
  const log = deps.log ?? (() => {});
  return async (entry: WatchEntry, state: PrMergeState): Promise<CiFixOutcome> => {
    let branch: string;
    try {
      const result = await deps.gh(['pr', 'view', entry.prUrl, '--json', 'headRefName'], { cwd: entry.repoCwd });
      const parsed = JSON.parse(result.stdout) as { headRefName?: unknown };
      branch = typeof parsed.headRefName === 'string' ? parsed.headRefName.trim() : '';
    } catch (error) {
      log(`[ci-fix] branch lookup failed for ${entry.prUrl}: ${error instanceof Error ? error.message : String(error)}`);
      await deps.diagnostic?.({ entry, stage: 'branch', reason: 'branch-lookup-failed' });
      return { kind: 'not-started' };
    }
    if (!branch) {
      await deps.diagnostic?.({ entry, stage: 'branch', reason: 'missing-branch' });
      return { kind: 'not-started' };
    }

    const prepared = buildCiFixHint(state);
    if (prepared.kind !== 'ready') {
      await deps.diagnostic?.({ entry, stage: 'context', reason: prepared.reason });
      return { kind: 'not-started' };
    }
    const enriched = await enrichCiFixHint(prepared.hint, state, deps.gh, entry.repoCwd);
    for (const reason of enriched.degradations) {
      await deps.diagnostic?.({ entry, stage: 'log-enrichment', reason });
    }
    return run(entry, branch, enriched.hint, {
      fixRunner: deps.fixRunner ?? { run: (opts) => productionCiFixRunner.run({ ...opts, dispatcher: deps.createDispatcher(entry) }) },
      liveness: deps.liveness,
    }, log);
  };
}
