import type { StepDefinition, StepName } from '../types/index.js';
import {
  REMEDIATION_EXISTING_TASK_DISPOSITION,
  REMEDIATION_PUBLICATION_DISPOSITION,
  remediationDispositionStep,
  type RemediationDispositionRejection,
  type RemediationGap,
} from './artifacts.js';
import { resolvePlanTaskReference } from './plan-task-parse.js';
import { scanPlanProtectedTargets } from './plan-protected-targets.js';
import type { RemediationProjectionSource } from './remediation-projection.js';
import type { AcceptedRemediationPlanDisposition } from './remediation-plan-contract.js';

/**
 * Identifies the gate evidence that authorized a remediation dispatch. A
 * validation-group round can carry more than one gate, so this deliberately
 * preserves each gate-to-artifact pairing rather than flattening it into a
 * comma-delimited filename string.
 */
export interface RemediationGateProvenance {
  gate: StepName;
  evidenceFile: string;
}

export interface RemediationHintSource {
  source: string;
  evidence: readonly RemediationGateProvenance[];
  /**
   * adr-2026-08-25 decision 8 (retained by decision 9): the same
   * validation-group round carries a manual_test FAIL, so the consolidated
   * kickback owns the work order. An existing-task gap still rides that
   * merged route, but its gate-local mechanics — lap charge, pending finding,
   * task-status re-stage, no-op baseline — must not run for this round.
   */
  consolidatedManualTestFail?: boolean;
}

export function formatRejectedDispositions(rejected: readonly RemediationDispositionRejection[]): string {
  if (rejected.length === 0) return '';
  if (rejected.every((rejection) => rejection.field === 'disposition')) {
    return `${rejected.map(({ gapId, disposition }) => `${gapId} → "${disposition}"`).join(', ')}; ` +
      `accepted dispositions are ${rejected[0].accepted.join(' | ')}`;
  }
  return rejected.map((rejection) => {
    const field = rejection.field === 'category' ? 'category' : 'disposition';
    const fieldPlural = field === 'category' ? 'categories' : 'dispositions';
    return `${rejection.gapId} ${field} → "${rejection.disposition}"; ` +
      `accepted ${fieldPlural} are ${rejection.accepted.join(' | ')}`;
  }).join('; ');
}

// Covers: task:19
export function remediationProjectionSource(source: string): RemediationProjectionSource {
  switch (source) {
    case 'validation-group': return 'validation-group';
    case 'prd-audit': return 'prd-audit';
    case 'prd_audit': return 'prd-audit';
    case 'build-stall':
    case 'build_stall':
    case 'build_stall_zero_work': return 'build-stall';
    case 'finish-verification': return 'finish-verification';
    case 'architecture-review-as-built':
    case 'architecture_review_as_built':
    case 'as-built architecture review': return 'as-built';
    default: return 'finish-verification';
  }
}

/** Keep the established admission path on its legacy in-memory shape. */
export function remediationGapsFromTypedPlan(
  dispositions: readonly AcceptedRemediationPlanDisposition[],
): RemediationGap[] {
  return dispositions.map((disposition) => ({
    id: disposition.reference.id,
    disposition: disposition.disposition,
    category: disposition.category,
    rationale: disposition.rationale,
    tasks: disposition.disposition === REMEDIATION_EXISTING_TASK_DISPOSITION
      ? disposition.boundTaskIds.map((id) => ({ id, title: `Existing task ${id}` }))
      : disposition.tasks.map((task) => ({ ...task })),
  }));
}

/**
 * The runner preserves field-specific rejections in its structured-result
 * diagnostic because it must not persist a rejected typed plan. Recover only
 * the validated event payload here; all other malformed-output diagnostics
 * remain ordinary retryable planner faults.
 */
export function remediationDispositionRejectionsFromDispatchOutput(
  output: string | undefined,
): RemediationDispositionRejection[] {
  const marker = '; rejections: ';
  if (output === undefined || !output.startsWith('structured-result-rejected:')) return [];
  const markerIndex = output.lastIndexOf(marker);
  if (markerIndex === -1) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.slice(markerIndex + marker.length));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((candidate): RemediationDispositionRejection[] => {
    if (candidate === null || typeof candidate !== 'object') return [];
    const rejection = candidate as Partial<RemediationDispositionRejection>;
    if (
      typeof rejection.gapId !== 'string' ||
      typeof rejection.disposition !== 'string' ||
      !Array.isArray(rejection.accepted) ||
      !rejection.accepted.every((value) => typeof value === 'string') ||
      (rejection.field !== 'disposition' && rejection.field !== 'category' && rejection.field !== 'boundTaskIds')
    ) return [];
    return [{
      gapId: rejection.gapId,
      disposition: rejection.disposition,
      accepted: [...rejection.accepted],
      field: rejection.field,
    }];
  });
}

