// `ai-conductor task-membership-check <commit-message>` — the blocking,
// hook-only child membership check.  Unlike scope-check, a cross-child commit
// places work on the wrong PR, so uncertainty is a refusal on child branches.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';
import { extractBodyTaskIds, canonicalTaskId } from './autoheal.js';
import {
  COVERAGE_BINDING_COMPLETION_STATUSES,
  readCoverageBindingEnvelope,
  type CoverageBindingEnvelopeFilesystem,
} from './coverage-binding-envelope.js';
import { parseChildId } from './child-context.js';
import { parseFeatureBranch } from './feature-branch-identity.js';

export interface TaskMembershipCheckCommand {
  commitMessagePath: string;
}

/** Recognize the hook-only `ai-conductor task-membership-check <commit-message>` command. */
export function detectTaskMembershipCheckCommand(argv: string[]): TaskMembershipCheckCommand | null {
  if (argv[2] !== 'task-membership-check' || !argv[3]) return null;
  return { commitMessagePath: argv[3] };
}

export interface TaskMembershipCheckDependencies {
  projectRoot: string;
  commitMessagePath: string;
  readFile?: (path: string) => Promise<string>;
  symbolicRef?: () => Promise<string | undefined>;
  print?: (message: string) => void;
}

const coverageBindingFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: async () => undefined,
  writeFile: async () => undefined,
  rename: async () => undefined,
};

async function currentBranch(projectRoot: string): Promise<string | undefined> {
  try {
    const result = await execa('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      cwd: projectRoot,
      reject: false,
    });
    return result.exitCode === 0 && result.stdout.trim() ? result.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

function unreadable(taskId: string, child: number, detail: string, print: (message: string) => void): number {
  print(`task-membership-check: unreadable membership for Task ${taskId} on checked-out child ${child}: ${detail}`);
  return 1;
}

/**
 * Refuse a Task trailer that belongs to a different child. Non-child branches
 * deliberately abstain so unsliced and flat features retain their hook behavior.
 */
export async function runTaskMembershipCheck(deps: TaskMembershipCheckDependencies): Promise<number> {
  const branch = await (deps.symbolicRef ?? (() => currentBranch(deps.projectRoot)))();
  const identity = branch === undefined ? undefined : parseFeatureBranch(branch);
  if (identity?.kind !== 'child') return 0;

  const print = deps.print ?? ((message: string) => process.stderr.write(`${message}\n`));
  const read = deps.readFile ?? ((path: string) => readFile(path, 'utf8'));
  let message: string;
  try {
    message = await read(deps.commitMessagePath);
  } catch {
    return unreadable('<unknown>', identity.child, 'commit message cannot be read', print);
  }
  const taskIds = extractBodyTaskIds(message);
  try {
    const stamped = (await read(join(deps.projectRoot, '.pipeline', 'current-task'))).trim();
    if (stamped) taskIds.push(stamped);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return unreadable(taskIds[0] ?? '<unknown>', identity.child, 'current task stamp cannot be read', print);
    }
  }
  if (taskIds.length === 0) return 0;

  const envelope = await readCoverageBindingEnvelope(deps.projectRoot, coverageBindingFilesystem);
  if (!envelope?.sliceMembership || !COVERAGE_BINDING_COMPLETION_STATUSES.includes(envelope.status)) {
    return unreadable(taskIds[0]!, identity.child, 'coverage-binding envelope is missing or invalid', print);
  }
  if (envelope.slug !== identity.slug) {
    return unreadable(taskIds[0]!, identity.child, 'coverage-binding envelope belongs to another feature', print);
  }

  let engineState: unknown = {};
  try {
    engineState = JSON.parse(await read(join(deps.projectRoot, '.pipeline', 'engine-state.json')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return unreadable(taskIds[0]!, identity.child, 'remediation membership cannot be read', print);
    }
  }
  if (typeof engineState !== 'object' || engineState === null || Array.isArray(engineState)) {
    return unreadable(taskIds[0]!, identity.child, 'remediation membership is malformed', print);
  }

  const state = engineState as Record<string, unknown>;
  const appended = state.appendedRemediationTaskIds;
  const children = state.appendedRemediationTaskChildren;
  if (appended !== undefined && (!Array.isArray(appended) || !appended.every((id) => typeof id === 'string'))) {
    return unreadable(taskIds[0]!, identity.child, 'remediation task list is malformed', print);
  }
  if (children !== undefined && (typeof children !== 'object' || children === null || Array.isArray(children))) {
    return unreadable(taskIds[0]!, identity.child, 'remediation child map is malformed', print);
  }

  const owners = new Map<string, number>();
  for (const [id, child] of Object.entries(envelope.sliceMembership.taskSlices)) {
    const canonical = canonicalTaskId(id);
    if (owners.has(canonical) || parseChildId(child) === undefined) {
      return unreadable(taskIds[0]!, identity.child, 'coverage-binding task membership is malformed', print);
    }
    owners.set(canonical, child);
  }

  const appendedIds = appended ?? [];
  const remediationChildren = (children ?? {}) as Record<string, unknown>;
  for (const id of appendedIds) {
    const recordedChild = remediationChildren[id];
    const child = typeof recordedChild === 'string' || typeof recordedChild === 'number'
      ? parseChildId(recordedChild)
      : undefined;
    const canonical = canonicalTaskId(id);
    if (child === undefined || owners.has(canonical)) {
      return unreadable(taskIds[0]!, identity.child, 'remediation task membership is missing or malformed', print);
    }
    owners.set(canonical, child);
  }

  for (const taskId of taskIds) {
    const owner = owners.get(canonicalTaskId(taskId));
    if (owner === undefined) {
      return unreadable(taskId, identity.child, 'Task has no recorded owning child', print);
    }
    if (owner !== identity.child) {
      print(`task-membership-check: rejected Task ${taskId}; it belongs to child ${owner}, not checked-out child ${identity.child}`);
      return 1;
    }
  }
  return 0;
}
