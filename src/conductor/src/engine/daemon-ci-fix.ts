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
import type { TrackerClient } from './tracker-client.js';
import type { ResolveWorktreeLiveness } from './autoresolve.js';
import type { CiRepairDiagnosticReason, CiRepairDiagnosticStage } from '../types/events.js';
import type { ConductorEvent } from '../types/events.js';

export type CiFixDiagnostic = (input: {
  entry: WatchEntry;
  stage: CiRepairDiagnosticStage;
  reason: CiRepairDiagnosticReason;
  provider?: string;
}) => void | Promise<void>;

export interface DaemonCiFixDispatchDeps {
  tracker: TrackerClient;
  createDispatcher: (entry: WatchEntry) => CiFixDispatcher;
  liveness?: ResolveWorktreeLiveness;
  log?: (message: string) => void;
  diagnostic?: CiFixDiagnostic;
  run?: typeof runCiFix;
  fixRunner?: CiFixRunner;
}

/** Keep factory diagnostics in the same closed vocabulary as root-bus events. */
function diagnosticReason(reason: string): CiRepairDiagnosticReason {
  if (reason === 'empty-failure-context') return 'missing-context';
  if (reason === 'read-failure' || reason === 'branch-lookup-failed') return 'api';
  if (reason === 'missing-branch') return 'missing-branch';
  if (reason === 'malformed-context') return 'malformed-context';
  if (reason === 'log-unavailable') return 'log-unavailable';
  if (reason === 'context-truncated') return 'context-truncated';
  return 'unknown';
}

/** Classify selected-state read failures using the root-event vocabulary. */
export function classifyCiContextFailure(state: PrMergeState): CiRepairDiagnosticReason {
  const error = state.readFailure && 'error' in state.readFailure ? state.readFailure.error : undefined;
  const text = error instanceof Error ? `${error.message} ${(error as { stderr?: unknown }).stderr ?? ''}`.toLowerCase() : '';
  if (state.contextFailure) return 'malformed-context';
  if (state.readFailure?.kind === 'capability') return 'capability';
  if (/auth|401|unauthor/.test(text)) return 'auth';
  if (/permission|forbidden|403/.test(text)) return 'permission';
  if (/timeout|timed out/.test(text)) return 'timeout';
  return 'api';
}

/** The only pre-dispatch diagnostic that represents degraded, usable context. */
export function ciRepairPreDispatchDisposition(stage: CiRepairDiagnosticStage): 'degraded' | 'deferred' {
  return stage === 'log-enrichment' ? 'degraded' : 'deferred';
}

/** Translate final CI-fix outcomes into the root-bus diagnostic contract. */
export function ciRepairOutcomeDiagnostic(
  entry: WatchEntry,
  outcome: Extract<CiFixOutcome, { kind: 'failed' | 'published' }>,
): Extract<ConductorEvent, { type: 'ci_repair_diagnostic' }> {
  const stage: CiRepairDiagnosticStage = outcome.kind === 'published'
    ? 'publication'
    : outcome.stage === 'guard'
      ? 'guard'
      : outcome.stage === 'verification'
        ? 'verification'
        : outcome.stage === 'publication'
          ? 'publication'
          : 'execution';
  const reason: CiRepairDiagnosticReason = outcome.kind === 'published'
    ? 'verified-publication'
    : outcome.stage === 'guard'
      ? 'guard-refused'
      : outcome.stage === 'verification'
        ? 'verification-failed'
        : outcome.stage === 'publication'
          ? 'publication-refused'
          : outcome.reason ?? 'unknown';
  return {
    type: 'ci_repair_diagnostic', prUrl: entry.prUrl, slug: entry.slug, stage, reason,
    disposition: outcome.kind === 'published' ? 'published' : 'failed',
    ...(outcome.provider ? { provider: outcome.provider } : {}),
  };
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
      branch = await deps.tracker.getPullRequestHeadRef(entry.prUrl, entry.repoCwd);
    } catch (error) {
      log(`[ci-fix] branch lookup failed for ${entry.prUrl}: ${error instanceof Error ? error.message : String(error)}`);
      await deps.diagnostic?.({ entry, stage: 'branch', reason: 'api' });
      return { kind: 'not-started' };
    }
    if (!branch) {
      await deps.diagnostic?.({ entry, stage: 'branch', reason: 'missing-branch' });
      return { kind: 'not-started' };
    }

    const prepared = buildCiFixHint(state);
    if (prepared.kind !== 'ready') {
      await deps.diagnostic?.({ entry, stage: 'context', reason: diagnosticReason(prepared.reason) });
      return { kind: 'not-started' };
    }
    const enriched = await enrichCiFixHint(prepared.hint, state, deps.tracker, entry.repoCwd);
    for (const reason of enriched.degradations) {
      await deps.diagnostic?.({ entry, stage: 'log-enrichment', reason: diagnosticReason(reason) });
    }
    const outcome = await run(entry, branch, enriched.hint, {
      fixRunner: deps.fixRunner ?? { run: (opts) => productionCiFixRunner.run({ ...opts, dispatcher: deps.createDispatcher(entry) }) },
      liveness: deps.liveness,
    }, log);
    // A provider boundary can affirmatively refuse before a session starts.
    // Keep that distinct from an unobserved/no-op repair: it is a deferred
    // execution diagnostic with the provider chosen by the execution result.
    if (outcome.kind === 'not-started') {
      const readiness = outcome.reason === 'readiness-degraded' || outcome.reason === 'provider-unavailable';
      await deps.diagnostic?.({ entry, stage: readiness ? 'readiness' : 'execution', reason: outcome.reason ?? 'unknown', ...(outcome.provider ? { provider: outcome.provider } : {}) });
    }
    return outcome;
  };
}
