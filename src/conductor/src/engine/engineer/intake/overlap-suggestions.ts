export interface IssueOverlap {
  issue: string;
  sharedPaths: readonly string[];
}

export interface BranchOverlap {
  branch: string;
  sharedPaths: readonly string[];
  issue: string | null;
}

export interface OverlapSuggestion {
  issue: string;
  sharedPaths: string[];
}

export interface OverlapSuggestions {
  shown: OverlapSuggestion[];
  preAccepted: OverlapSuggestion[];
  advisory: BranchOverlap[];
  omittedCount?: number;
}

export interface BuildSuggestionsInput {
  issueOverlaps: readonly IssueOverlap[];
  branchOverlaps: readonly BranchOverlap[];
  alreadyNamed: readonly string[];
  cap?: number;
}

export function buildSuggestions({
  issueOverlaps,
  branchOverlaps,
  alreadyNamed,
  cap = 5,
}: BuildSuggestionsInput): OverlapSuggestions {
  const pathsByIssue = new Map<string, string[]>();
  const addPaths = (issue: string, sharedPaths: readonly string[]) => {
    const paths = pathsByIssue.get(issue) ?? [];
    for (const path of sharedPaths) {
      if (!paths.includes(path)) paths.push(path);
    }
    pathsByIssue.set(issue, paths);
  };

  for (const overlap of issueOverlaps) addPaths(overlap.issue, overlap.sharedPaths);

  const advisory: BranchOverlap[] = [];
  for (const overlap of branchOverlaps) {
    if (overlap.issue === null) advisory.push(overlap);
    else addPaths(overlap.issue, overlap.sharedPaths);
  }

  const namedIssues = new Set(alreadyNamed);
  const shown: OverlapSuggestion[] = [];
  const preAccepted: OverlapSuggestion[] = [];
  for (const [issue, sharedPaths] of pathsByIssue) {
    const suggestion = { issue, sharedPaths };
    if (namedIssues.has(issue)) preAccepted.push(suggestion);
    else shown.push(suggestion);
  }

  const issueNumber = (issue: string) => Number.parseInt(issue.slice(issue.lastIndexOf("#") + 1), 10);
  const rankedShown = [...shown].sort((left, right) => {
    const pathCountOrder = right.sharedPaths.length - left.sharedPaths.length;
    if (pathCountOrder !== 0) return pathCountOrder;

    const leftIssueNumber = issueNumber(left.issue);
    const rightIssueNumber = issueNumber(right.issue);
    if (Number.isFinite(leftIssueNumber) && Number.isFinite(rightIssueNumber)) {
      const issueNumberOrder = leftIssueNumber - rightIssueNumber;
      if (issueNumberOrder !== 0) return issueNumberOrder;
    }

    return left.issue < right.issue ? -1 : left.issue > right.issue ? 1 : 0;
  });
  const cappedShown = rankedShown.slice(0, cap);
  const omittedCount = rankedShown.length - cappedShown.length;

  return {
    shown: cappedShown,
    preAccepted,
    advisory,
    ...(omittedCount > 0 ? { omittedCount } : {}),
  };
}
