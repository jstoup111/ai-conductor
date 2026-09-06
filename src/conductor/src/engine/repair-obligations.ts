import { relative, resolve } from 'node:path';
import { canonicalTaskId } from './autoheal.js';
import {
  createEngineStateStore,
  type EngineState,
  type EngineStateStore,
} from './engine-state-store.js';

export interface RepairAdmission {
  /** Engine-issued identity. Replays must present this same immutable id. */
  id: string;
  planPath: string;
  taskIds: readonly string[];
  source: {
    findingId: string;
    authority: string;
    instruction: string;
  };
  baseline: {
    head: string;
    tree: string;
    resolvedTaskIds: readonly string[];
  };
}

export interface RepairClosureEvidence {
  kind: string;
  value: string;
}

export interface RepairObligation {
  id: string;
  planIdentity: string;
  taskIds: string[];
  source: RepairAdmission['source'];
  baseline: {
    head: string;
    tree: string;
    resolvedTaskIds: string[];
  };
  settlement: 'unsettled' | 'settled';
  tasks: Record<string, { status: 'open' | 'resolved'; evidence?: RepairClosureEvidence }>;
}

interface RepairObligationSection {
  version: 1;
  records: Record<string, RepairObligation>;
  currentByPlan: Record<string, Record<string, string>>;
  admissionsByPlan: Record<string, Record<string, string>>;
}

type RepairResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: 'incompatible' | 'persistence' | 'stale' | 'missing'; message: string };

export type RepairAdmissionResult =
  | { ok: true; obligation: RepairObligation; replayed: boolean }
  | Extract<RepairResult<never>, { ok: false }>;
export type RepairClosureResult =
  | { ok: true; obligation: RepairObligation }
  | Extract<RepairResult<never>, { ok: false }>;

export interface RepairObligationStore {
  admit(admission: RepairAdmission): Promise<RepairAdmissionResult>;
  /** Replays only an explicit, caller-authoritative effect key within one plan. */
  admitOrReplay(admissionKey: string, admission: RepairAdmission): Promise<RepairAdmissionResult>;
  close(input: {
    planPath: string;
    taskId: string;
    obligationId: string;
    evidence: RepairClosureEvidence;
  }): Promise<RepairClosureResult>;
  read(): Promise<RepairResult<RepairObligationSection>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function uniqueCanonicalTaskIds(taskIds: readonly string[]): string[] {
  return [...new Set(taskIds.map((taskId) => canonicalTaskId(taskId.trim())).filter(Boolean))];
}

/** Normalizes a plan path without deriving identity from mutable plan bytes. */
export function repairPlanIdentity(projectRoot: string, planPath: string): string {
  return relative(resolve(projectRoot), resolve(projectRoot, planPath)).replaceAll('\\', '/');
}

function failure(message: string): RepairResult<never> {
  return { ok: false, kind: 'incompatible', message };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validEvidence(value: unknown): value is RepairClosureEvidence {
  return isRecord(value) && typeof value.kind === 'string' && typeof value.value === 'string';
}

function validObligation(value: unknown): value is RepairObligation {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.planIdentity !== 'string' ||
    !isStringArray(value.taskIds) || !isRecord(value.source) || !isRecord(value.baseline) ||
    !isRecord(value.tasks)) return false;
  if (typeof value.source.findingId !== 'string' || typeof value.source.authority !== 'string' ||
    typeof value.source.instruction !== 'string' || typeof value.baseline.head !== 'string' ||
    typeof value.baseline.tree !== 'string' || !isStringArray(value.baseline.resolvedTaskIds) ||
    (value.settlement !== 'unsettled' && value.settlement !== 'settled')) return false;
  return Object.values(value.tasks).every((task) => isRecord(task) &&
    (task.status === 'open' || task.status === 'resolved') &&
    (task.evidence === undefined || validEvidence(task.evidence)));
}

function parseSection(state: Readonly<EngineState>): RepairResult<RepairObligationSection> {
  const raw = state.repairObligations;
  if (raw === undefined) return { ok: true, value: { version: 1, records: {}, currentByPlan: {}, admissionsByPlan: {} } };
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.records) || !isRecord(raw.currentByPlan) ||
    (raw.admissionsByPlan !== undefined && !isRecord(raw.admissionsByPlan))) {
    return failure('Engine state repairObligations section is incompatible');
  }
  if (!Object.values(raw.records).every(validObligation) ||
    !Object.values(raw.currentByPlan).every((tasks) => isRecord(tasks) && Object.values(tasks).every((id) => typeof id === 'string')) ||
    !(raw.admissionsByPlan === undefined || Object.values(raw.admissionsByPlan)
      .every((keys) => isRecord(keys) && Object.values(keys).every((id) => typeof id === 'string')))) {
    return failure('Engine state repairObligations records are incompatible');
  }
  return {
    ok: true,
    value: { ...raw, admissionsByPlan: raw.admissionsByPlan ?? {} } as unknown as RepairObligationSection,
  };
}

