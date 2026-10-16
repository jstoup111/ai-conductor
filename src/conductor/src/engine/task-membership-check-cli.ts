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
import { loadConfig } from './config.js';
import { parseFeatureBranch } from './feature-branch-identity.js';
import { readCommittedRemediationTaskChildren } from './routing/owner-derivation.js';
import { readRepairMarker, readRouteRecord } from './routing/route-record-store.js';
import { routedTaskIdsForHost } from './routing/round-router.js';
import { routingSettingOn } from './routing/route-types.js';
import { isEngineAppendedRemediationTaskId } from './remediation-append.js';

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

type RoutedProjection =
  | { readonly kind: 'none' }
  | { readonly kind: 'ids'; readonly ids: readonly string[] }
  | { readonly kind: 'unreadable'; readonly detail: string };

/** Read routing refs only for a routing-enabled child checkout. */
async function routedProjectionForCheckedOutChild(
  projectRoot: string,
  identity: Extract<ReturnType<typeof parseFeatureBranch>, { kind: 'child' }>,
): Promise<RoutedProjection> {
  const config = await loadConfig(projectRoot);
  if (!config.ok || !routingSettingOn(config.config)) return { kind: 'none' };

  const marker = await readRepairMarker(projectRoot, identity.slug);
  if (marker.kind === 'absent') return { kind: 'none' };
  if (marker.kind !== 'marker') return { kind: 'unreadable', detail: 'routed repair marker is unreadable' };
  if (marker.marker.host !== identity.child) return { kind: 'none' };

  const route = await readRouteRecord(projectRoot, identity.slug, marker.marker.roundId);
  if (route.kind !== 'record') return { kind: 'unreadable', detail: 'routed task allocation is unavailable' };
  return { kind: 'ids', ids: routedTaskIdsForHost(route.record, identity.child) };
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
  } catch {
    // The cache is optional: committed Child lines survive a recreated
    // worktree even when its engine-state file is absent or unreadable.
  }
  if (typeof engineState !== 'object' || engineState === null || Array.isArray(engineState)) {
    engineState = {};
  }

  const state = engineState as Record<string, unknown>;
  const children = state.appendedRemediationTaskChildren;
  // `appendedRemediationTaskIds` and its child map are compatibility cache
  // fields. Their shape must never overrule a valid committed Child line.

  const owners = new Map<string, number>();
  for (const [id, child] of Object.entries(envelope.sliceMembership.taskSlices)) {
    const canonical = canonicalTaskId(id);
    if (owners.has(canonical) || parseChildId(child) === undefined) {
      return unreadable(taskIds[0]!, identity.child, 'coverage-binding task membership is malformed', print);
    }
    owners.set(canonical, child);
  }

  const allowed = new Set(
    [...owners.entries()].filter(([, child]) => child === identity.child).map(([id]) => id),
  );
  let routed: RoutedProjection | undefined;
  const addRoutedMembershipIfNeeded = async (): Promise<number | undefined> => {
    if (routed === undefined) routed = await routedProjectionForCheckedOutChild(deps.projectRoot, identity);
    if (routed.kind === 'unreadable') {
      return unreadable(taskIds[0]!, identity.child, routed.detail, print);
    }
    if (routed.kind === 'ids') {
      for (const id of routed.ids) allowed.add(canonicalTaskId(id));
    }
    return undefined;
  };

  const remediationChildren = typeof children === 'object' && children !== null && !Array.isArray(children)
    ? children as Record<string, unknown>
    : {};
  const committedRemediationChildren = await readCommittedRemediationTaskChildren(deps.projectRoot);

  for (const taskId of taskIds) {
    const canonical = canonicalTaskId(taskId);
    if (isEngineAppendedRemediationTaskId(taskId)) {
      // A Child line travels with the committed plan while the state cache is
      // intentionally disposable.  Only a truly source-less rem task refuses.
      const hasCommittedChild = Object.hasOwn(committedRemediationChildren, taskId);
      const committedChild = parseChildId(committedRemediationChildren[taskId]);
      const cachedChild = typeof remediationChildren[taskId] === 'string' || typeof remediationChildren[taskId] === 'number'
        ? parseChildId(remediationChildren[taskId])
        : undefined;
      if (hasCommittedChild && committedChild === undefined) {
        return unreadable(taskId, identity.child, 'committed remediation Child line is malformed', print);
      }
      const owner = committedChild ?? cachedChild;
      if (owner === undefined) {
        return unreadable(taskId, identity.child, 'remediation task membership is missing or malformed', print);
      }
      owners.set(canonical, owner);
    }

    // An envelope or committed Child line is independently sufficient for a
    // normal task. Do not turn an unrelated, unavailable route allocation
    // into a refusal of that already-provable local commit.
    if (allowed.has(canonical)) continue;
    const routedRefusal = await addRoutedMembershipIfNeeded();
    if (routedRefusal !== undefined) return routedRefusal;
    if (allowed.has(canonical)) continue;
    const owner = owners.get(canonical);
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
