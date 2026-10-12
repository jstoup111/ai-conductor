import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { parsePlanTaskBodies, parsePlanTaskPaths } from './plan-task-parse.js';
import { isTestFilePath } from './test-path.js';

export interface TestImpactCandidate {
  readonly lens: 'test-impact';
  readonly taskId: string;
  readonly testPath: string;
  readonly evidence: string;
  readonly matchedTerm: string;
}

export interface TestImpactCandidatesInput {
  readonly worktreePath: string;
  readonly planText: string;
}

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules']);

async function filesBelow(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : filesBelow(root, path);
    }
    return entry.isFile() ? [relative(root, path).replaceAll('\\', '/')] : [];
  }));
  return files.flat();
}

function isPlanReviewTestPath(path: string): boolean {
  return isTestFilePath(path) || /^(?:test|tests)(?:\/|$)/i.test(path);
}

function backtickedIdentifiers(text: string): string[] {
  return [...text.matchAll(/`([^`\r\n]+)`/g)]
    .map((match) => match[1]!.trim())
    .filter(Boolean);
}

function firstMatchingLine(text: string, term: string): number | undefined {
  const index = text.split(/\r?\n/).findIndex((line) => line.includes(term));
  return index === -1 ? undefined : index + 1;
}

/**
 * Finds existing tests that mention a task's planned path basenames or
 * backticked identifiers but are not named by any task in the plan.
 * Candidates are deliberately heuristic review inputs, never findings.
 */
export async function testImpactCandidates({
  worktreePath,
  planText,
}: TestImpactCandidatesInput): Promise<readonly TestImpactCandidate[]> {
  const taskPaths = parsePlanTaskPaths(planText);
  const listedPaths = new Set(
    [...taskPaths.values()].flatMap((paths) => [...paths].map((path) => path.replaceAll('\\', '/'))),
  );
  const taskBodies = parsePlanTaskBodies(planText);
  const testPaths = (await filesBelow(worktreePath))
    .filter(isPlanReviewTestPath)
    .filter((path) => !listedPaths.has(path))
    .sort();
  const candidates: TestImpactCandidate[] = [];

  for (const [taskId, paths] of taskPaths) {
    const terms = [...new Set([
      ...[...paths].map((path) => basename(path)),
      ...backtickedIdentifiers(taskBodies.get(taskId) ?? ''),
    ])].filter(Boolean);
    if (terms.length === 0) continue;

    for (const testPath of testPaths) {
      const contents = await readFile(join(worktreePath, testPath), 'utf8');
      for (const term of terms) {
        const line = firstMatchingLine(contents, term);
        if (line === undefined) continue;
        candidates.push({
          lens: 'test-impact',
          taskId,
          testPath,
          evidence: `${testPath}:${line}`,
          matchedTerm: term,
        });
        break;
      }
    }
  }

  return candidates;
}
