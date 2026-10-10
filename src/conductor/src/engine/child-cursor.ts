import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseChildId, type ChildId } from './child-context.js';
import { loadConfig } from './config.js';
import {
  COVERAGE_BINDING_COMPLETION_STATUSES,
  readCoverageBindingEnvelope,
  type CoverageBindingEnvelopeFilesystem,
} from './coverage-binding-envelope.js';
import { childBranchFor, leafBranchFor, parseFeatureRef } from './feature-branch-identity.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import { resolveThroughMap } from './rebase-translate.js';

export type ActiveChildResolution =
  | { kind: 'no-child' }
  | { kind: 'envelope-missing' }
  | { kind: 'detached-head' }
  | { kind: 'git-error' }
  | { kind: 'divergent'; child: ChildId }
  | { kind: 'active'; child: ChildId; position: ChildId; isLeaf: boolean; branch: string; leafMovePending?: boolean };

export interface ActiveChildDependencies {
  readonly git?: GitRunner;
}

const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

function positionsFromEnvelope(
  envelope: Awaited<ReturnType<typeof readCoverageBindingEnvelope>>,
): ChildId[] {
  if (!envelope?.sliceMembership || !COVERAGE_BINDING_COMPLETION_STATUSES.includes(envelope.status)) return [];
  return [...new Set(Object.values(envelope.sliceMembership.taskSlices))]
    .map((position) => parseChildId(position))
    .filter((position): position is ChildId => position !== undefined)
    .sort((left, right) => left - right);
}

type ClosedChild = { child: ChildId; tip: string };

async function runGit(git: GitRunner, args: string[]) {
  try {
    return await git(args);
  } catch {
    return undefined;
  }
}

async function childArtifactsExist(worktree: string, slug: string, git: GitRunner): Promise<boolean | 'git-error'> {
  const refs = await runGit(git, ['for-each-ref', '--format=%(refname)', 'refs/heads/feat']);
  if (!refs || refs.exitCode !== 0) return 'git-error';
  if (refs.stdout.split('\n').some((ref) => {
    const identity = parseFeatureRef(ref.trim());
    return identity.kind === 'child' && identity.slug === slug;
  })) return true;
  const closures = await runGit(git, ['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/closed/`]);
  if (!closures || closures.exitCode !== 0) return 'git-error';
  if (closures.stdout.trim() !== '') return true;
  try {
    return (await readdir(join(worktree, '.pipeline', 'children'))).length > 0;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? false : 'git-error';
  }
}

async function closedChildren(slug: string, positions: readonly ChildId[], git: GitRunner): Promise<ClosedChild[] | 'git-error'> {
  const result = await runGit(git, ['for-each-ref', '--format=%(refname) %(objectname)', `refs/conductor/${slug}/closed/`]);
  if (!result || result.exitCode !== 0) return 'git-error';
  const prefix = `refs/conductor/${slug}/closed/c`;
  const declared = new Set(positions);
  return result.stdout.split('\n').flatMap((line) => {
    const [ref, tip] = line.trim().split(/\s+/, 2);
    const rawChild = ref?.startsWith(prefix) ? ref.slice(prefix.length) : undefined;
    const child = rawChild === undefined ? undefined : parseChildId(rawChild);
    // `c01` is not the canonical ref for child 1 and must not close it.
    return child !== undefined && rawChild === String(child) && declared.has(child) && tip ? [{ child, tip }] : [];
  });
}

async function readRewriteMap(worktree: string): Promise<{ map: Record<string, string>; present: boolean } | 'git-error'> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(worktree, '.pipeline', 'rebase-rewrites.json'), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      !Object.values(parsed).every((value) => typeof value === 'string')) return 'git-error';
    return { map: parsed as Record<string, string>, present: true };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { map: {}, present: false } : 'git-error';
  }
}

async function onlyHaltRecordChanged(git: GitRunner, sha: string, slug: string): Promise<boolean | 'git-error'> {
  const changed = await runGit(git, ['diff-tree', '--no-commit-id', '--name-only', '-r', sha]);
  if (!changed || changed.exitCode !== 0) return 'git-error';
  return changed.stdout.split('\n').filter(Boolean).every((path) => path === `.docs/halted/${slug}.md`);
}

