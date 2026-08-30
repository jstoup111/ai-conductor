import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  RemediationCaseFeatureIdentity,
} from './remediation-case-store.js';
import type { RemediationCasePriority } from './remediation-case-artifact.js';

const WORK_ORDER_VERSION = 'v1' as const;
const WORK_ORDER_PATH = '.pipeline/build-review-work-order.json';
const MAX_REFERENCE_LENGTH = 256;
const MAX_TEXT_LENGTH = 8_000;
const MAX_CASES = 128;
const MAX_TASKS_PER_CASE = 32;

export interface BuildReviewWorkOrderTask {
  readonly title: string;
}

/** One canonical action case in its caller-supplied priority order. */
export interface BuildReviewWorkOrderCase {
  readonly caseId: string;
  readonly priority: RemediationCasePriority;
  readonly tasks: readonly BuildReviewWorkOrderTask[];
}

/**
 * Durable BUILD retry input. `effectId` is the stable route identity shared
 * with the case store and kickback ledger; this artifact never owns plan work.
 */
export interface BuildReviewWorkOrder {
  readonly version: typeof WORK_ORDER_VERSION;
  readonly domain: 'build_review';
  readonly feature: RemediationCaseFeatureIdentity;
  readonly effectId: string;
  readonly cases: readonly BuildReviewWorkOrderCase[];
}

