import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitRunner } from './pr-labels.js';
import { DOCS_RETENTION_POLICY, prunableFilesForStem } from './docs-retention.js';
import type { PullRequestWithFiles } from './pull-request-files.js';
import type { GithubOperationRunner } from './github-operations.js';
import { executeGithubOperation } from './github-operations.js';
import { withDaemonCoAuthorTrailer } from './bot-co-author.js';

export interface DocsPruneSelection { removable: string[]; deferred: { stem: string; paths: string[]; reason: 'open-pr-modifies'; pullRequests: string[] }[]; skipped: { stem: string; reason: 'no-shipped-record' }[]; excluded: string[]; stems: Map<string, string[]> }
export class DocsPruneRefusal extends Error {}

export interface DocsPrunePublisher {
  repoDir: string;
  repository: string;
  operatorLogin: string;
  branch: string;
  commit: string;
  outcome: Pick<DocsPruneSelection, 'removable' | 'deferred' | 'skipped' | 'excluded'>;
  openPullRequests: PullRequestWithFiles[];
  /** The push is deliberately injected: callers must use the guarded remote-git boundary. */
  push(branch: string, commit: string): Promise<{ kind: 'executed' | 'refused' | 'failed'; detail?: string }>;
  operations: GithubOperationRunner;
  /** Every remote write needs an exact interactive approval. */
  approve?: (request: Parameters<typeof executeGithubOperation>[0]) => Promise<boolean>;
}

/** Publish only to a docs-prune branch.  It neither merges nor enables auto-merge. */
export async function publishDocsPrune(input: DocsPrunePublisher): Promise<{ pullRequestUrl?: string; branch: string }> {
  const foreign = input.openPullRequests.find((pr) => pr.headRef.startsWith('docs-prune/') && pr.author !== input.operatorLogin);
  if (foreign) throw new DocsPruneRefusal(`docs-prune publication refused: another operator owns ${foreign.url}`);
  const existing = input.openPullRequests.find((pr) => pr.headRef.startsWith('docs-prune/') && pr.author === input.operatorLogin);
  const branch = existing?.headRef || input.branch;
  if (!input.approve || !await input.approve({ operation: 'remote-ref.push', repository: input.repository, resource: { kind: 'remote-ref', ref: `refs/heads/${branch}` }, context: { actor: input.operatorLogin } })) {
    throw new DocsPruneRefusal('docs-prune publication refused: remote-ref.push requires explicit approval');
  }
  const pushed = await input.push(branch, input.commit);
  if (pushed.kind !== 'executed') throw new DocsPruneRefusal(`docs-prune publication refused: push ${pushed.detail ?? pushed.kind}`);
  const body = renderDocsPruneReport(input.outcome);
  if (existing) {
    const request = { operation: 'pull-request.edit' as const, repository: input.repository, resource: { kind: 'pull-request' as const, number: existing.number }, context: { actor: input.operatorLogin }, payload: { body } };
    if (!input.approve || !await input.approve(request)) throw new DocsPruneRefusal('docs-prune publication refused: pull-request.edit requires explicit approval');
    const result = await executeGithubOperation(request, input.operations);
    if (result.kind !== 'executed') throw new DocsPruneRefusal(`docs-prune publication refused: pull-request.edit`);
    return { pullRequestUrl: existing.url, branch };
  }
  const request = { operation: 'pull-request.create' as const, repository: input.repository, resource: { kind: 'repository' as const }, context: { actor: input.operatorLogin }, payload: { title: 'docs: prune shipped DECIDE artifacts', body, head: branch, base: 'main' } };
  if (!input.approve || !await input.approve(request)) throw new DocsPruneRefusal('docs-prune publication refused: pull-request.create requires explicit approval');
  const result = await executeGithubOperation(request, input.operations);
  if (result.kind !== 'executed') throw new DocsPruneRefusal(`docs-prune publication refused: pull-request.create`);
  return { branch, ...(result.url ? { pullRequestUrl: result.url } : {}) };
}

