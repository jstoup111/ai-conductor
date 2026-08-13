import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { execa } from 'execa';
import { parsePlanTaskPaths } from './plan-task-parse.js';
import {
  parsePlanTaskVerifyOnly,
  canonicalTaskId,
  fileMatchesPlanPath,
  filesForCommit,
  listCommitsWithTrailers,
} from './autoheal.js';
import { evaluateScopeContainment } from './plan-scope-containment.js';
import { parseScopeTrailers, type ScopeTrailer } from './scope-trailer.js';
import { resolveScopeWideningRationale } from './scope-widening-rationale.js';
import { normalizeTasks } from './task-progress.js';
import type { ConductorEvent } from '../types/events.js';

/**
 * Per-task work-happened floor (task 1 of the per-task-commit-floor plan):
 * for every plan task id, confirm it is EITHER covered by a commit carrying
 * a matching `Task:` trailer OR marked verify-only in the plan. A gap is a
 * plan task id satisfying neither. Fail-soft: any thrown error (missing
 * plan, git failure, malformed input) degrades to a satisfied, no-gap report
 * with a skip note — this floor never fabricates a gap it couldn't actually
 * verify.
 */
export interface PerTaskFloorReport {
  satisfied: boolean;
  gaps: string[];
  coveredTasks: string[];
  markedTasks: string[];
  skipNotes: string[];
}

export interface ContainmentFloorViolation {
  taskId: string;
  sha: string;
  paths: string[];
}

/** A commit-local `Scope:` widening supplied to the isolated build reviewer. */
export interface AcceptedScopeWidening {
  path: string;
  rationale: string;
  derived: boolean;
  taskId: string;
  sha: string;
}

export interface ContainmentFloorReport {
  satisfied: boolean;
  violations: ContainmentFloorViolation[];
  acceptedWidenings: AcceptedScopeWidening[];
  unresolvedChecks: ContainmentCheckUnresolvedRecord[];
  skipNotes: string[];
}

export type ContainmentCheckUnresolvedRecord = Extract<
  ConductorEvent,
  { type: 'containment_check_unresolved' }
>;

