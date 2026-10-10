import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { execa } from 'execa';
import { parseChildId, type ChildId } from './child-context.js';
import {
  COVERAGE_BINDING_COMPLETION_STATUSES,
  readCoverageBindingEnvelope,
  type CoverageBindingEnvelopeFilesystem,
} from './coverage-binding-envelope.js';
import { childBranchFor, leafBranchFor } from './feature-branch-identity.js';

export type ActiveChildResolution =
  | { kind: 'no-child' }
  | { kind: 'active'; child: ChildId; position: ChildId; isLeaf: boolean; branch: string };

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

async function closedChildren(worktree: string, slug: string, positions: readonly ChildId[]): Promise<Set<ChildId>> {
  const result = await execa('git', [
    'for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/closed/`,
  ], { cwd: worktree, reject: false });
  const prefix = `refs/conductor/${slug}/closed/c`;
  const declaredRefs = new Map(positions.map((position) => [`${prefix}${position}`, position]));
  return new Set(result.stdout
    .split('\n')
    .map((ref) => declaredRefs.get(ref))
    .filter((position): position is ChildId => position !== undefined));
}

/** Resolves the next child solely from the sealed positions and monotone closure refs. */
export async function resolveActiveChild(worktree: string, slug: string): Promise<ActiveChildResolution> {
  const positions = positionsFromEnvelope(await readCoverageBindingEnvelope(worktree, envelopeFilesystem));
  if (positions.length === 0) return { kind: 'no-child' };

  const closed = await closedChildren(worktree, slug, positions);
  const leaf = positions.at(-1)!;
  const child = positions.slice(0, -1).find((position) => !closed.has(position)) ?? leaf;
  const isLeaf = child === leaf;
  if (isLeaf) {
    return { kind: 'active', child, position: child, isLeaf, branch: leafBranchFor(slug) };
  }
  const branch = childBranchFor(slug, child);
  if (!branch.ok) return { kind: 'no-child' };

  return { kind: 'active', child, position: child, isLeaf, branch: branch.branch };
}