/**
 * The earliest target step among a set of remediation fixes. The loop
 * navigateBacks here and re-runs forward, so picking the earliest re-runs every
 * step a fix needs (e.g. an `architecture_review` fix + a `build` fix → start at
 * `architecture_review`). Unresolvable dispositions are surfaced to the caller
 * so it can refuse to route a remediation plan it cannot fully understand.
 */
export function earliestRemediationTarget(
  fixes: RemediationGap[],
  steps: StepDefinition[],
): { target: StepName; unresolved: string[] } {
  let best: StepName = 'build';
  let bestIdx = steps.length;
  const unresolved = new Set<string>();
  for (const g of fixes) {
    // `publication` is a disposition, not a step name — it resolves to `finish`,
    // the step that owns PR prose.
    const stepName = remediationDispositionStep(g.disposition);
    const idx = steps.findIndex((s) => s.name === stepName);
    if (idx < 0) {
      unresolved.add(g.disposition);
      continue;
    }
    if (idx >= 0 && idx < bestIdx) {
      bestIdx = idx;
      best = stepName as StepName;
    }
  }
  return { target: best, unresolved: [...unresolved] };
}

export type ExistingTaskBindingResolution =
  | { kind: 'resolved'; ids: string[] }
  | { kind: 'unresolvable'; id: string };

/**
 * Resolve an existing-task remediation binding against the active plan. Keep
 * this at the admission seam so every caller shares plan-task-parse's grammar
 * and trailing-annotation normalization rather than recreating either locally.
 */
export function resolveExistingTaskBindingsForAdmission(
  tasks: ReadonlyArray<Pick<RemediationGap['tasks'][number], 'id'>>,
  activePlanTaskIds: ReadonlySet<string>,
): ExistingTaskBindingResolution {
  const ids: string[] = [];
  for (const task of tasks) {
    const resolved = resolvePlanTaskReference(task.id, activePlanTaskIds);
    if (resolved.kind !== 'resolved') {
      return { kind: 'unresolvable', id: resolved.kind === 'unresolvable' ? resolved.ids.join(', ') : task.id };
    }
    for (const id of resolved.ids) if (!ids.includes(id)) ids.push(id);
  }
  return { kind: 'resolved', ids };
}

/**
 * Remediation tasks carry their concrete file scopes in titles rather than in
 * plan `**Files:**` blocks. Present those scopes to the shared plan scanner so
 * this route inherits the seal's directory and own-feature judgement.
 */
export function remediationGapTargetsAnotherFeatureSealedArtifact(
  gap: RemediationGap,
  activePlanStem: string,
): {
  artifact: string;
  directingClause: string;
  directingSource: 'task title' | 'rationale';
} | undefined {
  // Task titles are prose, not plan Files declarations — remediation tasks
  // routinely cite .docs artifacts as evidence ("the sequence contract at
  // .docs/architecture/sequences/<slug>.md:87 requires ..."), and treating the
  // whole title as a Files line rerouted such gaps to the undispatchable
  // `plan` disposition and surfaced them as bare `Missing:` halts. Apply the
  // same directed-edit clause test the rationale already uses: only a
  // protected path with an edit verb in its own preceding clause is a target.
  const taskTarget = gap.tasks
    .map((task) => directedProtectedTarget(task.title, activePlanStem))
    .find((target) => target !== undefined);
  if (taskTarget) {
    return {
      artifact: taskTarget.path,
      directingClause: taskTarget.clause,
      directingSource: 'task title',
    };
  }

  // Rationale is prose rather than a plan Files declaration. Treat it as a
  // target only when it both names a resolvable protected artifact and directs
  // an edit; a context-only citation must not re-route source work.
  const rationaleTarget = directedProtectedTarget(gap.rationale, activePlanStem);
  return rationaleTarget === undefined
    ? undefined
    : {
      artifact: rationaleTarget.path,
      directingClause: rationaleTarget.clause,
      directingSource: 'rationale',
    };
}

/**
 * A protected `.docs` path counts as an edit target only when a directing
 * verb appears in the same clause before it; a context-only citation never
 * re-routes source work.
 */
