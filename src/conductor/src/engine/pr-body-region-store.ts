import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Durable captures are isolated to the feature worktree. */
export const PR_BODY_REGION_CAPTURES_PATH = '.pipeline/pr-body-region-captures.json';

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
  const path = capturePath(worktree);
  const captures = await readCaptureFile(worktree);
  const byStep = captures[pullRequestUrl] ?? {};
  const next: CaptureFile = {
    ...captures,
    [pullRequestUrl]: { ...byStep, [stepKey]: bytes },
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}
