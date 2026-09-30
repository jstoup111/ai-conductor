import { intersectFiles } from '../../overlap-scan.js';
import { runTrackerRead, type GhRunner } from '../../tracker-client.js';
import { extractCitedPaths } from './cited-paths.js';
import type { IssueOverlap } from './overlap-suggestions.js';

const DEFAULT_OPEN_ISSUES_LIMIT = 500;

interface OpenIssue {
  number: number;
  body: string;
}

type OpenIssueLister = (limit: number) => Promise<readonly OpenIssue[]>;

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