/** Resolves the next child and fails closed when stacked state is ambiguous or divergent. */
export async function resolveActiveChild(
  worktree: string,
  slug: string,
  dependencies: ActiveChildDependencies = {},
): Promise<ActiveChildResolution> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const artifacts = await childArtifactsExist(worktree, slug, git);
  if (artifacts === 'git-error') return { kind: 'git-error' };

  let envelope: Awaited<ReturnType<typeof readCoverageBindingEnvelope>>;
  try {
    envelope = await readCoverageBindingEnvelope(worktree, envelopeFilesystem);
  } catch {
    return artifacts ? { kind: 'envelope-missing' } : { kind: 'no-child' };
  }
  const positions = positionsFromEnvelope(envelope);
  if (positions.length === 0) return artifacts ? { kind: 'envelope-missing' } : { kind: 'no-child' };

  // A missing optional project config is today's ordinary N=1 default, not a
  // cursor failure. A malformed config is handled by configuration validation
  // before BUILD; it cannot make an existing child state disappear here.
  const config = await loadConfig(worktree);
  const eligible = config.ok && config.config.stacked_prs?.enabled === true && positions.length >= 2 &&
    envelope?.storyOwnership !== undefined;
  if (!artifacts && !eligible) return { kind: 'no-child' };

  const symbolic = await runGit(git, ['symbolic-ref', '-q', 'HEAD']);
  if (!symbolic || (symbolic.exitCode !== 0 && symbolic.exitCode !== 1)) return { kind: 'git-error' };
  if (symbolic.exitCode === 1) return { kind: 'detached-head' };

  const closed = await closedChildren(slug, positions, git);
  if (closed === 'git-error') return { kind: 'git-error' };
  const rewrites = await readRewriteMap(worktree);
  if (rewrites === 'git-error') return { kind: 'git-error' };
  let leafMovePending = false;

  for (const closure of closed) {
    const branch = childBranchFor(slug, closure.child);
    if (!branch.ok) return { kind: 'git-error' };
    const branchExists = await runGit(git, ['show-ref', '--verify', '--quiet', `refs/heads/${branch.branch}`]);
    if (!branchExists || (branchExists.exitCode !== 0 && branchExists.exitCode !== 1)) return { kind: 'git-error' };
    if (branchExists.exitCode === 0) {
      const postClosure = await runGit(git, ['rev-list', `${closure.tip}..refs/heads/${branch.branch}`]);
      if (!postClosure || postClosure.exitCode !== 0) return { kind: 'git-error' };
      for (const sha of postClosure.stdout.split('\n').filter(Boolean)) {
        const haltOnly = await onlyHaltRecordChanged(git, sha, slug);
        if (haltOnly === 'git-error') return { kind: 'git-error' };
        if (!haltOnly) return { kind: 'divergent', child: closure.child };
      }
    }
    const index = positions.indexOf(closure.child);
    const next = positions[index + 1];
    if (next === undefined) continue;
    const nextChildBranch = next === positions.at(-1) ? undefined : childBranchFor(slug, next);
    if (nextChildBranch && !nextChildBranch.ok) return { kind: 'git-error' };
    const nextBranch = next === positions.at(-1) ? leafBranchFor(slug) : nextChildBranch!.branch;
    if (!nextBranch) return { kind: 'git-error' };
    const ancestry = await runGit(git, ['merge-base', '--is-ancestor', resolveThroughMap(closure.tip, rewrites.map), `refs/heads/${nextBranch}`]);
    if (!ancestry || (ancestry.exitCode !== 0 && ancestry.exitCode !== 1)) return { kind: 'git-error' };
    if (ancestry.exitCode === 1) {
      if (next === positions.at(-1) && !rewrites.present) leafMovePending = true;
      else if (next !== positions.at(-1)) return { kind: 'divergent', child: closure.child };
    }
  }

  const closedSet = new Set(closed.map(({ child }) => child));
  const leaf = positions.at(-1)!;
  const child = positions.slice(0, -1).find((position) => !closedSet.has(position)) ?? leaf;
  const isLeaf = child === leaf;
  if (isLeaf) {
    return {
      kind: 'active', child, position: child, isLeaf, branch: leafBranchFor(slug),
      ...(leafMovePending || rewrites.present ? { leafMovePending } : {}),
    };
  }
  const branch = childBranchFor(slug, child);
  return branch.ok ? { kind: 'active', child, position: child, isLeaf, branch: branch.branch } : { kind: 'git-error' };
}
