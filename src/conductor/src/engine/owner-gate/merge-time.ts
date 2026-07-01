// owner-gate/merge-time.ts — derive a spec's first-appearance time from git.
//
// Un-owned specs are gated by a grandfather cutover (FR-8/9): merged BEFORE the
// cutover → build (trusted as the operator's); merged ON/AFTER → skip. The
// daemon reads only committed state, and a legacy spec carries no timestamp of
// its own, so the activation time is derived from git history
// (ADR: adr-2026-06-30-grandfather-cutover-merge-time): the commit timestamp at
// which the spec's plan file FIRST appeared on the base branch.
//
// `git log --diff-filter=A --format=%cI` lists the additions of the path newest
// first, so the LAST line is the first introduction. Empty output or a non-zero
// git exit → `null` (indeterminate), which the gate treats as post-cutover.

import type { GitRunner } from '../rebase.js';

/**
 * The ISO-8601 commit time at which `planPath` first appeared on `baseBranch`,
 * or `null` when it cannot be determined (no history / non-zero git). Uses
 * `git log --diff-filter=A --format=%cI` and takes the LAST (earliest) line —
 * the first commit that introduced the plan file.
 */
export async function firstAppearanceTime(
  git: GitRunner,
  baseBranch: string,
  planPath: string,
): Promise<string | null> {
  const { exitCode, stdout } = await git([
    'log',
    baseBranch,
    '--diff-filter=A',
    '--format=%cI',
    '--',
    planPath,
  ]);
  if (exitCode !== 0) return null;

  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (lines.length === 0) return null;

  return lines[lines.length - 1];
}
