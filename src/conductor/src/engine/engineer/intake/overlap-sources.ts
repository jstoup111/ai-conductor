import {
  intersectFiles,
} from '../../overlap-scan.js';
import { changedPathsSinceMergeBase, type GitRunner } from '../../rebase.js';
import { runTrackerRead, type GhRunner } from '../../tracker-client.js';
import { parseIntakeSourceRef } from '../../artifacts.js';
import { parseSourceRef } from '../issue-ref.js';
import { extractCitedPaths } from './cited-paths.js';
import { sanitizeInboundText, INBOUND_ARMOR_LINE } from './sanitize-inbound.js';
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

export interface OpenIssueOverlapResult {
  overlaps: IssueOverlap[];
  skipNotes: string[];
}

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
}): Promise<OpenIssueOverlapResult> {
  const overlaps: IssueOverlap[] = [];
  const effectiveLimit = Math.min(limit, DEFAULT_OPEN_ISSUES_LIMIT);
  const openIssues = await makeOpenIssueLister(gh, cwd, repository)(effectiveLimit);

  for (const issue of openIssues.slice(0, effectiveLimit)) {
    const sanitized = sanitizeInboundText([issue.body], {
      kind: 'github', repo: repository, number: String(issue.number),
    });
    // Armor is transport metadata, not tracker evidence. Excluding it keeps
    // its source-ref and digest tokens out of the cited-path extractor.
    const body = sanitized.text.split('\n').filter((line) => !INBOUND_ARMOR_LINE.test(line)).join('\n');
    const sharedPaths = intersectFiles([...citedPaths], extractCitedPaths(body, knownPaths));
    if (sharedPaths.length > 0) {
      overlaps.push({ issue: `#${issue.number}`, sharedPaths });
    }
  }

  return {
    overlaps,
    skipNotes: effectiveLimit > 0 && openIssues.length >= effectiveLimit
      ? [`partial comparison: reached ${effectiveLimit}-issue bound`]
      : [],
  };
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

export interface InFlightBranchSelection {
  branches: string[];
  skipNotes: string[];
}

/** Select the exact, bounded population used for both path discovery and comparison. */
export async function selectInFlightBranches({
  git,
  baseRef,
  maxBranches = DEFAULT_IN_FLIGHT_BRANCH_LIMIT,
}: {
  git: GitRunner;
  baseRef: string;
  maxBranches?: number;
}): Promise<InFlightBranchSelection> {
  const skipNotes: string[] = [];
  let branches: string[];
  try {
    // Unlike DECIDE's best-effort overlap scan, this filing path must preserve
    // a failed ref enumeration as a visible degraded-comparison note.
    const refs = await git([
      'for-each-ref',
      '--format=%(refname:short)',
      ...IN_FLIGHT_REF_PATTERNS,
    ]);
    if (refs.exitCode !== 0) {
      return { branches: [], skipNotes: [`skipped in-flight branch enumeration: ${refs.stderr}`] };
    }

    const candidates = refs.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    branches = [];
    for (const branch of candidates) {
      if (branch === baseRef || branch.endsWith(`/${baseRef}`)) continue;
      const ahead = await git(['rev-list', '--count', `${baseRef}..${branch}`]);
      const aheadCount = ahead.exitCode === 0 ? Number.parseInt(ahead.stdout.trim(), 10) : Number.NaN;
      // A failed ahead-count is indeterminate, not proof that this comparison
      // branch is merged. Keep it, matching enumerateUnmergedBranches.
      if (Number.isNaN(aheadCount) || aheadCount !== 0) branches.push(branch);
    }
  } catch (error) {
    return { branches: [], skipNotes: [`skipped in-flight branch enumeration: ${error instanceof Error ? error.message : String(error)}`] };
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
  const bound = Math.max(0, maxBranches);
  if (unshipped.length > bound) skipNotes.push(`partial comparison: reached ${bound}-branch bound`);
  return { branches: unshipped.slice(0, bound).map(({ branch }) => branch), skipNotes };
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
  selectedBranches,
}: {
  git: GitRunner;
  baseRef: string;
  citedPaths: readonly string[];
  maxBranches?: number;
  repository?: string;
  readIssueState?: IssueStateReader;
  gh?: GhRunner;
  cwd?: string;
  selectedBranches?: InFlightBranchSelection;
}): Promise<{ overlaps: BranchOverlap[]; skipNotes: string[] }> {
  const selection = selectedBranches ?? await selectInFlightBranches({ git, baseRef, maxBranches });
  // A caller that supplied the selection has already reported its selection
  // notes while building known paths; retain only per-diff notes here.
  const skipNotes = selectedBranches ? [] : [...selection.skipNotes];

  const overlaps: BranchOverlap[] = [];
  const issueStateReader = readIssueState
    ?? (gh && cwd && repository ? makeIssueStateReader(gh, cwd, repository) : undefined);
  for (const branch of selection.branches) {
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
