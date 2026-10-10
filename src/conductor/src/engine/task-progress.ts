import { readFile, unlink, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { execa } from 'execa';
import {
  listCommitsWithTrailers,
  listCommitsWithTrailersAfterRepairBoundary,
  canonicalTaskId,
  parsePlanTaskVerifyOnly,
} from './autoheal.js';
import { readEngineState } from './engine-state-store.js';
import {
  COVERAGE_BINDING_COMPLETION_STATUSES,
  coverageBindingEnvelopePath,
  parseCoverageBindingEnvelope,
  projectChildOwnership,
} from './coverage-binding-envelope.js';
import { parseChildId, type ChildId } from './child-context.js';
import {
  createRepairObligationStore,
  repairPlanIdentity,
  taskObligationStanding,
  type RepairObligation,
  type RepairObligationSection,
} from './repair-obligations.js';
import { resolveRepairPlanBinding } from './repair-plan-binding.js';
import { parsePlanTaskBodies, parsePlanTaskDoneWhen, TEST_DONE_WHEN_TAG } from './plan-task-parse.js';
import { resolvePlanStoriesPath } from './plan-stories-reference.js';
import { readGitBlobs } from './git-blob-batch.js';
import {
  parseDoneWhenTestReference,
  verifyDoneWhenTestReference,
} from './done-when-test-reference.js';
import { writeHaltMarker } from './halt-marker.js';
import type { HaltMarkerWriteResult } from './halt-marker.js';
import type { ConductorEventEmitter } from '../ui/events.js';

/**
 * Count of distinct plan task-ids that are "resolved" — i.e. either already
 * `completed`/`skipped` in `.pipeline/task-status.json` (gate-authority /
 * `conduct task done` marked), OR carried by a `Task:` trailer on a commit
 * on the current branch. Returns 0 when the status file is absent or
 * unparseable — callers treat "no data" as "no progress" which is the safe
 * default.
 *
 * #757/#773 Task 15: this used to be sourced (indirectly, via task-status.json
 * completion) from the per-task evidence-ledger derivation engine
 * (`deriveCompletion`/`applyDerivedCompletion`), which feature #773 deleted
 * (Task 11) — that engine was never re-wired into the live build loop, so the
 * resolved-count silently stalled at whatever task-status.json already had.
 * The count now reads `Task:`-trailered commits directly (telemetry only,
 * non-gating) so it advances even when nothing has explicitly flipped a row's
 * status.
 *
 * Used by the build-step stall circuit breaker: if the count doesn't move
 * between two consecutive retries, the retries aren't actually producing
 * work and we auto-hand-off to interactive mode rather than burning the
 * rest of the budget.
 */
export async function countResolvedTasks(projectRoot: string, activeChild?: ChildId): Promise<number> {
  const statusPath = join(projectRoot, '.pipeline/task-status.json');
  let raw: string;
  try {
    raw = await readFile(statusPath, 'utf-8');
  } catch {
    return 0;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 0;
  }

  const tasks = normalizeTasks(parsed);
  if (tasks.length === 0) return 0;

  let planIds = tasks.map((t) => t.id).filter((id): id is string => id !== undefined);
  if (activeChild !== undefined) {
    const scope = await resolveChildTaskScope(projectRoot, activeChild);
    // An unreadable child membership must never let unrelated completed rows
    // count as progress.  Returning zero is the count API's existing
    // fail-closed representation for unavailable task state.
    if (scope.kind === 'refused') return 0;
    planIds = scope.taskIds;
  }
  if (planIds.length === 0) return 0;
  const resolved = await resolveTaskIds(projectRoot, planIds);
  return resolved.size;
}

export type ChildTaskScope =
  | { kind: 'available'; taskIds: string[] }
  | { kind: 'refused'; reason: string };

/**
 * The authoritative task set for one stacked BUILD child.  Plan slices are
 * sealed in coverage-binding; remediation tasks are additive and belong only
 * to the child recorded at append time.  A present remediation id without
 * that attribution is unsafe to assign speculatively, so it refuses rather
 * than silently dropping it.
 */
export async function resolveChildTaskScope(
  projectRoot: string,
  child: ChildId,
): Promise<ChildTaskScope> {
  let envelope;
  try {
    envelope = parseCoverageBindingEnvelope(
      JSON.parse(await readFile(coverageBindingEnvelopePath(projectRoot), 'utf8')),
    );
  } catch {
    envelope = null;
  }
  if (
    envelope === null ||
    !COVERAGE_BINDING_COMPLETION_STATUSES.includes(envelope.status) ||
    envelope.sliceMembership === undefined
  ) {
    return {
      kind: 'refused',
      reason: `child ${child} task membership is unavailable: coverage-binding slice membership is missing or invalid`,
    };
  }

  const state = await readEngineState(join(projectRoot, '.pipeline', 'engine-state.json'));
  if (!state.ok) {
    return {
      kind: 'refused',
      reason: `child ${child} task membership is unavailable: engine state is unreadable (${state.message})`,
    };
  }
  const rawRecorded = state.value.appendedRemediationTaskIds;
  if (rawRecorded !== undefined && (!Array.isArray(rawRecorded) || !rawRecorded.every((id) => typeof id === 'string' && id.length > 0))) {
    return {
      kind: 'refused',
      reason: `child ${child} task membership is unavailable: appended remediation task ids are invalid`,
    };
  }
  const recorded = (rawRecorded ?? []) as string[];
  const rawChildren = state.value.appendedRemediationTaskChildren;
  const children =
    rawChildren !== null && typeof rawChildren === 'object' && !Array.isArray(rawChildren)
      ? rawChildren as Record<string, unknown>
      : undefined;
  for (const id of recorded) {
    const owner = typeof children?.[id] === 'number' ? parseChildId(children[id] as number) : undefined;
    if (owner === undefined) {
      return {
        kind: 'refused',
        reason: `child ${child} task membership is unavailable: remediation task ${id} has no recorded child`,
      };
    }
  }

  const owned = projectChildOwnership(envelope, child).taskIds;
  const remediation = recorded.filter((id) => children?.[id] === child);
  return { kind: 'available', taskIds: [...new Set([...owned, ...remediation])] };
}

/**
 * Shared union fold: plan task-ids that are "resolved" — either already
 * `completed`/`skipped` in `.pipeline/task-status.json`, OR carried by a
 * `Task:` trailer on a commit on the current branch (matched against
 * `planIds` directly or via `canonicalTaskId` alias, e.g. plan id `2`
 * matches trailer `Task: T2`). Trailer read is fail-soft: a git error (non-repo
 * dir, no commits, etc.) degrades to no additional ids, never throws.
 *
 * This is the exact fold `countResolvedTasks` computes internally; extracted
 * here so other callers (the build completion predicate) can consume the
 * same definition instead of re-deriving it.
 */
export interface TaskResolution {
  resolved: Set<string>;
  unavailableReasons: Map<string, string>;
}

/** Resolves task completion while retaining strict-repair refusal diagnostics. */
export async function resolveTaskIdsWithDiagnostics(
  projectRoot: string,
  planIds: string[],
): Promise<TaskResolution> {
  const statusPath = join(projectRoot, '.pipeline/task-status.json');
  let raw: string;
  try {
    raw = await readFile(statusPath, 'utf-8');
  } catch {
    raw = '';
  }

  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : undefined;
  } catch {
    parsed = undefined;
  }

  const tasks = normalizeTasks(parsed);
  const planIdSet = new Set(planIds);

  const resolved = new Set<string>();
  for (const t of tasks) {
    if (
      (t.status === 'completed' || t.status === 'skipped') &&
      t.id !== undefined &&
      planIdSet.has(t.id)
    ) {
      resolved.add(t.id);
    }
  }

  const trailerIds = await distinctTaskTrailerIds(projectRoot);
  for (const id of trailerIds) {
    const canonical = canonicalTaskId(id);
    const match = planIdSet.has(id)
      ? id
      : [...planIdSet].find((p) => canonicalTaskId(p) === canonical);
    if (match !== undefined) resolved.add(match);
  }

  const unavailableReasons = new Map<string, string>();
  const repairState = await readOpenRepairState(projectRoot);
  if (repairState.kind === 'unavailable') {
    for (const planId of planIds) unavailableReasons.set(planId, repairState.reason);
    return { resolved: new Set(), unavailableReasons };
  }
  if (repairState.kind === 'none') return { resolved, unavailableReasons };

  for (const planId of planIds) {
    const canonicalId = canonicalTaskId(planId);
    const standing = taskObligationStanding(repairState.section, repairState.planIdentity, planId);
    if (standing.kind === 'none') continue;
    if (standing.kind === 'current-less') {
      resolved.delete(planId);
      unavailableReasons.set(planId, standing.reason);
      continue;
    }

    const obligations = standing.live;

    if (obligations.every((obligation) => obligation.tasks[canonicalId].status === 'resolved')) {
      resolved.add(planId);
      continue;
    }

    // An explicit repair takes precedence over legacy rows and broad branch
    // history. Every still-open obligation needs current, boundary-bounded
    // Task evidence before this task can route forward.
    resolved.delete(planId);
    let allOpenObligationsEvidenced = true;
    for (const obligation of obligations) {
      if (obligation.tasks[canonicalId].status === 'resolved') continue;
      const strictRange = await listCommitsWithTrailersAfterRepairBoundary(projectRoot, obligation.baseline.head);
      if (strictRange.kind !== 'available') {
        allOpenObligationsEvidenced = false;
        unavailableReasons.set(planId, strictRange.reason);
        continue;
      }
      const hasCurrentTrailer = strictRange.commits.some((commit) =>
        (commit.trailers.Task ?? []).some((trailer) => canonicalTaskId(trailer) === canonicalId),
      );
      if (!hasCurrentTrailer) allOpenObligationsEvidenced = false;
    }
    if (allOpenObligationsEvidenced) resolved.add(planId);
  }

  return { resolved, unavailableReasons };
}

