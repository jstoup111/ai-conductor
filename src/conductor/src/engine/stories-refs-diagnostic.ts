import {
  gitTreeSource,
  listBacklogCandidates,
  resolveCandidateStories,
} from './daemon-backlog.js';
import { resolveDaemonBaseSha } from './daemon-deps.js';
import { readPlanStoriesReferenceText } from './plan-stories-reference.js';
import { resolveMainRepoRootStrict } from './park-marker.js';
import { makeGitRunner, originDefaultBranch } from './rebase.js';

export type StoriesRefState = 'actionable';

export interface BrokenStoriesRef {
  slug: string;
  plan: string | null;
  reference: string | null;
  attempted: readonly string[];
  kind: 'missing' | 'unresolvable' | 'malformed-manifest';
  state: StoriesRefState;
}

export type StoriesRefsScan =
  | {
    kind: 'ok';
    baseRef: string;
    baseSha: string;
    specCount: number;
    broken: BrokenStoriesRef[];
  }
  | { kind: 'failed'; reason: string };

export async function scanStoriesRefs(repoPath: string): Promise<StoriesRefsScan> {
  const root = await resolveMainRepoRootStrict(repoPath);
  if (root === null) return { kind: 'failed', reason: 'not inside a Git repository' };

  const defaultBranch = await originDefaultBranch(makeGitRunner(root)) ?? 'main';
  const baseSha = await resolveDaemonBaseSha(root, defaultBranch);
  if (baseSha === undefined) {
    return { kind: 'failed', reason: `could not resolve base ${defaultBranch}` };
  }

  try {
    const tree = gitTreeSource(root, baseSha);
    const candidates = await listBacklogCandidates(tree);
    const broken: BrokenStoriesRef[] = [];

    for (const candidate of candidates) {
      const resolution = await resolveCandidateStories(tree, candidate);
      if (resolution.kind === 'no-plan' || resolution.kind === 'resolved') continue;

      if (resolution.kind === 'unresolvable') {
        broken.push({
          slug: candidate.slug,
          plan: resolution.planRel,
          reference: readPlanStoriesReferenceText(resolution.planContent),
          attempted: [],
          kind: 'unresolvable',
          state: 'actionable',
        });
        continue;
      }

      if (resolution.kind === 'missing') {
        broken.push({
          slug: candidate.slug,
          plan: resolution.planRel,
          reference: resolution.source === 'plan-line'
            ? readPlanStoriesReferenceText(resolution.planContent)
            : `manifest ${resolution.manifestPath}`,
          attempted: resolution.source === 'plan-line' ? [resolution.path] : resolution.listed,
          kind: 'missing',
          state: 'actionable',
        });
        continue;
      }

      broken.push({
        slug: candidate.slug,
        plan: candidate.planFile === undefined ? null : `.docs/plans/${candidate.planFile}`,
        reference: `manifest ${resolution.manifestPath}: ${resolution.message}`,
        attempted: [],
        kind: 'malformed-manifest',
        state: 'actionable',
      });
    }

    return { kind: 'ok', baseRef: defaultBranch, baseSha, specCount: candidates.length, broken };
  } catch (error) {
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

export function renderStoriesRefsReport(scan: StoriesRefsScan): string[] {
  if (scan.kind === 'failed') return [];
  return scan.broken.map((finding) => {
    const plan = finding.plan ?? '(unresolved plan)';
    const reference = finding.reference ?? '(no Stories line; same-stem fallback)';
    const attempted = finding.attempted.length === 0 ? 'none' : finding.attempted.join(', ');
    return `  • ${plan} — ${finding.state} — ${finding.kind} — reference: ${reference} — attempted: ${attempted}`;
  });
}
