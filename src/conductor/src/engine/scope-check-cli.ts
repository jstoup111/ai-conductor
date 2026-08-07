import { readFile } from 'node:fs/promises';
import { execa } from 'execa';
import { extractBodyTaskIds } from './autoheal.js';
import {
  evaluateScopeContainment,
  type ScopeContainmentTask,
} from './plan-scope-containment.js';
import { parseScopeTrailers } from './scope-trailer.js';

export interface ScopeCheckCommand {
  commitMessagePath: string;
}

/**
 * The resolved shipped default. Flip this single value only after live
 * containment-floor evidence supports enforcing scope refusals.
 */
export const DEFAULT_SCOPE_CHECK_ENFORCEMENT = false;

/** Recognize the hook-only `conduct-ts scope-check <commit-message>` command. */
export function detectScopeCheckCommand(argv: string[]): ScopeCheckCommand | null {
  if (argv[2] !== 'scope-check' || !argv[3]) return null;
  return { commitMessagePath: argv[3] };
}

export interface ScopeCheckDependencies {
  projectRoot: string;
  commitMessagePath: string;
  /**
   * Resolved containment enforcement mode. The shipped default is report-only
   * until live containment-floor evidence earns the one-line enforcement flip.
   */
  enforce?: boolean;
  readFile?: (path: string) => Promise<string>;
  stagedPaths?: () => Promise<string[]>;
  print?: (message: string) => void;
}

/**
 * Check a staged commit against its Task trailer's declared paths.
 *
 * Exit 0 means allowed (including a report-only violation); 2 means positively
 * refused; every other value is intentionally an abstention so the shell hook
 * can fail open.
 */
export async function runScopeCheck(deps: ScopeCheckDependencies): Promise<number> {
  try {
    const read = deps.readFile ?? ((path: string) => readFile(path, 'utf8'));
    const commitMessage = await read(deps.commitMessagePath);
    const taskId = extractBodyTaskIds(commitMessage)[0];
    if (taskId === undefined) return 1;

    const taskStatus = await read(`${deps.projectRoot}/.pipeline/task-status.json`);
    const tasks = parseScopeContainmentTasks(taskStatus);
    const activeTask = tasks.find((task) => task.id === taskId);
    if (
      activeTask === undefined ||
      activeTask.status !== 'in_progress' ||
      activeTask.files === undefined ||
      activeTask.files.length === 0 ||
      !tasks.some((task) => task.files !== undefined)
    ) {
      return 1;
    }

    const stagedPaths = await (deps.stagedPaths ?? (() => listStagedPaths(deps.projectRoot)))();
    const result = evaluateScopeContainment({
      stagedPaths,
      task: activeTask,
      scopeTrailers: parseScopeTrailers(commitMessage, stagedPaths),
    });
    if (result.allowed) return 0;

    (deps.print ?? console.error)(renderScopeRefusal(result.taskId, result.offendingPaths));
    const enforce = deps.enforce ?? DEFAULT_SCOPE_CHECK_ENFORCEMENT;
    return enforce ? 2 : 0;
  } catch {
    return 1;
  }
}

async function listStagedPaths(projectRoot: string): Promise<string[]> {
  const result = await execa('git', ['diff', '--cached', '--name-only'], {
    cwd: projectRoot,
    reject: false,
  });
  if (result.exitCode !== 0) throw new Error('could not list staged paths');
  return result.stdout.split('\n').filter(Boolean);
}

function parseScopeContainmentTasks(raw: string): ScopeContainmentTask[] {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('task-status.json is not an object');
  }

  const root = parsed as Record<string, unknown>;
  if (!Array.isArray(root.tasks)) throw new Error('task-status.json has no tasks array');
  return root.tasks.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (row.id === undefined || row.id === null || typeof row.status !== 'string') return [];
    const files = Array.isArray(row.files) && row.files.every((file) => typeof file === 'string')
      ? row.files
      : undefined;
    return [{ id: String(row.id), status: row.status, ...(files === undefined ? {} : { files }) }];
  });
}

function renderScopeRefusal(taskId: string, offendingPaths: readonly string[]): string {
  return [
    `scope-check: refusing Task ${taskId}; staged paths are outside its declared scope:`,
    ...offendingPaths.map((path) => `  ${path}`),
    'Narrow this commit to the task declaration, or justify each widening by adding:',
    ...offendingPaths.map((path) => `  Scope: ${path} — <rationale>`),
  ].join('\n');
}