/** Backwards-compatible resolved-id fold for callers that do not render diagnostics. */
export async function resolveTaskIds(projectRoot: string, planIds: string[]): Promise<Set<string>> {
  return (await resolveTaskIdsWithDiagnostics(projectRoot, planIds)).resolved;
}

type OpenRepairState =
  | { kind: 'none' }
  | {
    kind: 'available';
    obligations: RepairObligation[];
    section: RepairObligationSection;
    planIdentity: string;
  }
  | { kind: 'unavailable'; reason: string };

/**
 * The durable repair section is a control boundary. A malformed present state
 * must not silently restore historic completion through the legacy union.
 */
async function readOpenRepairState(projectRoot: string): Promise<OpenRepairState> {
  const statePath = join(projectRoot, '.pipeline', 'engine-state.json');
  const state = await readEngineState(statePath);
  if (!state.ok) return { kind: 'unavailable', reason: `repair state is unavailable: ${state.message}` };

  const repairs = await createRepairObligationStore(projectRoot, statePath).read();
  if (!repairs.ok) return { kind: 'unavailable', reason: `repair state is unavailable: ${repairs.message}` };
  const records = Object.values(repairs.value.records);
  // No obligation has ever been admitted here: the legacy union is the whole
  // authority and no plan needs resolving. This fast path keeps every feature
  // that predates repair obligations (and every telemetry-only
  // `countResolvedTasks` caller) on exactly its previous behaviour.
  if (records.length === 0) return { kind: 'none' };

  // Obligations exist, so the plan they are keyed by MUST be established
  // before the legacy union may speak. `activePlanPath` alone is not that
  // authority — a daemon-dispatched feature never runs the plan step that
  // records it, which is precisely how open obligations used to be read as
  // "none" and the re-staged task re-closed by an old `Task:` trailer
  // (#1831, #2261). Fail closed instead: an unresolvable plan under present
  // obligations is `unavailable`, never `none`.
  const binding = await resolveRepairPlanBinding(projectRoot);
  if (binding.kind === 'unbound') {
    return { kind: 'unavailable', reason: `repair state is unavailable: ${binding.reason}` };
  }
  const obligations = records.filter((obligation) => obligation.planIdentity === binding.identity);
  return obligations.length === 0
    ? { kind: 'none' }
    : { kind: 'available', obligations, section: repairs.value, planIdentity: binding.identity };
}

