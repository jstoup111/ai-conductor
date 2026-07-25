import { readFile, rename, writeFile } from 'node:fs/promises';

const IMPLEMENTATION_PR_TOKEN = '{{IMPLEMENTATION_PR}}';

export type ChangelogPrFinalizationState = 'changed' | 'no-op';

export interface ChangelogPrFinalizerRunners {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, contents: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
}

export async function finalizeChangelogPr(
  changelogPath: string,
  prUrl: string,
  runners: ChangelogPrFinalizerRunners = {
    readFile: (path) => readFile(path, 'utf-8'),
    writeFile: (path, contents) => writeFile(path, contents, 'utf-8'),
    rename,
  },
): Promise<ChangelogPrFinalizationState> {
  const match = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/([1-9]\d*)$/.exec(prUrl);
  if (match === null) throw new Error('invalid canonical GitHub pull request URL');

  const changelog = await runners.readFile(changelogPath);
  const replacement = `[implementation PR #${match[1]}](${prUrl})`;
  const updatedChangelog = changelog.replace(IMPLEMENTATION_PR_TOKEN, replacement);
  const tempPath = `${changelogPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;

  await runners.writeFile(tempPath, updatedChangelog);
  await runners.rename(tempPath, changelogPath);
  return 'changed';
}
