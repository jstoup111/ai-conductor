import { createHash } from 'node:crypto';
import { execa } from 'execa';
import { canonicalTaskId, listCommitsWithTrailers } from './autoheal.js';
import { isEngineAppendedRemediationTaskId } from './remediation-append.js';
import { parsePlanTaskBodies, parsePlanTaskTitles } from './plan-task-parse.js';
import { createRepairObligationStore, repairPlanIdentity } from './repair-obligations.js';
import { markRemediationClosureApplied, readRemediationClosureState, recordRemediationClosureVerdicts } from './remediation-closure-state.js';
import { restageExistingRemediationTaskStatuses } from './repair-restage.js';
import { currentCommitSha, currentTreeHash } from './project-prelude.js';
import { countResolvedTasks, resolveChildTaskScope, resolveTaskIdsWithDiagnostics } from './task-progress.js';
import type { ChildId } from './child-context.js';

/** Maximum UTF-8 byte projection of a candidate's cited commit diffs. */
export const REMEDIATION_CLOSURE_DIFF_CAP_BYTES = 48_000;

const REMEDIATION_CLOSURE_INSTRUCTION =
  'Judge whether the named change in the plan block is present. An unverified close is not by itself grounds for persists or partial.';

export type RemediationClosureVerdict = 'resolved' | 'persists' | 'partial';

/** The stable fields of one persisted Done-when close record. */
export interface RemediationClosureCloseRecord {
  readonly check: string;
  readonly evidence: string;
  readonly source?: string;
}

/** The state needed to decide whether a task's current close was judged. */
export interface RemediationClosureCandidateState {
  readonly reopenCount: number;
  readonly verdicts: Readonly<Record<string, unknown>>;
}

export interface RemediationClosureCandidate {
  readonly taskId: string;
  readonly title?: string;
  readonly closeIdentity: string;
  readonly closeRecords: readonly RemediationClosureCloseRecord[];
}

export interface RemediationClosureInputCommit {
  readonly sha: string;
  /** Task-trailer commits are context only, never provenance or evidence. */
  readonly source: 'evidence' | 'task-trailer-context';
}

export interface RemediationClosureInputCandidate {
  readonly taskId: string;
  readonly closeIdentity: string;
  readonly planBlock: { readonly title: string; readonly body: string };
  readonly closeRecords: readonly RemediationClosureCloseRecord[];
  readonly citedCommits: readonly RemediationClosureInputCommit[];
  readonly diff: string;
  readonly truncated: boolean;
}

/** Read-only projection supplied to the remediation-closure provider. */
export interface RemediationClosureInput {
  readonly instruction: string;
  readonly candidates: readonly RemediationClosureInputCandidate[];
}

export interface SelectRemediationClosureCandidatesInput {
  readonly status: unknown;
  readonly scopeTaskIds: readonly string[];
  readonly resolvedIds: ReadonlySet<string>;
  /** Current-plan task state, keyed by task id. */
  readonly state: Readonly<Record<string, RemediationClosureCandidateState>>;
  readonly openCitationTaskIds: ReadonlySet<string>;
}

/**
 * Identifies one close independently of provenance rewritten by rebase or
 * citation settlement.  The record order is intentional: it is the order in
 * which the task was closed, not an unordered bag of assertions.
 */