export type OpenRepairLookup =
  | { kind: 'none' }
  | { kind: 'open'; obligationId: string }
  | { kind: 'unavailable'; reason: string };

/**
 * Whether `id` currently carries an open repair obligation in the active plan.
 * `unavailable` distinguishes malformed present control state from legacy
 * absence so callers refuse instead of silently skipping an open repair.
 */
export async function openRepairForTask(projectRoot: string, id: string): Promise<OpenRepairLookup> {
  const state = await readOpenRepairState(projectRoot);
  if (state.kind === 'unavailable') return { kind: 'unavailable', reason: state.reason };
  if (state.kind === 'none') return { kind: 'none' };
  const standing = taskObligationStanding(state.section, state.planIdentity, id);
  if (standing.kind === 'current-less') return { kind: 'unavailable', reason: standing.reason };
  if (standing.kind === 'none') return { kind: 'none' };
  const open = standing.current?.tasks[canonicalTaskId(id)]?.status === 'open'
    ? standing.current
    : standing.live.find((obligation) => obligation.tasks[canonicalTaskId(id)]?.status === 'open');
  return open ? { kind: 'open', obligationId: open.id } : { kind: 'none' };
}

/**
 * Distinct raw `Task:` trailer values across commits on the current branch
 * (per `listCommitsWithTrailers`'s merge-base-relative range). Fails soft to
 * an empty set on any git error (non-repo dir, no commits, etc.) — trailer
 * sourcing is a best-effort addition, never a hard requirement.
 */
