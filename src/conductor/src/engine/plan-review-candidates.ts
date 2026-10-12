import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import {
  parsePlanTaskBodies,
  parsePlanTaskDoneWhen,
  parsePlanTaskPaths,
} from './plan-task-parse.js';
import {
  parsePlanDependencyGraph,
  transitiveDependencies,
  type PlanDependencyViolation,
} from './plan-dependencies.js';
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

export interface WiringSurfaceItem {
  readonly surface: string;
  readonly productionCaller: string;
}

export interface ReachabilityCandidate {
  readonly lens: 'reachability';
  readonly identifier: string;
  readonly taskId: string;
  readonly evidence: string;
  readonly searchedPaths: readonly string[];
}

export interface ReachabilityCandidatesInput {
  readonly worktreePath: string;
  readonly planText: string;
  readonly architectureReviewText: string;
}

export interface DependencyOrderCandidate {
  readonly lens: 'dependency-order';
  readonly taskId: string;
  readonly relatedTaskId: string;
  readonly identifier: string;
  readonly dependencyClosure: readonly string[];
}

/** Refuses candidate construction when plan dependency metadata is not trustworthy. */
export class PlanReviewInputError extends Error {
  constructor(readonly violations: readonly PlanDependencyViolation[]) {
    super(violations.map((violation) => violation.message).join('; '));
    this.name = 'PlanReviewInputError';
  }
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

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const TASK_HEADING = /^#{1,6}\s+Task\s+([A-Za-z0-9._-]+)/i;

function identifierTokens(text: string): string[] {
  return [...new Set(backtickedIdentifiers(text).filter((token) => IDENTIFIER.test(token)))];
}

function stepAndFileIdentifiers(taskBody: string): string[] {
  let section: 'steps' | 'files' | undefined;
  const identifiers: string[] = [];
  for (const line of taskBody.split(/\r?\n/)) {
    if (/^\s*\*\*Steps:\*\*\s*$/i.test(line)) {
      section = 'steps';
      continue;
    }
    if (/^\s*\*\*Files likely touched:\*\*\s*$/i.test(line)) {
      section = 'files';
      continue;
    }
    if (/^\s*\*\*[^*]+:\*\*\s*$/.test(line)) {
      section = undefined;
      continue;
    }
    if (section) identifiers.push(...identifierTokens(line));
  }
  return identifiers;
}

function taskIdentifierEvidence(planText: string): Map<string, Map<string, string>> {
  const evidence = new Map<string, Map<string, string>>();
  let taskId: string | undefined;
  for (const [index, line] of planText.split(/\r?\n/).entries()) {
    const heading = line.match(TASK_HEADING);
    if (heading) {
      taskId = heading[1];
      continue;
    }
    if (!taskId) continue;
    for (const identifier of identifierTokens(line)) {
      const byIdentifier = evidence.get(taskId) ?? new Map<string, string>();
      if (!evidence.has(taskId)) evidence.set(taskId, byIdentifier);
      byIdentifier.set(identifier, `plan.md:${index + 1}`);
    }
  }
  return evidence;
}

function sourceMentions(contents: string, identifier: string): boolean {
  return new RegExp(`\\b${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(contents);
}

/** Parses the architecture review's optional design-time Wiring Surface table. */
export function parseWiringSurface(reviewText: string): readonly WiringSurfaceItem[] {
  const lines = reviewText.split(/\r?\n/);
  const heading = lines.findIndex((line) => /^##\s+Wiring Surface\s*$/i.test(line));
  if (heading === -1) return [];

  const items: WiringSurfaceItem[] = [];
  for (const line of lines.slice(heading + 1)) {
    if (/^#{1,2}\s/.test(line)) break;
    if (!line.includes('|') || /^\s*\|?\s*-{3,}/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2 || /^new surface$/i.test(cells[0])) continue;
    items.push({
      surface: cells[0].replaceAll('`', ''),
      productionCaller: cells[1].replaceAll('`', ''),
    });
  }
  return items;
}

