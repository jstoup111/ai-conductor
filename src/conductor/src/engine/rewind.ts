import type { ConductState, HarnessConfig } from '../types/index.js';
import type { ConductStateStore, StateMutation } from './conduct-state-store.js';
import { buildStepRegistry } from './steps.js';
import { createFilesystemConductStateStore } from './filesystem-conduct-state-store.js';
import { readState } from './state.js';
import { loadConfig } from './config.js';
import { ConductorEventEmitter } from '../ui/events.js';
import { EventPersister } from './event-persister.js';
import { AuditTrailWriter } from './audit-trail.js';
import { HALT_CLASS_MARKER, HALT_MARKER } from './halt-marker.js';
import { GATES_DIR } from './gate-verdicts.js';
import { join } from 'node:path';
import { access, readFile, rename, rm, writeFile } from 'node:fs/promises';

export interface RewindStateInput {
  state: ConductState;
  config: HarnessConfig;
  target: string;
  store: ConductStateStore<ConductState>;
  /** Reads a fresh snapshot only to make a refused port mutation actionable. */
  readCurrentState: () => Promise<ConductState>;
}

export interface RewindStateResult {
  target: string;
  demoted: string[];
}

export type RewindDispatch = { kind: 'rewind'; target: string };

/** Test seams for the operator command boundary; production uses filesystem defaults. */
export interface RewindCommandDependencies {
  loadConfig?: typeof loadConfig;
  readState?: typeof readState;
  store?: ConductStateStore<ConductState>;
  preflightDerivedRecords?: (root: string) => Promise<void>;
  clearDerivedRecords?: (root: string, demoted: string[]) => Promise<void>;
  emit?: (result: RewindStateResult) => Promise<void>;
}

export interface RewindMarkerFilesystem {
  rename: typeof rename;
  remove: typeof rm;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, contents: string) => Promise<void>;
}

const markerFilesystem: RewindMarkerFilesystem = {
  rename,
  remove: rm,
  readFile: (path) => readFile(path, 'utf-8'),
  writeFile: (path, contents) => writeFile(path, contents, 'utf-8'),
};

export function detectRewindCommand(argv: string[]): RewindDispatch | null {
  if (argv[2] !== 'rewind' || argv[3] !== '--to') return null;
  const target = argv[4];
  return target && !target.startsWith('--') && argv.length === 5 ? { kind: 'rewind', target } : null;
}

export async function clearHaltAtomically(
  root: string,
  filesystem: RewindMarkerFilesystem = markerFilesystem,
): Promise<void> {
  const halt = join(root, HALT_MARKER);
  const haltClass = join(root, HALT_CLASS_MARKER);
  const originals = [halt, haltClass];
  const staged = [halt, haltClass].map((path) => `${path}.rewind-clearing`);
  const contents = await Promise.all(originals.map((path) => filesystem.readFile(path)));
  const moved: number[] = [];
  const removed = new Set<number>();
  try {
    for (let index = 0; index < 2; index += 1) {
      await filesystem.rename(originals[index], staged[index]);
      moved.push(index);
    }
    for (let index = 0; index < 2; index += 1) {
      await filesystem.remove(staged[index], { force: true });
      removed.add(index);
    }
  } catch (error) {
    for (const index of moved.reverse()) {
      if (removed.has(index)) {
        await filesystem.writeFile(originals[index], contents[index]).catch(() => {});
      } else {
        await filesystem.rename(staged[index], originals[index]).catch(() => {});
      }
    }
    throw error;
  }
}

async function preflightDerivedRecords(root: string): Promise<void> {
  await Promise.all([
    access(join(root, HALT_MARKER)),
    access(join(root, HALT_CLASS_MARKER)),
  ]);
}

async function clearDerivedRecords(root: string, demoted: string[]): Promise<void> {
  await Promise.all(demoted.map((step) => rm(join(root, GATES_DIR, `${step}.json`), { force: true })));
  await clearHaltAtomically(root);
}

async function rollbackRewindState(
  state: ConductState,
  config: HarnessConfig,
  result: RewindStateResult,
  store: ConductStateStore<ConductState>,
): Promise<void> {
  const steps = buildStepRegistry(config);
  const targetIndex = steps.findIndex((step) => step.name === result.target);
  if (targetIndex <= 0) throw new Error('Cannot restore rewind state without a target predecessor');
  const predecessor = steps[targetIndex - 1]!.name as NonNullable<ConductState['last_step']>;
  const previousLastStep = state.last_step;
  if (!previousLastStep) throw new Error('Cannot restore rewind state without a prior last step');
  const demotionRollback: StateMutation<ConductState>[] = result.demoted.map((step) => {
    const original = state[step as keyof ConductState];
    if (original === undefined) throw new Error(`Cannot restore absent rewind field ${step}`);
    return {
      field: step,
      expected: 'stale',
      intent: `rollback failed operator rewind to ${result.target}`,
      next: original,
    } as StateMutation<ConductState>;
  });

  const rollback = await store.applyBatch({
    name: 'rollback failed operator rewind state',
    mutations: [
      ...demotionRollback,
      {
        field: 'last_step',
        expected: predecessor,
        intent: `rollback failed operator rewind to ${result.target}`,
        next: previousLastStep,
      } as StateMutation<ConductState>,
    ],
  });
  if ('message' in rollback) {
    throw new Error(`Operator rewind rollback failed (${rollback.kind}): ${rollback.message}`);
  }
}

