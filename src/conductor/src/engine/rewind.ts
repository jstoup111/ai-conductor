import type { ConductState, HarnessConfig, StepName } from '../types/index.js';
import type { ConductStateStore, NamedAtomicStateMutationBatch, StateFieldDeletion, StateMutation } from './conduct-state-store.js';
import { buildStepRegistry } from './steps.js';
import { createFilesystemConductStateStore } from './filesystem-conduct-state-store.js';
import { readState } from './state.js';
import { loadConfig } from './config.js';
import { ConductorEventEmitter } from '../ui/events.js';
import { EventPersister } from './event-persister.js';
import { AuditTrailWriter } from './audit-trail.js';
import { HALT_CLASS_MARKER, HALT_MARKER, writeHaltMarker } from './halt-marker.js';
import { verdictPathFor } from './gate-verdicts.js';
import { AS_BUILT_REPORT_PATH, AS_BUILT_VERDICT_PATH } from './as-built-verdict-store.js';
import { PRD_AUDIT_REPORT_PATH, PRD_AUDIT_VERDICT_PATH } from './prd-audit-verdict-store.js';
import {
  CHILD_REGION_STEPS,
  childStateExists,
  isRegionStep,
  listExistingChildren,
  parseChildId,
  pipelinePathFor,
  type ChildId,
} from './child-context.js';
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

export interface RewindChildDemotion {
  child?: ChildId;
  step: string;
}

export interface AppliedChildRewindBatch {
  path: string;
  originalState: ConductState;
  batch: NamedAtomicStateMutationBatch<ConductState>;
}

export interface RewindChildStateInput {
  root: string;
  config: HarnessConfig;
  target: string;
  child: ChildId;
  storeFor: (path: string) => ConductStateStore<ConductState>;
  /** Reads a fresh snapshot only to make a refused port mutation actionable. */
  readCurrentState: (path: string) => Promise<ConductState>;
}

export interface RewindChildStateResult {
  target: string;
  child: ChildId;
  demotions: RewindChildDemotion[];
  applied: AppliedChildRewindBatch[];
}

export type RewindDispatch = { kind: 'rewind'; target: string; child?: string };

/** Test seams for the operator command boundary; production uses filesystem defaults. */
export interface RewindCommandDependencies {
  loadConfig?: typeof loadConfig;
  readState?: typeof readState;
  store?: ConductStateStore<ConductState>;
  storeFor?: (path: string) => ConductStateStore<ConductState>;
  preflightDerivedRecords?: (root: string) => Promise<void>;
  clearDerivedRecords?: (root: string, demoted: RewindChildDemotion[]) => Promise<void>;
  markerFilesystem?: RewindMarkerFilesystem;
  emit?: (result: RewindStateResult & { child?: ChildId }) => Promise<void>;
}

export interface RewindMarkerFilesystem {
  rename: typeof rename;
  remove: typeof rm;
  readFile: (path: string) => Promise<string>;
  restoreHalt: (root: string, body: string) => Promise<void>;
  writeClass: (path: string, contents: string) => Promise<void>;
}

const markerFilesystem: RewindMarkerFilesystem = {
  rename,
  remove: rm,
  readFile: (path) => readFile(path, 'utf-8'),
  async restoreHalt(root, body) {
    const result = await writeHaltMarker(root, body, 'needs-human');
    if (result.status !== 'written') {
      throw new Error(`Canonical HALT restoration failed: ${result.reason ?? result.path}`);
    }
  },
  writeClass: (path, contents) => writeFile(path, contents, 'utf-8'),
};