export interface BuildReviewWorkOrderFilesystem {
  readFile(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
}

export type BuildReviewWorkOrderFailureReason =
  | 'missing-work-order'
  | 'unreadable-work-order'
  | 'malformed-json'
  | 'unknown-version'
  | 'foreign-domain'
  | 'malformed-order'
  | 'foreign-feature'
  | 'foreign-effect'
  | 'atomic-replace-failed';

export type PublishBuildReviewWorkOrderResult =
  | { readonly ok: true; readonly workOrder: BuildReviewWorkOrder }
  | { readonly ok: false; readonly reason: BuildReviewWorkOrderFailureReason };

export type ReadBuildReviewWorkOrderResult = PublishBuildReviewWorkOrderResult;

const defaultFilesystem: BuildReviewWorkOrderFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8').then(() => undefined),
  rename: (from, to) => rename(from, to).then(() => undefined),
  rm: (path) => rm(path, { force: true }).then(() => undefined),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function boundedString(value: unknown, maximum = MAX_TEXT_LENGTH): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function sameFeature(left: RemediationCaseFeatureIdentity, right: RemediationCaseFeatureIdentity): boolean {
  return left.version === right.version && left.repository === right.repository && left.feature === right.feature;
}

function parseFeature(value: unknown): RemediationCaseFeatureIdentity | undefined {
  if (!isRecord(value) || !exactKeys(value, ['version', 'repository', 'feature']) || value.version !== WORK_ORDER_VERSION ||
    !boundedString(value.repository, MAX_REFERENCE_LENGTH) || !boundedString(value.feature, MAX_REFERENCE_LENGTH)) return undefined;
  return { version: WORK_ORDER_VERSION, repository: value.repository, feature: value.feature };
}

function parseCase(value: unknown): BuildReviewWorkOrderCase | undefined {
  if (!isRecord(value) || !exactKeys(value, ['caseId', 'priority', 'tasks']) ||
    !boundedString(value.caseId, MAX_REFERENCE_LENGTH) ||
    !['critical', 'high', 'medium', 'low'].includes(value.priority as string) ||
    !Array.isArray(value.tasks) || value.tasks.length === 0 || value.tasks.length > MAX_TASKS_PER_CASE) return undefined;
  const tasks: BuildReviewWorkOrderTask[] = [];
  for (const task of value.tasks) {
    if (!isRecord(task) || !exactKeys(task, ['title']) || !boundedString(task.title)) return undefined;
    tasks.push({ title: task.title });
  }
  return { caseId: value.caseId, priority: value.priority as RemediationCasePriority, tasks };
}

function parseWorkOrder(value: unknown): PublishBuildReviewWorkOrderResult {
  if (!isRecord(value) || !exactKeys(value, ['version', 'domain', 'feature', 'effectId', 'cases'])) {
    return { ok: false, reason: 'malformed-order' };
  }
  if (value.version !== WORK_ORDER_VERSION) return { ok: false, reason: 'unknown-version' };
  if (value.domain !== 'build_review') return { ok: false, reason: 'foreign-domain' };
  const feature = parseFeature(value.feature);
  if (!feature || !boundedString(value.effectId, MAX_REFERENCE_LENGTH) || !Array.isArray(value.cases) ||
    value.cases.length === 0 || value.cases.length > MAX_CASES) return { ok: false, reason: 'malformed-order' };

  const caseIds = new Set<string>();
  const cases: BuildReviewWorkOrderCase[] = [];
  for (const candidate of value.cases) {
    const caseRow = parseCase(candidate);
    if (!caseRow || caseIds.has(caseRow.caseId)) return { ok: false, reason: 'malformed-order' };
    caseIds.add(caseRow.caseId);
    cases.push(caseRow);
  }
  return { ok: true, workOrder: { version: WORK_ORDER_VERSION, domain: 'build_review', feature, effectId: value.effectId, cases } };
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** The feature-local artifact path, deliberately outside the approved plan. */
export function buildReviewWorkOrderPath(projectRoot: string): string {
  return join(projectRoot, WORK_ORDER_PATH);
}

/**
 * Atomically publishes one fully validated work order. The case-store lease in
 * the action-effect executor serializes competing publishers; this module is
 * intentionally limited to the artifact boundary.
 */
export async function publishBuildReviewWorkOrder(
  projectRoot: string,
  workOrderInput: unknown,
  filesystem: BuildReviewWorkOrderFilesystem = defaultFilesystem,
): Promise<PublishBuildReviewWorkOrderResult> {
  const parsed = parseWorkOrder(workOrderInput);
  if (!parsed.ok) return parsed;

  const path = buildReviewWorkOrderPath(projectRoot);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await filesystem.mkdir(dirname(path));
    await filesystem.writeFile(temporaryPath, `${JSON.stringify(parsed.workOrder)}\n`);
    await filesystem.rename(temporaryPath, path);
    return parsed;
  } catch {
    await filesystem.rm(temporaryPath).catch(() => undefined);
    return { ok: false, reason: 'atomic-replace-failed' };
  }
}

/**
 * Reads only a work order bound to the feature and stable effect that the
 * caller reserved. Any malformed, stale, or foreign artifact remains outside
 * BUILD prompt construction.
 */
export async function readBuildReviewWorkOrder(
  projectRoot: string,
  feature: RemediationCaseFeatureIdentity,
  effectId: string,
  filesystem: BuildReviewWorkOrderFilesystem = defaultFilesystem,
): Promise<ReadBuildReviewWorkOrderResult> {
  let serialized: string;
  try {
    serialized = await filesystem.readFile(buildReviewWorkOrderPath(projectRoot));
  } catch (error) {
    return { ok: false, reason: isMissing(error) ? 'missing-work-order' : 'unreadable-work-order' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    return { ok: false, reason: 'malformed-json' };
  }
  const parsed = parseWorkOrder(raw);
  if (!parsed.ok) return parsed;
  if (!sameFeature(parsed.workOrder.feature, feature)) return { ok: false, reason: 'foreign-feature' };
  if (parsed.workOrder.effectId !== effectId) return { ok: false, reason: 'foreign-effect' };
  return parsed;
}

/** Adds validated ordered work to an existing BUILD retry context. */
export function appendBuildReviewWorkOrderContext(
  context: string,
  workOrder: BuildReviewWorkOrder,
): string {
  const lines = [
    context,
    '',
    `Build-review remediation work order (effect: ${workOrder.effectId}):`,
  ];
  for (const [caseIndex, caseRow] of workOrder.cases.entries()) {
    lines.push(`${caseIndex + 1}. [${caseRow.priority}] ${caseRow.caseId}`);
    for (const [taskIndex, task] of caseRow.tasks.entries()) {
      lines.push(`   ${taskIndex + 1}. ${task.title}`);
    }
  }
  return lines.join('\n');
}
