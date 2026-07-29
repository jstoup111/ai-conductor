import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeGitRunner, resolveFreshBase, type GitRunner } from './rebase.js';

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

export function branchNewImplementationPrTokenLineIndexes(
  changelog: string,
  baseChangelogContent: string | null,
): number[] | null {
  const tokenLines = changelog
    .split('\n')
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.includes(IMPLEMENTATION_PR_TOKEN));
  if (tokenLines.length === 0) return [];
  if (baseChangelogContent === null) return null;

  const remainingBaseLineCounts = baseChangelogContent.split('\n').reduce((counts, line) => {
    counts.set(line, (counts.get(line) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const branchNewIndexes: number[] = [];

  for (const { line, index } of tokenLines) {
    const inheritedOccurrences = remainingBaseLineCounts.get(line) ?? 0;
    if (inheritedOccurrences > 0) {
      remainingBaseLineCounts.set(line, inheritedOccurrences - 1);
    } else {
      branchNewIndexes.push(index);
    }
  }
  return branchNewIndexes;
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
  /**
   * CHANGELOG.md contents at this branch's merge-base, when known. A stale,
   * never-finalized token can already exist on the base branch (an earlier
   * PR's finish never ran this finalizer) — without this, its presence makes
   * every later PR's finalize ambiguous forever. When provided, ambiguity is
   * resolved by replacing every token-bearing line that is NOT already
   * present verbatim in the base — i.e. all the lines this branch itself
   * introduced, however many entries it ships. Without it, several tokens
   * stay a hard failure rather than risk misattributing a base entry.
   */
  baseChangelogContent?: string | null,
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

  const replacement = `[implementation PR #${match[1]}](${prUrl})`;
  let updatedChangelog: string;

  if (baseChangelogContent != null) {
    const lines = changelog.split('\n');
    const newTokenLineIndexes =
      branchNewImplementationPrTokenLineIndexes(changelog, baseChangelogContent) ?? [];

    // Every token line this branch introduced belongs to this PR, so all of
    // them take this PR's link — a PR may legitimately ship more than one
    // changelog entry. Nothing new means there is nothing of this branch's to
    // finalize: the remaining tokens are the base's, and substituting one
    // would misattribute another PR's entry to this one.
    if (newTokenLineIndexes.length === 0) return 'no-op';

    for (const index of newTokenLineIndexes) {
      lines[index] = lines[index].replaceAll(IMPLEMENTATION_PR_TOKEN, replacement);
    }
    updatedChangelog = lines.join('\n');
  } else if (tokenCount === 1) {
    updatedChangelog = changelog.replace(IMPLEMENTATION_PR_TOKEN, replacement);
  } else {
    throw new Error('multiple implementation PR tokens found');
  }
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

/**
 * CHANGELOG.md contents at this branch's merge-base with the discovered
 * default branch, or `null` if the base/file can't be resolved (no remote,
 * detached HEAD, file didn't exist at that commit, etc). A `null` here just
 * means `finalizeChangelogPr` falls back to its strict single-token
 * behavior — never a hard failure of the finalize command itself.
 */
export async function resolveBaseChangelogContent(git: GitRunner): Promise<string | null> {
  try {
    const resolution = await resolveFreshBase(git);
    const mergeBase = await git(['merge-base', resolution.ref, 'HEAD']);
    const mergeBaseSha = mergeBase.stdout.trim();
    if (mergeBase.exitCode !== 0 || !mergeBaseSha) return null;

    const show = await git(['show', `${mergeBaseSha}:CHANGELOG.md`]);
    if (show.exitCode !== 0) return null;
    return show.stdout;
  } catch {
    return null;
  }
}

export async function dispatchFinalizeChangelogPr(
  command: ChangelogPrFinalizerDispatch,
  cwd: string,
  runners?: ChangelogPrFinalizerRunners,
  git: GitRunner = makeGitRunner(cwd),
): Promise<number> {
  if (command.kind === 'guide') {
    console.error(FINALIZE_CHANGELOG_PR_USAGE);
    return 1;
  }

  try {
    const baseChangelogContent = await resolveBaseChangelogContent(git);
    const defaultRunners: ChangelogPrFinalizerRunners = {
      readFile: (path) => readFile(path, 'utf-8'),
      writeFile: (path, contents) => writeFile(path, contents, 'utf-8'),
      rename,
      rm: (path) => rm(path, { force: true }).then(() => undefined),
    };
    await finalizeChangelogPr(
      join(cwd, 'CHANGELOG.md'),
      command.prUrl,
      runners ?? defaultRunners,
      baseChangelogContent,
    );
    return 0;
  } catch (error) {
    console.error(
      `finalize-changelog-pr: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}