export async function resolveDocsPruneSelection(repoDir: string, git: GitRunner): Promise<DocsPruneSelection> {
  await git(['fetch', 'origin', 'main'], { cwd: repoDir });
  const tree = (await git(['ls-tree', '-r', '--name-only', 'origin/main', '--', '.docs'], { cwd: repoDir })).stdout.split('\n').filter(Boolean);
  const shipped = tree.filter((p) => p.startsWith('.docs/shipped/') && p.endsWith('.md')).map((p) => p.slice('.docs/shipped/'.length, -3));
  const plans = new Set(tree.filter((p) => p.startsWith('.docs/plans/')).map((p) => p.slice('.docs/plans/'.length, -3)));
  const stems = new Map<string, string[]>(); const excluded: string[] = [];
  for (const stem of shipped) { const paths = prunableFilesForStem(tree, stem).filter((path) => { const family = DOCS_RETENTION_POLICY.normalizedStemFamilies.find((candidate) => path.startsWith(`.docs/${candidate}/`)); const undated = family ? path.slice(`.docs/${family}/`.length, -3).replace(/^\d{4}-\d{2}-\d{2}-/, '') : undefined; if (undated && [...plans].filter((s) => s.replace(/^\d{4}-\d{2}-\d{2}-/, '') === undated).length > 1) { excluded.push(path); return false; } return true; }); stems.set(stem, paths); }
  const skipped = [...plans].filter((stem) => !shipped.includes(stem)).map((stem) => ({ stem, reason: 'no-shipped-record' as const }));
  return { removable: [...stems.values()].flat(), deferred: [], skipped, excluded, stems };
}
export function applyOpenPullRequestDeferral(selection: DocsPruneSelection, prs: PullRequestWithFiles[], operatorLogin: string): DocsPruneSelection { const deferred = [...selection.deferred]; const removable = new Set(selection.removable); for (const [stem, paths] of selection.stems) { const hits = prs.filter((pr) => !(pr.author === operatorLogin && pr.headRef.startsWith('docs-prune/')) && pr.changedPaths.some((p) => paths.includes(p))); if (hits.length) { paths.forEach((p) => removable.delete(p)); deferred.push({ stem, paths, reason: 'open-pr-modifies', pullRequests: hits.map((p) => p.url) }); } } return { ...selection, removable: [...removable], deferred }; }
export async function commitDocsPruneDeletion(input: { repoDir: string; startPoint: string; removable: string[]; git: GitRunner }): Promise<string> { const worktree = await mkdtemp(join(tmpdir(), 'docs-prune-')); try { await input.git(['worktree', 'add', '--detach', worktree, input.startPoint], { cwd: input.repoDir }); if (input.removable.length) await input.git(['rm', '--', ...input.removable], { cwd: worktree }); const changes = (await input.git(['diff', '--cached', '--name-status'], { cwd: worktree })).stdout.split('\n').filter(Boolean); const expected = new Set(input.removable); if (changes.some((line) => { const [status, path] = line.split('\t'); return status !== 'D' || !expected.delete(path); }) || expected.size) throw new Error(`docs-prune commit has unexpected staged path: ${changes.join(', ')}`); await input.git(['commit', '-m', withDaemonCoAuthorTrailer('docs: prune shipped DECIDE artifacts')], { cwd: worktree }); return (await input.git(['rev-parse', 'HEAD'], { cwd: worktree })).stdout.trim(); } finally { await input.git(['worktree', 'remove', '--force', worktree], { cwd: input.repoDir }).catch(() => {}); await rm(worktree, { recursive: true, force: true }); } }
export function renderDocsPruneReport(outcome: Pick<DocsPruneSelection, 'removable' | 'deferred' | 'skipped' | 'excluded'>): string { return ['## Shipped DECIDE artifact prune', '', '### Removed', ...(outcome.removable.length ? outcome.removable.map((p) => `- ${p}`) : ['- None']), '', '### Deferred', ...(outcome.deferred.length ? outcome.deferred.flatMap((d) => [`- ${d.stem}: ${d.reason} (${d.pullRequests.join(', ')})`, ...d.paths.map((p) => `  - ${p}`)]) : ['- None'])].join('\n'); }
export function docsPruneEvent(outcome: Pick<DocsPruneSelection, 'removable' | 'deferred' | 'skipped' | 'excluded'>, pullRequestUrl?: string) { return { type: 'decide_artifacts_pruned' as const, removed: outcome.removable, deferred: outcome.deferred, skipped: outcome.skipped, excluded: outcome.excluded, ...(pullRequestUrl ? { pullRequestUrl } : {}) }; }