export async function runPerTaskCommitFloor(args: {
  projectRoot: string;
  planPath: string;
  taskStatusPath?: string;
}): Promise<PerTaskFloorReport> {
  try {
    const planText = await readFile(args.planPath, 'utf-8');
    const planIds = [...parsePlanTaskPaths(planText).keys()];

    const commits = await listCommitsWithTrailers(args.projectRoot);
    const coveredCanonical = new Set<string>();
    for (const commit of commits) {
      for (const value of commit.trailers['Task'] ?? []) {
        coveredCanonical.add(canonicalTaskId(value));
      }
    }

    const verifyOnly = parsePlanTaskVerifyOnly(planText);
    const skippedCanonical = await readSkippedTaskIds(
      args.taskStatusPath ?? join(args.projectRoot, '.pipeline/task-status.json'),
    );

    const coveredTasks: string[] = [];
    const markedTasks: string[] = [];
    const gaps: string[] = [];

    for (const id of planIds) {
      const covered = coveredCanonical.has(canonicalTaskId(id));
      const marked = verifyOnly.get(id) === true || skippedCanonical.has(canonicalTaskId(id));
      if (covered) coveredTasks.push(id);
      if (marked) markedTasks.push(id);
      if (!covered && !marked) gaps.push(id);
    }

    return {
      satisfied: gaps.length === 0,
      gaps,
      coveredTasks,
      markedTasks,
      skipNotes: [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      satisfied: true,
      gaps: [],
      coveredTasks: [],
      markedTasks: [],
      skipNotes: [`per-task-commit-floor: ${message}`],
    };
  }
}

/**
 * Commit-history containment backstop. Unlike the commit-msg hook, this runs
 * after the branch is built, so it records rather than refuses an undeclared
 * change. The report is intentionally self-contained: build_review receives a
 * diff, not commit messages, and needs accepted `Scope:` widenings explicitly.
 */
export async function runContainmentFloor(args: {
  projectRoot: string;
  planPath: string;
  scopeContainmentEnforced?: boolean;
}): Promise<ContainmentFloorReport> {
  try {
    await assertGitRepository(args.projectRoot);
    if (await isContainmentFloorExempt(args.projectRoot)) {
      return skippedContainmentFloor('commit exemption is active');
    }

    const planText = await readFile(args.planPath, 'utf-8');
    const parsedTaskPaths = parsePlanTaskPaths(planText);
    const taskPaths = new Map(
      [...parsedTaskPaths.entries()].filter(([id]) => parsedTaskPaths.declaredTaskIds.has(id)),
    );
    if (taskPaths.size === 0) {
      return skippedContainmentFloor('plan contains no explicit Files declarations');
    }
    const tasksByCanonicalId = new Map(
      [...taskPaths.entries()].map(([id, files]) => [canonicalTaskId(id), { id, files: [...files] }]),
    );
    const commits = await listCommitsWithTrailers(args.projectRoot);
    const violations: ContainmentFloorViolation[] = [];
    const acceptedWidenings: AcceptedScopeWidening[] = [];
    const unresolvedLedger = await readUnresolvedContainmentChecks(args.projectRoot);

    for (const commit of commits) {
      if (await isMergeCommit(args.projectRoot, commit.sha)) continue;

      const taskIds = new Set((commit.trailers.Task ?? []).map(canonicalTaskId));
      if (taskIds.size === 0) continue;

      const files = await filesForCommit(args.projectRoot, commit.sha);
      const message = await commitMessage(args.projectRoot, commit.sha);
      const scopeTrailers = parseScopeTrailers(message, files);

      for (const taskId of taskIds) {
        const task = tasksByCanonicalId.get(taskId);
        if (!task) continue;

        const result = evaluateScopeContainment({
          stagedPaths: files,
          task: { id: task.id, status: 'in_progress', files: task.files },
          scopeTrailers,
        });
        for (const scope of scopeTrailers) {
          if (!files.some((path) => path === scope.path || path.startsWith(`${scope.path}/`))) {
            continue;
          }
          if (task.files.some((declaredPath) => fileMatchesPlanPath(scope.path, declaredPath))) {
            continue;
          }
          if (args.scopeContainmentEnforced !== false) acceptedWidenings.push({
            path: scope.path,
            ...resolveScopeWideningRationale(scope.path, scopeTrailers, message),
            taskId: task.id,
            sha: commit.sha,
          });
        }

        if (!result.allowed) {
          for (const path of result.offendingPaths) {
            if (args.scopeContainmentEnforced !== false) acceptedWidenings.push({
              path,
              ...resolveScopeWideningRationale(path, scopeTrailers, message),
              taskId: task.id,
              sha: commit.sha,
            });
          }
        }
      }
    }

    return {
      satisfied: violations.length === 0,
      violations,
      acceptedWidenings: args.scopeContainmentEnforced === false ? [] : acceptedWidenings,
      unresolvedChecks: unresolvedLedger.checks,
      skipNotes: args.scopeContainmentEnforced === false ? [] : unresolvedLedger.skipNotes,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return skippedContainmentFloor(message);
  }
}

function skippedContainmentFloor(message: string): ContainmentFloorReport {
  return {
    satisfied: true,
    violations: [],
    acceptedWidenings: [],
    unresolvedChecks: [],
    skipNotes: [`containment-floor: ${message}`],
  };
}

const UNRESOLVED_CONTAINMENT_FAILURES = new Set<ContainmentCheckUnresolvedRecord['failure']>([
  'commit-message-unreadable',
  'task-status-unreadable',
  'task-status-malformed',
  'evaluation-failed',
]);

/**
 * The hook and engine own separate event files because they are separate
 * processes. Read both as the same event schema, skipping only bad records so
 * a corrupt hook append cannot hide valid engine records.
 */
async function readUnresolvedContainmentChecks(projectRoot: string): Promise<{
  checks: ContainmentCheckUnresolvedRecord[];
  skipNotes: string[];
}> {
  const pipelineDir = join(projectRoot, '.pipeline');
  const ledgers = [
    { name: 'events', path: join(pipelineDir, 'events.jsonl'), required: false },
    { name: 'hook-events', path: join(pipelineDir, 'hook-events.jsonl'), required: true },
  ];
  const checks: ContainmentCheckUnresolvedRecord[] = [];
  const skipNotes: string[] = [];

  for (const ledger of ledgers) {
    let raw: string;
    try {
      raw = await readFile(ledger.path, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (ledger.required) skipNotes.push('containment-floor: hook-events ledger is unrecorded');
        continue;
      }
      skipNotes.push(`containment-floor: ${ledger.name} ledger unreadable`);
      continue;
    }

    let malformed = false;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const event = parseUnresolvedContainmentCheck(JSON.parse(line) as unknown);
        if (event !== undefined) checks.push(event);
      } catch {
        malformed = true;
      }
    }
    if (malformed) skipNotes.push(`containment-floor: ${ledger.name} ledger contains malformed records`);
  }

  return {
    checks: checks.sort((left, right) => left.ts - right.ts),
    skipNotes,
  };
}