async function distinctTaskTrailerIds(projectRoot: string): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const commits = await listCommitsWithTrailers(projectRoot);
    for (const commit of commits) {
      for (const value of commit.trailers['Task'] ?? []) {
        ids.add(value);
      }
    }
  } catch {
    // fail-soft — no trailer data available
  }
  return ids;
}

/** A task row after tolerating both the new array shape and the legacy
 * id-keyed map shape. `id` and `title` are best-effort — absent/malformed
 * fields degrade to `undefined` rather than throwing. */
export interface NormalizedTask {
  id?: string;
  title?: string;
  status?: string;
}

/** Evidence supplied for a numbered task-local `Done when:` check. */
export interface DoneWhenEvidenceInput {
  index: number;
  evidence: string;
}

/** A reason supplied for explicitly closing a tagged check without test evidence. */
export interface DoneWhenUnverifiedInput {
  index: number;
  reason: string;
}

/** The engine-owned task-status entry recorded for each satisfied check. */
export interface DoneWhenEvidenceRecord {
  check: string;
  evidence: string;
  source: 'verified' | 'reported' | 'verify-only' | 'unverified';
  reason?: string;
}

export type TaskDoneWhenCloseResult =
  | { kind: 'legacy' }
  | { kind: 'completed' }
  | { kind: 'refused'; message: string };

interface TaskStatusRow extends Record<string, unknown> {
  id?: unknown;
  status?: unknown;
  doneWhen?: unknown;
}

/**
 * Apply the opted-in `Done when:` close contract to a task-status row.
 *
 * The active plan path comes only from engine state. A plan that predates
 * `Done when:` has no parser entry for the task and therefore returns the
 * legacy outcome without touching its row. For an opted-in task, this is the
 * sole writer of the completion state and the accompanying evidence.
 */
