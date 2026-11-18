import { confirmUntrackedRebasePaths, moveRebaseUntrackedPathsToQuarantine, type GitRunner } from './rebase.js';

export const VALIDATOR_RESIDUE_DIRECTORY = '.pipeline/validator-residue';

export type ValidatorResidueResult =
  | { readonly kind: 'moved'; readonly paths: string[]; readonly directory: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'refused'; readonly reason: string };

export type ValidatorResidueBaselineResult =
  { readonly kind: 'captured'; readonly paths: string[] } | { readonly kind: 'refused'; readonly reason: string };

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
  const records = status.stdout.split('\0');
  const paths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.startsWith('?? ')) paths.push(record.slice(3));
    // With `-z`, rename/copy records contain an additional, bare old-path
    // field. It is metadata for the preceding record, never another status
    // record, so consume it before looking at the next record.
    if (record.length >= 3 && (record.slice(0, 2).includes('R') || record.slice(0, 2).includes('C'))) index += 1;
  }
  return paths;
}

/**
 * Capture a pre-dispatch baseline without allowing an unavailable Git probe to
 * abort the validator itself. Callers log a refusal and skip quarantine while
 * preserving the validator's ordinary result.
 */
export async function captureValidatorResidueBaseline(git: GitRunner): Promise<ValidatorResidueBaselineResult> {
  try {
    return { kind: 'captured', paths: await listUntrackedPaths(git) };
  } catch (error) {
    return { kind: 'refused', reason: error instanceof Error ? error.message : String(error) };
  }
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
    // `.pipeline/` is harness-owned attempt evidence, never product residue.
    // It is normally ignored by provisioned worktrees, but preserving it here
    // keeps a missing ignore rule from erasing the validator evidence that the
    // completion check must read immediately after dispatch.
    const paths = current.filter(
      (path) => !baseline.has(path) && path !== '.pipeline' && !path.startsWith('.pipeline/'),
    );
    if (paths.length === 0) return { kind: 'none' };

    const directory = `${VALIDATOR_RESIDUE_DIRECTORY}/${input.source}-${new Date().toISOString().replaceAll(':', '-')}`;
    const confirmed = await confirmUntrackedRebasePaths(input.git, input.projectRoot, paths);
    await moveRebaseUntrackedPathsToQuarantine(input.projectRoot, confirmed, directory);
    return { kind: 'moved', paths: confirmed, directory };
  } catch (error) {
    return { kind: 'refused', reason: error instanceof Error ? error.message : String(error) };
  }
}