/**
 * Finds planned exports or primitives that have neither a production source
 * caller nor a named existing entry point in a task's Done-when check.
 * Candidates are review inputs, never findings.
 */
export async function reachabilityCandidates({
  worktreePath,
  planText,
  architectureReviewText,
}: ReachabilityCandidatesInput): Promise<readonly ReachabilityCandidate[]> {
  const taskPaths = parsePlanTaskPaths(planText);
  const taskBodies = parsePlanTaskBodies(planText);
  const evidenceByTask = taskIdentifierEvidence(planText);
  const taskDoneWhen = parsePlanTaskDoneWhen(planText);
  const identifiers = new Map<string, { taskId: string; evidence: string }>();

  for (const [taskId, body] of taskBodies) {
    const evidence = evidenceByTask.get(taskId);
    for (const identifier of identifierTokens(body)) {
      const location = evidence?.get(identifier);
      if (location && !identifiers.has(identifier)) identifiers.set(identifier, { taskId, evidence: location });
    }
  }
  for (const item of parseWiringSurface(architectureReviewText)) {
    for (const identifier of identifierTokens(item.surface)) {
      if (identifiers.has(identifier)) continue;
      for (const [taskId, evidence] of evidenceByTask) {
        const location = evidence.get(identifier);
        if (location) {
          identifiers.set(identifier, { taskId, evidence: location });
          break;
        }
      }
    }
  }

  const sourcePaths = (await filesBelow(worktreePath)).filter((path) => !isPlanReviewTestPath(path)).sort();
  const sourceContents = new Map(await Promise.all(sourcePaths.map(async (path) => [
    path,
    await readFile(join(worktreePath, path), 'utf8'),
  ] as const)));
  const candidates: ReachabilityCandidate[] = [];

  for (const [identifier, introduced] of identifiers) {
    const definingPaths = taskPaths.get(introduced.taskId) ?? new Set<string>();
    const searchedPaths = sourcePaths.filter((path) => !definingPaths.has(path));
    const hasSourceCaller = searchedPaths.some((path) => sourceMentions(sourceContents.get(path) ?? '', identifier));
    const hasNamedEntryPoint = [...taskDoneWhen.values()].some((checks) => checks.some((check) => {
      const named = identifierTokens(check);
      return named.includes(identifier) && named.some((name) => name !== identifier
        && sourcePaths.some((path) => sourceMentions(sourceContents.get(path) ?? '', name)));
    }));
    if (hasSourceCaller || hasNamedEntryPoint) continue;
    candidates.push({
      lens: 'reachability',
      identifier,
      taskId: introduced.taskId,
      evidence: introduced.evidence,
      searchedPaths,
    });
  }

  return candidates;
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

/**
 * Finds Done-when citations whose introducing task is not a direct or
 * transitive prerequisite. Candidates are review inputs, never findings.
 */
export function dependencyOrderCandidates(planText: string): readonly DependencyOrderCandidate[] {
  const graph = parsePlanDependencyGraph(planText);
  if (graph.violations.length > 0) throw new PlanReviewInputError(graph.violations);

  const taskBodies = parsePlanTaskBodies(planText);
  const introducedBy = new Map<string, string>();
  for (const [taskId, body] of taskBodies) {
    for (const identifier of stepAndFileIdentifiers(body)) {
      if (!introducedBy.has(identifier)) introducedBy.set(identifier, taskId);
    }
  }

  const candidates: DependencyOrderCandidate[] = [];
  for (const [taskId, checks] of parsePlanTaskDoneWhen(planText)) {
    const closure = transitiveDependencies(graph.dependenciesByTaskId, taskId);
    for (const identifier of identifierTokens(checks.join('\n'))) {
      const relatedTaskId = introducedBy.get(identifier);
      if (!relatedTaskId || relatedTaskId === taskId || closure.has(relatedTaskId)) continue;
      candidates.push({
        lens: 'dependency-order',
        taskId,
        relatedTaskId,
        identifier,
        dependencyClosure: [...closure].sort(),
      });
    }
  }
  return candidates;
}
