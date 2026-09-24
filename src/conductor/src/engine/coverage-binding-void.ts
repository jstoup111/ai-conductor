import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConductState } from '../types/index.js';
import { ConductorEventEmitter } from '../ui/events.js';
import type { ConductStateStore } from './conduct-state-store.js';
import { createFilesystemConductStateStore } from './filesystem-conduct-state-store.js';
import {
  readCoverageBindingEnvelope,
  writeCoverageBindingEnvelope,
  type CoverageBindingEnvelopeFilesystem,
} from './coverage-binding-envelope.js';
import type { CoverageBindingDecideSet } from './coverage-binding-decide-set.js';
import { readVerdict, writeVerdict } from './gate-verdicts.js';
import { readState } from './state.js';

export interface CoverageBindingRebaseline {
  readonly path: string;
  readonly priorFingerprint: string;
  readonly newFingerprint: string;
}

export interface VoidCoverageBindingForDecideChangeOptions {
  readonly projectRoot: string;
  readonly decideSet: Pick<CoverageBindingDecideSet, 'paths'>;
  readonly rebaselines: readonly CoverageBindingRebaseline[];
  readonly events: ConductorEventEmitter;
  /** Isolates callers that already own a state store without bypassing its lease. */
  readonly stateStore?: ConductStateStore<ConductState>;
  /** Keeps an injected store tied to its actual persisted state file. */
  readonly stateFilePath?: string;
}

const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

function changedDecidePaths(
  decideSet: Pick<CoverageBindingDecideSet, 'paths'>,
  rebaselines: readonly CoverageBindingRebaseline[],
): string[] {
  return [...new Set(rebaselines
    .filter(({ path, priorFingerprint, newFingerprint }) =>
      decideSet.paths.has(path) && priorFingerprint !== newFingerprint)
    .map(({ path }) => path))]
    .sort();
}

/**
 * Voids only a completed coverage judgement whose resolved DECIDE inputs have
 * changed. The ordinary conductor gate then re-dispatches coverage_binding
 * before BUILD; this helper does not select or dispatch any lifecycle step.
 */
export async function voidCoverageBindingForDecideChange(
  options: VoidCoverageBindingForDecideChangeOptions,
): Promise<void> {
  const paths = changedDecidePaths(options.decideSet, options.rebaselines);
  if (paths.length === 0) return;

  const envelope = await readCoverageBindingEnvelope(options.projectRoot, envelopeFilesystem);
  const verdict = await readVerdict(options.projectRoot, 'coverage_binding');
  if (envelope?.status !== 'done' || verdict?.satisfied !== true) return;

  const statePath = options.stateFilePath ?? join(options.projectRoot, '.pipeline', 'conduct-state.json');
  const state = await readState(statePath);
  if (!state.ok) throw new Error(`Coverage binding void could not read state: ${state.error.message}`);
  const store = options.stateStore ?? createFilesystemConductStateStore(statePath);
  const mutation = await store.apply({
    field: 'coverage_binding',
    expected: state.value.coverage_binding,
    next: 'stale',
    intent: 'void coverage binding after DECIDE change',
  });
  if ('message' in mutation) {
    throw new Error(`Coverage binding void state mutation failed (${mutation.kind}): ${mutation.message}`);
  }

  await writeCoverageBindingEnvelope(options.projectRoot, {
    ...envelope,
    status: 'invalidated',
  }, envelopeFilesystem);
  await writeVerdict(options.projectRoot, 'coverage_binding', {
    satisfied: false,
    reason: 'invalidated by changed DECIDE artifact',
    checkedAt: Date.now(),
    kickback: { from: 'decide-change', evidence: paths.join(', ') },
  });
  await options.events.emitOrThrow({
    type: 'coverage_binding_invalidated',
    paths,
    origin: 'decide-change',
  });
}
