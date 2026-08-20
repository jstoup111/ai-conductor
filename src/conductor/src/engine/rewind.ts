import type { ConductState, HarnessConfig } from '../types/index.js';
import type { ConductStateStore, StateMutation } from './conduct-state-store.js';
import { buildStepRegistry } from './steps.js';
import { createFilesystemConductStateStore } from './filesystem-conduct-state-store.js';
import { readState } from './state.js';
import { ConductorEventEmitter } from '../ui/events.js';
import { EventPersister } from './event-persister.js';
import { HALT_CLASS_MARKER, HALT_MARKER } from './halt-marker.js';
import { GATES_DIR } from './gate-verdicts.js';
import { join } from 'node:path';
import { rename, rm } from 'node:fs/promises';

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

export function detectRewindCommand(argv: string[]): RewindDispatch | null {
  if (argv[2] !== 'rewind' || argv[3] !== '--to') return null;
  const target = argv[4];
  return target && !target.startsWith('--') && argv.length === 5 ? { kind: 'rewind', target } : null;
}

async function clearHaltAtomically(root: string): Promise<void> {
  const halt = join(root, HALT_MARKER);
  const haltClass = join(root, HALT_CLASS_MARKER);
  const staged = [halt, haltClass].map((path) => `${path}.rewind-clearing`);
  const moved: Array<[string, string]> = [];
  try {
    for (let index = 0; index < 2; index += 1) {
      await rename([halt, haltClass][index], staged[index]);
      moved.push([[halt, haltClass][index], staged[index]]);
    }
    await Promise.all(staged.map((path) => rm(path, { force: true })));
  } catch (error) {
    await Promise.all(moved.reverse().map(async ([original, temporary]) => {
      await rename(temporary, original).catch(() => {});
    }));
    throw error;
  }
}

/** Operator-only command boundary; no engine or daemon path calls this. */
export async function dispatchRewindCommand(command: RewindDispatch, cwd = process.cwd()): Promise<number> {
  const statePath = join(cwd, '.pipeline', 'conduct-state.json');
  const observed = await readState(statePath);
  if (!observed.ok) {
    console.error(`rewind: ${observed.error.message}`);
    return 1;
  }
  const store = createFilesystemConductStateStore(statePath);
  let result: RewindStateResult;
  try {
    result = await rewindState({ state: observed.value, config: {}, target: command.target, store, readCurrentState: async () => {
      const current = await readState(statePath);
      return current.ok ? current.value : {};
    } });
    await Promise.all(result.demoted.map((step) => rm(join(cwd, GATES_DIR, `${step}.json`), { force: true })));
    await clearHaltAtomically(cwd);
  } catch (error) {
    console.error(`rewind: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const events = new ConductorEventEmitter();
  const persister = new EventPersister(join(cwd, '.pipeline', 'events.jsonl'), events);
  persister.start();
  await events.emit({ type: 'operator_rewind', operator: process.env.USER ?? 'operator', target: result.target, demoted: result.demoted });
  persister.stop();
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
