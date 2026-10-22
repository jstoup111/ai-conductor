import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitRunner } from './pr-labels.js';
import { prunableFilesForStem } from './docs-retention.js';
import type { PullRequestWithFiles } from './pull-request-files.js';

export interface DocsPruneSelection { removable: string[]; deferred: { stem: string; paths: string[]; reason: 'open-pr-modifies'; pullRequests: string[] }[]; skipped: { stem: string; reason: 'no-shipped-record' }[]; excluded: string[]; stems: Map<string, string[]> }
export class DocsPruneRefusal extends Error {}

export async function resolveDocsPruneSelection(repoDir: string, git: GitRunner): Promise<DocsPruneSelection> {
  await git(['fetch', 'origin', 'main'], { cwd: repoDir });
  const tree = (await git(['ls-tree', '-r', '--name-only', 'origin/main', '--', '.docs'], { cwd: repoDir })).stdout.split('\n').filter(Boolean);
  const shipped = tree.filter((p) => p.startsWith('.docs/shipped/') && p.endsWith('.md')).map((p) => p.slice('.docs/shipped/'.length, -3));
  const plans = new Set(tree.filter((p) => p.startsWith('.docs/plans/')).map((p) => p.slice('.docs/plans/'.length, -3)));
  const stems = new Map<string, string[]>(); const excluded: string[] = [];
  for (const stem of shipped) { const paths = prunableFilesForStem(tree, stem).filter((path) => { const undated = path.match(/^\.docs\/(?:conflicts|coherence|coherence-waivers|track|complexity|halted|plan-review|applicability)\/([^/]+)\.md$/)?.[1]; if (undated && [...plans].filter((s) => s.replace(/^\d{4}-\d{2}-\d{2}-/, '') === undated).length > 1) { excluded.push(path); return false; } return true; }); stems.set(stem, paths); }
  const skipped = [...plans].filter((stem) => !shipped.includes(stem)).map((stem) => ({ stem, reason: 'no-shipped-record' as const }));
  return { removable: [...stems.values()].flat(), deferred: [], skipped, excluded, stems };
}
export function applyOpenPullRequestDeferral(selection: DocsPruneSelection, prs: PullRequestWithFiles[], operatorLogin: string): DocsPruneSelection { const deferred = [...selection.deferred]; const removable = new Set(selection.removable); for (const [stem, paths] of selection.stems) { const hits = prs.filter((pr) => !(pr.author === operatorLogin && pr.headRef.startsWith('docs-prune/')) && pr.changedPaths.some((p) => paths.includes(p))); if (hits.length) { paths.forEach((p) => removable.delete(p)); deferred.push({ stem, paths, reason: 'open-pr-modifies', pullRequests: hits.map((p) => p.url) }); } } return { ...selection, removable: [...removable], deferred }; }
export async function commitDocsPruneDeletion(input: { repoDir: string; startPoint: string; removable: string[]; git: GitRunner }): Promise<string> { const worktree = await mkdtemp(join(tmpdir(), 'docs-prune-')); try { await input.git(['worktree', 'add', '--detach', worktree, input.startPoint], { cwd: input.repoDir }); if (input.removable.length) await input.git(['rm', '--', ...input.removable], { cwd: worktree }); const changes = (await input.git(['diff', '--cached', '--name-status'], { cwd: worktree })).stdout.split('\n').filter(Boolean); const expected = new Set(input.removable); if (changes.some((line) => { const [status, path] = line.split('\t'); return status !== 'D' || !expected.delete(path); }) || expected.size) throw new Error(`docs-prune commit has unexpected staged path: ${changes.join(', ')}`); await input.git(['commit', '-m', 'docs: prune shipped DECIDE artifacts'], { cwd: worktree }); return (await input.git(['rev-parse', 'HEAD'], { cwd: worktree })).stdout.trim(); } finally { await input.git(['worktree', 'remove', '--force', worktree], { cwd: input.repoDir }).catch(() => {}); await rm(worktree, { recursive: true, force: true }); } }
export function renderDocsPruneReport(outcome: Pick<DocsPruneSelection, 'removable' | 'deferred' | 'skipped' | 'excluded'>): string { return ['## Shipped DECIDE artifact prune', '', '### Removed', ...(outcome.removable.length ? outcome.removable.map((p) => `- ${p}`) : ['- None']), '', '### Deferred', ...(outcome.deferred.length ? outcome.deferred.flatMap((d) => [`- ${d.stem}: ${d.reason} (${d.pullRequests.join(', ')})`, ...d.paths.map((p) => `  - ${p}`)]) : ['- None'])].join('\n'); }
export function docsPruneEvent(outcome: Pick<DocsPruneSelection, 'removable' | 'deferred' | 'skipped' | 'excluded'>, pullRequestUrl?: string) { return { type: 'decide_artifacts_pruned' as const, removed: outcome.removable, deferred: outcome.deferred, skipped: outcome.skipped, excluded: outcome.excluded, ...(pullRequestUrl ? { pullRequestUrl } : {}) }; }
