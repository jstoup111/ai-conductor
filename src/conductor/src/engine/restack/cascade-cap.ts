import type { ChildId } from '../child-context.js';
import { parseChildId } from '../child-context.js';
import { makeGitRunner, type GitRunner } from '../rebase.js';
import { parseCommitSha, parseRefName, type CommitSha, type RefName } from './restack-types.js';

/** The default number of applied feature repairs one child may originate. */
export const MAX_RESTACK_CASCADES_PER_CHILD = 3;

export interface CascadeCounts {
  readonly version: 1;
  /** String keys keep the ref-backed JSON stable and readable outside TypeScript. */
  readonly counts: Readonly<Record<string, number>>;
}

export type ReadCascadeCountsResult =
  | { readonly kind: 'counts'; readonly ref: RefName; readonly counts: CascadeCounts; readonly blob?: CommitSha }
  | { readonly kind: 'unreadable'; readonly ref: RefName; readonly detail: string };

export type CascadeCapResult =
  | { readonly kind: 'clear'; readonly counts: CascadeCounts; readonly limit: number }
  | { readonly kind: 'exhausted'; readonly child: ChildId; readonly count: number; readonly limit: number; readonly detail?: string };

export type CascadeUpdateLinesResult =
  | { readonly kind: 'lines'; readonly lines: readonly string[]; readonly counts: CascadeCounts }
  | { readonly kind: 'unreadable'; readonly ref: RefName; readonly detail: string };

export interface CascadeCapDependencies {
  readonly git?: GitRunner;
}

function cascadeRef(slug: string): RefName {
  const value = parseRefName(`refs/conductor/${slug}/cascades`);
  if (!value) throw new Error(`invalid cascade ref for ${slug}`);
  return value;
}

export function cascadesRefFor(slug: string): RefName {
  return cascadeRef(slug);
}

async function runGit(git: GitRunner, args: string[], input?: string) {
  try {
    return await git(args, input === undefined ? undefined : { input });
  } catch {
    return undefined;
  }
}

function parseCounts(value: unknown): CascadeCounts | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.counts !== 'object' || record.counts === null || Array.isArray(record.counts)) return undefined;
  const counts: Record<string, number> = {};
  for (const [rawChild, rawCount] of Object.entries(record.counts as Record<string, unknown>)) {
    const child = parseChildId(rawChild);
    if (child === undefined || rawChild !== String(child) || typeof rawCount !== 'number' || !Number.isSafeInteger(rawCount) || rawCount < 0) return undefined;
    counts[rawChild] = rawCount;
  }
  return { version: 1, counts };
}

function emptyCounts(): CascadeCounts {
  return { version: 1, counts: {} };
}

/** Read the durable ref-backed cascade counters; malformed state fails closed. */
export async function readCascadeCounts(
  worktree: string,
  slug: string,
  dependencies: CascadeCapDependencies = {},
): Promise<ReadCascadeCountsResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const ref = cascadeRef(slug);
  const resolved = await runGit(git, ['rev-parse', '-q', '--verify', ref]);
  if (resolved === undefined) return { kind: 'unreadable', ref, detail: `cannot read ${ref}` };
  if (resolved.exitCode === 1) {
    // rev-parse's ordinary "missing ref" exit is the initial zero-count state.
    return { kind: 'counts', ref, counts: emptyCounts() };
  }
  if (resolved.exitCode !== 0) return { kind: 'unreadable', ref, detail: `cannot resolve ${ref}` };
  const blob = parseCommitSha(resolved.stdout.trim());
  if (!blob) return { kind: 'unreadable', ref, detail: `${ref} does not name a full object id` };
  const content = await runGit(git, ['cat-file', 'blob', blob]);
  if (content === undefined || content.exitCode !== 0) return { kind: 'unreadable', ref, detail: `cannot read blob at ${ref}` };
  let parsed: CascadeCounts | undefined;
  try { parsed = parseCounts(JSON.parse(content.stdout)); } catch { parsed = undefined; }
  return parsed === undefined
    ? { kind: 'unreadable', ref, detail: `${ref} contains malformed cascade counts` }
    : { kind: 'counts', ref, counts: parsed, blob };
}

/** Refuse before a journal exists when any originating child has exhausted its allowance. */
export async function checkCascadeCap(
  worktree: string,
  slug: string,
  originatingChildren: readonly ChildId[],
  limit = MAX_RESTACK_CASCADES_PER_CHILD,
  dependencies: CascadeCapDependencies = {},
): Promise<CascadeCapResult> {
  const state = await readCascadeCounts(worktree, slug, dependencies);
  const first = [...new Set(originatingChildren)].sort((left, right) => left - right)[0];
  if (first === undefined) return { kind: 'clear', counts: state.kind === 'counts' ? state.counts : emptyCounts(), limit };
  if (state.kind === 'unreadable') {
    return { kind: 'exhausted', child: first, count: limit, limit, detail: `${state.detail} (${state.ref})` };
  }
  for (const child of [...new Set(originatingChildren)].sort((left, right) => left - right)) {
    const count = state.counts.counts[String(child)] ?? 0;
    if (count >= limit) return { kind: 'exhausted', child, count, limit };
  }
  return { kind: 'clear', counts: state.counts, limit };
}

/**
 * Prepare the one CAS line that records applied feature-repair cascades.
 * The caller appends it to its journal-to-applied transaction so a crash cannot
 * leave a moved restack without its charge (or vice versa).
 */
export async function cascadeUpdateLines(
  worktree: string,
  slug: string,
  originatingChildren: readonly ChildId[],
  dependencies: CascadeCapDependencies = {},
): Promise<CascadeUpdateLinesResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const state = await readCascadeCounts(worktree, slug, { git });
  if (state.kind === 'unreadable') return state;
  const next: Record<string, number> = { ...state.counts.counts };
  for (const child of new Set(originatingChildren)) next[String(child)] = (next[String(child)] ?? 0) + 1;
  const counts: CascadeCounts = { version: 1, counts: next };
  const blobResult = await runGit(git, ['hash-object', '-w', '--stdin'], JSON.stringify(counts));
  const blob = blobResult?.exitCode === 0 ? parseCommitSha(blobResult.stdout.trim()) : undefined;
  if (!blob) return { kind: 'unreadable', ref: state.ref, detail: `cannot write cascade counts for ${state.ref}` };
  return {
    kind: 'lines',
    counts,
    lines: [`update ${state.ref} ${blob}${state.blob === undefined ? '' : ` ${state.blob}`}`],
  };
}
