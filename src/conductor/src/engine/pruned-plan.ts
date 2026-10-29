import type { GitRunner } from './rebase.js';
import { featureManifestPath, parseFeatureManifest } from './feature-manifest.js';

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

  const deletingCommit = await deletingCommitFor(git, commit, planPath);
  if (typeof deletingCommit !== 'string') return refused(planPath, deletingCommit.error);
  if (!deletingCommit) return readManifestPlanOrRefuse(readAt, git, commit, planPath);
  let parentPlan: Buffer | null;
  try { parentPlan = await readAt(`${deletingCommit}^`, planPath); } catch (error) { return refused(planPath, errorMessage(error)); }
  return parentPlan ?? refused(planPath, `deleting commit ${deletingCommit} has no parent plan`);
}

async function readManifestPlanOrRefuse(
  readAt: PlanAtCommitReader,
  git: GitRunner,
  commit: string,
  planPath: string,
): Promise<Buffer | PrunedPlanRefusal> {
  const slug = legacyPlanSlug(planPath);
  if (!slug) return refused(planPath, 'no reachable deleting commit');

  const manifestPath = featureManifestPath(slug);
  const deletingCommit = await deletingCommitFor(git, commit, manifestPath);
  if (typeof deletingCommit !== 'string') return refused(planPath, deletingCommit.error);
  if (!deletingCommit) return refused(planPath, 'no reachable deleting commit');

  let rawManifest: Buffer | null;
  try { rawManifest = await readAt(`${deletingCommit}^`, manifestPath); } catch (error) { return refused(planPath, errorMessage(error)); }
  if (rawManifest === null) return refused(planPath, `deleting commit ${deletingCommit} has no parent manifest`);

  const parsed = parseFeatureManifest(rawManifest.toString('utf8'), manifestPath, slug);
  if (parsed.kind === 'malformed') return refused(planPath, parsed.reason);
  const manifestPlanPath = parsed.manifest.artifacts.find((entry) => entry.kind === 'plan')?.path;
  if (!manifestPlanPath) return refused(planPath, `deleting manifest ${manifestPath} has no plan entry`);

  try {
    const manifestPlan = await readAt(`${deletingCommit}^`, manifestPlanPath);
    return manifestPlan ?? refused(planPath, `deleting commit ${deletingCommit} has no parent plan`);
  } catch (error) {
    return refused(planPath, errorMessage(error));
  }
}

async function deletingCommitFor(
  git: GitRunner,
  commit: string,
  path: string,
): Promise<string | { error: string }> {
  let deletion;
  try {
    deletion = await git(['log', '-1', '--diff-filter=D', '--format=%H', commit, '--', path]);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  if (deletion.exitCode !== 0) return { error: deletion.stderr || 'deletion history read failed' };
  return deletion.stdout.trim();
}

function legacyPlanSlug(planPath: string): string | undefined {
  if (!planPath.startsWith('.docs/plans/') || !planPath.endsWith('.md')) return undefined;
  const slug = planPath.slice('.docs/plans/'.length, -'.md'.length);
  return slug.includes('/') || !slug ? undefined : slug;
}

function refused(path: string, detail: string): PrunedPlanRefusal {
  return { kind: 'refused', code: 'shipment-plan-pruned', path, detail };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
