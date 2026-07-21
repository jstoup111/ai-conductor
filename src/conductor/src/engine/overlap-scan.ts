// overlap-scan.ts — DECIDE-time unmerged-overlap scan (#523, Scope A).
//
// SCAFFOLD ONLY (pre-implementation): types + signatures so the acceptance and
// unit specs load and fail on real assertions (RED), not on collection errors.
// Every function throws — `/pipeline` (Tasks 1-6) replaces each throw with the
// real implementation, one task at a time, per the plan's TDD cycle.

import type { GitRunner } from './rebase.js';
import { resolveBase, changedPathsBetween } from './rebase.js';
import type { BlockerResolver, IssueRef } from './blocker-resolver.js';

export interface SeamOverlap {
  branch: string;
  files: string[];
}

export interface OverlapReport {
  seamOverlaps: SeamOverlap[];
  blockers: IssueRef[];
  indeterminate: { detail: string }[];
  skipNotes: string[];
}

export interface RunOverlapScanArgs {
  candidateFiles: string[];
  git: GitRunner;
  resolver: BlockerResolver;
  sourceRef?: string;
  localBase: string;
}

/**
 * Candidate sibling branches to scan for overlap: local `spec/*` branches
 * (in-flight DECIDE/BUILD work authored by this harness) plus any
 * remote-tracking `spec/*` heads (open-PR branches fetched to a remote,
 * e.g. `origin/spec/*`). Excludes branches already merged into `base` —
 * a branch with zero commits ahead of `base` (`rev-list --count
 * base..branch === 0`) carries nothing base doesn't already have, so it
 * cannot overlap with in-progress work.
 */
export async function enumerateUnmergedBranches(
  git: GitRunner,
  base: string,
): Promise<string[]> {
  const refs = await git([
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/heads/spec/*',
    'refs/remotes/*/spec/*',
  ]);
  const candidates = refs.exitCode === 0
    ? refs.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    : [];

  const unmerged: string[] = [];
  for (const branch of candidates) {
    if (branch === base || branch.endsWith(`/${base}`)) continue;
    const r = await git(['rev-list', '--count', `${base}..${branch}`]);
    const aheadCount = r.exitCode === 0 ? Number.parseInt(r.stdout.trim(), 10) : NaN;
    // Non-zero (or indeterminate) ahead-count means the branch is not fully
    // merged into base — keep it as a scan candidate. A confirmed 0 means
    // fully merged — exclude it.
    if (Number.isNaN(aheadCount) || aheadCount !== 0) {
      unmerged.push(branch);
    }
  }
  return unmerged;
}

/**
 * Exact repo-relative intersection of two file-path lists. Normalizes both
 * sides (strip leading `./`, collapse backslashes to forward slashes) then
 * matches on strict path equality — no prefix/substring/basename matching,
 * since those produce false positives (e.g. `helper.ts` vs `helperx.ts`).
 */
export function intersectFiles(candidate: string[], changed: string[]): string[] {
  const normalize = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');

  const changedSet = new Set(changed.map(normalize));
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of candidate) {
    const norm = normalize(raw);
    if (changedSet.has(norm) && !seen.has(norm)) {
      seen.add(norm);
      result.push(norm);
    }
  }

  return result;
}

/**
 * Sweep for open blockers on `sourceRef`, delegating the blocked_by API call
 * and closed-blocker filtering entirely to the injected `resolver` — this
 * function only maps the resulting verdict onto the overlap report shape.
 * Absent `sourceRef` (no linked issue) skips the sweep without calling the
 * resolver at all.
 */
export async function blockerSweep(
  sourceRef: string | undefined,
  resolver: BlockerResolver,
): Promise<{ blockers: IssueRef[]; indeterminate: { detail: string }[] }> {
  if (!sourceRef) {
    return { blockers: [], indeterminate: [] };
  }

  const verdict = await resolver.resolve(sourceRef);
  switch (verdict.kind) {
    case 'blocked':
      return { blockers: verdict.blockers, indeterminate: [] };
    case 'indeterminate':
      return { blockers: [], indeterminate: [{ detail: verdict.detail }] };
    case 'cycle':
      return {
        blockers: [],
        indeterminate: [{ detail: `dependency cycle detected among: ${verdict.members.map((m) => `${m.repo}#${m.number}`).join(', ')}` }],
      };
    case 'unblocked':
    default:
      return { blockers: [], indeterminate: [] };
  }
}

/**
 * Orchestrate the full DECIDE-time unmerged-overlap scan: resolve the base
 * ref, enumerate unmerged sibling branches, diff each against base and
 * intersect with this feature's candidate files to find seam overlaps, then
 * sweep for open blockers on the source ref. Assembles everything into a
 * single `OverlapReport`.
 */
export async function runOverlapScan(args: RunOverlapScanArgs): Promise<OverlapReport> {
  const { candidateFiles, git, resolver, sourceRef, localBase } = args;

  const skipNotes: string[] = [];

  const base = await resolveBase(git, localBase);

  let branches: string[] = [];
  try {
    branches = await enumerateUnmergedBranches(git, base.ref);
  } catch (err) {
    skipNotes.push(
      `skipped sibling-branch enumeration: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const seamOverlaps: SeamOverlap[] = [];
  for (const branch of branches) {
    try {
      const changed = await changedPathsBetween(git, base.ref, branch);
      const files = intersectFiles(candidateFiles, changed);
      if (files.length > 0) {
        seamOverlaps.push({ branch, files });
      }
    } catch (err) {
      skipNotes.push(
        `skipped diff for branch ${branch}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  let blockers: IssueRef[] = [];
  let indeterminate: { detail: string }[] = [];
  try {
    ({ blockers, indeterminate } = await blockerSweep(sourceRef, resolver));
  } catch (err) {
    skipNotes.push(
      `skipped blocker sweep: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { seamOverlaps, blockers, indeterminate, skipNotes };
}

export function renderReport(_report: OverlapReport): string {
  throw new Error('not implemented: renderReport (Task 6)');
}
