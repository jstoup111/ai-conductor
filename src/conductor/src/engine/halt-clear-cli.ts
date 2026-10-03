import { access, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { HaltClearDispatch } from '../cli.js';
import type { ConductorEvent } from '../types/events.js';
import type { StepName } from '../types/index.js';
import { ConductorEventEmitter } from '../ui/events.js';
import { AuditTrailWriter } from './audit-trail.js';
import { isAcceptableOperatorRationale, resolveCliFeatureWorktree, resolveMachineOperatorIdentity } from './cli-operator-authority.js';
import { EventPersister } from './event-persister.js';
import { HALT_CLASS_MARKER, HALT_MARKER } from './halt-marker.js';
import { supersedeHaltRecord } from './halt-record.js';
import { resolveMainRepoRoot } from './park-marker.js';

type HaltClearEvent = Extract<ConductorEvent, { type: 'halt_clear_authorized' }>;

export interface HaltClearCliDeps {
  cwd?: string;
  isInteractive?: () => boolean;
  resolveOperator?: () => string | undefined | Promise<string | undefined>;
  print?: (message: string) => void;
  resolveMainRoot?: (cwd: string) => Promise<string>;
  appendEvent?: (worktree: string, event: HaltClearEvent) => void | Promise<void>;
}

async function appendAuthorizationEvent(
  worktree: string,
  event: HaltClearEvent,
  appendEvent?: HaltClearCliDeps['appendEvent'],
): Promise<void> {
  const events = new ConductorEventEmitter();
  const persister = new EventPersister(join(worktree, '.pipeline', 'events.jsonl'), events);
  const audit = new AuditTrailWriter(worktree, { throwOnWriteFailure: true });
  persister.start();
  audit.subscribe(events);
  try {
    await appendEvent?.(worktree, event);
    await events.emitOrThrow(event);
  } finally {
    persister.stop();
  }
}

/** Clear a live halt after recording the operator's authorization on the event spine. */
export async function dispatchHaltClearCommand(
  command: HaltClearDispatch,
  deps: HaltClearCliDeps = {},
): Promise<number> {
  const print = deps.print ?? console.log;
  const root = await (deps.resolveMainRoot ?? resolveMainRepoRoot)(deps.cwd ?? process.cwd());
  const worktree = await resolveCliFeatureWorktree(command.feature, {
    cwd: deps.cwd,
    resolveMainRoot: deps.resolveMainRoot,
  });
  if (!worktree) {
    print(`halt clear: feature '${command.feature}' is unavailable.`);
    return 1;
  }
  if (deps.isInteractive ? !deps.isInteractive() : !process.stdin.isTTY) {
    print('halt clear: requires an interactive local operator terminal.');
    return 2;
  }
  if (!isAcceptableOperatorRationale(command.rationale)) {
    print('halt clear: invalid rationale.');
    return 2;
  }
  try {
    await access(join(worktree, HALT_MARKER));
  } catch {
    print(`halt clear: feature '${command.feature}' is not halted.`);
    return 1;
  }
  const haltClass = (await readFile(join(worktree, HALT_CLASS_MARKER), 'utf8').catch(() => 'unclassified')).trim() || 'unclassified';
  const operator = deps.resolveOperator
    ? await deps.resolveOperator()
    : await resolveMachineOperatorIdentity(root);
  if (!operator?.trim()) {
    print('halt clear: no approved operator identity is available.');
    return 1;
  }
  let step: StepName = 'build';
  try {
    const state = JSON.parse(await readFile(join(worktree, '.pipeline', 'conduct-state.json'), 'utf8')) as { last_step?: StepName };
    step = state.last_step ?? step;
  } catch {
    // Halt clearing must not rewrite state merely to enrich an audit event.
  }
  const event: HaltClearEvent = {
    type: 'halt_clear_authorized',
    feature: command.feature,
    operator: operator.trim(),
    rationale: command.rationale.trim(),
    haltClass,
    step,
    ts: new Date().toISOString(),
  };
  try {
    await appendAuthorizationEvent(worktree, event, deps.appendEvent);
  } catch (error) {
    print(`halt clear: refused — ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  await unlink(join(worktree, HALT_CLASS_MARKER));
  await unlink(join(worktree, HALT_MARKER));
  await supersedeHaltRecord(worktree, command.feature, 'operator');
  return 0;
}