export function remediationCloseIdentity(
  taskId: string,
  reopenCount: number,
  records: readonly RemediationClosureCloseRecord[],
): string {
  const canonical = JSON.stringify({
    taskId,
    reopenCount,
    records: records.map(({ check, evidence }) => [check, evidence]),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export interface RemediationClosureVerdictResult {
  readonly taskId: string;
  readonly verdict: RemediationClosureVerdict;
  readonly rationale: string;
}

export interface RemediationClosureReopen {
  readonly taskId: string;
  readonly reason: string;
}

async function applyRemediationClosureReopen(input: {
  readonly projectRoot: string;
  readonly planPath: string;
  readonly candidate: RemediationClosureCandidate;
  readonly rationale: string;
  readonly branch?: string;
}): Promise<RemediationClosureReopen> {
  const [head, tree, resolvedCount] = await Promise.all([
    currentCommitSha(input.projectRoot), currentTreeHash(input.projectRoot), countResolvedTasks(input.projectRoot),
  ]);
  const repairs = createRepairObligationStore(input.projectRoot, `${input.projectRoot}/.pipeline/engine-state.json`);
  const instruction = `Task ${input.candidate.taskId} "${input.candidate.title ?? ''}": ${input.rationale}`;
  const admitted = await repairs.admitOrReplay(`remediation-closure:${input.candidate.closeIdentity}`, {
    id: `remediation-closure-${input.candidate.closeIdentity.slice(0, 16)}`,
    planPath: input.planPath,
    taskIds: [input.candidate.taskId],
    source: { findingId: input.candidate.closeIdentity, authority: 'remediation-closure', instruction },
    baseline: {
      ...(input.branch === undefined ? {} : { branch: input.branch }),
      head: head ?? '', tree: tree ?? '', resolvedTaskIds: [], resolvedCount,
    },
  });
  if (!admitted.ok) throw new Error(`could not admit remediation closure reopen: ${admitted.message}`);
  const settled = await repairs.markSettled({ planPath: input.planPath, obligationId: admitted.obligation.id });
  if (!settled.ok) throw new Error(`could not settle remediation closure reopen: ${settled.message}`);
  const restaged = await restageExistingRemediationTaskStatuses(input.projectRoot, input.planPath, new Set([input.candidate.taskId]));
  if (restaged.kind === 'failed') throw new Error(restaged.detail);
  await markRemediationClosureApplied(input.projectRoot, input.planPath, input.candidate.taskId, input.candidate.closeIdentity);
  return { taskId: input.candidate.taskId, reason: `Remediation closure reopened: ${instruction}` };
}

/**
 * Finish a reopen which was durably recorded before a process stopped. Each
 * operation is idempotent, so replay can safely resume at any write boundary.
 */
export async function replayRemediationClosureReopens(input: {
  readonly projectRoot: string;
  readonly planPath: string;
  readonly planText: string;
  readonly scopeTaskIds: readonly string[];
  readonly branch?: string;
}): Promise<readonly RemediationClosureReopen[]> {
  const closureState = await readRemediationClosureState(input.projectRoot);
  if (closureState.kind === 'incompatible') throw new Error(closureState.message);
  const planIdentity = repairPlanIdentity(input.projectRoot, input.planPath);
  const tasks = closureState.state.plans[planIdentity]?.tasks ?? {};
  const titles = parsePlanTaskTitles(input.planText);
  const scope = new Set(input.scopeTaskIds.map(canonicalTaskId));
  const reopened: RemediationClosureReopen[] = [];
  for (const [taskId, task] of Object.entries(tasks).sort(([left], [right]) => left.localeCompare(right))) {
    if (!scope.has(canonicalTaskId(taskId))) continue;
    for (const [closeIdentity, verdict] of Object.entries(task.verdicts).sort(([left], [right]) => left.localeCompare(right))) {
      if (verdict.applied || verdict.disposition !== 'reopened' || verdict.verdict === 'resolved') continue;
      reopened.push(await applyRemediationClosureReopen({
        projectRoot: input.projectRoot,
        planPath: input.planPath,
        candidate: { taskId, title: titles.get(taskId), closeIdentity, closeRecords: [] },
        rationale: verdict.rationale,
        ...(input.branch === undefined ? {} : { branch: input.branch }),
      }));
    }
  }
  return reopened;
}

/**
 * Applies a completed closure judgement in the order which makes a reopen
 * crash-recoverable: verdict, obligation, settlement, row restage, then the
 * applied marker/count.  This is deliberately separate from candidate
 * selection so the conductor can turn the returned reasons into its retry
 * hint without re-reading mutable state.
 */
export async function applyRemediationClosureVerdicts(input: {
  readonly projectRoot: string;
  readonly planPath: string;
  readonly candidates: readonly RemediationClosureCandidate[];
  readonly verdicts: readonly RemediationClosureVerdictResult[];
  /** A routed child obligation must bind its host branch at admission. */
  readonly branch?: string;
}): Promise<readonly RemediationClosureReopen[]> {
  const candidates = new Map(input.candidates.map((candidate) => [candidate.taskId, candidate]));
  await recordRemediationClosureVerdicts(input.projectRoot, input.planPath, input.verdicts.map((verdict) => {
    const candidate = candidates.get(verdict.taskId);
    if (!candidate) throw new Error(`remediation closure verdict has no candidate for ${verdict.taskId}`);
    return {
      taskId: verdict.taskId,
      closeIdentity: candidate.closeIdentity,
      verdict: verdict.verdict,
      rationale: verdict.rationale,
      disposition: verdict.verdict === 'resolved' ? 'left-closed' : 'reopened',
    };
  }));

  const reopened: RemediationClosureReopen[] = [];
  for (const verdict of input.verdicts) {
    if (verdict.verdict === 'resolved') continue;
    const candidate = candidates.get(verdict.taskId)!;
    reopened.push(await applyRemediationClosureReopen({
      projectRoot: input.projectRoot, planPath: input.planPath, candidate, rationale: verdict.rationale,
      ...(input.branch === undefined ? {} : { branch: input.branch }),
    }));
  }
  return reopened;
}

export type RemediationClosureValidation =
  | { readonly kind: 'valid'; readonly verdicts: readonly RemediationClosureVerdictResult[] }
  | { readonly kind: 'invalid'; readonly reason: string };

/** Provider-visible contract for one verdict per remediation-closure candidate. */
export const REMEDIATION_CLOSURE_JUDGEMENT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['taskId', 'verdict', 'rationale'],
        properties: {
          taskId: { type: 'string', pattern: '\\S' },
          verdict: { type: 'string', enum: ['resolved', 'persists', 'partial'] },
          rationale: { type: 'string', minLength: 1 },
        },
      },
    },
  },
});

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function closeRecords(value: unknown): readonly RemediationClosureCloseRecord[] {
  if (!Array.isArray(value)) return [];
  const records: RemediationClosureCloseRecord[] = [];
  for (const rawRecord of value) {
    const close = record(rawRecord);
    if (!close || typeof close.check !== 'string' || typeof close.evidence !== 'string') return [];
    records.push({
      check: close.check,
      evidence: close.evidence,
      ...(typeof close.source === 'string' ? { source: close.source } : {}),
    });
  }
  return records;
}