function persistenceFailure(result: { kind: string; message: string }): RepairResult<never> {
  return { ok: false, kind: result.kind === 'incompatible' ? 'incompatible' : 'persistence', message: result.message };
}

export function createRepairObligationStore(
  projectRoot: string,
  statePath: string,
  store: EngineStateStore = createEngineStateStore(statePath),
): RepairObligationStore {
  const read = async (): Promise<RepairResult<RepairObligationSection>> => {
    const current = await store.read();
    if (!current.ok) return persistenceFailure(current);
    return parseSection(current.value);
  };

  const admit = async (admission: RepairAdmission, admissionKey?: string): Promise<RepairAdmissionResult> => {
      let result: RepairAdmissionResult | undefined;
      const planIdentity = repairPlanIdentity(projectRoot, admission.planPath);
      const taskIds = uniqueCanonicalTaskIds(admission.taskIds);
      if (!admission.id || taskIds.length === 0 || (admissionKey !== undefined && !admissionKey.trim())) return failure('Repair admission requires an id, task, and non-empty key') as RepairAdmissionResult;

      const updated = await store.update((current) => {
        const parsed = parseSection(current);
        if (!parsed.ok) {
          result = parsed as RepairAdmissionResult;
          return current as EngineState;
        }
        const section = clone(parsed.value);
        const replayId = admissionKey === undefined ? undefined : section.admissionsByPlan[planIdentity]?.[admissionKey];
        if (replayId !== undefined) {
          const replay = section.records[replayId];
          if (!replay) {
            result = failure('Repair admission key points to a missing obligation') as RepairAdmissionResult;
            return current as EngineState;
          }
          result = { ok: true, obligation: clone(replay), replayed: true };
          return current as EngineState;
        }
        const existing = section.records[admission.id];
        if (existing) {
          result = { ok: true, obligation: clone(existing), replayed: true };
          return current as EngineState;
        }
        const obligation: RepairObligation = {
          id: admission.id,
          planIdentity,
          taskIds,
          source: clone(admission.source),
          baseline: { ...clone(admission.baseline), resolvedTaskIds: uniqueCanonicalTaskIds(admission.baseline.resolvedTaskIds) },
          settlement: 'unsettled',
          tasks: Object.fromEntries(taskIds.map((taskId) => [taskId, { status: 'open' as const }])),
        };
        section.records[obligation.id] = obligation;
        if (admissionKey !== undefined) {
          section.admissionsByPlan[planIdentity] = {
            ...(section.admissionsByPlan[planIdentity] ?? {}),
            [admissionKey]: obligation.id,
          };
        }
        const currentTasks = section.currentByPlan[planIdentity] ?? {};
        section.currentByPlan[planIdentity] = { ...currentTasks, ...Object.fromEntries(taskIds.map((taskId) => [taskId, obligation.id])) };
        result = { ok: true, obligation: clone(obligation), replayed: false };
        return { ...current, repairObligations: section };
      });
      return updated.ok ? result! : persistenceFailure(updated) as RepairAdmissionResult;
  };

  return {
    read,
    admit: (admission) => admit(admission),
    admitOrReplay: (admissionKey, admission) => admit(admission, admissionKey),

    async close(input): Promise<RepairClosureResult> {
      let result: RepairClosureResult | undefined;
      const planIdentity = repairPlanIdentity(projectRoot, input.planPath);
      const taskId = canonicalTaskId(input.taskId.trim());
      const updated = await store.update((current) => {
        const parsed = parseSection(current);
        if (!parsed.ok) {
          result = parsed as RepairClosureResult;
          return current as EngineState;
        }
        const section = clone(parsed.value);
        const obligation = section.records[input.obligationId];
        if (!obligation || !obligation.tasks[taskId]) {
          result = { ok: false, kind: 'missing', message: 'Repair obligation or bound task is missing' };
          return current as EngineState;
        }
        if (section.currentByPlan[planIdentity]?.[taskId] !== input.obligationId) {
          result = { ok: false, kind: 'stale', message: 'Repair obligation has been superseded for this task' };
          return current as EngineState;
        }
        if (obligation.tasks[taskId].status === 'open') {
          obligation.tasks[taskId] = { status: 'resolved', evidence: clone(input.evidence) };
        }
        result = { ok: true, obligation: clone(obligation) };
        return { ...current, repairObligations: section };
      });
      return updated.ok ? result! : persistenceFailure(updated) as RepairClosureResult;
    },
  };
}