export async function completeTaskDoneWhen(
  projectRoot: string,
  id: string,
  suppliedEvidence: DoneWhenEvidenceInput[],
  suppliedUnverified: DoneWhenUnverifiedInput[] = [],
): Promise<TaskDoneWhenCloseResult> {
  const pipelineDir = join(projectRoot, '.pipeline');
  // A missing engine state is the legacy close path. A present but unreadable
  // control document is a typed refusal (AB-1): the close must not fail open
  // and clear the marker on top of malformed repair state.
  const engineState = await readEngineState(join(pipelineDir, 'engine-state.json'));
  if (!engineState.ok) {
    return { kind: 'refused', message: `[task-cli] cannot close task ${id}: ${engineState.message}` };
  }
  const recordedPlanPath = engineState.value.activePlanPath;
  let activePlanPath =
    typeof recordedPlanPath === 'string' && recordedPlanPath.trim() ? recordedPlanPath : undefined;
  if (!activePlanPath) {
    // A daemon-dispatched feature never runs the plan step that records
    // activePlanPath (#1831/#2261), so the close must resolve the plan the
    // same way readOpenRepairState does — by feature slug — or every
    // `task done` on such a feature is a silent legacy no-op that leaves the
    // row pending and stalls the build on no_task_progress.
    const binding = await resolveRepairPlanBinding(projectRoot);
    if (binding.kind === 'bound') activePlanPath = binding.identity;
  }
  if (!activePlanPath) return { kind: 'legacy' };

  let planText: string;
  try {
    planText = await readFile(
      isAbsolute(activePlanPath) ? activePlanPath : join(projectRoot, activePlanPath),
      'utf-8',
    );
  } catch {
    return {
      kind: 'refused',
      message: `[task-cli] cannot read the active plan to verify Done when evidence for task ${id}`,
    };
  }

  const doneWhen = parsePlanTaskDoneWhen(planText);
  if (doneWhen.malformedTaskIds.has(id)) {
    return {
      kind: 'refused',
      message: `[task-cli] task ${id} has a malformed Done when block with no checks`,
    };
  }
  const checks = doneWhen.get(id);
  if (!checks) return { kind: 'legacy' };

  const verifyOnly = parsePlanTaskVerifyOnly(planText).get(id) === true;
  const statePath = join(pipelineDir, 'engine-state.json');
  const repairs = createRepairObligationStore(projectRoot, statePath);
  const repairState = await repairs.read();
  if (!repairState.ok) {
    return { kind: 'refused', message: `[task-cli] cannot close task ${id}: ${repairState.message}` };
  }
  const canonicalId = canonicalTaskId(id);
  const planIdentity = repairPlanIdentity(projectRoot, activePlanPath);
  const standing = taskObligationStanding(repairState.value, planIdentity, id);
  if (standing.kind === 'current-less') {
    return { kind: 'refused', message: `[task-cli] cannot close task ${id}: ${standing.reason}` };
  }
  // `currentByPlan` selects the newest row for legacy single-repair callers,
  // but a task can carry independent findings from more than one authority.
  // A successful Done-when close is current evidence for every still-open
  // obligation on that task; leaving an older authority open would let it
  // override the just-completed status on the next resolution fold.
  const openObligationIds = (standing.kind === 'live' ? standing.live : [])
    .filter((obligation) => obligation.tasks[canonicalId]?.status === 'open')
    .map((obligation) => obligation.id);
  const evidenceByIndex = new Map<number, string>();
  for (const entry of suppliedEvidence) {
    if (entry.index > 0 && entry.evidence.trim()) {
      evidenceByIndex.set(entry.index, entry.evidence);
    }
  }
  const unverifiedByIndex = new Map<number, string>();
  for (const entry of suppliedUnverified) {
    const check = checks[entry.index - 1];
    if (!check || !check.trimStart().startsWith(TEST_DONE_WHEN_TAG)) {
      return {
        kind: 'refused',
        message: `[task-cli] cannot complete task ${id}: --unverified check ${entry.index} is not a tagged Done when check`,
      };
    }
    if (!entry.reason.trim()) {
      return {
        kind: 'refused',
        message:
          `[task-cli] cannot complete task ${id}: unverified close for Done when check ${entry.index} requires a non-empty reason; ` +
          `write or cite the test, or use --unverified ${entry.index}=<reason>.`,
      };
    }
    unverifiedByIndex.set(entry.index, entry.reason);
  }

  const missingIndex = checks.findIndex((check, index) =>
    (!verifyOnly || check.trimStart().startsWith(TEST_DONE_WHEN_TAG)) &&
    !evidenceByIndex.has(index + 1) && !unverifiedByIndex.has(index + 1));
  if (missingIndex !== -1) {
    const missingCheck = checks[missingIndex]!;
    const recovery = missingCheck.trimStart().startsWith(TEST_DONE_WHEN_TAG)
      ? `; write or cite the test, or use --unverified ${missingIndex + 1}=<reason>.`
      : '';
    return {
      kind: 'refused',
      message:
        `[task-cli] cannot complete task ${id}: missing Done when evidence for ` +
        `check ${missingIndex + 1}: ${missingCheck}${recovery}`,
    };
  }

  const taggedChecks = checks
    .map((check, index) => ({ check, index: index + 1 }))
    .filter(({ check }) => check.trimStart().startsWith(TEST_DONE_WHEN_TAG));
  if (taggedChecks.some(({ index }) => !unverifiedByIndex.has(index))) {
    let repositoryRoot: string;
    try {
      const root = await execa('git', ['rev-parse', '--show-toplevel'], {
        cwd: projectRoot,
        reject: false,
      });
      if (root.exitCode !== 0 || !root.stdout.trim()) {
        return {
          kind: 'refused',
          message: `[task-cli] cannot complete task ${id}: cannot resolve repository root for tagged Done when evidence`,
        };
      }
      repositoryRoot = root.stdout.trim();
    } catch {
      return {
        kind: 'refused',
        message: `[task-cli] cannot complete task ${id}: cannot resolve repository root for tagged Done when evidence`,
      };
    }

    const references = taggedChecks
      .filter(({ index }) => !unverifiedByIndex.has(index))
      .map(({ index }) => parseDoneWhenTestReference(evidenceByIndex.get(index)!));
    const paths = references.flatMap((reference) => reference ? [reference.path] : []);
    let blobs: Map<string, Buffer>;
    try {
      blobs = await readGitBlobs(repositoryRoot, 'HEAD', paths);
    } catch {
      return {
        kind: 'refused',
        message: `[task-cli] cannot complete task ${id}: cannot read HEAD test blobs for tagged Done when evidence`,
      };
    }

    const planRepoPath = relative(repositoryRoot, isAbsolute(activePlanPath)
      ? activePlanPath
      : join(projectRoot, activePlanPath)).replaceAll('\\', '/');
    const storiesPath = resolvePlanStoriesPath(planRepoPath, planText);
    const storiesText = storiesPath
      ? await readFile(join(repositoryRoot, storiesPath), 'utf8').catch(() => '')
      : '';
    const taskText = parsePlanTaskBodies(planText).get(id) ?? '';

    for (const { check, index } of taggedChecks) {
      if (unverifiedByIndex.has(index)) continue;
      const verification = verifyDoneWhenTestReference({
        evidence: evidenceByIndex.get(index)!,
        taskId: id,
        taskText,
        storiesText,
        blobs,
      });
      if (verification.kind === 'verified') continue;
      const detail = verification.part === 'missing-file'
        ? `${verification.path} is absent at HEAD`
        : verification.part === 'missing-title'
          ? `missing title ${verification.title} in ${verification.path}`
          : verification.part === 'missing-covers-marker'
            ? `missing Covers: marker in ${verification.path}`
            : 'not-a-test-reference: evidence is not a test:<path>::<title> reference';
      return {
        kind: 'refused',
        message:
          `[task-cli] cannot complete task ${id}: Done when check ${index}: ${check}; ${detail}. ` +
          `write or cite the test, or use --unverified ${index}=<reason>.`,
      };
    }
  }

  const statusPath = join(pipelineDir, 'task-status.json');
  let status: Record<string, unknown>;
  try {
    const rawStatus = await readFile(statusPath, 'utf-8');
    const parsed: unknown = JSON.parse(rawStatus);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { kind: 'refused', message: '[task-cli] task-status.json root is not an object' };
    }
    status = parsed as Record<string, unknown>;
  } catch (err) {
    return {
      kind: 'refused',
      message: `[task-cli] could not read task-status.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!Array.isArray(status.tasks)) {
    return { kind: 'refused', message: '[task-cli] task-status.json does not have a tasks array' };
  }

  const task = (status.tasks as unknown[]).find(
    (row): row is TaskStatusRow =>
      !!row && typeof row === 'object' && (row as TaskStatusRow).id === id,
  );
  if (!task) {
    return {
      kind: 'refused',
      message: `[task-cli] task id "${id}" not found in task-status.json`,
    };
  }

  const doneWhenRecords: DoneWhenEvidenceRecord[] = checks.map((check, index) => {
    const checkIndex = index + 1;
    const unverifiedReason = unverifiedByIndex.get(checkIndex);
    if (unverifiedReason !== undefined) {
      return {
        check,
        evidence: unverifiedReason,
        source: 'unverified',
        reason: unverifiedReason,
      };
    }
    return {
      check,
      evidence: verifyOnly && !check.trimStart().startsWith(TEST_DONE_WHEN_TAG)
        ? 'prove-closed'
        : evidenceByIndex.get(checkIndex)!,
      source: check.trimStart().startsWith(TEST_DONE_WHEN_TAG)
        ? 'verified'
        : verifyOnly ? 'verify-only' : 'reported',
    };
  });

  for (const obligationId of openObligationIds) {
    const closure = await repairs.close({
      planPath: activePlanPath,
      taskId: id,
      obligationId,
      evidence: { kind: 'current-done-when', value: JSON.stringify(doneWhenRecords) },
    });
    if (!closure.ok) {
      return { kind: 'refused', message: `[task-cli] cannot close current repair for task ${id}: ${closure.message}` };
    }
  }
  task.status = 'completed';
  task.doneWhen = doneWhenRecords;

  const tempFile = join(
    pipelineDir,
    `.task-status.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    await writeFile(tempFile, JSON.stringify(status, null, 2));
    await rename(tempFile, statusPath);
  } catch (err) {
    await rm(tempFile, { force: true }).catch(() => {});
    return {
      kind: 'refused',
      message: `[task-cli] failed to write task-status.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { kind: 'completed' };
}

/**
 * Tolerant parse shared by `countResolvedTasks` and the build-progress
 * watcher's `readSnapshot`: accepts the new `{tasks: [...]}` array shape and
 * the legacy id-keyed map shape (with or without a `tasks` wrapper key).
 * Never throws — malformed input normalizes to an empty array.
 */
export function normalizeTasks(parsed: unknown): NormalizedTask[] {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const container = 'tasks' in (parsed as Record<string, unknown>)
    ? (parsed as Record<string, unknown>).tasks
    : parsed;

  const titleOf = (t: Record<string, unknown>): string | undefined => {
    if (typeof t.title === 'string') return t.title;
    if (typeof t.name === 'string') return t.name;
    return undefined;
  };
  const statusOf = (t: Record<string, unknown>): string | undefined =>
    typeof t.status === 'string' ? t.status : undefined;

  if (Array.isArray(container)) {
    return container
      .filter((t) => typeof t === 'object' && t !== null)
      .map((t) => {
        const row = t as Record<string, unknown>;
        return {
          id: row.id !== undefined && row.id !== null ? String(row.id) : undefined,
          title: titleOf(row),
          status: statusOf(row),
        };
      });
  }
  if (container && typeof container === 'object') {
    return Object.entries(container as Record<string, unknown>).map(([id, v]) => {
      const row = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
      return {
        id,
        title: titleOf(row),
        status: statusOf(row),
      };
    });
  }
  return [];
}

/**
 * Marker file path used by skills (chiefly `/pipeline`) to explicitly signal
 * that the step can't make autonomous progress and needs human judgement. The
 * conductor reads this after each build attempt; if present, it treats the
 * attempt as a stall regardless of task-count deltas, emits
 * `build_stall`, and hands off to interactive mode.
 *
 * Shape-B counterpart of the progress-stall circuit breaker — skills opt in
 * when they KNOW they can't continue without input; the conductor catches
 * unconscious stalls via task-count deltas either way.
 */
export const HALT_MARKER_RELATIVE = '.pipeline/halt-user-input-required';

export function haltMarkerPath(projectRoot: string): string {
  return join(projectRoot, HALT_MARKER_RELATIVE);
}

export async function haltMarkerExists(projectRoot: string): Promise<boolean> {
  try {
    await readFile(haltMarkerPath(projectRoot), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the content of the halt marker file exactly as written. Returns null
 * if the file doesn't exist (ENOENT or any other error). Returns the raw
 * string content (possibly empty) if the file exists.
 *
 * Used by skills to retrieve the reason or context for a stall from the
 * halt marker body.
 */
export async function readHaltMarkerContent(projectRoot: string): Promise<string | null> {
  try {
    return await readFile(haltMarkerPath(projectRoot), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Clear the halt marker once the conductor has acknowledged it (handed off
 * to interactive mode). Silent on missing file — idempotent.
 */
export async function clearHaltMarker(projectRoot: string): Promise<void> {
  await unlink(haltMarkerPath(projectRoot)).catch(() => {
    // Marker absent — nothing to clear.
  });
}

/**
 * Write the build stall question (the reason for the halt) to an evidence file
 * at `.pipeline/build-stall-question.md`. If content is null, empty, or
 * whitespace-only, writes a placeholder line instead. Creates the `.pipeline`
 * directory if needed (mkdir -p semantics).
 *
 * Returns the exact string written (either the content or the placeholder),
 * for reuse by callers (e.g. to include in the HALT marker body).
 *
 * Used by the build-stall logic to persist the question asked during halt
 * for debugging and audit purposes.
 */
export async function writeStallQuestionEvidence(
  projectRoot: string,
  content: string | null,
): Promise<string> {
  const placeholder = '(agent wrote no reason into halt-user-input-required)';

  // Determine the effective text: use placeholder if content is null, empty, or whitespace-only
  const effectiveText =
    content === null || (typeof content === 'string' && content.trim() === '')
      ? placeholder
      : content;

  // Create .pipeline directory if needed
  const pipelineDir = join(projectRoot, '.pipeline');
  await mkdir(pipelineDir, { recursive: true });

  // Write to .pipeline/build-stall-question.md
  const evidencePath = join(pipelineDir, 'build-stall-question.md');
  await writeFile(evidencePath, effectiveText, 'utf-8');

  return effectiveText;
}

/**
 * Write a fail-safe HALT marker for a degraded remediation exit. Combines
 * the stall question with a detail about what went wrong (threw, malformed
 * JSON, stale file, dispositions dropped, or budget exhausted). Always
 * writes to `.pipeline/HALT` with the question on the first non-empty line,
 * then the detail. Used when planRemediation fails or returns a degraded outcome.
 *
 * Creates the `.pipeline` directory if needed (mkdir -p semantics).
 */
export async function writeStallHalt(
  projectRoot: string,
  question: string | null,
  detail: string,
  events?: ConductorEventEmitter,
  haltClass: Parameters<typeof writeHaltMarker>[2] | 'kickback-cap' = 'needs-human',
): Promise<HaltMarkerWriteResult> {
  const effectiveQuestion =
    question === null || (typeof question === 'string' && question.trim() === '')
      ? '(agent wrote no reason into halt-user-input-required)'
      : question;

  const haltContent = [effectiveQuestion, detail].filter(Boolean).join('\n\n');

  return writeHaltMarker(
    projectRoot,
    haltContent + '\n',
    haltClass as Parameters<typeof writeHaltMarker>[2],
    events,
  );
}
