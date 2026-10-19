import { parseChildId, type ChildId } from './child-context.js';
import { childBranchFor } from './feature-branch-identity.js';
import type { GitRunner } from './rebase.js';
import { runTrackerRepositoryRead, type GhRunner } from './tracker-client.js';
import type { PublicationRecord } from './stack-publication-record.js';
import { deleteFeatureConductorRefs } from './restack/restack-refs-cleanup.js';

export type StackTeardownResult =
  | { readonly kind: 'deleted' }
  | { readonly kind: 'kept' }
  | { readonly kind: 'failed' };

export interface StackTeardownDependencies {
  readonly git: GitRunner;
  readonly gh: GhRunner;
  readonly repository: string;
}

async function sealedChildren(slug: string, git: GitRunner): Promise<readonly ChildId[] | undefined> {
  try {
    const result = await git(['cat-file', '-p', `refs/conductor/${slug}/positions`]);
    if (result.exitCode !== 0) return undefined;
    const raw: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(raw) || raw.length < 2) return undefined;
    const positions = raw.map((value) => parseChildId(value));
    if (positions.some((position) => position === undefined)) return undefined;
    const values = positions as ChildId[];
    if (new Set(values).size !== values.length || values.some((value, index) => index > 0 && values[index - 1]! >= value)) return undefined;
    return values.slice(0, -1);
  } catch {
    return undefined;
  }
}

type MergedMember = { readonly state?: unknown; readonly headRefOid?: unknown; readonly mergeCommit?: { readonly oid?: unknown } };

/**
 * Covers: task:28. Delete only sealed child branches whose merged PR still
 * proves the exact local head.  This deliberately enumerates names from the
 * sealed positions ref: neither a prefix scan nor an unsealed child is a
 * deletion candidate.
 */
export async function deleteStackChildren(
  root: string,
  slug: string,
  record: PublicationRecord,
  dependencies: StackTeardownDependencies,
): Promise<StackTeardownResult> {
  const positions = await sealedChildren(slug, dependencies.git);
  if (!positions) return { kind: 'failed' };
  let kept = false;

  for (const position of positions) {
    const branch = childBranchFor(slug, position);
    const member = record.members.find((candidate) => candidate.position === position && candidate.branch === (branch.ok ? branch.branch : ''));
    if (!branch.ok || !member) return { kind: 'failed' };
    let observed: MergedMember;
    try {
      const stdout = await runTrackerRepositoryRead(
        dependencies.gh, root, 'pull-request.read', dependencies.repository, { kind: 'pull-request', number: member.pr },
        ['pr', 'view', String(member.pr), '-R', dependencies.repository, '--json', 'state,headRefOid,mergeCommit'],
      );
      observed = JSON.parse(stdout) as MergedMember;
    } catch {
      return { kind: 'failed' };
    }
    const head = typeof observed.headRefOid === 'string' ? observed.headRefOid : undefined;
    const merge = observed.mergeCommit?.oid;
    if (observed.state !== 'MERGED' || !head || typeof merge !== 'string') {
      kept = true;
      continue;
    }
    try {
      const [onMain, local] = await Promise.all([
        dependencies.git(['merge-base', '--is-ancestor', merge, 'origin/main']),
        dependencies.git(['rev-parse', '--verify', `refs/heads/${branch.branch}`]),
      ]);
      // A missing local branch is an already-completed delete. A failed probe
      // is not evidence to keep it: stop and retry rather than recording a
      // terminal teardown receipt.
      if (onMain.exitCode !== 0 || local.exitCode > 1) return { kind: 'failed' };
      if (local.exitCode === 1) continue;
      if (local.stdout.trim() !== head) {
        kept = true;
        continue;
      }
      const deleted = await dependencies.git(['update-ref', '-d', `refs/heads/${branch.branch}`, head]);
      if (deleted.exitCode > 1) return { kind: 'failed' };
    } catch {
      return { kind: 'failed' };
    }
  }

  if (kept) return { kind: 'kept' };
  if (!await deleteFeatureConductorRefs(slug, dependencies.git)) return { kind: 'failed' };
  try {
    const removed = await dependencies.git([
      'update-ref', '--stdin',
    ], { input: `start\ndelete refs/conductor/${slug}/positions\ndelete refs/conductor/${slug}/publication\nprepare\ncommit\n` });
    return removed.exitCode === 0 ? { kind: 'deleted' } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}
