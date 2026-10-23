import type { GitRunner } from './rebase.js';

export interface PrunedPlanRefusal {
  kind: 'refused';
  code: 'shipment-plan-pruned';
  path: string;
  detail: string;
}

export type PlanAtCommitReader = (commit: string, path: string) => Promise<Buffer | null>;

export async function readPlanOrPruned(
  readAt: PlanAtCommitReader,
  git: GitRunner,
  commit: string,
  planPath: string,
): Promise<Buffer | PrunedPlanRefusal> {
  let plan: Buffer | null;
  try { plan = await readAt(commit, planPath); } catch (error) { return refused(planPath, errorMessage(error)); }
  if (plan !== null) return plan;

  let deletion;
  try {
    deletion = await git(['log', '-1', '--diff-filter=D', '--format=%H', commit, '--', planPath]);
  } catch (error) {
    return refused(planPath, errorMessage(error));
  }
  if (deletion.exitCode !== 0) return refused(planPath, deletion.stderr || 'deletion history read failed');

  const deletingCommit = deletion.stdout.trim();
  if (!deletingCommit) return refused(planPath, 'no reachable deleting commit');
  let parentPlan: Buffer | null;
  try { parentPlan = await readAt(`${deletingCommit}^`, planPath); } catch (error) { return refused(planPath, errorMessage(error)); }
  return parentPlan ?? refused(planPath, `deleting commit ${deletingCommit} has no parent plan`);
}

function refused(path: string, detail: string): PrunedPlanRefusal {
  return { kind: 'refused', code: 'shipment-plan-pruned', path, detail };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
