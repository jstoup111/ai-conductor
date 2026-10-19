import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { canonicalTaskId } from './autoheal.js';
import { settleRemediationRound } from './kickback-ledger.js';
import { currentCommitSha, currentTreeHash } from './project-prelude.js';
import { createRepairObligationStore, type RepairObligation } from './repair-obligations.js';
import { countResolvedTasks } from './task-progress.js';
import { seedTaskStatus } from './task-seed.js';
import { parseRoundId, type RoundId } from './routing/route-types.js';

export interface AdmitRoutedObligationInput {
  projectRoot: string;
  planPath: string;
  roundId: RoundId;
  findingId: string;
  taskIds: readonly string[];
  branch: string;
  head: string;
  tree: string;
}

export type AdmitRoutedObligationResult =
  | { kind: 'admitted'; admissionKey: string; obligation: RepairObligation; replayed: boolean }
  | { kind: 'failed'; detail: string };

/**
 * Project the route record's authoritative obligation into engine state.
 *
 * The round-owned key deliberately excludes mutable checkout and plan details,
 * so re-entry after a restack or plan rewrite replays the same obligation.
 */
export async function admitRoutedObligation(
  input: AdmitRoutedObligationInput,
): Promise<AdmitRoutedObligationResult> {
  // This API is normally reached from a parsed route record. Re-parse at the
  // persistence boundary as well so an unsafe caller cannot derive an
  // admission key in an invalid routing namespace.
  const roundId = parseRoundId(input.roundId);
  if (!roundId) return { kind: 'failed', detail: 'routed admission requires a valid round id' };
  const taskIds = [...new Set(input.taskIds.map(canonicalTaskId))].sort();
  const admissionKey = createHash('sha256').update(JSON.stringify({
    roundId,
    findingId: input.findingId,
    taskIds,
  })).digest('hex');
  const repairs = createRepairObligationStore(
    input.projectRoot,
    join(input.projectRoot, '.pipeline', 'engine-state.json'),
  );
  const admission = await repairs.admitOrReplay(admissionKey, {
    id: `routed-${admissionKey.slice(0, 16)}`,
    planPath: input.planPath,
    taskIds,
    source: {
      findingId: input.findingId,
      authority: 'routed_repair',
      instruction: 'Repair the routed finding on its host branch.',
    },
    baseline: {
      branch: input.branch,
      head: input.head,
      tree: input.tree,
      resolvedTaskIds: [],
    },
  });
  if (!admission.ok) return { kind: 'failed', detail: `could not persist routed admission: ${admission.message}` };
  return { kind: 'admitted', admissionKey, obligation: admission.obligation, replayed: admission.replayed };
}

export interface AdmitAndRestageRepairInput {
  projectRoot: string;
  planPath: string;
  taskIds: readonly string[];
  findingIds: readonly string[];
  sourceAuthority: string;
  instruction: string;
  /** Every authority whose remediation lap this admitted effect consumes. */
  gates: readonly string[];
  /** Optional shared per-gate remediation lap cap. */
  lapCap?: number;
}

export type AdmitAndRestageRepairResult =
  | {
    kind: 'restaged';
    obligation: RepairObligation;
    replayed: boolean;
    baseline: { treeHash: string | null; resolvedCount: number };
  }
  | { kind: 'failed'; detail: string; capExceeded?: string };

/**
 * Admit an existing-plan repair and reopen only its bound task rows.
 *
 * The receipt id is the obligation id, so a replay reuses the durable
 * admission and restages the work without charging any source gate twice.
 */