function statusRows(status: unknown): readonly Record<string, unknown>[] {
  const root = record(status);
  if (!root) return [];
  const tasks = root.tasks ?? root;
  if (Array.isArray(tasks)) return tasks.flatMap((value) => {
    const row = record(value);
    return row ? [row] : [];
  });
  return Object.entries(record(tasks) ?? {}).flatMap(([id, value]) => {
    const row = record(value);
    return row ? [{ ...row, ...(typeof row.id === 'string' ? {} : { id }) }] : [];
  });
}

/**
 * Selects only current resolved remediation closes eligible for the sibling
 * closure judgement.  This deliberately consumes resolved ids from the
 * shared resolver rather than reinterpreting row status or Task trailers.
 */
export function selectRemediationClosureCandidates(
  input: SelectRemediationClosureCandidatesInput,
): readonly RemediationClosureCandidate[] {
  const scope = new Set(input.scopeTaskIds);
  const candidates: RemediationClosureCandidate[] = [];
  for (const row of statusRows(input.status)) {
    if (typeof row.id !== 'string' || !isEngineAppendedRemediationTaskId(row.id) ||
      !scope.has(row.id) || !input.resolvedIds.has(row.id) || input.openCitationTaskIds.has(row.id)) continue;
    const records = closeRecords(row.doneWhen);
    if (records.length === 0 || records.some(({ source }) => source === 'pending-judgement')) continue;
    const taskState = input.state[row.id];
    const reopenCount = taskState?.reopenCount ?? 0;
    const closeIdentity = remediationCloseIdentity(row.id, reopenCount, records);
    if (taskState?.verdicts[closeIdentity] !== undefined) continue;
    candidates.push({
      taskId: row.id,
      ...(typeof row.title === 'string' ? { title: row.title } : {}),
      closeIdentity,
      closeRecords: records,
    });
  }
  return candidates;
}

