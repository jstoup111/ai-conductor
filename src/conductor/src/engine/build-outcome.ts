import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { EffortLevel } from '../types/config.js';

/** The tree-level outcome observed when a build step settles. */
export type BuildSettleOutcome = 'moved' | 'no-movement';

/** The terminal state reached by a build step. */
export type BuildTerminalOutcome = 'done' | 'failed' | 'no-verdict';

/** The model and reasoning-effort rung used for a build attempt. */
export interface BuildOutcomeRung {
  model: string;
  effort: EffortLevel;
}

/** Durable engine-authored observation of one build-step settle. */
export interface BuildOutcomeRecord {
  outcome: BuildSettleOutcome;
  terminalOutcome: BuildTerminalOutcome;
  gate: string | null;
  verdict: boolean | null;
  rung: BuildOutcomeRung;
  treeBefore: string | null;
  treeAfter: string | null;
  headBefore: string | null;
  headAfter: string | null;
  note?: string[];
  category?: string;
}

/** Durable build-settle observations stored outside the feature branch. */
export interface BuildOutcomeStore {
  version: 1;
  records: BuildOutcomeRecord[];
}

export const BUILD_OUTCOME_PATH = '.pipeline/build-outcome.json';

export interface ClassifyBuildSettleInput {
  treeBefore: string | null;
  treeAfter: string | null;
  resolvedBefore: number;
  resolvedAfter: number;
}

export interface NoOpCycleInput {
  gate: string;
  treeHash: string | null;
  verdict: boolean;
  rung: BuildOutcomeRung;
}

/** Classifies the tree/resolved-work movement observed during a build settle. */
export function classifyBuildSettle({
  treeBefore,
  treeAfter,
  resolvedBefore,
  resolvedAfter,
}: ClassifyBuildSettleInput): BuildSettleOutcome {
  if (treeBefore === null || treeAfter === null) return 'no-movement';
  if (treeBefore !== null && treeAfter !== null && treeBefore !== treeAfter) return 'moved';
  if (resolvedAfter > resolvedBefore) return 'moved';
  return 'no-movement';
}

/** Returns whether a prior build settled without movement for this exact cycle. */
export function sameNoOpCycle(
  prior: BuildOutcomeRecord | null,
  current: NoOpCycleInput,
): boolean {
  return prior !== null
    && prior.outcome === 'no-movement'
    && prior.gate === current.gate
    && prior.treeAfter !== null
    && current.treeHash !== null
    && prior.treeAfter === current.treeHash
    && prior.verdict === current.verdict
    && prior.rung.model === current.rung.model
    && prior.rung.effort === current.rung.effort;
}

function emptyBuildOutcome(): BuildOutcomeStore {
  return { version: 1, records: [] };
}

function isEffortLevel(value: unknown): value is EffortLevel {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max';
}

function isBuildOutcomeRecord(value: unknown): value is BuildOutcomeRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const record = value as Record<string, unknown>;
  const isNullableString = (candidate: unknown): candidate is string | null =>
    typeof candidate === 'string' || candidate === null;
  return (
    (record.outcome === 'moved' || record.outcome === 'no-movement')
    && (record.terminalOutcome === 'done' || record.terminalOutcome === 'failed' || record.terminalOutcome === 'no-verdict')
    && isNullableString(record.gate)
    && (typeof record.verdict === 'boolean' || record.verdict === null)
    && typeof record.rung === 'object'
    && record.rung !== null
    && !Array.isArray(record.rung)
    && typeof (record.rung as Record<string, unknown>).model === 'string'
    && isEffortLevel((record.rung as Record<string, unknown>).effort)
    && isNullableString(record.treeBefore)
    && isNullableString(record.treeAfter)
    && isNullableString(record.headBefore)
    && isNullableString(record.headAfter)
    && (record.note === undefined || (Array.isArray(record.note) && record.note.every((line) => typeof line === 'string')))
    && (record.category === undefined || typeof record.category === 'string')
  );
}

function isBuildOutcomeStore(value: unknown): value is BuildOutcomeStore {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const store = value as Record<string, unknown>;
  return store.version === 1 && Array.isArray(store.records) && store.records.every(isBuildOutcomeRecord);
}

/**
 * Read durable build-settle observations. Missing, malformed, and incompatible
 * sidecars deliberately fail open so they can never block a build dispatch.
 */
export async function readBuildOutcome(projectRoot: string): Promise<BuildOutcomeStore> {
  const outcomePath = join(projectRoot, BUILD_OUTCOME_PATH);

  try {
    const parsed: unknown = JSON.parse(await readFile(outcomePath, 'utf-8'));
    if (isBuildOutcomeStore(parsed)) return parsed;

    if (typeof parsed === 'object' && parsed !== null && (parsed as { version?: unknown }).version !== 1) {
      console.warn(`[build-outcome] unsupported sidecar version at ${outcomePath}; using empty record set`);
      return emptyBuildOutcome();
    }

    console.warn(`[build-outcome] corrupt sidecar at ${outcomePath}; using empty record set`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(
        `[build-outcome] unable to read sidecar at ${outcomePath}; using empty record set: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return emptyBuildOutcome();
}

/** Write build-settle observations atomically, so readers never see partial JSON. */
export async function writeBuildOutcome(
  projectRoot: string,
  outcome: BuildOutcomeStore,
): Promise<void> {
  const outcomePath = join(projectRoot, BUILD_OUTCOME_PATH);
  const outcomeDir = dirname(outcomePath);
  const tempPath = join(
    outcomeDir,
    `.build-outcome.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );

  await mkdir(outcomeDir, { recursive: true });
  try {
    await writeFile(tempPath, JSON.stringify(outcome, null, 2));
    await rename(tempPath, outcomePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}
