import {
  enumerateUnmergedBranches,
  intersectFiles,
} from '../../overlap-scan.js';
import { changedPathsSinceMergeBase, type GitRunner } from '../../rebase.js';
import { runTrackerRead, type GhRunner } from '../../tracker-client.js';
import { parseIntakeSourceRef } from '../../artifacts.js';
import { parseSourceRef } from '../issue-ref.js';
import { extractCitedPaths } from './cited-paths.js';
import type { IssueOverlap } from './overlap-suggestions.js';
import type { BranchOverlap } from './overlap-suggestions.js';

const DEFAULT_OPEN_ISSUES_LIMIT = 500;
const DEFAULT_IN_FLIGHT_BRANCH_LIMIT = 100;
const IN_FLIGHT_REF_PATTERNS = [
  'refs/heads/spec/*',
  'refs/remotes/*/spec/*',
  'refs/heads/feat/daemon-*',
  'refs/remotes/*/feat/daemon-*',
];

interface OpenIssue {
  number: number;
  body: string;
}

type OpenIssueLister = (limit: number) => Promise<readonly OpenIssue[]>;
export type IssueStateReader = (issue: string) => Promise<'OPEN' | 'CLOSED' | string | null>;

function parseOpenIssues(stdout: string): OpenIssue[] {
  const parsed: unknown = JSON.parse(stdout || '[]');
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((issue): OpenIssue[] => (
    typeof issue === 'object' && issue !== null &&
    typeof issue.number === 'number' &&
    Number.isSafeInteger(issue.number) && issue.number > 0 &&
    typeof issue.body === 'string'
      ? [{ number: issue.number, body: issue.body }]
      : []
  ));
}

/** Lists the bounded set of open issues for one filing repository. */
function makeOpenIssueLister(
  gh: GhRunner,
  cwd: string,
  repository: string,
): OpenIssueLister {
  return async (limit: number) => {
    const stdout = await runTrackerRead(
      gh,
      cwd,
      'repository.read',
      repository,
      { kind: 'repository' },
      [
        'issue', 'list', '--repo', repository, '--state', 'open', '--limit', String(limit),
        '--json', 'number,body',
      ],
    );
    return parseOpenIssues(stdout);
  };
}

/**
 * Projects open issue bodies onto shared cited paths. Raw tracker text remains
 * inside this module and is never included in its result.
 */
export async function collectOpenIssueOverlaps({
  gh,
  cwd,
  repository,
  citedPaths,
  knownPaths,
  limit = DEFAULT_OPEN_ISSUES_LIMIT,
}: {
  gh: GhRunner;
  cwd: string;
  repository: string;
  citedPaths: readonly string[];
  knownPaths?: ReadonlySet<string>;
  limit?: number;
}): Promise<IssueOverlap[]> {
  const overlaps: IssueOverlap[] = [];
  const openIssues = await makeOpenIssueLister(gh, cwd, repository)(Math.min(limit, DEFAULT_OPEN_ISSUES_LIMIT));

  for (const issue of openIssues) {
    const sharedPaths = intersectFiles([...citedPaths], extractCitedPaths(issue.body, knownPaths));
    if (sharedPaths.length > 0) {
      overlaps.push({ issue: `#${issue.number}`, sharedPaths });
    }
  }

  return overlaps;
}

function inFlightSlug(branch: string): string | null {
  const localName = branch.match(/(?:^|\/)(spec\/.+|feat\/daemon-.+)$/)?.[1];
  if (!localName) return null;
  if (localName.startsWith('spec/')) return localName.slice('spec/'.length);
  if (localName.startsWith('feat/daemon-')) return localName.slice('feat/daemon-'.length);
  return null;
}

function makeIssueStateReader(gh: GhRunner, cwd: string, repository: string): IssueStateReader {
  return async (issue) => runTrackerRead(
    gh,
    cwd,
    'issue.read',
    repository,
    { kind: 'issue', number: Number(issue) },
    ['issue', 'view', issue, '--repo', repository, '--json', 'state', '-q', '.state'],
  ).then((stdout) => stdout.trim());
}