function shaTokens(evidence: string): readonly string[] {
  return evidence.match(/(?<![0-9a-f])[0-9a-f]{7,40}(?![0-9a-f])/gi) ?? [];
}

async function resolveCommit(projectRoot: string, token: string): Promise<string | undefined> {
  const result = await execa('git', ['rev-parse', '--verify', '--quiet', `${token}^{commit}`], {
    cwd: projectRoot,
    reject: false,
  });
  return result.exitCode === 0 && result.stdout.trim() ? result.stdout.trim() : undefined;
}

function truncateUtf8(value: string): { text: string; truncated: boolean } {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= REMEDIATION_CLOSURE_DIFF_CAP_BYTES) return { text: value, truncated: false };
  let end = REMEDIATION_CLOSURE_DIFF_CAP_BYTES;
  while (end > 0 && (bytes[end] ?? 0) >= 0x80 && (bytes[end] ?? 0) <= 0xbf) end -= 1;
  return { text: bytes.subarray(0, end).toString('utf8'), truncated: true };
}

/**
 * Builds the bounded, read-only evidence projection for one judgement pass.
 * Evidence-shaped SHA tokens that do not name commits are intentionally
 * ignored: the input enriches a completed close but never refuses it.
 */
export async function buildRemediationClosureInput(
  projectRoot: string,
  candidates: readonly RemediationClosureCandidate[],
  planBodies: ReadonlyMap<string, string>,
): Promise<RemediationClosureInput> {
  const trailerCommits = await listCommitsWithTrailers(projectRoot).catch(() => []);
  const inputCandidates = await Promise.all(candidates.map(async (candidate) => {
    const commits: RemediationClosureInputCommit[] = [];
    const seen = new Set<string>();
    for (const token of candidate.closeRecords.flatMap(({ evidence }) => shaTokens(evidence))) {
      const sha = await resolveCommit(projectRoot, token).catch(() => undefined);
      if (sha && !seen.has(sha)) {
        seen.add(sha);
        commits.push({ sha, source: 'evidence' });
      }
    }
    for (const commit of trailerCommits) {
      if (!(commit.trailers.Task ?? []).some((taskId) =>
        canonicalTaskId(taskId.trim()) === canonicalTaskId(candidate.taskId))) continue;
      const sha = await resolveCommit(projectRoot, commit.sha).catch(() => undefined);
      if (sha && !seen.has(sha)) {
        seen.add(sha);
        commits.push({ sha, source: 'task-trailer-context' });
      }
    }
    const diffs = await Promise.all(commits.map(async ({ sha }) => {
      const result = await execa('git', ['show', '--format=', sha], { cwd: projectRoot, reject: false });
      return result.exitCode === 0 ? result.stdout : '';
    }));
    const bounded = truncateUtf8(diffs.join(''));
    return {
      taskId: candidate.taskId,
      closeIdentity: candidate.closeIdentity,
      planBlock: { title: candidate.title ?? '', body: planBodies.get(candidate.taskId) ?? '' },
      closeRecords: candidate.closeRecords,
      citedCommits: commits,
      diff: bounded.text,
      truncated: bounded.truncated,
    };
  }));
  return { instruction: REMEDIATION_CLOSURE_INSTRUCTION, candidates: inputCandidates };
}

export function validateRemediationClosureOutput(
  output: unknown,
  candidateIds: readonly string[],
): RemediationClosureValidation {
  const root = record(output);
  if (!root || Object.keys(root).some((key) => key !== 'verdicts') || !Array.isArray(root.verdicts)) {
    return { kind: 'invalid', reason: 'remediation closure judgement must be an object with verdicts' };
  }

  const expected = new Set(candidateIds);
  const seen = new Set<string>();
  const verdicts: RemediationClosureVerdictResult[] = [];
  for (const rawVerdict of root.verdicts) {
    const verdict = record(rawVerdict);
    if (!verdict ||
      Object.keys(verdict).some((key) => !['taskId', 'verdict', 'rationale'].includes(key)) ||
      typeof verdict.taskId !== 'string' || !verdict.taskId.trim() ||
      (verdict.verdict !== 'resolved' && verdict.verdict !== 'persists' && verdict.verdict !== 'partial') ||
      typeof verdict.rationale !== 'string' || !verdict.rationale.trim()) {
      return { kind: 'invalid', reason: 'remediation closure judgement has an invalid verdict' };
    }
    if (!expected.has(verdict.taskId)) {
      return { kind: 'invalid', reason: `remediation closure judgement has unexpected verdict for ${verdict.taskId}` };
    }
    if (seen.has(verdict.taskId)) {
      return { kind: 'invalid', reason: `remediation closure judgement has duplicate verdict for ${verdict.taskId}` };
    }
    seen.add(verdict.taskId);
    verdicts.push({
      taskId: verdict.taskId,
      verdict: verdict.verdict,
      rationale: verdict.rationale,
    });
  }
  if (seen.size !== expected.size) {
    return { kind: 'invalid', reason: 'remediation closure judgement omitted a candidate verdict' };
  }
  return { kind: 'valid', verdicts };
}