export function detectRewindCommand(argv: string[]): RewindDispatch | null {
  if (argv[2] !== 'rewind') return null;
  const values = new Map<string, string>();
  for (let index = 3; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || value === undefined || !['--to', '--child'].includes(flag) || values.has(flag)) return null;
    values.set(flag, value);
  }
  const target = values.get('--to');
  if (!target || target.startsWith('--')) return null;
  const child = values.get('--child');
  return { kind: 'rewind', target, ...(child === undefined ? {} : { child }) };
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
    const restorationFailures: unknown[] = [];
    let classRepurposedAsHalt = false;
    for (const index of moved) {
      if (removed.has(index)) {
        try {
          if (index === 0) {
            await filesystem.restoreHalt(root, contents[index]);
          } else {
            await filesystem.writeClass(originals[index], contents[index]);
          }
        } catch (restoreError) {
          restorationFailures.push(restoreError);
          // A missing class sidecar is deliberately fail-closed when HALT is
          // present. If HALT itself cannot be restored, move the still-staged
          // class into its place so the daemon cannot resume this feature.
          if (index === 0 && !removed.has(1)) {
            try {
              await filesystem.rename(staged[1], originals[0]);
              classRepurposedAsHalt = true;
            } catch (protectiveError) {
              restorationFailures.push(protectiveError);
            }
          }
        }
      }
    }
    for (const index of [...moved].reverse()) {
      if (removed.has(index) || (index === 1 && classRepurposedAsHalt)) continue;
      try {
        await filesystem.rename(staged[index], originals[index]);
      } catch (restoreError) {
        restorationFailures.push(restoreError);
      }
    }
    if (restorationFailures.length > 0) {
      throw new AggregateError(
        [error, ...restorationFailures],
        `Failed to clear HALT atomically and restore its protective marker: ${restorationFailures.map((failure) => failure instanceof Error ? failure.message : String(failure)).join('; ')}`,
      );
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

async function clearDerivedRecords(
  root: string,
  demoted: RewindChildDemotion[],
  filesystem: RewindMarkerFilesystem = markerFilesystem,
): Promise<void> {
  const staged: Array<{ original: string; staged: string; contents: string }> = [];
  const [haltContents, haltClassContents] = await Promise.all([
    readFile(join(root, HALT_MARKER), 'utf-8'),
    readFile(join(root, HALT_CLASS_MARKER), 'utf-8'),
  ]);
  let haltCleared = false;
  try {
    for (const { child, step } of demoted) {
      const verdict = verdictPathFor(root, step as StepName, child);
      const records = [
        { original: verdict, staged: verdict.replace(/\.json$/, '.rewind-clearing') },
        ...(child === undefined && step === 'architecture_review_as_built'
          ? [
              { original: join(root, AS_BUILT_VERDICT_PATH), staged: join(root, `${AS_BUILT_VERDICT_PATH}.rewind-clearing`) },
              { original: join(root, AS_BUILT_REPORT_PATH), staged: join(root, `${AS_BUILT_REPORT_PATH}.rewind-clearing`) },
            ]
          : []),
        ...(child === undefined && step === 'prd_audit'
          ? [
              { original: join(root, PRD_AUDIT_VERDICT_PATH), staged: join(root, `${PRD_AUDIT_VERDICT_PATH}.rewind-clearing`) },
              { original: join(root, PRD_AUDIT_REPORT_PATH), staged: join(root, `${PRD_AUDIT_REPORT_PATH}.rewind-clearing`) },
            ]
          : []),
      ];
      for (const record of records) {
        try {
          const contents = await readFile(record.original, 'utf-8');
          await filesystem.rename(record.original, record.staged);
          staged.push({ ...record, contents });
        } catch (error) {
          if ((error as { code?: unknown }).code !== 'ENOENT') throw error;
        }
      }
    }
    await clearHaltAtomically(root, filesystem);
    haltCleared = true;
    const deletions = await Promise.allSettled(staged.map(({ staged: path }) => filesystem.remove(path)));
    const deletionFailure = deletions.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (deletionFailure) throw deletionFailure.reason;
  } catch (error) {
    const restorationFailures: unknown[] = [];
    for (const entry of staged.reverse()) {
      try {
        await filesystem.rename(entry.staged, entry.original);
      } catch (restoreError) {
        if ((restoreError as { code?: unknown }).code !== 'ENOENT') {
          restorationFailures.push(restoreError);
          continue;
        }
        try {
          await writeFile(entry.original, entry.contents, 'utf-8');
        } catch (writeError) {
          restorationFailures.push(writeError);
        }
      }
    }
    if (haltCleared) {
      try {
        await filesystem.restoreHalt(root, haltContents);
      } catch (restoreError) {
        restorationFailures.push(restoreError);
      }
      try {
        await filesystem.writeClass(join(root, HALT_CLASS_MARKER), haltClassContents);
      } catch (restoreError) {
        restorationFailures.push(restoreError);
      }
    }
    if (restorationFailures.length > 0) {
      throw new AggregateError(
        [error, ...restorationFailures],
        `Failed to clear derived records and restore staged verdicts: ${restorationFailures.map((failure) => failure instanceof Error ? failure.message : String(failure)).join('; ')}`,
      );
    }
    throw error;
  }
}

async function rollbackRewindState(
  state: ConductState,
  config: HarnessConfig,
  result: RewindStateResult,
  store: ConductStateStore<ConductState>,
  expectedLastStep?: NonNullable<ConductState['last_step']>,
): Promise<void> {
  const steps = buildStepRegistry(config);
  const targetIndex = steps.findIndex((step) => step.name === result.target);
  if (targetIndex <= 0) throw new Error('Cannot restore rewind state without a target predecessor');
  const predecessor = steps[targetIndex - 1]!.name as NonNullable<ConductState['last_step']>;
  const previousLastStep = state.last_step;
  if (!previousLastStep) throw new Error('Cannot restore rewind state without a prior last step');
  const definedRollback: StateMutation<ConductState>[] = [];
  const absentRollback: StateFieldDeletion<ConductState>[] = [];
  for (const step of result.demoted) {
    const original = state[step as keyof ConductState];
    if (original === undefined) {
      absentRollback.push({ field: step, expected: 'stale', intent: `rollback failed operator rewind to ${result.target}` } as StateFieldDeletion<ConductState>);
    } else {
      definedRollback.push({ field: step, expected: 'stale', intent: `rollback failed operator rewind to ${result.target}`, next: original } as StateMutation<ConductState>);
    }
  }
  const lastStepRollback = {
    field: 'last_step',
    expected: expectedLastStep ?? predecessor,
    intent: `rollback failed operator rewind to ${result.target}`,
    next: previousLastStep,
  } as StateMutation<ConductState>;
  const rollback = absentRollback.length === 0
    ? await store.applyBatch({
      name: 'rollback failed operator rewind state',
      mutations: [
        ...definedRollback,
        lastStepRollback,
      ],
    })
    : store.applyCorrection
      ? await store.applyCorrection({
        name: 'rollback failed operator rewind state',
        deletions: absentRollback,
        mutations: [...definedRollback, lastStepRollback],
        privileged: true,
      })
      : { kind: 'persistence' as const, message: `State store does not support corrective mutations for absent rewind fields: ${absentRollback.map(({ field }) => field).join(', ')}` };
  if ('message' in rollback) {
    throw new Error(`Operator rewind rollback failed (${rollback.kind}): ${rollback.message}`);
  }
}

async function rollbackChildRewindState(
  result: RewindChildStateResult,
  config: HarnessConfig,
  storeFor: (path: string) => ConductStateStore<ConductState>,
): Promise<void> {
  const failures: unknown[] = [];
  for (const applied of [...result.applied].reverse()) {
    try {
      const lastStep = applied.batch.mutations.find((mutation) => mutation.field === 'last_step');
      if (!lastStep) throw new Error(`Cannot restore child rewind state without last_step for ${applied.path}`);
      await rollbackRewindState(
        applied.originalState,
        config,
        {
          target: result.target,
          demoted: applied.batch.mutations
            .filter((mutation) => mutation.field !== 'last_step')
            .map((mutation) => String(mutation.field)),
        },
        storeFor(applied.path),
        lastStep.next as NonNullable<ConductState['last_step']>,
      );
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Failed to restore ${failures.length} child rewind state ${failures.length === 1 ? 'store' : 'stores'}`,
    );
  }
}

class RewindChildStateFailure extends Error {
  constructor(
    cause: unknown,
    readonly result: RewindChildStateResult,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'RewindChildStateFailure';
  }
}

/** Operator-only command boundary; no engine or daemon path calls this. */
export async function dispatchRewindCommand(
  command: RewindDispatch,
  cwd = process.cwd(),
  dependencies: RewindCommandDependencies = {},
): Promise<number> {
  if (command.child !== undefined) {
    const child = parseChildId(command.child);
    if (child === undefined) {
      console.error(`rewind: invalid child id "${command.child}" (expected 1-9)`);
      return 1;
    }
    if (!(await childStateExists(cwd, child))) {
      console.error(`rewind: child ${child} has no child state (.pipeline/children/${child}/ does not exist)`);
      return 1;
    }
    if (!isRegionStep(command.target)) {
      console.error('rewind: only acceptance_specs, build, test_suite and build_review can be rewound per child');
      return 1;
    }
    const configResult = await (dependencies.loadConfig ?? loadConfig)(cwd);
    if (!configResult.ok && configResult.error.type !== 'missing') {
      console.error(`rewind: ${configResult.error.message}`);
      return 1;
    }
    const config = configResult.ok ? configResult.config : {};
    const storeFor = dependencies.storeFor
      ?? ((path: string) => dependencies.store ?? createFilesystemConductStateStore(path));
    const preflight = dependencies.preflightDerivedRecords ?? preflightDerivedRecords;
    const clear = dependencies.clearDerivedRecords
      ?? ((root, demoted) => clearDerivedRecords(root, demoted, dependencies.markerFilesystem));
    let result: RewindChildStateResult | undefined;
    try {
      await preflight(cwd);
      result = await rewindChildState({
        root: cwd,
        config,
        target: command.target,
        child,
        storeFor,
        readCurrentState: async (path) => {
          const current = await readState(path);
          return current.ok ? current.value : {};
        },
      });
      await clear(cwd, result.demotions);
    } catch (error) {
      console.error(`rewind: ${error instanceof Error ? error.message : String(error)}`);
      const partial = error instanceof RewindChildStateFailure ? error.result : result;
      if (partial) {
        try {
          await rollbackChildRewindState(partial, config, storeFor);
        } catch (rollbackError) {
          console.error(`rewind: rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
        }
      }
      return 1;
    }
    if (!result) return 1;
    const demoted = result.demotions.map(({ child: demotedChild, step }) =>
      demotedChild === undefined ? step : `children/${demotedChild}/${step}`,
    );
    if (dependencies.emit) {
      await dependencies.emit({ target: result.target, demoted, child: result.child });
    } else {
      const events = new ConductorEventEmitter();
      const persister = new EventPersister(join(cwd, '.pipeline', 'events.jsonl'), events);
      new AuditTrailWriter(cwd, { throwOnWriteFailure: true }).subscribe(events);
      persister.start();
      await events.emitOrThrow({
        type: 'operator_rewind', operator: process.env.USER ?? 'operator', target: result.target, demoted, child: result.child,
      });
      persister.stop();
    }
    console.log(`Rewound child ${result.child} to ${result.target}.`);
    return 0;
  }
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
  const clear = dependencies.clearDerivedRecords
    ?? ((root, demoted) => clearDerivedRecords(root, demoted.map((step) => ({ step })), dependencies.markerFilesystem));
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
    console.error(`rewind: ${error instanceof Error ? error.message : String(error)}`);
    if (result) {
      try {
        await rollbackRewindState(originalState, config, result, store);
      } catch (rollbackError) {
        console.error(`rewind: rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
    }
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

/**
 * Demote the selected child, children above it, and the affected whole-feature
 * tail through one intent-bearing batch per conduct-state file.
 */
export async function rewindChildState({
  root,
  config,
  target,
  child,
  storeFor,
  readCurrentState,
}: RewindChildStateInput): Promise<RewindChildStateResult> {
  const childPath = pipelinePathFor(root, 'conduct-state.json', child);
  const observedChild = await readState(childPath);
  if (!observedChild.ok) throw new Error(observedChild.error.message);

  const steps = buildStepRegistry(config);
  const targetIndex = steps.findIndex((step) => step.name === target);
  if (targetIndex === -1) {
    throw new Error(`Invalid rewind target "${target}". Valid steps: ${steps.map((step) => step.name).join(', ')}`);
  }
  const currentIndex = steps.findIndex((step) => step.name === observedChild.value.last_step);
  if (currentIndex === -1) {
    throw new Error('Cannot rewind without a current resolved step in child conduct state');
  }
  if (targetIndex >= currentIndex) {
    throw new Error(`target "${target}" must be earlier than child ${child}'s current step "${observedChild.value.last_step}"`);
  }
  const regionTargetIndex = (CHILD_REGION_STEPS as readonly string[]).indexOf(target);
  if (regionTargetIndex === -1) throw new Error(`Invalid child rewind target "${target}"`);

  const intent = `operator rewind to ${target} (child ${child})`;
  const demotions: RewindChildDemotion[] = [];
  const applied: AppliedChildRewindBatch[] = [];
  const apply = async (
    path: string,
    state: ConductState,
    stepNames: readonly string[],
    predecessor: NonNullable<ConductState['last_step']>,
    demotionChild?: ChildId,
  ): Promise<void> => {
    const demotedSteps = stepNames.filter((step) => state[step as keyof ConductState] !== 'skipped');
    const mutations: StateMutation<ConductState>[] = demotedSteps.map((step) => ({
      field: step,
      expected: state[step as keyof ConductState],
      intent,
      next: 'stale',
    } as StateMutation<ConductState>));
    if (mutations.length === 0) return;
    mutations.push({
      field: 'last_step',
      expected: state.last_step,
      intent,
      next: predecessor,
    });
    const batch: NamedAtomicStateMutationBatch<ConductState> = { name: 'operator rewind state', mutations };
    const result = await storeFor(path).applyBatch(batch);
    if ('message' in result) {
      if (result.kind === 'conflict') {
        const current = await readCurrentState(path);
        const refused = mutations.find((mutation) => current[mutation.field] !== mutation.expected);
        if (refused) {
          throw new Error(
            `Operator rewind refused ${refused.field}: expected ${String(refused.expected)}, current ${String(current[refused.field])}`,
          );
        }
      }
      throw new Error(`Operator rewind mutation failed (${result.kind}): ${result.message}`);
    }
    demotions.push(...demotedSteps.map((step) => demotionChild === undefined ? { step } : { child: demotionChild, step }));
    applied.push({ path, originalState: { ...state }, batch });
  };

  const acceptanceSpecsIndex = steps.findIndex((step) => step.name === 'acceptance_specs');
  if (acceptanceSpecsIndex <= 0) throw new Error('Cannot rewind child state without an acceptance_specs predecessor');
  const laterChildren = (await listExistingChildren(root)).filter((candidate) => candidate > child);
  const laterStates = await Promise.all(laterChildren.map(async (laterChild) => {
    const path = pipelinePathFor(root, 'conduct-state.json', laterChild);
    const observed = await readState(path);
    if (!observed.ok) throw new Error(observed.error.message);
    return { path, child: laterChild, state: observed.value };
  }));

  const flatPath = pipelinePathFor(root, 'conduct-state.json');
  const observedFlat = await readState(flatPath);
  if (!observedFlat.ok) throw new Error(observedFlat.error.message);
  const buildReviewIndex = steps.findIndex((step) => step.name === 'build_review');
  if (buildReviewIndex === -1) throw new Error('Cannot rewind child state without build_review');
  const flatSteps = steps.slice(buildReviewIndex + 1).map((step) => step.name);
  const firstFlatDemotion = flatSteps.find((step) => observedFlat.value[step as keyof ConductState] !== 'skipped');
  const flatPredecessor = firstFlatDemotion === undefined
    ? undefined
    : steps[steps.findIndex((step) => step.name === firstFlatDemotion) - 1]!.name;
  const planned = [
    {
      path: childPath,
      state: observedChild.value,
      stepNames: CHILD_REGION_STEPS.slice(regionTargetIndex),
      predecessor: steps[targetIndex - 1]!.name,
      child,
    },
    ...laterStates.map(({ path, child: laterChild, state }) => ({
      path,
      state,
      stepNames: CHILD_REGION_STEPS as readonly string[],
      predecessor: steps[acceptanceSpecsIndex - 1]!.name,
      child: laterChild,
    })),
    ...(flatPredecessor === undefined ? [] : [{
      path: flatPath,
      state: observedFlat.value,
      stepNames: flatSteps,
      predecessor: flatPredecessor,
      child: undefined,
    }]),
  ];
  for (const plan of planned) {
    if (
      plan.stepNames.some((step) => plan.state[step as keyof ConductState] !== 'skipped')
      && !plan.state.last_step
    ) {
      throw new Error(`Cannot rewind state without a prior last step for ${plan.path}`);
    }
  }

  try {
    for (const plan of planned) {
      await apply(plan.path, plan.state, plan.stepNames, plan.predecessor, plan.child);
    }
  } catch (error) {
    throw new RewindChildStateFailure(error, { target, child, demotions, applied });
  }

  return { target, child, demotions, applied };
}
