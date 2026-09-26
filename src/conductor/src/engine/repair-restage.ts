import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { canonicalTaskId } from './autoheal.js';
import { settleRemediationRound } from './kickback-ledger.js';
import { currentCommitSha, currentTreeHash } from './project-prelude.js';
import { createRepairObligationStore, type RepairObligation } from './repair-obligations.js';
import { countResolvedTasks } from './task-progress.js';
import { seedTaskStatus } from './task-seed.js';

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
    // A coverage-binding finding id is the claim digest.  It is part of the
    // durable effect identity: two distinct amendments may bind the same
    // task on the same HEAD, but must retain separate admissions and laps.
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

async function restageExistingRemediationTaskStatuses(
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
