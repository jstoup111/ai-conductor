import {
  gitTreeSource,
  listBacklogCandidates,
  resolveCandidateStories,
} from './daemon-backlog.js';
import { isProcessed, resolveDaemonBase } from './daemon-deps.js';
import { DONE_MARKER } from './daemon-dashboard.js';
import { HALT_MARKER } from './halt-marker.js';
import { readPlanStoriesReferenceText } from './plan-stories-reference.js';
import { isOperatorParked, resolveMainRepoRootStrict } from './park-marker.js';
import { makeGitRunner, originDefaultBranch } from './rebase.js';
import { listShippedRecords } from './shipped-record.js';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

export type StoriesRefState = 'processed' | 'shipped' | 'parked' | 'halted' | 'actionable';

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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function classifyStoriesRefState(
  root: string,
  slug: string,
  shippedStems: ReadonlySet<string>,
): Promise<StoriesRefState> {
  if (await isProcessed(root, slug)) return 'processed';
  if (shippedStems.has(slug)) return 'shipped';
  if (await isOperatorParked(root, slug)) return 'parked';

  const worktree = join(root, '.worktrees', slug);
  if (
    await pathExists(join(worktree, HALT_MARKER)) &&
    !await pathExists(join(worktree, DONE_MARKER))
  ) return 'halted';

  return 'actionable';
}

export async function scanStoriesRefs(repoPath: string): Promise<StoriesRefsScan> {
  const root = await resolveMainRepoRootStrict(repoPath);
  if (root === null) return { kind: 'failed', reason: 'not inside a Git repository' };

  const defaultBranch = await originDefaultBranch(makeGitRunner(root)) ?? 'main';
  const base = await resolveDaemonBase(root, defaultBranch);
  if (base === undefined) {
    return { kind: 'failed', reason: `could not resolve base ${defaultBranch}` };
  }

  try {
    const tree = gitTreeSource(root, base.sha);
    const candidates = await listBacklogCandidates(tree);
    const shippedStems = new Set((await listShippedRecords(tree)).map(({ stem }) => stem));
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
          state: await classifyStoriesRefState(root, candidate.slug, shippedStems),
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
          state: await classifyStoriesRefState(root, candidate.slug, shippedStems),
        });
        continue;
      }

      broken.push({
        slug: candidate.slug,
        plan: candidate.planFile === undefined ? null : `.docs/plans/${candidate.planFile}`,
        reference: `manifest ${resolution.manifestPath}: ${resolution.message}`,
        attempted: [],
        kind: 'malformed-manifest',
        state: await classifyStoriesRefState(root, candidate.slug, shippedStems),
      });
    }

    return { kind: 'ok', baseRef: base.ref, baseSha: base.sha, specCount: candidates.length, broken };
  } catch (error) {
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

export function renderStoriesRefsReport(scan: StoriesRefsScan): string[] {
  if (scan.kind === 'failed') return [];
  const lines = [`stories-refs: scanned ${scan.specCount} specs at ${scan.baseRef} (${scan.baseSha.slice(0, 9)})`];
  lines.push(...scan.broken.map((finding) => {
    const plan = finding.plan ?? '(unresolved plan)';
    const reference = finding.reference ?? '(no Stories line; same-stem fallback)';
    const attempted = finding.attempted.length === 0 ? 'none' : finding.attempted.join(', ');
    return `  • ${plan} — ${finding.state} — ${finding.kind} — reference: ${reference} — attempted: ${attempted}`;
  }));
  if (scan.broken.length === 0) return lines;

  const counts = Object.fromEntries(
    (['actionable', 'halted', 'parked', 'shipped', 'processed'] as const).map((state) => [
      state,
      scan.broken.filter((finding) => finding.state === state).length,
    ]),
  ) as Record<StoriesRefState, number>;
  lines.push(
    `stories-refs: ${scan.broken.length} broken (actionable ${counts.actionable}, halted ${counts.halted}, parked ${counts.parked}, shipped ${counts.shipped}, processed ${counts.processed})`,
  );
  return lines;
}
