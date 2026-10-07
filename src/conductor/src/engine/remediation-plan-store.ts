import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { REMEDIATION_PLAN_CONTRACT_VERSION, type AcceptedRemediationPlanDisposition } from './remediation-plan-contract.js';
import type { RemediationProjectionSource, RemediationRequiredReference } from './remediation-projection.js';

/** Engine-owned authority for validated gap-plan dispositions. */
export const REMEDIATION_TYPED_PLAN_PATH = '.pipeline/remediation-plan.json';

export interface PersistedRemediationPlan {
  readonly version: typeof REMEDIATION_PLAN_CONTRACT_VERSION;
  readonly attemptId: string;
  readonly source: RemediationProjectionSource;
  readonly requiredReferenceDigest: string;
  readonly dispositions: readonly AcceptedRemediationPlanDisposition[];
}

export interface PersistRemediationPlanInput {
  readonly attemptId: string;
  readonly source: RemediationProjectionSource;
  readonly requiredReferences: readonly RemediationRequiredReference[];
  readonly dispositions: readonly AcceptedRemediationPlanDisposition[];
}

export type PersistRemediationPlanResult =
  | { readonly kind: 'persisted'; readonly value: PersistedRemediationPlan }
  | { readonly kind: 'persistence-fault'; readonly reason: string };

export type ReadTypedRemediationPlanResult =
  | { readonly kind: 'present'; readonly value: PersistedRemediationPlan }
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid'; readonly reason: string };

/** Injectable boundary for atomic persistence and reader-isolation fixtures. */
export interface RemediationPlanStoreFilesystem {
  mkdir(path: string): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
}

export interface RemediationPlanStoreDependencies {
  readonly filesystem?: RemediationPlanStoreFilesystem;
}

const filesystem: RemediationPlanStoreFilesystem = {
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8').then(() => undefined),
  rename: (from, to) => rename(from, to).then(() => undefined),
  rm: (path) => rm(path, { force: true }).then(() => undefined),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validSource(value: unknown): value is RemediationProjectionSource {
  return value === 'validation-group' || value === 'prd-audit' || value === 'as-built' ||
    value === 'build-stall' || value === 'finish-verification';
}

function validReference(value: unknown): boolean {
  if (!isRecord(value) || !nonEmptyText(value.kind) || !nonEmptyText(value.id)) return false;
  if (value.kind === 'prd-criterion') {
    return exactKeys(value, ['kind', 'id', 'sourceGate', 'ownerTaskId', 'summary']) &&
      value.sourceGate === 'prd_audit' && nonEmptyText(value.ownerTaskId) && nonEmptyText(value.summary);
  }
  if (value.kind === 'as-built-finding') {
    return exactKeys(value, ['kind', 'id', 'sourceGate', 'reference', 'summary']) &&
      value.sourceGate === 'architecture_review_as_built' && isRecord(value.reference) && nonEmptyText(value.summary);
  }
  return value.kind === 'refusal' && exactKeys(value, ['kind', 'id', 'sourceGate', 'revision', 'rationale']) &&
    value.sourceGate === 'refusal-rework' && typeof value.revision === 'number' && Number.isInteger(value.revision) &&
    value.revision > 0 && nonEmptyText(value.rationale);
}

function validLooseReference(value: unknown): boolean {
  return isRecord(value) && exactKeys(value, ['kind', 'id']) && nonEmptyText(value.kind) && nonEmptyText(value.id);
}

function validDisposition(value: unknown): value is AcceptedRemediationPlanDisposition {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  const allowed = ['reference', 'requiredReference', 'disposition', 'targetStep', 'category', 'rationale', 'tasks', 'boundTaskIds'];
  if (!keys.every((key) => allowed.includes(key)) || !keys.includes('reference') || !keys.includes('disposition') ||
    !keys.includes('targetStep') || !keys.includes('category') || !keys.includes('rationale') ||
    !keys.includes('tasks') || !keys.includes('boundTaskIds')) return false;
  const reference = validReference(value.reference) || validLooseReference(value.reference);
  return reference && (value.requiredReference === undefined || validReference(value.requiredReference)) &&
    nonEmptyText(value.disposition) && nonEmptyText(value.targetStep) &&
    (value.category === null || nonEmptyText(value.category)) && nonEmptyText(value.rationale) &&
    Array.isArray(value.tasks) && value.tasks.every((task) => isRecord(task) && exactKeys(task, ['id', 'title']) &&
      nonEmptyText(task.id) && nonEmptyText(task.title)) &&
    Array.isArray(value.boundTaskIds) && value.boundTaskIds.every(nonEmptyText);
}

function validPersistedPlan(value: unknown): value is PersistedRemediationPlan {
  return isRecord(value) && exactKeys(value, ['version', 'attemptId', 'source', 'requiredReferenceDigest', 'dispositions']) &&
    value.version === REMEDIATION_PLAN_CONTRACT_VERSION && nonEmptyText(value.attemptId) && validSource(value.source) &&
    typeof value.requiredReferenceDigest === 'string' && /^sha256:[a-f0-9]{64}$/.test(value.requiredReferenceDigest) &&
    Array.isArray(value.dispositions) && value.dispositions.every(validDisposition);
}

/** The projected reference order is authoritative, so the digest preserves it. */
export function remediationRequiredReferenceDigest(references: readonly RemediationRequiredReference[]): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(references)).digest('hex')}`;
}

async function atomicWrite(path: string, contents: string, fs: RemediationPlanStoreFilesystem): Promise<void> {
  await fs.mkdir(dirname(path));
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, contents);
    await fs.rename(temporary, path);
  } finally {
    await fs.rm(temporary).catch(() => undefined);
  }
}

/** Persist the engine-validated output for exactly one planning attempt. */
export async function persistRemediationPlan(
  projectRoot: string,
  input: PersistRemediationPlanInput,
  dependencies: RemediationPlanStoreDependencies = {},
): Promise<PersistRemediationPlanResult> {
  const value: PersistedRemediationPlan = {
    version: REMEDIATION_PLAN_CONTRACT_VERSION,
    attemptId: input.attemptId,
    source: input.source,
    requiredReferenceDigest: remediationRequiredReferenceDigest(input.requiredReferences),
    dispositions: input.dispositions,
  };
  try {
    await atomicWrite(join(projectRoot, REMEDIATION_TYPED_PLAN_PATH), `${JSON.stringify(value, null, 2)}\n`, dependencies.filesystem ?? filesystem);
    return { kind: 'persisted', value };
  } catch (error) {
    return {
      kind: 'persistence-fault',
      reason: `failed to persist typed remediation plan: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** The sole authority reader for remediation gap-plan consumers. */
export async function readTypedRemediationPlan(
  projectRoot: string,
  request: { readonly attemptId: string },
  dependencies: RemediationPlanStoreDependencies = {},
): Promise<ReadTypedRemediationPlanResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(await (dependencies.filesystem ?? filesystem).readFile(join(projectRoot, REMEDIATION_TYPED_PLAN_PATH)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };
    return {
      kind: 'invalid',
      reason: `invalid typed remediation plan: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!validPersistedPlan(raw)) {
    return { kind: 'invalid', reason: 'invalid typed remediation plan: invalid persisted envelope' };
  }
  return raw.attemptId === request.attemptId ? { kind: 'present', value: raw } : { kind: 'absent' };
}
