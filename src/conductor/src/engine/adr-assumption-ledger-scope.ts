import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseAdrAssumptionLedger,
  type AdrLedgerDiagnostic,
} from './artifacts.js';
import { makeGitRunner, originDefaultBranch } from './rebase.js';

const ADR_PATH = /^\.docs\/decisions\/adr-[^/]+\.md$/i;
const ASSUMPTIONS_HEADING = /^\s{0,3}##\s+Assumptions\s*$/im;

export type AdrAssumptionLedgerFailure = {
  path: string;
  diagnostics: AdrLedgerDiagnostic[];
};

export type AdrAssumptionLedgerScopeResult =
  | { kind: 'evaluated'; failures: AdrAssumptionLedgerFailure[] }
  | { kind: 'merge-base-unresolved'; detail: string };

export interface EvaluateAdrAssumptionLedgersInput {
  readonly worktreePath: string;
  /** Local default branch used if the origin default tracking ref is absent. */
  readonly baseRef?: string;
  /** A merge base already resolved by the caller. */
  readonly mergeBase?: string;
}

async function resolveMergeBase(
  worktreePath: string,
  baseRef: string | undefined,
  suppliedMergeBase: string | undefined,
): Promise<{ kind: 'resolved'; sha: string } | { kind: 'unresolved'; detail: string }> {
  if (suppliedMergeBase) return { kind: 'resolved', sha: suppliedMergeBase };

  const git = makeGitRunner(worktreePath);
  const localBase = baseRef ?? 'main';
  const originBranch = await originDefaultBranch(git);
  const originRef = originBranch ? `origin/${originBranch}` : undefined;
  const originExists = originRef !== undefined
    && (await git(['rev-parse', '--verify', '--quiet', `${originRef}^{commit}`])).exitCode === 0;
  const comparisonBase = originExists ? originRef! : localBase;
  const mergeBase = await git(['merge-base', comparisonBase, 'HEAD']);
  const sha = mergeBase.stdout.trim();
  if (mergeBase.exitCode !== 0 || sha === '') {
    return {
      kind: 'unresolved',
      detail: `ADR assumption-ledger merge base could not be resolved from ${comparisonBase}.`,
    };
  }
  return { kind: 'resolved', sha };
}

async function workingTreeAdrPaths(worktreePath: string): Promise<string[]> {
  try {
    const names = await readdir(join(worktreePath, '.docs', 'decisions'));
    return names
      .map((name) => `.docs/decisions/${name}`)
      .filter((path) => ADR_PATH.test(path))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Evaluate only ADRs introduced by a feature, plus changed ADRs that have
 * opted into the assumptions ledger. Legacy ADRs without that section remain
 * readable without retroactive migration.
 */
export async function evaluateAdrAssumptionLedgers(
  input: EvaluateAdrAssumptionLedgersInput,
): Promise<AdrAssumptionLedgerScopeResult> {
  const resolved = await resolveMergeBase(input.worktreePath, input.baseRef, input.mergeBase);
  if (resolved.kind === 'unresolved') {
    return { kind: 'merge-base-unresolved', detail: resolved.detail };
  }

  const git = makeGitRunner(input.worktreePath);
  const baseTree = await git(['ls-tree', '-r', '--name-only', resolved.sha, '--', '.docs/decisions']);
  if (baseTree.exitCode !== 0) {
    return {
      kind: 'merge-base-unresolved',
      detail: `ADR assumption-ledger merge base could not be resolved from ${resolved.sha}.`,
    };
  }
  const basePaths = new Set(baseTree.stdout.split('\n').map((path) => path.trim()).filter(Boolean));
  const failures: AdrAssumptionLedgerFailure[] = [];

  for (const path of await workingTreeAdrPaths(input.worktreePath)) {
    const content = await readFile(join(input.worktreePath, path), 'utf8');
    const added = !basePaths.has(path);
    let changed = false;
    if (!added) {
      const baseContent = await git(['show', `${resolved.sha}:${path}`]);
      if (baseContent.exitCode !== 0) {
        return {
          kind: 'merge-base-unresolved',
          detail: `ADR assumption-ledger merge base could not be resolved from ${resolved.sha}.`,
        };
      }
      changed = baseContent.stdout !== content;
    }

    if (!added && (!changed || !ASSUMPTIONS_HEADING.test(content))) continue;
    const parsed = parseAdrAssumptionLedger(content);
    if (parsed.kind === 'diagnostics') failures.push({ path, diagnostics: parsed.diagnostics });
  }

  return { kind: 'evaluated', failures };
}