/**
 * Runs the BUILD-boundary closure judgement after citation settlement.  This
 * task applies the resulting reopen through the durable repair-obligation
 * path before the completion predicate observes the task rows.
 */
export async function runRemediationClosurePass(input: {
  projectRoot: string;
  planPath: string;
  planText: string;
  status: unknown;
  scopeTaskIds: readonly string[];
  activeChild?: ChildId;
  branch?: string;
  dispatch: (input: RemediationClosureInput) => Promise<
    | { readonly kind: 'valid'; readonly verdicts: readonly RemediationClosureVerdictResult[] }
    | { readonly kind: 'unavailable'; readonly cause: string }
  >;
}): Promise<readonly RemediationClosureReopen[]> {
  let scopeTaskIds = input.scopeTaskIds;
  if (input.activeChild !== undefined) {
    const scope = await resolveChildTaskScope(input.projectRoot, input.activeChild);
    // Child membership is an authority boundary.  In particular, never judge
    // a sibling's close when a recreated worktree cannot establish ownership.
    if (scope.kind === 'refused') return [];
    scopeTaskIds = scope.taskIds;
  }
  // Recovery must complete before selection: an interrupted reopen is still a
  // closed row until restaging, and must never be sent to the judge again.
  const replayed = await replayRemediationClosureReopens({ ...input, scopeTaskIds });
  const [closureState, repairs, resolution] = await Promise.all([
    readRemediationClosureState(input.projectRoot),
    createRepairObligationStore(input.projectRoot, `${input.projectRoot}/.pipeline/engine-state.json`).read(),
    resolveTaskIdsWithDiagnostics(input.projectRoot, [...scopeTaskIds]),
  ]);
  if (closureState.kind === 'incompatible') throw new Error(closureState.message);
  if (!repairs.ok) throw new Error(`could not read repair obligations: ${repairs.message}`);

  const planIdentity = repairPlanIdentity(input.projectRoot, input.planPath);
  const openCitationTaskIds = new Set<string>();
  for (const obligation of Object.values(repairs.value.records)) {
    if (obligation.planIdentity !== planIdentity || obligation.source.authority !== 'done-when-citation') continue;
    for (const taskId of obligation.taskIds) {
      if (obligation.tasks[taskId]?.status === 'open') openCitationTaskIds.add(taskId);
    }
  }
  const state = closureState.state.plans[planIdentity]?.tasks ?? {};
  const candidates = selectRemediationClosureCandidates({
    status: input.status,
    scopeTaskIds,
    resolvedIds: resolution.resolved,
    state,
    openCitationTaskIds,
  });
  if (candidates.length === 0) return replayed;

  const titles = parsePlanTaskTitles(input.planText);
  const titledCandidates = candidates.map((candidate) => ({ ...candidate, title: titles.get(candidate.taskId) ?? candidate.title }));
  const judgementInput = await buildRemediationClosureInput(
    input.projectRoot,
    titledCandidates,
    parsePlanTaskBodies(input.planText),
  );
  const judgement = await input.dispatch(judgementInput);
  if (judgement.kind !== 'valid') return replayed;
  return [...replayed, ...await applyRemediationClosureVerdicts({
    projectRoot: input.projectRoot, planPath: input.planPath, candidates: titledCandidates, verdicts: judgement.verdicts, branch: input.branch,
  })];
}
