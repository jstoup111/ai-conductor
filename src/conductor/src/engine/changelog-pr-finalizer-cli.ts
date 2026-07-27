import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const IMPLEMENTATION_PR_TOKEN = '{{IMPLEMENTATION_PR}}';

export const FINALIZE_CHANGELOG_PR_USAGE =
  'Usage: conduct-ts finalize-changelog-pr --pr-url <canonical-github-pr-url>';

export type ChangelogPrFinalizerDispatch =
  | { kind: 'finalize'; prUrl: string }
  | { kind: 'guide' };

export function detectFinalizeChangelogPrCommand(
  argv: string[],
): ChangelogPrFinalizerDispatch | null {
  if (argv[2] !== 'finalize-changelog-pr') return null;

  const rest = argv.slice(3);
  if (rest.length !== 2 || rest[0] !== '--pr-url' || rest[1].length === 0) {
    return { kind: 'guide' };
  }
  return { kind: 'finalize', prUrl: rest[1] };
}

export type ChangelogPrFinalizationState = 'changed' | 'no-op';

export interface ChangelogPrFinalizerRunners {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, contents: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  rm: (path: string) => Promise<void>;
}

export async function finalizeChangelogPr(
  changelogPath: string,
  prUrl: string,
  runners: ChangelogPrFinalizerRunners = {
    readFile: (path) => readFile(path, 'utf-8'),
    writeFile: (path, contents) => writeFile(path, contents, 'utf-8'),
    rename,
    rm: (path) => rm(path, { force: true }).then(() => undefined),
  },
): Promise<ChangelogPrFinalizationState> {
  let parsedPrUrl: URL;
  try {
    parsedPrUrl = new URL(prUrl);
  } catch {
    throw new Error('invalid canonical GitHub pull request URL');
  }
  const match =
    /^\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/(?!\.{1,2}\/)[A-Za-z0-9._-]+\/pull\/([1-9]\d*)$/.exec(
      parsedPrUrl.pathname,
    );
  if (
    parsedPrUrl.protocol !== 'https:' ||
    parsedPrUrl.hostname !== 'github.com' ||
    parsedPrUrl.username !== '' ||
    parsedPrUrl.password !== '' ||
    parsedPrUrl.port !== '' ||
    parsedPrUrl.search !== '' ||
    parsedPrUrl.hash !== '' ||
    parsedPrUrl.href !== prUrl ||
    match === null
  ) {
    throw new Error('invalid canonical GitHub pull request URL');
  }

  const changelog = await runners.readFile(changelogPath);
  const tokenCount = changelog.split(IMPLEMENTATION_PR_TOKEN).length - 1;
  if (tokenCount === 0) return 'no-op';
  if (tokenCount > 1) throw new Error('multiple implementation PR tokens found');

  const replacement = `[implementation PR #${match[1]}](${prUrl})`;
  const updatedChangelog = changelog.replace(IMPLEMENTATION_PR_TOKEN, replacement);
  const tempPath = `${changelogPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;

  try {
    await runners.writeFile(tempPath, updatedChangelog);
    await runners.rename(tempPath, changelogPath);
  } catch (error) {
    await runners.rm(tempPath).catch(() => {});
    throw error;
  }
  return 'changed';
}

export async function dispatchFinalizeChangelogPr(
  command: ChangelogPrFinalizerDispatch,
  cwd: string,
  runners?: ChangelogPrFinalizerRunners,
): Promise<number> {
  if (command.kind === 'guide') {
    console.error(FINALIZE_CHANGELOG_PR_USAGE);
    return 1;
  }

  try {
    await finalizeChangelogPr(join(cwd, 'CHANGELOG.md'), command.prUrl, runners);
    return 0;
  } catch (error) {
    console.error(
      `finalize-changelog-pr: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}
