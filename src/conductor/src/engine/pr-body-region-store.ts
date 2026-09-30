import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Durable captures are isolated to the feature worktree. */
export const PR_BODY_REGION_CAPTURES_PATH = '.pipeline/pr-body-region-captures.json';
/** Shared greppable durability warning for a .pipeline root lost mid-run. */
export const MISSING_PIPELINE_ROOT_WARNING =
  'WARNING: .pipeline root was missing mid-run and had to be recreated (the directory was likely deleted by concurrent cleanup or an unscoped deleter)';

type CaptureFile = Record<string, Record<string, string>>;

function capturePath(worktree: string): string {
  return join(worktree, PR_BODY_REGION_CAPTURES_PATH);
}

async function readCaptureFile(worktree: string): Promise<CaptureFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(capturePath(worktree), 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([pullRequestUrl, captures]) => {
      if (captures === null || typeof captures !== 'object' || Array.isArray(captures)) return [];
      const validCaptures = Object.fromEntries(Object.entries(captures).filter((entry): entry is [string, string] =>
        typeof entry[1] === 'string'));
      return [[pullRequestUrl, validCaptures]];
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

async function writeCaptureFile(worktree: string, captures: CaptureFile): Promise<void> {
  const path = capturePath(worktree);
  const pipelineRoot = dirname(path);
  let warned = false;
  const recreateRoot = async () => {
    if (!warned) {
      console.warn(MISSING_PIPELINE_ROOT_WARNING);
      warned = true;
    }
    await mkdir(pipelineRoot, { recursive: true });
  };
  try {
    await stat(pipelineRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await recreateRoot();
  }
  try {
    await writeFile(path, `${JSON.stringify(captures, null, 2)}\n`, 'utf8');
  } catch (error) {
    // A concurrent cleanup can remove the root after the read (or after the
    // existence check). Recreate once and complete the idempotent write.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await recreateRoot();
    await writeFile(path, `${JSON.stringify(captures, null, 2)}\n`, 'utf8');
  }
}

/** Reads every step capture for one pull request, never crossing PR identities. */
export async function readRegionCaptures(worktree: string, pullRequestUrl: string): Promise<Readonly<Record<string, string>>> {
  const captures = await readCaptureFile(worktree);
  return captures[pullRequestUrl] ?? {};
}

/** Replaces one step's capture after ensuring the pipeline directory exists. */
export async function writeRegionCapture(
  worktree: string,
  pullRequestUrl: string,
  stepKey: string,
  bytes: string,
): Promise<void> {
  const captures = await readCaptureFile(worktree);
  const byStep = captures[pullRequestUrl] ?? {};
  const next: CaptureFile = {
    ...captures,
    [pullRequestUrl]: { ...byStep, [stepKey]: bytes },
  };
  await writeCaptureFile(worktree, next);
}

/** Drops one step's obsolete capture before that owner is dispatched again. */
export async function discardRegionCapture(
  worktree: string,
  pullRequestUrl: string,
  stepKey: string,
): Promise<void> {
  const captures = await readCaptureFile(worktree);
  const byStep = captures[pullRequestUrl];
  if (byStep === undefined || !(stepKey in byStep)) {
    // A first dispatch has nothing to invalidate.  Do not create an empty
    // capture store before the owner has successfully supplied any content.
    return;
  }
  const { [stepKey]: _discarded, ...remaining } = byStep;
  const next: CaptureFile = { ...captures };
  if (Object.keys(remaining).length === 0) delete next[pullRequestUrl];
  else next[pullRequestUrl] = remaining;
  await writeCaptureFile(worktree, next);
}
