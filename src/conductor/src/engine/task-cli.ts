// `conduct task start <id>` and `conduct task done <id>` — CLI for the
// task-driven pipeline. Starts or marks a task as done interactively or
// from automation.
//
// Mirrors the derive-feedback-cli.ts pattern: detected before the interactive
// pipeline boots, pure parsing (no I/O), returns dispatch type or null.

import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  completeTaskDoneWhen,
  type DoneWhenEvidenceInput,
} from './task-progress.js';
import { writeHaltMarker } from './halt-marker.js';
import { parsePlanTaskDoneWhen } from './plan-task-parse.js';
import { appendCloseoutEvent } from './closeout-events.js';

export interface PlanGapInput {
  index: number;
  reason: string;
}

export type TaskDispatch =
  | { kind: 'start'; id: string }
  | {
      kind: 'done';
      id: string;
      doneWhen?: DoneWhenEvidenceInput[];
      planGap?: PlanGapInput;
    }
  | { kind: 'guide' };

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

  if (verb === 'start') return { kind: 'start', id };

  const doneWhen: DoneWhenEvidenceInput[] = [];
  let planGapIndex: number | undefined;
  let planGapReason: string | undefined;
  for (let index = 5; index < argv.length;) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value) return { kind: 'guide' };
    if (flag === '--done-when') {
      const match = value.match(/^(\d+)=(.+)$/);
      if (!match || Number(match[1]) < 1 || !match[2].trim()) return { kind: 'guide' };
      doneWhen.push({ index: Number(match[1]), evidence: match[2] });
    } else if (flag === '--plan-gap') {
      if (planGapIndex !== undefined || !/^\d+$/.test(value) || Number(value) < 1) {
        return { kind: 'guide' };
      }
      planGapIndex = Number(value);
    } else if (flag === '--reason') {
      if (planGapReason !== undefined || !value.trim()) return { kind: 'guide' };
      planGapReason = value;
    } else {
      return { kind: 'guide' };
    }
    index += 2;
  }

  if (planGapIndex !== undefined || planGapReason !== undefined) {
    if (planGapIndex === undefined || planGapReason === undefined || doneWhen.length > 0) {
      return { kind: 'guide' };
    }
    return { kind: 'done', id, planGap: { index: planGapIndex, reason: planGapReason } };
  }

  return doneWhen.length > 0 ? { kind: 'done', id, doneWhen } : { kind: 'done', id };
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
        'conduct task done <id> [--done-when <n>=<evidence>]...\n' +
        '  Close task <id>. Tasks with a Done when block require evidence for every check.\n' +
        '  The engine records that evidence before clearing the current-task stamp.\n' +
        '\n' +
        'conduct task done <id> --plan-gap <n> --reason <text>\n' +
        '  Halt when Done when check <n> cannot be satisfied within the approved plan.',
    );
    return 2;
  }

  if (cmd.kind === 'start') {
    return runTaskStart(cwd, cmd.id);
  }

  if (cmd.kind === 'done') {
    return runTaskDone(cwd, cmd.id, cmd.doneWhen ?? [], cmd.planGap);
  }

  // Should never reach here
  return 2;
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
    const validIds = tasks.map((t) => t.id).join(', ');
    console.error(
      `[task-cli] task id "${id}" not found in task-status.json\n` +
        `[task-cli] valid ids: ${validIds}`,
    );
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

/**
 * Clear a task by removing its stamp file at .pipeline/current-task.
 * Validates that the stamp matches the requested id before removing it.
 *
 * Safety guarantees:
 * - If stamp file contains a different id, exits non-zero and leaves stamp untouched
 * - If stamp file is absent, exits 0 (idempotent)
 * - A task with an engine-recorded `Done when:` block is completed only after
 *   the engine records evidence for every declared check
 *
 * Exit codes:
 *   0 = success (stamp removed or already absent)
 *   1 = mismatch (stamp exists but id doesn't match, stamp left untouched)
 */
export async function runTaskDone(
  projectRoot: string,
  id: string,
  doneWhen: DoneWhenEvidenceInput[] = [],
  planGap?: PlanGapInput,
): Promise<number> {
  const pipelineDir = join(projectRoot, '.pipeline');
  const stampPath = join(pipelineDir, 'current-task');

  // Try to read the current stamp
  let stampContent: string;
  try {
    stampContent = await readFile(stampPath, 'utf-8');
  } catch (err) {
    // Stamp file doesn't exist — this is idempotent success
    return 0;
  }

  // A different stamp is a sibling's current work. Never clear it.
  if (stampContent !== id) {
    console.error(`[task-cli] cannot clear task ${id}; current stamp is ${stampContent}`);
    return 1;
  }

  if (planGap) {
    return runTaskPlanGap(projectRoot, id, planGap);
  }

  const completion = await completeTaskDoneWhen(projectRoot, id, doneWhen);
  if (completion.kind === 'refused') {
    console.error(completion.message);
    return 1;
  }

  // Remove the stamp file
  try {
    await rm(stampPath);
  } catch (err) {
    console.error(`[task-cli] failed to remove stamp file: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  return 0;
}

/**
 * Halt an active task when one declared Done when check cannot be achieved
 * without widening the approved plan. This deliberately leaves both the task
 * row and current-task stamp untouched: no task has closed, and no off-plan
 * remediation task may be appended.
 */
async function runTaskPlanGap(
  projectRoot: string,
  id: string,
  planGap: PlanGapInput,
): Promise<number> {
  const pipelineDir = join(projectRoot, '.pipeline');
  let activePlanPath: string | undefined;
  try {
    const state = JSON.parse(
      await readFile(join(pipelineDir, 'engine-state.json'), 'utf-8'),
    ) as { activePlanPath?: unknown };
    if (typeof state.activePlanPath === 'string' && state.activePlanPath.trim()) {
      activePlanPath = state.activePlanPath;
    }
  } catch {
    // The diagnostic below gives the operator the actionable missing authority.
  }
  if (!activePlanPath) {
    console.error(`[task-cli] cannot report a plan gap for task ${id}: no active plan is recorded`);
    return 1;
  }

  let planText: string;
  try {
    planText = await readFile(
      isAbsolute(activePlanPath) ? activePlanPath : join(projectRoot, activePlanPath),
      'utf-8',
    );
  } catch (error) {
    console.error(
      `[task-cli] cannot report a plan gap for task ${id}: could not read the active plan: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  const check = parsePlanTaskDoneWhen(planText).get(id)?.[planGap.index - 1];
  if (!check) {
    console.error(
      `[task-cli] cannot report a plan gap for task ${id}: Done when check ${planGap.index} is not declared`,
    );
    return 1;
  }

  const reason = planGap.reason.trim();
  const haltReason =
    `Plan gap: task ${id}, Done when check ${planGap.index} cannot be satisfied under the approved plan.\n` +
    `Check: ${check}\n` +
    `Reason: ${reason}\n`;
  const write = await writeHaltMarker(projectRoot, haltReason, 'plan-gap');
  if (write.status !== 'written') {
    console.error(
      `[task-cli] failed to write classified plan-gap HALT for task ${id}: ${write.reason}`,
    );
    return 1;
  }

  appendCloseoutEvent(projectRoot, {
    type: 'loop_halt',
    reason: haltReason,
    haltClass: 'plan-gap',
    ts: new Date().toISOString(),
  });
  return 1;
}
