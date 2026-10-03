import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  PRD_AUDIT_JUDGMENT_CONTRACT_VERSION,
  isPrdAuditNoOwnerOrdinal,
  type PrdAuditJudgment,
} from './prd-audit-contract.js';

/** Engine-owned authority; the adjacent Markdown report is only a derived view. */
export const PRD_AUDIT_VERDICT_PATH = '.pipeline/prd-audit.json';
export const PRD_AUDIT_REPORT_PATH = '.pipeline/prd-audit.md';

/**
 * Routing supplies these engine-derived projections after it has applied the
 * current policy. They retain the durable decision separately from the
 * reviewer's judgment so later consumers never infer acceptance from intent.
 */
export interface PrdAuditRecordedDisposition {
  readonly criterionId: string;
  readonly grade: 'PLAN_GAP' | 'OVER_SCOPE';
  /** `record` is the engine's non-operator publication decision. */
  readonly decision: 'record' | 'accept' | 'refuse';
  /** Policy or operator rationale for this disposition, never reviewer prose. */
  readonly rationale: string;
  /** The actor authorized an accept/refuse decision; engine for record. */
  readonly authority: string;
}

export interface PersistedPrdAuditVerdict {
  readonly attemptId: string;
  readonly codeStamp: string | null;
  readonly complete: boolean;
  /** The validated reviewer judgment, retained independently of projections. */
  readonly judgment: PrdAuditJudgment;
  /** Engine-authored validation defects; empty only for complete evidence. */
  readonly diagnostics: readonly string[];
  /** Engine-derived routing/display projections, never reviewer or operator authority. */
  readonly recordedDispositions: readonly PrdAuditRecordedDisposition[];
}

export type ReadPrdAuditVerdictResult =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly reason: string }
  | { readonly kind: 'present'; readonly value: PersistedPrdAuditVerdict };

/** Narrow test seam; failure remains a failure and never falls back to Markdown. */
export interface PrdAuditVerdictStoreDependencies {
  readonly write?: (path: string, contents: string) => Promise<void>;
  readonly render?: (value: PersistedPrdAuditVerdict) => string;
}

/** Lets the runner name the output that failed after authority was durable. */
export class PrdAuditVerdictPersistenceError extends Error {
  constructor(readonly stage: 'authority' | 'report', cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'PrdAuditVerdictPersistenceError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validAssociation(value: unknown): boolean {
  return isRecord(value) && exactKeys(value, ['path', 'requirementId']) &&
    nonEmptyText(value.path) && nonEmptyText(value.requirementId);
}

function validCriterionJudgment(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.criterion) ||
    !exactKeys(value.criterion, ['storyId', 'ordinal']) || !nonEmptyText(value.criterion.storyId) ||
    typeof value.criterion.ordinal !== 'number' || !Number.isInteger(value.criterion.ordinal) || value.criterion.ordinal < 1 ||
    !nonEmptyText(value.criterionId) || !nonEmptyText(value.evidence) || !nonEmptyText(value.rationale) ||
    !Array.isArray(value.requirementAssociations) || !value.requirementAssociations.every(validAssociation) ||
    !Array.isArray(value.evidenceTaskIds) || !value.evidenceTaskIds.every(nonEmptyText)) return false;

  if (value.grade === 'FIXABLE') {
    return exactKeys(value, ['criterion', 'criterionId', 'grade', 'evidence', 'rationale', 'requirementAssociations', 'evidenceTaskIds', 'ownerTaskId']) &&
      nonEmptyText(value.ownerTaskId);
  }
  if (value.grade === 'OVER_SCOPE') {
    return exactKeys(value, ['criterion', 'criterionId', 'grade', 'evidence', 'rationale', 'requirementAssociations', 'evidenceTaskIds', 'intentRelation']) &&
      (value.intentRelation === 'within' || value.intentRelation === 'outside-harmless' || value.intentRelation === 'outside-visible');
  }
  return (value.grade === 'PASS' || value.grade === 'PLAN_GAP') &&
    exactKeys(value, ['criterion', 'criterionId', 'grade', 'evidence', 'rationale', 'requirementAssociations', 'evidenceTaskIds']);
}

function validNoOwnerObservation(value: unknown): boolean {
  return isRecord(value) && exactKeys(value, ['presentationOrdinal', 'grade', 'evidence', 'rationale', 'intentRelation']) &&
    nonEmptyText(value.presentationOrdinal) && isPrdAuditNoOwnerOrdinal(value.presentationOrdinal) && value.grade === 'OVER_SCOPE' && nonEmptyText(value.evidence) && nonEmptyText(value.rationale) &&
    (value.intentRelation === 'within' || value.intentRelation === 'outside-harmless' || value.intentRelation === 'outside-visible');
}

function validJudgment(value: unknown): value is PrdAuditJudgment {
  return isRecord(value) && exactKeys(value, ['version', 'criterionJudgments', 'noOwnerObservations']) &&
    value.version === PRD_AUDIT_JUDGMENT_CONTRACT_VERSION && Array.isArray(value.criterionJudgments) &&
    value.criterionJudgments.every(validCriterionJudgment) && Array.isArray(value.noOwnerObservations) &&
    value.noOwnerObservations.every(validNoOwnerObservation) &&
    new Set(value.noOwnerObservations.map((observation) => observation.presentationOrdinal)).size === value.noOwnerObservations.length;
}