/**
 * Resolves an in-flight branch's own intake marker to an open issue in the
 * filing repository. Every unreadable or non-GitHub state remains advisory.
 */
export async function traceBranchIssue({
  git,
  branch,
  repository,
  readIssueState,
}: {
  git: GitRunner;
  branch: string;
  repository: string;
  readIssueState: IssueStateReader;
}): Promise<string | null> {
  const slug = inFlightSlug(branch);
  if (!slug) return null;

  try {
    const marker = await git(['show', `${branch}:.docs/intake/${slug}.md`]);
    if (marker.exitCode !== 0) return null;
    const parsed = parseSourceRef(parseIntakeSourceRef(marker.stdout));
    if (!parsed || parsed.repo !== repository) return null;
    return await readIssueState(parsed.number) === 'OPEN'
      ? `${parsed.repo}#${parsed.number}`
      : null;
  } catch {
    return null;
  }
}

async function isShippedBranch(git: GitRunner, baseRef: string, branch: string): Promise<boolean> {
  const slug = inFlightSlug(branch);
  if (!slug) return false;
  const shipped = await git(['cat-file', '-e', `${baseRef}:.docs/shipped/${slug}.md`]);
  return shipped.exitCode === 0;
}

async function committedAt(git: GitRunner, branch: string): Promise<number> {
  const result = await git(['log', '-1', '--format=%ct', branch]);
  const timestamp = result.exitCode === 0 ? Number.parseInt(result.stdout.trim(), 10) : NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Finds cited paths changed by in-flight spec and daemon branches. Errors on
 * individual branches remain advisory so a damaged ref cannot block filing.
 */
export async function collectInFlightOverlaps({
  git,
  baseRef,
  citedPaths,
  maxBranches = DEFAULT_IN_FLIGHT_BRANCH_LIMIT,
  repository,
  readIssueState,
  gh,
  cwd,
}: {
  git: GitRunner;
  baseRef: string;
  citedPaths: readonly string[];
  maxBranches?: number;
  repository?: string;
  readIssueState?: IssueStateReader;
  gh?: GhRunner;
  cwd?: string;
}): Promise<{ overlaps: BranchOverlap[]; skipNotes: string[] }> {
  const skipNotes: string[] = [];
  let branches: string[];
  try {
    branches = await enumerateUnmergedBranches(git, baseRef, IN_FLIGHT_REF_PATTERNS);
  } catch (error) {
    skipNotes.push(`skipped in-flight branch enumeration: ${error instanceof Error ? error.message : String(error)}`);
    return { overlaps: [], skipNotes };
  }

  const unshipped: Array<{ branch: string; committedAt: number }> = [];
  for (const branch of branches) {
    try {
      if (await isShippedBranch(git, baseRef, branch)) continue;
      unshipped.push({ branch, committedAt: await committedAt(git, branch) });
    } catch (error) {
      skipNotes.push(`skipped in-flight branch ${branch}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  unshipped.sort((left, right) => right.committedAt - left.committedAt || left.branch.localeCompare(right.branch));

  const overlaps: BranchOverlap[] = [];
  const issueStateReader = readIssueState
    ?? (gh && cwd && repository ? makeIssueStateReader(gh, cwd, repository) : undefined);
  for (const { branch } of unshipped.slice(0, Math.max(0, maxBranches))) {
    try {
      const changedPaths = await changedPathsSinceMergeBase(git, baseRef, branch);
      if (changedPaths === null) {
        skipNotes.push(`skipped merge-base comparison for branch ${branch}: no merge base`);
        continue;
      }
      const sharedPaths = intersectFiles([...citedPaths], changedPaths);
      if (sharedPaths.length > 0) {
        const issue = repository && issueStateReader
          ? await traceBranchIssue({ git, branch, repository, readIssueState: issueStateReader })
          : null;
        overlaps.push({ branch, sharedPaths, issue });
      }
    } catch (error) {
      skipNotes.push(`skipped in-flight diff for branch ${branch}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { overlaps, skipNotes };
}