export async function admitAndRestageRepair(
  input: AdmitAndRestageRepairInput,
): Promise<AdmitAndRestageRepairResult> {
  const taskIds = [...new Set(input.taskIds)];
  const findingIds = [...new Set(input.findingIds)].sort();
  const admissionHead = (await currentCommitSha(input.projectRoot)) ?? '';
  const admissionKey = createHash('sha256').update(JSON.stringify({
    planPath: input.planPath,
    source: input.sourceAuthority,
    // Finding ids are part of the durable effect identity: two distinct
    // findings may bind the same task on the same HEAD, but must retain
    // separate admissions and laps.
    findings: findingIds,
    bindings: taskIds.map(canonicalTaskId).sort(),
    head: admissionHead,
  })).digest('hex');
  const baseline = {
    treeHash: await currentTreeHash(input.projectRoot),
    resolvedCount: await countResolvedTasks(input.projectRoot),
  };
  const repairs = createRepairObligationStore(
    input.projectRoot,
    join(input.projectRoot, '.pipeline', 'engine-state.json'),
  );
  const admission = await repairs.admitOrReplay(admissionKey, {
    id: `repair-${admissionKey.slice(0, 16)}`,
    planPath: input.planPath,
    taskIds,
    source: {
      findingId: findingIds.join(','),
      authority: input.sourceAuthority,
      instruction: input.instruction,
    },
    baseline: {
      head: admissionHead,
      tree: baseline.treeHash ?? '',
      resolvedTaskIds: [],
      resolvedCount: baseline.resolvedCount,
    },
  });
  if (!admission.ok) return { kind: 'failed', detail: `could not persist admission: ${admission.message}` };

  // prd_audit and as-built repairs use the obligation as their pending-repair
  // receipt and charge only when BUILD dispatches. Any other gate is charged
  // its restage-time lap here (ADR 2026-09-06 D10).
  // The route label is presentation-facing (`architecture-review-as-built`,
  // or a validation-group label), while `gates` carries the canonical ledger
  // owners.  Classifying by the label charged an as-built repair here and
  // then recorded the same deferred charge below, so BUILD saw an already
  // exhausted lap and never dispatched the reopened task.
  const chargesAtBuild = input.gates.some(
    (gate) => gate === 'prd_audit' || gate === 'architecture_review_as_built',
  );
  if (!chargesAtBuild) {
    try {
      const settlement = await settleRemediationRound(input.projectRoot, admission.obligation.id, input.gates, input.lapCap);
      if (settlement.capExceeded !== undefined) {
        return {
          kind: 'failed',
          capExceeded: settlement.capExceeded,
          detail: `gates.${settlement.capExceeded} has exhausted the remediation lap cap (${input.lapCap})`,
        };
      }
    } catch (error) {
      return {
        kind: 'failed',
        detail:
          `could not settle its admitted round ${admission.obligation.id}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  const settled = await repairs.markSettled({ planPath: input.planPath, obligationId: admission.obligation.id });
  if (!settled.ok) {
    return {
      kind: 'failed',
      detail: `recorded its receipt for ${admission.obligation.id} but could not persist settlement: ${settled.message}`,
    };
  }

  const restage = await restageExistingRemediationTaskStatuses(
    input.projectRoot,
    input.planPath,
    new Set(taskIds),
  );
  if (restage.kind === 'failed') return restage;
  return { kind: 'restaged', obligation: admission.obligation, replayed: admission.replayed, baseline };
}

/** Reopen an already-authored task without admitting or charging a new repair. */
export async function restageExistingRemediationTaskStatuses(
  projectRoot: string,
  planPath: string,
  boundIds: ReadonlySet<string>,
): Promise<{ kind: 'restaged' } | { kind: 'failed'; detail: string }> {
  const statusPath = join(projectRoot, '.pipeline', 'task-status.json');
  try {
    const statusFile = JSON.parse(await readFile(statusPath, 'utf8')) as {
      tasks?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(statusFile.tasks)) {
      return { kind: 'failed', detail: 'could not re-stage task-status.json: task-status.json has no task rows to re-stage' };
    }

    const boundCanonicalIds = new Set([...boundIds].map(canonicalTaskId));
    const stagedCanonicalIds = new Set(statusFile.tasks.flatMap((task) =>
      typeof task.id === 'string' ? [canonicalTaskId(task.id)] : [],
    ));
    const missingIds = [...boundCanonicalIds].filter((id) => !stagedCanonicalIds.has(id));
    if (missingIds.length > 0) {
      return {
        kind: 'failed',
        detail:
          'could not re-stage task-status.json: ' +
          `bound id${missingIds.length === 1 ? '' : 's'} ` +
          `${missingIds.map((id) => `'${id}'`).join(', ')} is absent from task-status.json`,
      };
    }

    for (const task of statusFile.tasks) {
      if (typeof task.id === 'string' && boundCanonicalIds.has(canonicalTaskId(task.id))) {
        task.status = 'pending';
      }
    }
    await writeFile(statusPath, JSON.stringify(statusFile, null, 2) + '\n');
    await seedTaskStatus(projectRoot, planPath);
    return { kind: 'restaged' };
  } catch (error) {
    return {
      kind: 'failed',
      detail:
        'could not re-stage task-status.json: task-status.json could not be read or re-staged ' +
        `(${error instanceof Error ? error.message : String(error)})`,
    };
  }
}
