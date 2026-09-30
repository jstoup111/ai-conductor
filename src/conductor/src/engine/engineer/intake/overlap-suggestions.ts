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
}

export interface BuildSuggestionsInput {
  issueOverlaps: readonly IssueOverlap[];
  branchOverlaps: readonly BranchOverlap[];
  alreadyNamed: readonly string[];
  cap: number;
}

export function buildSuggestions({
  issueOverlaps,
  branchOverlaps,
  alreadyNamed,
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

  return { shown, preAccepted, advisory };
}
