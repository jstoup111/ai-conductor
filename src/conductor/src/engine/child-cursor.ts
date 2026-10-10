import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseChildId, type ChildId } from './child-context.js';
import { loadConfig } from './config.js';
import {
  COVERAGE_BINDING_COMPLETION_STATUSES,
  readCoverageBindingEnvelope,
  type CoverageBindingEnvelopeFilesystem,
} from './coverage-binding-envelope.js';
import { childBranchFor, featureSlugOf, leafBranchFor, parseFeatureBranch, parseFeatureRef } from './feature-branch-identity.js';
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

/**
 * The base against which a child-local consumer must compare its inputs.
 *
 * `parent` deliberately carries the closure-ref tip rather than the current
 * parent branch tip: halt-record commits may follow closure without becoming
 * part of the child's reviewed contribution.
 */
export type ChildBaseResolution =
  | { kind: 'none' }
  | { kind: 'parent'; parent: ChildId; sha: string }
  | { kind: 'parent-missing'; parent: ChildId; branch: string }
  | { kind: 'parent-not-ancestor'; parent: ChildId; sha: string };

export interface ChildBaseDependencies {
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
  try {
    if ((await readdir(join(worktree, '.pipeline', 'children'))).length > 0) return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 'git-error';
  }
  const refs = await runGit(git, ['for-each-ref', '--format=%(refname)', 'refs/heads/feat']);
  if (!refs || refs.exitCode !== 0) return 'git-error';
  if (refs.stdout.split('\n').some((ref) => {
    const identity = parseFeatureRef(ref.trim());
    return identity.kind === 'child' && identity.slug === slug;
  })) return true;
  const closures = await runGit(git, ['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/closed/`]);
  if (!closures || closures.exitCode !== 0) return 'git-error';
  if (closures.stdout.trim() !== '') return true;
  return false;
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

/**
 * Produces the local comparison base for a child region. This intentionally
 * reads only local refs: child branches and their closure refs are daemon
 * state, never a remote-discovery concern.
 */
export async function resolveChildBase(
  worktree: string,
  slug: string,
  child?: ChildId,
  dependencies: ChildBaseDependencies = {},
): Promise<ChildBaseResolution> {
  if (child === undefined) return { kind: 'none' };

  const git = dependencies.git ?? makeGitRunner(worktree);
  let envelope: Awaited<ReturnType<typeof readCoverageBindingEnvelope>> | null;
  try {
    envelope = await readCoverageBindingEnvelope(worktree, envelopeFilesystem);
  } catch {
    envelope = null;
  }
  const positions = positionsFromEnvelope(envelope);
  const index = positions.indexOf(child);

  // A position is first according to the sealed slice order, not its numeric
  // spelling (a valid manifest may use a gap such as positions 1 and 3).
  if (index === 0 || (positions.length === 0 && child === 1)) return { kind: 'none' };

  // An absent or malformed envelope cannot establish a declared predecessor.
  // Preserve the typed, fail-closed surface rather than guessing a diff base.
  const parent = index > 0 ? positions[index - 1] : parseChildId(child - 1);
  if (parent === undefined) return { kind: 'none' };
  const branchResult = childBranchFor(slug, parent);
  if (!branchResult.ok) {
    return { kind: 'parent-missing', parent, branch: `feat/c${parent}/${slug}` };
  }
  const branch = branchResult.branch;

  const closureRef = `refs/conductor/${slug}/closed/c${parent}`;
  const closure = await runGit(git, ['rev-parse', '--verify', closureRef]);
  if (!closure || closure.exitCode !== 0 || !closure.stdout.trim()) {
    return { kind: 'parent-missing', parent, branch };
  }

  const branchExists = await runGit(git, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  if (!branchExists || branchExists.exitCode !== 0) {
    return { kind: 'parent-missing', parent, branch };
  }

  const rewrites = await readRewriteMap(worktree);
  if (rewrites === 'git-error') {
    return { kind: 'parent-not-ancestor', parent, sha: closure.stdout.trim() };
  }
  const sha = resolveThroughMap(closure.stdout.trim(), rewrites.map);
  const ancestry = await runGit(git, ['merge-base', '--is-ancestor', sha, 'HEAD']);
  if (!ancestry || ancestry.exitCode !== 0) {
    return { kind: 'parent-not-ancestor', parent, sha };
  }

  return { kind: 'parent', parent, sha };
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
  // Unit fixtures and legacy N=1 callers may not be Git worktrees. With no
  // child directory, they cannot contain child refs either, so retain the flat
  // path without treating the deliberately absent Git boundary as corruption.
  if (!existsSync(join(worktree, '.git'))) {
    try {
      if ((await readdir(join(worktree, '.pipeline', 'children'))).length === 0) {
        return { kind: 'no-child' };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'no-child' };
      return { kind: 'git-error' };
    }
  }
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
    // The next intermediate branch is intentionally absent between closure
    // and region entry. Its creation is startChild's responsibility, so there
    // is no successor ancestry to validate until that branch exists.
    const nextExists = await runGit(git, ['show-ref', '--verify', '--quiet', `refs/heads/${nextBranch}`]);
    if (!nextExists || (nextExists.exitCode !== 0 && nextExists.exitCode !== 1)) return { kind: 'git-error' };
    if (nextExists.exitCode === 1 && next !== positions.at(-1)) continue;
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

/**
 * Resolves a cursor for an operator command issued from a feature worktree.
 * Non-feature directories deliberately retain the N=1 command path; a
 * feature branch delegates to the cursor, which owns stacked-state refusal.
 */
export async function resolveActiveChildForCurrentFeature(
  worktree: string,
  dependencies: ActiveChildDependencies = {},
): Promise<ActiveChildResolution> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const head = await runGit(git, ['symbolic-ref', '-q', '--short', 'HEAD']);
  if (!head || head.exitCode !== 0 || !head.stdout.trim()) return { kind: 'no-child' };
  const slug = featureSlugOf(parseFeatureBranch(head.stdout.trim()));
  return slug === undefined ? { kind: 'no-child' } : resolveActiveChild(worktree, slug, { git });
}