export function directedProtectedTarget(
  prose: string,
  activePlanStem: string,
): { path: string; clause: string } | undefined {
  const prosePaths = Array.from(
    prose.matchAll(
      /(?:^|[\s`])((?:\.\/)?\.docs\/(?:architecture|decisions|plans|stories|specs)\/[A-Za-z0-9._-]+\.md)\b/g,
    ),
  );
  if (prosePaths.length === 0) return undefined;
  const action = /\b(?:amend|change|delete|edit|remove|rewrite|update)\b/i;
  const directedPaths = prosePaths.flatMap((match) => {
    const path = match[1];
    const pathOffset = (match.index ?? 0) + match[0].lastIndexOf(path);
    // A semicolon separates independent clauses just as a sentence boundary
    // does. Only an action in this path's own preceding clause can direct it.
    const beforePath = prose.slice(0, pathOffset);
    const clauseStart = Math.max(
      beforePath.lastIndexOf('.'),
      beforePath.lastIndexOf(';'),
      beforePath.lastIndexOf('\n'),
    );
    const clause = prose.slice(clauseStart + 1).trim();
    return action.test(beforePath.slice(clauseStart + 1)) ? [{ path, clause }] : [];
  });
  if (directedPaths.length === 0) return undefined;
  const directedScope = `### Task directed: remediation\n\n**Files:** ${directedPaths.map(({ path }) => path).join(', ')}`;
  const target = scanPlanProtectedTargets(directedScope, activePlanStem)[0]?.path;
  const targetClause = target === undefined
    ? undefined
    : directedPaths.find(({ path }) => path.replace(/^\.\//, '') === target.replace(/^\.\//, ''))?.clause;
  return targetClause === undefined || target === undefined
    ? undefined
    : { path: target, clause: normalizeDirectingClause(targetClause) };
}

function normalizeDirectingClause(clause: string): string {
  const normalized = clause.replace(/\s+/g, ' ').trim();
  return normalized.length <= 160 ? normalized : `${normalized.slice(0, 159)}…`;
}

/**
 * The retryReason handed to the remediation target step — names each gap, its
 * disposition, and its concrete tasks, and tells the agent to make the changes
 * even though the task list may show complete (the as-built code is re-audited).
 * `source`/`evidenceFile` name the gate that blocked and its gap artifact so the
 * same hint serves prd-audit, finish-verification, and as-built remediation.
 */
export function buildRemediationHint(
  fixes: RemediationGap[],
  source = 'prd-audit',
  evidenceFile = '.pipeline/prd-audit.md',
): string {
  // ai-conductor:session-command-context=managed
  const lines = fixes.map((g) => {
    const tasks = g.tasks.length ? ` Tasks: ${g.tasks.map((t) => t.title).join('; ')}` : '';
    return `- ${g.id} [${g.disposition}]: ${g.rationale}.${tasks}`;
  });
  // A publication-only plan is a prose defect. The generic wording below tells
  // the agent to "make the code/spec changes", which is exactly how a PR-body
  // gap turned into implementation work.
  if (fixes.length > 0 && fixes.every((g) => g.disposition === REMEDIATION_PUBLICATION_DISPOSITION)) {
    return (
      `Remediating blocking ${source} gaps (see the engine-owned typed remediation result and ` +
      `${evidenceFile}). These are PUBLICATION gaps: the implementation is complete and ` +
      'must not change. Fix only the pull request\'s published prose — rewrite the PR body ' +
      '(`## Why` / `## What Changed` / `## Testing`, plus the `Closes` reference) with a ' +
      '`pull-request.edit` request passed to `ai-conductor github-operation --request-file`, and correct the title or issue linkage if named below. Do not change ' +
      'code, do not amend the plan, and do not re-run the build:\n' +
      lines.join('\n')
    );
  }
  return (
    `Remediating blocking ${source} gaps (see the engine-owned typed remediation result and ` +
    `${evidenceFile}). The task list may already show complete, but the ` +
    'following are NOT satisfied — make the code/spec changes and commit them; ' +
    'the as-built code is re-audited after this step:\n' +
    lines.join('\n')
  );
  // /ai-conductor:session-command-context
}

/**
 * Build the retry hint injected into Claude's system prompt after a
 * completion-gate miss. The default hint assumes work is unfinished and
 * tells Claude to "finish the work now." That wording is actively
 * misleading when the real failure is a stale status file — Claude sees
 * "finish the work" and re-implements already-done tasks, producing
 * duplicate commits and never updating the tracking file. For `build`
 * with a "tasks not completed" reason, redirect Claude to verify on disk
 * before rewriting and to update `.pipeline/task-status.json` when the
 * work is already there.
 *
 * Task 11 (ADR D4): when the completion miss is classified `missing:'recording'`
 * (the finish skill did the real work but failed to record the outcome), the
 * standard hint would send Claude back through the full `/finish` walk —
 * needless churn when only `finish-record` needs to run. `pipelineDirArg`, when
 * provided, is the absolute `--pipeline-dir` value (mirrors the auto-mode
 * dispatch in step-runners.ts) so the narrow prompt points at the same
 * worktree pipeline dir regardless of cwd.
 */
export function buildRetryHint(
  step: StepName,
  reason: string | undefined,
  missing?: 'recording' | 'presentation' | 'uncommitted' | 'other',
  pipelineDirArg?: string,
): string {
  // ai-conductor:session-command-context=managed
  void pipelineDirArg;
  const r = reason ?? 'unknown';
  if (step === 'finish' && missing === 'presentation') {
    // A publication defect: every evidence check passed and only the PR's own
    // title/body/draft state is wrong. The default "finish the work now" hint
    // reads as "the implementation is incomplete" and sends the agent back into
    // the code — which is exactly how a 30-second `gh pr edit` once turned into
    // an 18-task rebuild.
    return (
      `Previous attempt did not satisfy the completion check: ${r}. ` +
      'The implementation, the tests and the shipped-record are already complete — ' +
      'ONLY the pull request\'s presentation is wrong. Do NOT re-implement anything, ' +
      'do not change code, do not touch the plan, and do not re-run the build. Fix the ' +
      'PR in place:\n' +
      '  1. Author a real body from the branch diff — `## Why`, `## What Changed`, ' +
      '`## Testing`, plus the `Closes` reference — and submit it as a `pull-request.edit` ' +
      'request through `ai-conductor github-operation --request-file <request.json>`. It must read like a clean first-pass finish: no halt ' +
      'boilerplate, no remediation narrative (those belong in a guarded `pull-request.comment.create` request), and ' +
      'no engine placeholder text.\n' +
      '  2. If the PR is still a draft, submit a guarded `pull-request.ready` request through the same CLI.\n' +
      'The engine-owned publication coordinator will re-observe the edited PR, record completion when authorized, and verify it.'
    );
  }
  if (step === 'finish' && missing === 'recording') {
    return (
      `Previous attempt did not satisfy the completion check: ${r}. ` +
      'The finish work itself appears done — only the outcome was not recorded. ' +
      'Do NOT repeat the full /finish walk. The engine-owned publication coordinator ' +
      'will re-observe the existing result, record completion when authorized, and verify it.'
    );
  }
  if (step === 'manual_test') {
    if (/is missing/i.test(r)) {
      return (
        `Previous attempt did not satisfy the completion check: ${r}. ` +
        'Record manual-test results now via:\n' +
        '  ai-conductor manual-test-record --results <path> --pipeline-dir <dir>\n' +
        'or, if this is an automated/headless run with no human tester available:\n' +
        '  ai-conductor manual-test-record --skip --reason <r> --pipeline-dir <dir>'
      );
    }
    return `Previous attempt did not satisfy the completion check: ${r}. Finish the work now.`;
  }
  if (step === 'build') {
    if (missing === 'uncommitted') {
      return (
        `Previous attempt did not satisfy the completion check: ${r}. ` +
        'Commit the uncommitted paths, then re-run the build step.'
      );
    }
    if (/^unverified Done-when checks require one BUILD review pass:/i.test(r)) {
      return (
        `Previous attempt did not satisfy the completion check: ${r}. ` +
        'Review each named check: add or cite its covering test when possible, or confirm the recorded unverified reason. ' +
        'Then complete the BUILD step.'
      );
    }
    if (/tasks? not completed/i.test(r)) {
      return (
        `Previous attempt did not satisfy the completion check: ${r}. ` +
        `Add a Task: <id> trailer to your commits to mark tasks completed. ` +
        `Format: Task: 9\\nTask: 10 (one per line).`
      );
    }
    if (/no tasks|missing.*task-status|plan is empty/i.test(r)) {
      return (
        `Previous attempt did not satisfy the completion check: ${r}. ` +
        `Check your plan at .docs/plans/ — the seed step creates task-status.json from there.`
      );
    }
  }
  // /ai-conductor:session-command-context
  return `Previous attempt did not satisfy the completion check: ${r}. Finish the work now.`;
}
