import type { ConductState, HarnessConfig } from '../types/index.js';
import type { ConductStateStore, StateMutation } from './conduct-state-store.js';
import { buildStepRegistry } from './steps.js';

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
  const mutations = demoted.map((step) => ({
    field: step,
    expected: state[step],
    intent,
    next: 'stale',
  } as StateMutation<ConductState>));
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