/** Operator-only command boundary; no engine or daemon path calls this. */
export async function dispatchRewindCommand(
  command: RewindDispatch,
  cwd = process.cwd(),
  dependencies: RewindCommandDependencies = {},
): Promise<number> {
  const statePath = join(cwd, '.pipeline', 'conduct-state.json');
  const read = dependencies.readState ?? readState;
  const observed = await read(statePath);
  if (!observed.ok) {
    console.error(`rewind: ${observed.error.message}`);
    return 1;
  }
  const configResult = await (dependencies.loadConfig ?? loadConfig)(cwd);
  if (!configResult.ok && configResult.error.type !== 'missing') {
    console.error(`rewind: ${configResult.error.message}`);
    return 1;
  }
  const config = configResult.ok ? configResult.config : {};
  const store = dependencies.store ?? createFilesystemConductStateStore(statePath);
  const preflight = dependencies.preflightDerivedRecords ?? preflightDerivedRecords;
  const clear = dependencies.clearDerivedRecords ?? clearDerivedRecords;
  const originalState = { ...observed.value };
  let result: RewindStateResult | undefined;
  try {
    await preflight(cwd);
    result = await rewindState({ state: observed.value, config, target: command.target, store, readCurrentState: async () => {
      const current = await read(statePath);
      return current.ok ? current.value : {};
    } });
    await clear(cwd, result.demoted);
  } catch (error) {
    if (result) {
      try {
        await rollbackRewindState(originalState, config, result, store);
      } catch (rollbackError) {
        console.error(`rewind: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
    }
    console.error(`rewind: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (!result) return 1;
  if (dependencies.emit) {
    await dependencies.emit(result);
  } else {
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(cwd, '.pipeline', 'events.jsonl'), events);
    new AuditTrailWriter(cwd, { throwOnWriteFailure: true }).subscribe(events);
    persister.start();
    await events.emitOrThrow({ type: 'operator_rewind', operator: process.env.USER ?? 'operator', target: result.target, demoted: result.demoted });
    persister.stop();
  }
  console.log(`Rewound to ${result.target}.`);
  return 0;
}

/**
 * Demote a completed feature to an earlier resolved step through the state
 * mutation port. Derived-record clearing and CLI registration belong to the
 * command boundary, not this state transition.
 */
export async function rewindState({
  state,
  config,
  target,
  store,
  readCurrentState,
}: RewindStateInput): Promise<RewindStateResult> {
  const steps = buildStepRegistry(config);
  const targetIndex = steps.findIndex((step) => step.name === target);
  if (targetIndex === -1) {
    throw new Error(`Invalid rewind target "${target}". Valid steps: ${steps.map((step) => step.name).join(', ')}`);
  }

  const currentIndex = steps.findIndex((step) => step.name === state.last_step);
  if (currentIndex === -1) {
    throw new Error('Cannot rewind without a current resolved step in conduct state');
  }
  if (targetIndex >= currentIndex) {
    throw new Error(`Rewind target "${target}" must be earlier than current step "${state.last_step}"`);
  }

  const demoted = steps
    .slice(targetIndex)
    .filter((step) => state[step.name] !== 'skipped')
    .map((step) => step.name);
  const intent = `operator rewind to ${target}`;
  const mutations: StateMutation<ConductState>[] = demoted.map((step) => ({
    field: step,
    expected: state[step],
    intent,
    next: 'stale',
  } as StateMutation<ConductState>));
  mutations.push({ field: 'last_step', expected: state.last_step, intent, next: steps[targetIndex - 1].name });
  const result = await store.applyBatch({ name: 'operator rewind state', mutations });
  if ('message' in result) {
    if (result.kind === 'conflict') {
      const current = await readCurrentState();
      const refused = mutations.find((mutation) => current[mutation.field] !== mutation.expected);
      if (refused) {
        throw new Error(
          `Operator rewind refused ${refused.field}: expected ${String(refused.expected)}, current ${String(current[refused.field])}`,
        );
      }
    }
    throw new Error(`Operator rewind mutation failed (${result.kind}): ${result.message}`);
  }

  return { target, demoted };
}