function validRecordedDisposition(value: unknown): value is PrdAuditRecordedDisposition {
  return isRecord(value) && exactKeys(value, ['criterionId', 'grade', 'decision', 'rationale', 'authority']) &&
    nonEmptyText(value.criterionId) && (value.grade === 'PLAN_GAP' || value.grade === 'OVER_SCOPE') &&
    (value.decision === 'record' || value.decision === 'accept' || value.decision === 'refuse') &&
    nonEmptyText(value.rationale) && nonEmptyText(value.authority);
}

/** Render a human-readable view. No machine reader may treat this text as authority. */
export function renderPrdAuditReport(value: PersistedPrdAuditVerdict): string {
  const lines = [
    '# PRD audit',
    '',
    `Status: ${value.complete ? 'complete' : 'incomplete'}`,
    `Attempt: ${value.attemptId}`,
    `Code stamp: ${value.codeStamp ?? 'unavailable'}`,
    '',
    '## Criterion judgments',
    ...value.judgment.criterionJudgments.map((judgment) =>
      `- ${judgment.criterionId}: ${judgment.grade} — ${judgment.evidence}`),
  ];
  if (value.judgment.noOwnerObservations.length > 0) {
    lines.push('', '## No-owner observations', ...value.judgment.noOwnerObservations.map((observation) =>
      `- ${observation.presentationOrdinal}: ${observation.grade} — ${observation.evidence}`));
  }
  if (value.diagnostics.length > 0) lines.push('', '## Diagnostics', ...value.diagnostics.map((diagnostic) => `- ${diagnostic}`));
  if (value.recordedDispositions.length > 0) {
    lines.push('', '## Recorded dispositions', ...value.recordedDispositions.map((disposition) =>
      `- ${disposition.criterionId}: ${disposition.grade} (${disposition.decision} by ${disposition.authority}) — ${disposition.rationale}`));
  }
  return `${lines.join('\n')}\n`;
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, 'utf8');
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

/**
 * Persist only the current engine-supplied attempt identity and code stamp.
 * This writer never reads a prior artifact, so an older file cannot satisfy a
 * current-dispatch write handshake.
 */
export async function persistPrdAuditVerdict(
  worktree: string,
  evidence: Omit<PersistedPrdAuditVerdict, 'attemptId' | 'codeStamp'>,
  identity: Pick<PersistedPrdAuditVerdict, 'attemptId' | 'codeStamp'>,
  dependencies: PrdAuditVerdictStoreDependencies = {},
): Promise<PersistedPrdAuditVerdict> {
  const value: PersistedPrdAuditVerdict = { ...evidence, ...identity };
  const write = dependencies.write ?? atomicWrite;
  const render = dependencies.render ?? renderPrdAuditReport;
  try {
    await write(join(worktree, PRD_AUDIT_VERDICT_PATH), `${JSON.stringify(value, null, 2)}\n`);
  } catch (error) {
    throw new PrdAuditVerdictPersistenceError('authority', error);
  }
  try {
    await write(join(worktree, PRD_AUDIT_REPORT_PATH), render(value));
  } catch (error) {
    throw new PrdAuditVerdictPersistenceError('report', error);
  }
  return value;
}

/** The sole authority reader for PRD-audit verdict consumers. */
export async function readPrdAuditVerdict(worktree: string): Promise<ReadPrdAuditVerdictResult> {
  const path = join(worktree, PRD_AUDIT_VERDICT_PATH);
  let contents: string;
  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT'
      ? { kind: 'absent' }
      : { kind: 'unreadable', reason: `${PRD_AUDIT_VERDICT_PATH} has invalid evidence: unreadable typed evidence: ${error instanceof Error ? error.message : String(error)}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch (error) {
    return {
      kind: 'unreadable',
      reason: `${PRD_AUDIT_VERDICT_PATH} has invalid evidence: corrupt typed evidence: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (isRecord(raw) && isRecord(raw.judgment) && typeof raw.judgment.version === 'string' &&
    raw.judgment.version !== PRD_AUDIT_JUDGMENT_CONTRACT_VERSION) {
    return {
      kind: 'unreadable',
      reason: `${PRD_AUDIT_VERDICT_PATH} has invalid evidence: unsupported typed evidence version ${raw.judgment.version}`,
    };
  }
  if (!isRecord(raw) || !exactKeys(raw, ['attemptId', 'codeStamp', 'complete', 'judgment', 'diagnostics', 'recordedDispositions']) ||
    !nonEmptyText(raw.attemptId) || (raw.codeStamp !== null && !nonEmptyText(raw.codeStamp)) || typeof raw.complete !== 'boolean' ||
    !validJudgment(raw.judgment) || !Array.isArray(raw.diagnostics) || !raw.diagnostics.every(nonEmptyText) ||
    !Array.isArray(raw.recordedDispositions) || !raw.recordedDispositions.every(validRecordedDisposition)) {
    return { kind: 'unreadable', reason: `${PRD_AUDIT_VERDICT_PATH} has invalid evidence: invalid persisted envelope` };
  }
  return {
    kind: 'present',
    value: {
      attemptId: raw.attemptId,
      codeStamp: raw.codeStamp,
      complete: raw.complete,
      judgment: raw.judgment,
      diagnostics: raw.diagnostics,
      recordedDispositions: raw.recordedDispositions,
    },
  };
}
