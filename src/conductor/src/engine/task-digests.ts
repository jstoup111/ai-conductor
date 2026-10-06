import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createEngineStateStore, type EngineState } from './engine-state-store.js';
import { repairPlanIdentity } from './repair-obligations.js';

interface TaskDigestSection {
  version: 1;
  byPlan: Record<string, Record<string, string>>;
}

export type TaskDigestReadResult =
  | { kind: 'absent' }
  | { kind: 'present'; digests: Record<string, string> }
  | { kind: 'incompatible'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function parseSection(state: Readonly<EngineState>):
  | { kind: 'absent' }
  | { kind: 'present'; section: TaskDigestSection }
  | { kind: 'incompatible'; message: string } {
  const raw = state.taskDigests;
  if (raw === undefined) return { kind: 'absent' };
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.byPlan) ||
    !Object.values(raw.byPlan).every(isStringMap)) {
    return { kind: 'incompatible', message: 'Engine state taskDigests section is incompatible' };
  }
  return { kind: 'present', section: raw as unknown as TaskDigestSection };
}

function statePath(projectRoot: string): string {
  return join(projectRoot, '.pipeline', 'engine-state.json');
}

export async function readTaskDigests(projectRoot: string, planPath: string): Promise<TaskDigestReadResult> {
  const result = await createEngineStateStore(statePath(projectRoot)).read();
  if (!result.ok) return { kind: 'incompatible', message: result.message };
  const parsed = parseSection(result.value);
  if (parsed.kind !== 'present') return parsed;
  const digests = parsed.section.byPlan[repairPlanIdentity(projectRoot, planPath)];
  return digests === undefined ? { kind: 'absent' } : { kind: 'present', digests: { ...digests } };
}

/**
 * Read only the task-digest section, tolerating a malformed sibling section.
 * Diagnostic use: lets a seed failure tell whether a reopen was actually due.
 */
export async function readTaskDigestsLeniently(projectRoot: string, planPath: string): Promise<TaskDigestReadResult> {
  let state: unknown;
  try {
    state = JSON.parse(await readFile(statePath(projectRoot), 'utf8'));
  } catch {
    return { kind: 'incompatible', message: 'Engine state is unreadable' };
  }
  if (!isRecord(state)) return { kind: 'incompatible', message: 'Engine state must be a JSON object' };
  const parsed = parseSection(state as EngineState);
  if (parsed.kind !== 'present') return parsed;
  const digests = parsed.section.byPlan[repairPlanIdentity(projectRoot, planPath)];
  return digests === undefined ? { kind: 'absent' } : { kind: 'present', digests: { ...digests } };
}

export async function recordTaskDigests(
  projectRoot: string,
  planPath: string,
  digests: Readonly<Record<string, string>>,
): Promise<void> {
  const result = await createEngineStateStore(statePath(projectRoot)).update((state) => {
    const parsed = parseSection(state);
    if (parsed.kind === 'incompatible') throw new Error(parsed.message);
    const section: TaskDigestSection = parsed.kind === 'absent'
      ? { version: 1, byPlan: {} }
      : { version: 1, byPlan: { ...parsed.section.byPlan } };
    section.byPlan[repairPlanIdentity(projectRoot, planPath)] = { ...digests };
    return { ...state, taskDigests: section };
  });
  if (!result.ok) throw new Error(`Failed to record task digests (${result.kind}): ${result.message}`);
}
