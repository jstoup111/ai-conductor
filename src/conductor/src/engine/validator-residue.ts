import {
  confirmUntrackedRebasePaths,
  moveRebaseUntrackedPathsToQuarantine,
  type GitRunner,
} from './rebase.js';

export const VALIDATOR_RESIDUE_DIRECTORY = '.pipeline/validator-residue';

export type ValidatorResidueResult =
  | { readonly kind: 'moved'; readonly paths: string[]; readonly directory: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'refused'; readonly reason: string };

export interface QuarantineValidatorResidueInput {
  readonly projectRoot: string;
  readonly git: GitRunner;
  readonly baseline: readonly string[];
  readonly source: string;
}

/** List Git's non-ignored untracked paths using its NUL-delimited porcelain format. */
export async function listUntrackedPaths(git: GitRunner): Promise<string[]> {
  const status = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (status.exitCode !== 0) throw new Error('cannot inspect untracked worktree paths');
  return status.stdout
    .split('\0')
    .filter((entry) => entry.startsWith('?? '))
    .map((entry) => entry.slice(3));
}

/**
 * Move only files that appeared after a validation dispatch into its ignored,
 * per-dispatch residue directory. Confirmation and destination checks occur
 * before the first rename, so a refusal is atomic for the candidate set.
 */
export async function quarantineValidatorResidue(
  input: QuarantineValidatorResidueInput,
): Promise<ValidatorResidueResult> {
  try {
    const current = await listUntrackedPaths(input.git);
    const baseline = new Set(input.baseline);
    const paths = current.filter((path) => !baseline.has(path));
    if (paths.length === 0) return { kind: 'none' };

    const directory = `${VALIDATOR_RESIDUE_DIRECTORY}/${input.source}-${new Date().toISOString().replaceAll(':', '-')}`;
    const confirmed = await confirmUntrackedRebasePaths(input.git, input.projectRoot, paths);
    await moveRebaseUntrackedPathsToQuarantine(input.projectRoot, confirmed, directory);
    return { kind: 'moved', paths: confirmed, directory };
  } catch (error) {
    return { kind: 'refused', reason: error instanceof Error ? error.message : String(error) };
  }
}
