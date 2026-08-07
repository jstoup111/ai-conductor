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
import { parseScopeTrailers } from './scope-trailer.js';
import { normalizeTasks } from './task-progress.js';

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
  taskId: string;
  sha: string;
}

export interface ContainmentFloorReport {
  satisfied: boolean;
  violations: ContainmentFloorViolation[];
  acceptedWidenings: AcceptedScopeWidening[];
  skipNotes: string[];
}

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
}): Promise<ContainmentFloorReport> {
  try {
    await assertGitRepository(args.projectRoot);
    if (await isContainmentFloorExempt(args.projectRoot)) {
      return skippedContainmentFloor('commit exemption is active');
    }

    const planText = await readFile(args.planPath, 'utf-8');
    const taskPaths = parsePlanTaskPaths(planText);
    if (taskPaths.size === 0) {
      return skippedContainmentFloor('plan contains no parseable task declarations');
    }
    const tasksByCanonicalId = new Map(
      [...taskPaths.entries()].map(([id, files]) => [canonicalTaskId(id), { id, files: [...files] }]),
    );
    const commits = await listCommitsWithTrailers(args.projectRoot);
    const violations: ContainmentFloorViolation[] = [];
    const acceptedWidenings: AcceptedScopeWidening[] = [];

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
        if (!result.allowed) {
          violations.push({ taskId: task.id, sha: commit.sha, paths: result.offendingPaths });
          continue;
        }

        for (const scope of scopeTrailers) {
          if (!files.some((path) => path === scope.path || path.startsWith(`${scope.path}/`))) {
            continue;
          }
          if (task.files.some((declaredPath) => fileMatchesPlanPath(scope.path, declaredPath))) {
            continue;
          }
          acceptedWidenings.push({ ...scope, taskId: task.id, sha: commit.sha });
        }
      }
    }

    return {
      satisfied: violations.length === 0,
      violations,
      acceptedWidenings,
      skipNotes: [],
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
    skipNotes: [`containment-floor: ${message}`],
  };
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
  return report.violations.map(
    (violation) =>
      `Advisory: containment violation for Task ${violation.taskId} in commit ${violation.sha}; offending paths: ${violation.paths.join(', ')}.`,
  );
}