function parseUnresolvedContainmentCheck(value: unknown): ContainmentCheckUnresolvedRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const event = value as Record<string, unknown>;
  if (
    event.type !== 'containment_check_unresolved'
    || typeof event.failure !== 'string'
    || !UNRESOLVED_CONTAINMENT_FAILURES.has(event.failure as ContainmentCheckUnresolvedRecord['failure'])
    || !isValidEventTimestamp(event.ts)
    || (event.taskId !== undefined && typeof event.taskId !== 'string')
  ) {
    return undefined;
  }
  return {
    type: 'containment_check_unresolved',
    failure: event.failure as ContainmentCheckUnresolvedRecord['failure'],
    ...(event.taskId === undefined ? {} : { taskId: event.taskId }),
    ts: normalizeEventTimestamp(event.ts),
  };
}

function isValidEventTimestamp(value: unknown): value is number | string {
  return (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

function normalizeEventTimestamp(value: number | string): number {
  return typeof value === 'number' ? value : Date.parse(value);
}

async function assertGitRepository(projectRoot: string): Promise<void> {
  const result = await execa('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: projectRoot,
    reject: false,
  });
  if (result.exitCode !== 0 || result.stdout.trim() !== 'true') {
    throw new Error(`git repository check failed: ${result.stderr || 'not a work tree'}`);
  }
}

async function isContainmentFloorExempt(projectRoot: string): Promise<boolean> {
  if (process.env.CONDUCT_ENGINE_COMMIT === '1') return true;

  const gitPath = async (name: string): Promise<string> => {
    const result = await execa('git', ['rev-parse', '--git-path', name], {
      cwd: projectRoot,
      reject: false,
    });
    if (result.exitCode !== 0 || !result.stdout.trim()) {
      throw new Error(`git path ${name} failed: ${result.stderr || 'unknown error'}`);
    }
    const path = result.stdout.trim();
    return isAbsolute(path) ? path : join(projectRoot, path);
  };

  for (const name of ['rebase-merge', 'rebase-apply']) {
    try {
      if ((await stat(await gitPath(name))).isDirectory()) return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  return false;
}

async function isMergeCommit(projectRoot: string, sha: string): Promise<boolean> {
  const result = await execa('git', ['rev-list', '--parents', '-n', '1', sha], {
    cwd: projectRoot,
    reject: false,
  });
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    throw new Error(`git parent lookup ${sha} failed: ${result.stderr || 'unknown error'}`);
  }
  return result.stdout.trim().split(/\s+/).length > 2;
}

async function commitMessage(projectRoot: string, sha: string): Promise<string> {
  const result = await execa('git', ['show', '-s', '--format=%B', sha], {
    cwd: projectRoot,
    reject: false,
  });
  if (result.exitCode !== 0) {
    throw new Error(`git show ${sha} failed: ${result.stderr || 'unknown error'}`);
  }
  return result.stdout;
}

/**
 * Canonical ids of `.pipeline/task-status.json` rows with `status ===
 * 'skipped'`. Fail-soft: a missing/unreadable/malformed status file (or one
 * `normalizeTasks` can't make sense of) yields an empty set — this is the
 * ordinary "no data" case, not an error worth a skip note.
 */
async function readSkippedTaskIds(taskStatusPath: string): Promise<Set<string>> {
  const skipped = new Set<string>();
  let raw: string;
  try {
    raw = await readFile(taskStatusPath, 'utf-8');
  } catch {
    return skipped;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return skipped;
  }
  for (const task of normalizeTasks(parsed)) {
    if (task.status === 'skipped' && task.id !== undefined) {
      skipped.add(canonicalTaskId(task.id));
    }
  }
  return skipped;
}

export function renderPerTaskFloorReport(report: PerTaskFloorReport): string[] {
  return report.gaps.map(
    (id) =>
      `Advisory: task ${id} produced no commit carrying its Task: trailer and no verify-only/skip marker — confirm its work shipped inside another task's commit or add a **Verify-only:** marker.`,
  );
}

export function renderContainmentFloorReport(report: ContainmentFloorReport): string[] {
  return [
    ...report.violations.map(
      (violation) =>
        `Advisory: containment violation for Task ${violation.taskId} in commit ${violation.sha}; offending paths: ${violation.paths.join(', ')}.`,
    ),
    ...report.unresolvedChecks.map((check) =>
      `Advisory: containment check unresolved${check.taskId === undefined ? '' : ` for Task ${check.taskId}`}; ${check.failure}.`,
    ),
    ...report.skipNotes.map((note) => `Advisory: ${note}.`),
  ];
}
