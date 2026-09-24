import { access, readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { parseArchitectureObligationMappings } from './architecture-obligation-coverage.js';
import { resolveFeaturePlanPath } from './artifacts.js';
import { resolvePlanStoriesPath } from './plan-stories-reference.js';
import {
  changedPathsSinceMergeBase,
  makeGitRunner,
  originDefaultBranch,
} from './rebase.js';

export interface CoverageBindingDecideSet {
  /** Repository-relative path of the resolved plan. */
  readonly planPath: string;
  /** Repository-relative path named by the plan's `Stories` reference. */
  readonly storiesPath: string | null;
  /** Feature-matched architecture review, when one exists. */
  readonly architectureReviewPath?: string;
  /** Same-stem PRD, when one exists. */
  readonly prdPath?: string;
  /** ADR paths drawn from obligation citations and the feature branch diff. */
  readonly adrPaths: ReadonlySet<string>;
  /** The complete DECIDE path set, expressed relative to the project root. */
  readonly paths: ReadonlySet<string>;
}

const ADR_PATH = /^\.docs\/decisions\/adr-[^/]+\.md$/;
const ADR_CITATION = /^(adr-[^#]+)#D\d+$/i;

function repoPath(projectRoot: string, absolutePath: string): string {
  return relative(projectRoot, absolutePath).replaceAll('\\', '/');
}

async function exists(projectRoot: string, path: string): Promise<boolean> {
  try {
    await access(join(projectRoot, path));
    return true;
  } catch {
    return false;
  }
}

async function resolveArchitectureReview(projectRoot: string, stem: string): Promise<string | undefined> {
  try {
    const candidates = (await readdir(join(projectRoot, '.docs', 'decisions')))
      .filter((name) => name.startsWith('architecture-review-') && name.endsWith(`-${stem}.md`))
      .sort();
    return candidates[0] ? `.docs/decisions/${candidates[0]}` : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the feature-owned DECIDE inputs used by coverage binding.
 *
 * A missing plan is an absent set; optional PRD and architecture-review inputs
 * simply do not participate. Cited ADRs remain in the set even when missing so
 * their reader can report the actual infrastructure failure rather than hiding it.
 */
export async function resolveCoverageBindingDecideSet(
  projectRoot: string,
  featureDesc: string | undefined,
): Promise<CoverageBindingDecideSet | undefined> {
  const resolvedPlan = await resolveFeaturePlanPath(projectRoot, featureDesc);
  if (!resolvedPlan) return undefined;

  const planPath = repoPath(projectRoot, resolvedPlan);
  let planText: string;
  try {
    planText = await readFile(resolvedPlan, 'utf8');
  } catch {
    return undefined;
  }

  const stem = basename(planPath, '.md');
  const storiesPath = resolvePlanStoriesPath(planPath, planText);
  const [architectureReviewPath, prdPresent] = await Promise.all([
    resolveArchitectureReview(projectRoot, stem),
    exists(projectRoot, `.docs/specs/${stem}.md`),
  ]);
  const prdPath = prdPresent ? `.docs/specs/${stem}.md` : undefined;
  const adrPaths = new Set<string>();

  for (const { decisionId } of parseArchitectureObligationMappings(planText).mappings) {
    const citation = decisionId.match(ADR_CITATION);
    if (citation) adrPaths.add(`.docs/decisions/${citation[1]}.md`);
  }

  const git = makeGitRunner(projectRoot);
  const baseBranch = (await originDefaultBranch(git)) ?? 'main';
  const changedPaths = await changedPathsSinceMergeBase(git, baseBranch, 'HEAD');
  for (const path of changedPaths ?? []) {
    if (ADR_PATH.test(path) && await exists(projectRoot, path)) adrPaths.add(path);
  }

  const paths = new Set<string>([planPath, ...adrPaths]);
  if (storiesPath) paths.add(storiesPath);
  if (architectureReviewPath) paths.add(architectureReviewPath);
  if (prdPath) paths.add(prdPath);

  return { planPath, storiesPath, architectureReviewPath, prdPath, adrPaths, paths };
}
