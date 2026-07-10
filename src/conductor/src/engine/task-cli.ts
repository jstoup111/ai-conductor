// `conduct task start <id>` and `conduct task done <id>` — CLI for the
// task-driven pipeline. Starts or marks a task as done interactively or
// from automation.
//
// Mirrors the derive-feedback-cli.ts pattern: detected before the interactive
// pipeline boots, pure parsing (no I/O), returns dispatch type or null.

import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

export type TaskDispatch = { kind: 'start'; id: string } | { kind: 'done'; id: string } | { kind: 'guide' };

/**
 * Parse argv for the `task` subcommand.
 *   conduct task start <id>      → {kind:'start', id:'<id>'}
 *   conduct task done <id>       → {kind:'done', id:'<id>'}
 *   conduct task [malformed]     → {kind:'guide'}
 *   (any other sub)              → null
 */
export function detectTaskCommand(argv: string[]): TaskDispatch | null {
  if (argv[2] !== 'task') return null;

  const verb = argv[3];
  const id = argv[4];

  // Missing or unknown verb
  if (!verb || (verb !== 'start' && verb !== 'done')) {
    return { kind: 'guide' };
  }

  // Missing or empty id
  if (!id) {
    return { kind: 'guide' };
  }

  return { kind: verb, id };
}

/**
 * Dispatch the `task` subcommand. Prints guide text or handles the task
 * start/done operations. (Future: this will coordinate with task-status.json)
 *
 * Exit codes:
 *   0 = success
 *   2 = usage/guide
 */
export async function dispatchTaskCommand(cmd: TaskDispatch, cwd: string): Promise<number> {
  if (cmd.kind === 'guide') {
    console.error(
      'conduct task start <id>\n' +
        '  Start or resume task <id> (H9 grammar [A-Za-z0-9._-]+). Prompts for\n' +
        '  confirmation and updates task-status.json.\n' +
        '\n' +
        'conduct task done <id>\n' +
        '  Mark task <id> as complete. Updates task-status.json and prints\n' +
        '  a completion summary.',
    );
    return 2;
  }

  // TODO: Implement task start/done logic
  // For now, just acknowledge the command
  console.log(`Task ${cmd.kind}: ${cmd.id}`);
  return 0;
}

/**
 * Start a task by flipping its status to 'in_progress' in task-status.json
 * and writing a stamp file at .pipeline/current-task.
 *
 * Uses atomic writes (temp file + rename) for JSON updates to prevent torn
 * writes during concurrent access.
 *
 * Exit codes:
 *   0 = success (row found and flipped)
 *   1 = id not found in task-status.json rows
 */
export async function runTaskStart(projectRoot: string, id: string): Promise<number> {
  const statusPath = join(projectRoot, '.pipeline/task-status.json');
  const pipelineDir = join(projectRoot, '.pipeline');
  const stampPath = join(pipelineDir, 'current-task');

  // Read task-status.json
  let raw: string;
  try {
    raw = await readFile(statusPath, 'utf-8');
  } catch (err) {
    console.error(`[task-cli] could not read task-status.json: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[task-cli] corrupt task-status.json: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  // Extract tasks array
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error('[task-cli] task-status.json root is not an object');
    return 1;
  }

  const status = parsed as Record<string, unknown>;
  if (!Array.isArray(status.tasks)) {
    console.error('[task-cli] task-status.json does not have a tasks array');
    return 1;
  }

  const tasks = status.tasks as Array<Record<string, unknown>>;

  // Find the row with matching id
  const rowIndex = tasks.findIndex((t) => t.id === id);
  if (rowIndex === -1) {
    console.error(`[task-cli] task id "${id}" not found in task-status.json`);
    return 1;
  }

  // Flip status to in_progress
  const task = tasks[rowIndex] as Record<string, unknown>;
  task.status = 'in_progress';

  // Write task-status.json atomically
  await mkdir(pipelineDir, { recursive: true });

  const tempFile = join(
    pipelineDir,
    `.task-status.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    await writeFile(tempFile, JSON.stringify(status, null, 2));
    await rename(tempFile, statusPath);
  } catch (err) {
    await rm(tempFile, { force: true }).catch(() => {});
    console.error(`[task-cli] failed to write task-status.json: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  // Write stamp file
  try {
    await writeFile(stampPath, id);
  } catch (err) {
    console.error(`[task-cli] failed to write stamp file: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  return 0;
}
