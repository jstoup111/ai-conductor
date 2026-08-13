import { appendFile, readFile } from 'node:fs/promises';
import { writeSync } from 'node:fs';
import { execa } from 'execa';
import { extractBodyTaskIds } from './autoheal.js';
import { loadConfig, type ConfigResult } from './config.js';
import {
  evaluateScopeContainment,
  type ScopeContainmentTask,
} from './plan-scope-containment.js';
import { resolveBuildReviewConfig } from './resolved-config.js';
import { parseScopeTrailers } from './scope-trailer.js';
import { resolveScopeWideningRationale } from './scope-widening-rationale.js';
import type { ConductorEvent } from '../types/events.js';

export interface ScopeCheckCommand {
  commitMessagePath: string;
}

/**
 * The resolved shipped default for report-only containment recording. The
 * recorder never refuses commits; see adr-2026-08-09-non-blocking-plan-scope-containment D3.
 */
const DEFAULT_SCOPE_CHECK_ENFORCEMENT = false;

type ScopeCheckConfigLoader = (projectRoot: string) => Promise<ConfigResult>;

/** Load the resolved containment mode, failing open to report-only. */
export async function loadScopeCheckEnforcement(
  projectRoot: string,
  load: ScopeCheckConfigLoader = loadConfig,
): Promise<boolean> {
  try {
    const result = await load(projectRoot);
    if (!result.ok) return DEFAULT_SCOPE_CHECK_ENFORCEMENT;
    return resolveBuildReviewConfig(result.config).scopeContainmentEnforced;
  } catch {
    return DEFAULT_SCOPE_CHECK_ENFORCEMENT;
  }
}

/** Recognize the hook-only `conduct-ts scope-check <commit-message>` command. */
export function detectScopeCheckCommand(argv: string[]): ScopeCheckCommand | null {
  if (argv[2] !== 'scope-check' || !argv[3]) return null;
  return { commitMessagePath: argv[3] };
}

export interface ScopeCheckDependencies {
  projectRoot: string;
  commitMessagePath: string;
  /**
   * Resolved containment recording mode, never a commit-blocking enforcement
   * switch; see adr-2026-08-09-non-blocking-plan-scope-containment D3.
   */
  enforce?: boolean;
  readFile?: (path: string) => Promise<string>;
  stagedPaths?: () => Promise<string[]>;
  print?: (message: string) => void;
}

/**
 * Check a staged commit against its Task trailer's declared paths.
 *
 * Exit 0 means allowed, not applicable, or an advisory out-of-floor path; 3
 * means the applicable check could not be resolved.
 */
export async function runScopeCheck(deps: ScopeCheckDependencies): Promise<number> {
  const read = deps.readFile ?? ((path: string) => readFile(path, 'utf8'));
  let commitMessage: string;
  try {
    commitMessage = await read(deps.commitMessagePath);
  } catch {
    await appendUnresolvedContainmentCheck(deps.projectRoot, {
      type: 'containment_check_unresolved',
      failure: 'commit-message-unreadable',
      ts: Date.now(),
    });
    return 3;
  }
  const taskId = extractBodyTaskIds(commitMessage)[0];
  if (taskId === undefined) return 0;

  let taskStatus: string;
  try {
    taskStatus = await read(`${deps.projectRoot}/.pipeline/task-status.json`);
  } catch (error) {
    if (isMissingFileError(error)) return 0;
    await appendUnresolvedContainmentCheck(deps.projectRoot, {
      type: 'containment_check_unresolved',
      failure: 'task-status-unreadable',
      taskId,
      ts: Date.now(),
    });
    return 3;
  }

  let tasks: ScopeContainmentTask[];
  try {
    tasks = parseScopeContainmentTasks(taskStatus);
  } catch {
    await appendUnresolvedContainmentCheck(deps.projectRoot, {
      type: 'containment_check_unresolved',
      failure: 'task-status-malformed',
      taskId,
      ts: Date.now(),
    });
    return 3;
  }
  const activeTask = tasks.find((task) => task.id === taskId);
  if (
    activeTask === undefined ||
    activeTask.status !== 'in_progress' ||
    activeTask.files === undefined ||
    activeTask.files.length === 0
  ) {
    return 0;
  }

  try {
    const stagedPaths = await (deps.stagedPaths ?? (() => listStagedPaths(deps.projectRoot)))();
    const result = evaluateScopeContainment({
      stagedPaths,
      task: activeTask,
      scopeTrailers: parseScopeTrailers(commitMessage, stagedPaths),
    });
    if (result.allowed) return 0;
    if (deps.enforce !== true) return 0;

    const print = deps.print ?? ((message: string) => writeSync(process.stderr.fd, `${message}\n`));
    print(renderScopeAdvisory(result.taskId, result.offendingPaths, commitMessage, stagedPaths));
    return 0;
  } catch {
    await appendUnresolvedContainmentCheck(deps.projectRoot, {
      type: 'containment_check_unresolved',
      failure: 'evaluation-failed',
      taskId,
      ts: Date.now(),
    });
    return 3;
  }
}

/** Record hook-owned uncertainty without allowing filesystem failures to block a commit. */
export async function appendUnresolvedContainmentCheck(
  projectRoot: string,
  event: Extract<ConductorEvent, { type: 'containment_check_unresolved' }>,
): Promise<void> {
  try {
    await appendFile(`${projectRoot}/.pipeline/hook-events.jsonl`, `${JSON.stringify(event)}\n`);
  } catch {
    // The hook's containment verdict remains advisory even when its sibling ledger is unavailable.
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
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

const MAX_RENDERED_OFFENDING_PATHS = 20;

function renderScopeAdvisory(
  taskId: string,
  offendingPaths: readonly string[],
  commitMessage: string,
  stagedPaths: readonly string[],
): string {
  const renderedPaths = offendingPaths.slice(0, MAX_RENDERED_OFFENDING_PATHS);
  const remainingPathCount = offendingPaths.length - renderedPaths.length;
  const scopeTrailers = parseScopeTrailers(commitMessage, stagedPaths);
  return [
    `scope-check: Task ${taskId} has staged paths outside its declared scope (advisory):`,
    ...renderedPaths.map((path) => `  ${path}`),
    ...(remainingPathCount === 0 ? [] : [`  … ${remainingPathCount} more undeclared paths`]),
    'Record each widening by adding:',
    ...renderedPaths.map((path) => `  Scope: ${path} — ${resolveScopeWideningRationale(path, scopeTrailers, commitMessage).rationale}`),
  ].join('\n');
}
