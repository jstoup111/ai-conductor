import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';

// #405: near-miss derive diagnostics (path-corroboration miss, pinned-stamp
// demotion prevention) repeat on EVERY build-gate evaluation — H7 deliberately
// re-derives each pass, so a healthy long build re-warns the same
// (task, commit) pairs all build long. First occurrence is signal; repeats are
// noise. Warn once per key for the process lifetime (a daemon run); the
// verdict/audit-entry machinery is untouched — this is presentation-only.
const derivedWarningsSeen = new Set<string>();

/** Test seam: clear the warn-once memory (module state spans vitest files). */
export function resetDeriveWarnOnce(): void {
  derivedWarningsSeen.clear();
}

function warnOnce(key: string, message: string): void {
  if (derivedWarningsSeen.has(key)) return;
  derivedWarningsSeen.add(key);
  console.warn(message);
}

// Simple logger interface for fail-closed operations
interface EvidenceRangeLogger {
  anomalies: string[];
  warnings: string[];
}

function createEvidenceRangeLogger(): EvidenceRangeLogger {
  return {
    anomalies: [],
    warnings: [],
  };
}

/**
 * Task trailer matcher with ambiguity-guarded alias support.
 *
 * Matches trailer values against a task ID, supporting both exact form (bare ID)
 * and alias form (task-N). The alias form is only accepted if it's unambiguous
 * in the plan's task namespace — i.e., if `task-${taskId}` is not also a plan
 * task ID itself (which would make it ambiguous which task was intended).
 *
 * Use case: In a plan with both `Task 7` (bare numeric) and `Task task-7`
 * (alphanumeric), a commit trailer `Task: task-7` is ambiguous. The guard
 * ensures we only match the alias when it's the only possible interpretation.
 *
 * @param trailerValues - Parsed values from a `Task:` trailer (e.g., ['7', 'task-7'])
 * @param taskId - The task ID to match against (e.g., '7')
 * @param planIds - Set of all task IDs in the plan (used to detect ambiguity)
 * @returns true if trailerValues contains taskId (exact or unambiguous alias), false otherwise
 */
export function taskTrailerMatches(trailerValues: string[], taskId: string, planIds: Set<string>): boolean {
  // Check exact match first: if taskId is in trailerValues, return true
  if (trailerValues.includes(taskId)) {
    return true;
  }

  // Check guarded alias: if `task-${taskId}` is in trailerValues
  const aliasForm = `task-${taskId}`;
  if (trailerValues.includes(aliasForm)) {
    // If alias is NOT in planIds, it's safe to use (not ambiguous)
    if (!planIds.has(aliasForm)) {
      return true;
    }
    // If alias IS in planIds, it's ambiguous, return false
    return false;
  }

  // No match found
  return false;
}

/**
 * Derive task completion from git evidence. Evaluates commits since a plan
 * anchor and marks tasks complete based on trailer evidence (Task: N),
 * explicit Evidence: forms, or pinned sidecar stamps.
 *
 * Automatically:
 * - Loads the plan from planPath and extracts task IDs + file paths
 * - Resolves the plan anchor (first commit on HEAD) for the evidence range
 * - Reads git history for evidence (commits with Task: trailers, Evidence: forms)
 * - Loads and writes task-evidence.json sidecar for evidence stamps
 *
 * Evidence bar (both conditions must hold for a commit to mark a task complete):
 *  1. Commit contains Task: <id> trailer OR Evidence: satisfied-by/skipped form
 *  2. If task has file paths, commit must touch at least one (path corroboration)
 *     If task has no paths, Task: trailer alone is sufficient
 *
 * Call this function on every build-gate evaluation to derive fresh evidence.
 * Writes evidence stamps to .pipeline/task-evidence.json sidecar.
 */

export interface HealedTask {
  taskId: string;
  commit: string;
  subject: string;
  matchedFiles: string[];
}

export interface SkippedTask {
  taskId: string;
  reason: string;
}

export interface AutoHealResult {
  healed: HealedTask[];
  skipped: SkippedTask[];
}

interface TaskRecord {
  id: string;
  name?: string;
  status?: string;
  rawEntry: Record<string, unknown>;
}

interface ParsedStatus {
  parsed: Record<string, unknown>;
  tasks: TaskRecord[];
  planRef?: string;
  statusPath: string;
}

/**
 * MIGRATION-ONLY FALLBACK (ADR H5).
 *
 * This is the pre-ADR subject/path matching heuristic. It is no longer an
 * authoritative source of task completion — deriveCompletion() (trailer +
 * sidecar evidence) is the only engine-owned path that may mark a task
 * "completed" as a matter of course. attemptAutoHeal is retained solely as a
 * best-effort migration aid for pre-cutover repos that have no trailer
 * history to derive from.
 *
 * To honor H8 (seedTaskStatus demotes any "completed" row lacking a sidecar
 * evidence stamp back to "pending"), every heal performed here immediately
 * writes a corresponding task-evidence.json stamp (form: 'legacy-heal') so
 * the write it makes to task-status.json is never orphaned: it either has
 * evidence to back it up, or it must not be written at all. This closes the
 * legacy-heal -> no-stamp -> demoted-to-pending loop.
 */
export async function attemptAutoHeal(projectRoot: string): Promise<AutoHealResult> {
  const result: AutoHealResult = { healed: [], skipped: [] };
  try {
    const status = await readTaskStatus(projectRoot);
    if (!status) return result;

    const pendingTasks = status.tasks.filter((t) => t.status === 'pending');
    if (pendingTasks.length === 0) return result;

    const commits = await listCommits(projectRoot);
    if (commits.length === 0) {
      for (const t of pendingTasks) {
        result.skipped.push({ taskId: t.id, reason: 'no git commits available' });
      }
      await writeAuditFile(projectRoot, result);
      return result;
    }

    const planPaths = await readPlanPaths(projectRoot, status.planRef);

    const { createTaskEvidence } = await import('./task-evidence.js');
    const evidence = await createTaskEvidence(projectRoot);

    for (const task of pendingTasks) {
      const match = await findMatchingCommit(projectRoot, task, commits, planPaths);
      if (!match) {
        result.skipped.push({ taskId: task.id, reason: 'no unambiguous commit match' });
        continue;
      }
      task.rawEntry.status = 'completed';
      if ('commit' in task.rawEntry || !('commit' in task.rawEntry)) {
        task.rawEntry.commit = match.commit.slice(0, 7);
      }
      // Never write status='completed' without a corresponding sidecar
      // evidence stamp (H5/H8) — stamp immediately, in the same pass, so
      // the next seedTaskStatus call sees evidence and preserves it.
      evidence.evidenceStamps.set(task.id, { sha: match.commit, form: 'legacy-heal' });
      result.healed.push({
        taskId: task.id,
        commit: match.commit.slice(0, 7),
        subject: match.subject,
        matchedFiles: match.matchedFiles,
      });
    }

    if (result.healed.length > 0) {
      await writeTaskStatus(status);
      await evidence.write();
    }
    await writeAuditFile(projectRoot, result);
    return result;
  } catch {
    return result;
  }
}

async function readTaskStatus(projectRoot: string): Promise<ParsedStatus | null> {
  const statusPath = join(projectRoot, '.pipeline/task-status.json');
  let raw: string;
  try {
    raw = await readFile(statusPath, 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const root = parsed as Record<string, unknown>;
  const tasks = extractTaskRecords(root);
  if (tasks.length === 0) return null;
  const planRef = typeof root.plan_ref === 'string' ? root.plan_ref : undefined;
  return { parsed: root, tasks, planRef, statusPath };
}

function extractTaskRecords(root: Record<string, unknown>): TaskRecord[] {
  const container = 'tasks' in root ? root.tasks : root;
  if (Array.isArray(container)) {
    return container
      .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
      .map((entry) => ({
        id: typeof entry.id === 'string' ? entry.id : String(entry.id ?? ''),
        name: typeof entry.name === 'string' ? entry.name : undefined,
        status: typeof entry.status === 'string' ? entry.status : undefined,
        rawEntry: entry,
      }))
      .filter((t) => t.id !== '');
  }
  if (container && typeof container === 'object' && !Array.isArray(container)) {
    return Object.entries(container as Record<string, unknown>)
      .filter((e): e is [string, Record<string, unknown>] => typeof e[1] === 'object' && e[1] !== null)
      .map(([id, entry]) => ({
        id,
        name: typeof entry.name === 'string' ? entry.name : undefined,
        status: typeof entry.status === 'string' ? entry.status : undefined,
        rawEntry: entry,
      }));
  }
  return [];
}

async function writeTaskStatus(status: ParsedStatus): Promise<void> {
  const serialized = JSON.stringify(status.parsed, null, 2) + '\n';
  await writeFile(status.statusPath, serialized);
}

interface CommitInfo {
  sha: string;
  subject: string;
}

export interface CommitWithTrailers {
  sha: string;
  subject: string;
  trailers: Record<string, string[]>;
}

export interface EvidenceRangeResult {
  commits: CommitWithTrailers[];
  anomalies: string[];
  warnings: string[];
}

/**
 * Get evidence range for a task, anchored to a plan SHA.
 * Fails closed: if origin/main doesn't exist, returns zero commits.
 * If anchor is unreachable, falls back to merge-base.
 * All failures are logged but never thrown.
 *
 * @param projectRoot - Root of the git repository
 * @param anchor - Plan anchor SHA (required); commits before this are excluded
 * @returns EvidenceRangeResult with commits, anomalies, and warnings
 */
export async function getEvidenceRange(
  projectRoot: string,
  anchor: string,
): Promise<EvidenceRangeResult> {
  const logger = createEvidenceRangeLogger();
  const result: EvidenceRangeResult = {
    commits: [],
    anomalies: logger.anomalies,
    warnings: logger.warnings,
  };

  try {
    // Check if origin/main exists
    const refCheck = await execa('git', ['rev-parse', '--verify', 'origin/main'], {
      cwd: projectRoot,
      reject: false,
    });

    if (refCheck.exitCode !== 0) {
      const msg = 'Evidence range: origin/main does not exist; returning zero commits (fail-closed)';
      logger.anomalies.push(msg);
      console.error(msg);
      return result;
    }

    // Try to get merge-base for fallback
    const mergeBase = await execa('git', ['merge-base', '--fork-point', 'origin/main', 'HEAD'], {
      cwd: projectRoot,
      reject: false,
    });

    let lowerBound: string | null = null;

    // First, verify that anchor is reachable
    const anchorCheck = await execa('git', ['rev-parse', '--verify', `${anchor}^{commit}`], {
      cwd: projectRoot,
      reject: false,
    });

    if (anchorCheck.exitCode === 0) {
      // Anchor is reachable, use it as lower bound
      lowerBound = anchor;
    } else {
      // Anchor is unreachable, fall back to merge-base
      const warningMsg = `Evidence range: anchor ${anchor.slice(0, 7)} is unreachable; falling back to merge-base`;
      logger.warnings.push(warningMsg);
      console.warn(warningMsg);

      if (mergeBase.exitCode === 0 && mergeBase.stdout.trim()) {
        lowerBound = mergeBase.stdout.trim();
      }
    }

    // Build the range
    let range: string;
    if (lowerBound) {
      range = `${lowerBound}..HEAD`;
    } else {
      // No valid lower bound, use HEAD with limit
      range = 'HEAD';
    }

    // Use %x1e (ASCII record separator) to delimit commits, since trailers can contain newlines
    const args =
      range === 'HEAD'
        ? ['log', '-n', '100', '--format=%H%x09%s%x00%(trailers)%x1e', 'HEAD']
        : ['log', '--format=%H%x09%s%x00%(trailers)%x1e', range];

    const log = await execa('git', args, { cwd: projectRoot, reject: false });
    if (log.exitCode === 0 && typeof log.stdout === 'string') {
      result.commits = log.stdout
        .split('\x1e') // Split by record separator
        .map((record) => record.trim())
        .filter((record) => record.length > 0)
        .map((record) => {
          const nullIndex = record.indexOf('\x00');
          if (nullIndex < 0) return null;

          const metaPart = record.slice(0, nullIndex);
          const trailersPart = record.slice(nullIndex + 1);

          const tabIndex = metaPart.indexOf('\t');
          if (tabIndex < 0) return null;

          const sha = metaPart.slice(0, tabIndex);
          const subject = metaPart.slice(tabIndex + 1);

          const trailers = parseTrailers(trailersPart);

          return { sha, subject, trailers };
        })
        .filter((item): item is CommitWithTrailers => item !== null);
    }
  } catch (err) {
    // Catch any unexpected errors and log them
    const errMsg = `Evidence range: unexpected error: ${err instanceof Error ? err.message : String(err)}`;
    logger.anomalies.push(errMsg);
    console.error(errMsg);
  }

  return result;
}

async function listCommits(projectRoot: string): Promise<CommitInfo[]> {
  const mergeBase = await execa('git', ['merge-base', 'origin/main', 'HEAD'], {
    cwd: projectRoot,
    reject: false,
  });

  let range: string;
  if (mergeBase.exitCode === 0 && typeof mergeBase.stdout === 'string' && mergeBase.stdout.trim()) {
    range = `${mergeBase.stdout.trim()}..HEAD`;
  } else {
    range = 'HEAD';
  }

  const args =
    range === 'HEAD'
      ? ['log', '-n', '100', '--format=%H%x09%s', 'HEAD']
      : ['log', '--format=%H%x09%s', range];

  const log = await execa('git', args, { cwd: projectRoot, reject: false });
  if (log.exitCode !== 0 || typeof log.stdout !== 'string') return [];

  return log.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const tab = line.indexOf('\t');
      if (tab < 0) return { sha: line, subject: '' };
      return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
    });
}

export async function listCommitsWithTrailers(
  projectRoot: string,
  anchor?: string,
): Promise<CommitWithTrailers[]> {
  // If anchor is provided, use the evidence range (fail-closed)
  if (anchor) {
    const range = await getEvidenceRange(projectRoot, anchor);
    return range.commits;
  }

  // Legacy path: no anchor provided, use simple merge-base logic
  const mergeBase = await execa('git', ['merge-base', 'origin/main', 'HEAD'], {
    cwd: projectRoot,
    reject: false,
  });

  let range: string;
  if (mergeBase.exitCode === 0 && typeof mergeBase.stdout === 'string' && mergeBase.stdout.trim()) {
    range = `${mergeBase.stdout.trim()}..HEAD`;
  } else {
    range = 'HEAD';
  }

  // Use %x1e (ASCII record separator) to delimit commits, since trailers can contain newlines
  const args =
    range === 'HEAD'
      ? ['log', '-n', '100', '--format=%H%x09%s%x00%(trailers)%x1e', 'HEAD']
      : ['log', '--format=%H%x09%s%x00%(trailers)%x1e', range];

  const log = await execa('git', args, { cwd: projectRoot, reject: false });
  if (log.exitCode !== 0 || typeof log.stdout !== 'string') return [];

  return log.stdout
    .split('\x1e') // Split by record separator
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const nullIndex = record.indexOf('\x00');
      if (nullIndex < 0) return null;

      const metaPart = record.slice(0, nullIndex);
      const trailersPart = record.slice(nullIndex + 1);

      const tabIndex = metaPart.indexOf('\t');
      if (tabIndex < 0) return null;

      const sha = metaPart.slice(0, tabIndex);
      const subject = metaPart.slice(tabIndex + 1);

      const trailers = parseTrailers(trailersPart);

      return { sha, subject, trailers };
    })
    .filter((item): item is CommitWithTrailers => item !== null);
}

export interface DeriveCompletionResult {
  [taskId: string]: {
    completed: boolean;
    evidencedBy?: string;
    auditEntry?: string;
    status?: 'skipped' | 'completed';
    skipReason?: string;
  };
}

/**
 * Derive task completion from git trailers.
 * Trailer-first: checks for Task: <id> trailers in commit bodies.
 * Evidence forms: Evidence: satisfied-by <sha> and Evidence: skipped <reason>
 * Path corroboration: if task has paths, commit must touch at least one.
 * Sidecar writes: evidence stamps stored in task-evidence.json on completion.
 *
 * @param projectRoot - Root of the git repository
 * @param planPath - Path to the plan markdown file
 * @param anchor - Plan anchor SHA for evidence range
 * @param commits - CommitWithTrailers array (from listCommitsWithTrailers)
 * @param evidence - TaskEvidence instance for sidecar writes
 * @returns Map of task ID → {completed, evidencedBy?, auditEntry?, status?, skipReason?}
 */
async function deriveCompletionInternal(
  projectRoot: string,
  planPath: string,
  anchor: string,
  commits: CommitWithTrailers[],
  evidence: any, // TaskEvidence type from task-evidence.ts
): Promise<DeriveCompletionResult> {
  const result: DeriveCompletionResult = {};

  // Parse the plan to extract tasks and their file paths
  let planText: string;
  try {
    planText = await readFile(planPath, 'utf-8');
  } catch {
    return result;
  }

  // Task IDs are sourced from parsePlanTaskPaths (colon-optional header match)
  // rather than parsePlanTasks (colon-required), because plan headers written
  // as `### Task 1` (no colon/title) are valid and must still be derivable —
  // the loop body below never reads task name/paths from parsePlanTasks, only
  // the id, so parsePlanTaskPaths' more permissive header match is a safe and
  // more correct source of truth for "which task ids exist in this plan."
  const planPaths = parsePlanTaskPaths(planText);
  const planIds = new Set(planPaths.keys());

  for (const taskId of planPaths.keys()) {
    result[taskId] = { completed: false };

    // Look for Evidence: forms first (no-op commits). Scoped to THIS task:
    // the ADR's canonical no-op form is an empty commit carrying BOTH
    // `Task: <id>` and the `Evidence:` trailer — an unscoped Evidence commit
    // must never complete/skip every task in the plan.
    const evidenceCommit = commits.find((c) => {
      const taskTrailers = c.trailers['Task'] || [];
      if (!taskTrailerMatches(taskTrailers, taskId, planIds)) return false;
      const evidenceTrailers = c.trailers['Evidence'] || [];
      return evidenceTrailers.some((e) => e.startsWith(`satisfied-by `) || e.startsWith('skipped '));
    });

    if (evidenceCommit) {
      // Check for Evidence: satisfied-by form
      const satisfiedByTrailer = (evidenceCommit.trailers['Evidence'] || []).find((e) =>
        e.startsWith('satisfied-by '),
      );

      if (satisfiedByTrailer) {
        // Extract the sha from "satisfied-by <sha>"
        const sha = satisfiedByTrailer.slice('satisfied-by '.length).trim();

        // Validate the sha exists in git
        const shaCheck = await execa('git', ['rev-parse', '--verify', `${sha}^{commit}`], {
          cwd: projectRoot,
          reject: false,
        });

        if (shaCheck.exitCode === 0) {
          // Valid sha: mark task completed
          result[taskId].completed = true;
          result[taskId].evidencedBy = sha;
          result[taskId].status = 'completed';
          evidence.evidenceStamps.set(taskId, { sha, form: 'evidence:satisfied-by' });
        } else {
          // Dangling sha: log audit entry, leave incomplete
          result[taskId].auditEntry = `Task ${taskId}: Evidence: satisfied-by ${sha.slice(0, 7)} is dangling (unreachable SHA)`;
          console.warn(
            `[autoheal] Task ${taskId}: dangling satisfied-by sha ${sha.slice(0, 7)}`,
          );
        }
        continue;
      }

      // Check for Evidence: skipped form
      const skippedTrailer = (evidenceCommit.trailers['Evidence'] || []).find((e) =>
        e.startsWith('skipped '),
      );

      if (skippedTrailer) {
        // Extract the reason from "skipped <reason>"
        const reason = skippedTrailer.slice('skipped '.length).trim();
        result[taskId].status = 'skipped';
        result[taskId].skipReason = reason;
        result[taskId].completed = false;
        continue;
      }
    }

    // Look for a commit with Task: <taskId> trailer
    const matchingCommit = commits.find((c) => {
      const taskTrailers = c.trailers['Task'] || [];
      return taskTrailerMatches(taskTrailers, taskId, planIds);
    });

    if (!matchingCommit) {
      // No current evidence found; check if task has a pinned evidence stamp in sidecar
      if (evidence.evidenceStamps.has(taskId)) {
        // Task was previously completed and evidenced; preserve that status to prevent demotion
        result[taskId].completed = true;
        result[taskId].status = 'completed';
        const stamp = evidence.evidenceStamps.get(taskId);
        result[taskId].evidencedBy = stamp?.sha;
        warnOnce(
          `${projectRoot}:demotion:${taskId}:${stamp?.sha ?? ''}`,
          `[autoheal] Task ${taskId}: no current evidence in history but sidecar has evidence stamp (pinned completed); preventing demotion`,
        );
        continue;
      }
      continue;
    }

    // Check if the commit is empty (no files changed)
    const filesInCommit = await filesForCommit(projectRoot, matchingCommit.sha);
    const isEmptyCommit = filesInCommit.length === 0;

    // Empty commits with only Task: trailer (no Evidence:) do not complete tasks
    if (isEmptyCommit) {
      result[taskId].auditEntry = `Task ${taskId}: empty commit with Task: trailer but no Evidence: form (incomplete)`;
      continue;
    }

    // Found a commit with the Task: trailer and file changes
    const taskPaths = planPaths.get(taskId);
    const hasPlanFiles = !!(taskPaths && taskPaths.size > 0);

    if (!hasPlanFiles) {
      // Task has no specific paths; trailer alone is enough
      result[taskId].completed = true;
      result[taskId].status = 'completed';
      result[taskId].evidencedBy = matchingCommit.sha;
      evidence.evidenceStamps.set(taskId, { sha: matchingCommit.sha, form: 'trailer' });
      continue;
    }

    // Task has paths; verify commit touches at least one
    const overlap = filesInCommit.filter((f) => taskPaths!.has(f.replace(/^\.\//, '')));

    if (overlap.length === 0) {
      // Path mismatch: log audit entry
      result[taskId].auditEntry = `Task ${taskId}: trailer found but no path overlap. Commit ${matchingCommit.sha.slice(0, 7)} touched [${filesInCommit.slice(0, 3).join(', ')}...] but expected paths like [${Array.from(taskPaths).slice(0, 3).join(', ')}...]`;
      warnOnce(
        `${projectRoot}:pathcorr:${taskId}:${matchingCommit.sha}`,
        `[autoheal] Path corroboration failed for task ${taskId}: trailer ${matchingCommit.sha.slice(0, 7)} has no overlap with plan paths`,
      );
      continue;
    }

    // Path overlap confirmed; mark completed
    result[taskId].completed = true;
    result[taskId].status = 'completed';
    result[taskId].evidencedBy = matchingCommit.sha;
    evidence.evidenceStamps.set(taskId, { sha: matchingCommit.sha, form: 'trailer' });
  }

  // Write evidence to sidecar
  await evidence.write();

  return result;
}

/**
 * PUBLIC API: Derive task completion from git evidence.
 *
 * Two call forms, one behavior:
 *  - `deriveCompletion(root, planPath)` — gate/engine form: resolves the plan
 *    anchor, evidence-range commits, and the sidecar itself (H7 per-gate
 *    derive), then derives.
 *  - `deriveCompletion(root, planPath, anchor, commits, evidence)` — explicit
 *    form (tests, hook feedback path): callers supply the pieces.
 *
 * Returns the FULL per-task map — an entry for EVERY plan task, including
 * incomplete (`completed: false`), audit entries for near-misses, and
 * `status: 'skipped'` rows from `Evidence: skipped` no-op commits. Callers
 * that only care about positives filter on `.completed`; discarding the
 * negative/skip information here is what previously hid H5's skip form from
 * the write-back entirely.
 */
export async function deriveCompletion(
  projectRoot: string,
  planPath: string,
  anchorArg?: string,
  commitsArg?: CommitWithTrailers[],
  evidenceArg?: { evidenceStamps: Map<string, { sha: string; form: string }>; write(): Promise<void> },
): Promise<DeriveCompletionResult> {
  let anchor = anchorArg ?? '';
  if (anchorArg === undefined) {
    try {
      // Get the first commit (plan anchor) for evidence range boundary.
      // NOTE: `-n 1 --reverse` is a classic git footgun — `-n`/`--max-count` is
      // applied BEFORE `--reverse`, so `-n 1 --reverse HEAD` returns the first
      // of the newest-first list (i.e. HEAD itself), not the oldest commit.
      // That made anchor always equal HEAD, so `${anchor}..HEAD` was always an
      // empty range and every gate evaluation saw zero commits regardless of
      // real history. Reading the full reversed list and taking its first
      // line gives the true root commit.
      const { stdout } = await execa('git', ['log', '--format=%H', '--reverse', 'HEAD'], {
        cwd: projectRoot,
        reject: false,
      });
      anchor = (stdout || '').split('\n')[0]?.trim() ?? '';
    } catch {
      // No commits yet — use empty string, getEvidenceRange will handle it
      anchor = '';
    }
  }

  const commits = commitsArg ?? (await getEvidenceRange(projectRoot, anchor)).commits;

  let evidence = evidenceArg;
  if (!evidence) {
    const { createTaskEvidence } = await import('./task-evidence.js');
    evidence = await createTaskEvidence(projectRoot);
  }

  return deriveCompletionInternal(projectRoot, planPath, anchor, commits, evidence);
}

/**
 * Apply a deriveCompletion() result to .pipeline/task-status.json.
 *
 * This is the write-back half of the engine-owned task-status contract: derive
 * only computes fresh completion from git evidence + the task-evidence sidecar
 * (evidence stamping happens inside deriveCompletion itself); this function is
 * what actually flips a still-"pending" row to "completed" on disk so the build
 * gate's raw-row check (CUSTOM_COMPLETION_PREDICATES.build) sees it.
 *
 * Returns an AutoHealResult (healed/skipped) so callers can keep emitting the
 * existing `auto_heal` event shape without caring that the underlying engine
 * (attemptAutoHeal's commit-matching heuristic vs. deriveCompletion's trailer/
 * evidence derivation) changed.
 */
export async function applyDerivedCompletion(
  projectRoot: string,
  derived: DeriveCompletionResult,
): Promise<AutoHealResult> {
  const result: AutoHealResult = { healed: [], skipped: [] };
  try {
    const status = await readTaskStatus(projectRoot);
    if (!status) return result;

    const pendingTasks = status.tasks.filter((t) => t.status === 'pending');
    if (pendingTasks.length === 0) return result;

    let wroteAnything = false;
    for (const task of pendingTasks) {
      const hit = derived[task.id];
      if (hit?.status === 'skipped') {
        // H5: `Evidence: skipped <reason>` no-op commits mark the row skipped
        // (gate-acceptable) — previously dropped entirely by the write-back,
        // leaving skip-evidenced tasks pending forever.
        task.rawEntry.status = 'skipped';
        if (hit.skipReason) task.rawEntry.skip_reason = hit.skipReason;
        wroteAnything = true;
        continue;
      }
      if (!hit?.completed) {
        result.skipped.push({ taskId: task.id, reason: 'no derived evidence' });
        continue;
      }
      task.rawEntry.status = 'completed';
      if (hit.evidencedBy) {
        task.rawEntry.commit = hit.evidencedBy.slice(0, 7);
      }
      wroteAnything = true;
      result.healed.push({
        taskId: task.id,
        commit: hit.evidencedBy ? hit.evidencedBy.slice(0, 7) : '',
        subject: '',
        matchedFiles: [],
      });
    }

    if (wroteAnything) {
      await writeTaskStatus(status);
    }
    await writeAuditFile(projectRoot, result);
    return result;
  } catch {
    return result;
  }
}

export function parseTrailers(trailerText: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  if (!trailerText || trailerText.trim().length === 0) {
    return result;
  }

  const lines = trailerText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match "Key: value" format (with space after colon)
    // Keys must be alphanumeric, hyphens allowed
    const match = trimmed.match(/^([A-Za-z][A-Za-z0-9-]*): (.+)$/);
    if (!match) continue;

    const key = match[1];
    const value = match[2];

    // Only capture Task and Evidence trailers
    if (key !== 'Task' && key !== 'Evidence') continue;

    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(value);
  }

  return result;
}

export async function filesForCommit(projectRoot: string, sha: string): Promise<string[]> {
  const out = await execa('git', ['diff-tree', '--name-only', '-r', sha], {
    cwd: projectRoot,
    reject: false,
  });
  if (out.exitCode !== 0 || typeof out.stdout !== 'string') return [];
  return out.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function readPlanPaths(
  projectRoot: string,
  planRef: string | undefined,
): Promise<Map<string, Set<string>>> {
  const empty = new Map<string, Set<string>>();
  if (!planRef) return empty;
  const planPath = resolvePlanPath(projectRoot, planRef);
  let text: string;
  try {
    text = await readFile(planPath, 'utf-8');
  } catch {
    return empty;
  }
  return parsePlanTaskPaths(text);
}

function resolvePlanPath(projectRoot: string, planRef: string): string {
  const trimmed = planRef.trim();
  const withExt = /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
  if (withExt.startsWith('/')) return withExt;
  if (withExt.startsWith('.docs/') || withExt.startsWith('./')) {
    return join(projectRoot, withExt);
  }
  return join(projectRoot, '.docs/plans', withExt);
}

const PATH_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs|md|json|yml|yaml|sh|rb|py|go|rs|html|css|scss|vue|toml)$/i;
const BACKTICK_TOKEN = /`([^`\s]+)`/g;

// Task ID pattern: alphanumeric + dots, underscores, hyphens
// Supports: 1, 1.2, task_1, task-name, rem-adr-001, etc.
// (H9 id grammar — exported so callers outside this module, e.g. the
// post-commit fast-feedback CLI dispatch, validate/derive against the SAME
// grammar instead of re-deriving a narrower ad hoc regex.)
export const TASK_ID_PATTERN = '[A-Za-z0-9._-]+';

/**
 * Fast-feedback, single-commit evidence check (ADR post-landing amendment:
 * post-commit-derive-feedback.sh invokes this via the `derive-feedback`
 * CLI dispatch instead of a bare bash regex). Advisory only — never writes
 * task-status.json or the evidence sidecar; a plain read-only check of
 * whether the given commit carries a `Task: <id>` trailer matching the H9
 * grammar, with a path-fallback: if the commit has no Task trailer at all,
 * check whether its changed files overlap any task's plan-declared paths
 * (best-effort; plan may not exist yet, e.g. very early in a project).
 */
export async function checkCommitEvidence(
  projectRoot: string,
  sha: string,
  planPath?: string,
): Promise<{ evidenced: boolean; taskId?: string; reason: 'trailer' | 'path-fallback' | 'none' }> {
  const show = await execa('git', ['show', '-s', '--format=%B', sha], {
    cwd: projectRoot,
    reject: false,
  });
  const message = show.exitCode === 0 && typeof show.stdout === 'string' ? show.stdout : '';
  const taskTrailerLine = message
    .split('\n')
    .find((l) => new RegExp(`^Task: (${TASK_ID_PATTERN})$`).test(l.trim()));

  if (taskTrailerLine) {
    const match = taskTrailerLine.trim().match(new RegExp(`^Task: (${TASK_ID_PATTERN})$`));
    return { evidenced: true, taskId: match?.[1], reason: 'trailer' };
  }

  // Path-fallback: no Task trailer present. If a plan is available, see
  // whether this commit's changed files overlap any task's declared paths —
  // that still counts as (weak) evidence for fast feedback purposes.
  if (planPath) {
    try {
      const planText = await readFile(planPath, 'utf-8');
      const planPaths = parsePlanTaskPaths(planText);
      const changedFiles = await filesForCommit(projectRoot, sha);
      for (const [taskId, paths] of planPaths.entries()) {
        const overlap = changedFiles.filter((f) => paths.has(f.replace(/^\.\//, '')));
        if (overlap.length > 0) {
          return { evidenced: true, taskId, reason: 'path-fallback' };
        }
      }
    } catch {
      // No plan yet, or unreadable — fall through to "none".
    }
  }

  return { evidenced: false, reason: 'none' };
}

export interface PlanTask {
  name: string;
  paths: string[];
}

export function parsePlanTasks(text: string): Map<string, PlanTask> {
  const result = new Map<string, PlanTask>();
  const lines = text.split('\n');
  let currentTaskId: string | null = null;

  // Match: ### Task ID: Title (requires colon and at least some title)
  // Supports numeric (1, 18, 100), dotted (1.2), alphanumeric with separators (task_1, rem-adr-001)
  // Pattern: ### Task <id>: <title_with_at_least_one_char>
  const taskHeader = new RegExp(`^#{1,6}\\s+Task\\s+(${TASK_ID_PATTERN}):\\s+(.+)$`);

  for (const line of lines) {
    const headerMatch = line.match(taskHeader);
    if (headerMatch) {
      const id = headerMatch[1];
      const name = headerMatch[2].trim();
      currentTaskId = id;
      result.set(id, { name, paths: [] });
      continue;
    }

    if (!currentTaskId) continue;

    // Extract paths from backtick-delimited tokens
    let m: RegExpExecArray | null;
    while ((m = BACKTICK_TOKEN.exec(line)) !== null) {
      const token = m[1];
      if (!PATH_EXTENSIONS.test(token) && !token.includes('/')) continue;
      const normalized = token.replace(/^\.\//, '');
      if (!normalized || normalized.startsWith('-')) continue;
      const task = result.get(currentTaskId);
      if (task && !task.paths.includes(normalized)) {
        task.paths.push(normalized);
      }
    }
  }

  return result;
}

// A task's **Files:** line is the authoritative declaration of which paths
// corroborate its commits (#424). Plans write these as plain text (no
// backticks) with `;`/`,` separators, and use `same` / `same as Task N`
// shorthand to inherit an earlier task's set. Matches `**Files:**`,
// `**Files**:`, and `**Files likely touched:**`, with an optional list bullet.
const FILES_LINE = /^\s*(?:[-*]\s+)?\*\*Files(?:\s+[^*]*?)?\s*:?\s*\*\*\s*:?\s*(.*)$/i;

/** Path-looking tokens from a **Files:** line (plain text or backticked). */
function extractFilesLinePaths(rest: string): string[] {
  const paths: string[] = [];
  for (const raw of rest.replace(/`/g, ' ').split(/[;,\s]+/)) {
    const token = raw.trim();
    if (!token) continue;
    if (!PATH_EXTENSIONS.test(token) && !token.includes('/')) continue;
    const normalized = token.replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('-')) continue;
    if (!paths.includes(normalized)) paths.push(normalized);
  }
  return paths;
}

export function parsePlanTaskPaths(text: string): Map<string, Set<string>> {
  interface TaskSection {
    ids: string[];
    filesPaths: Set<string>; // declared on **Files:** lines
    sameRef: string | null; // 'prev' or an explicit task id to inherit from
    hasFilesLine: boolean;
    prosePaths: Set<string>; // legacy whole-section backtick scan
  }
  const sections: TaskSection[] = [];
  let current: TaskSection | null = null;
  // True while consuming list-item lines that continue a **Files:** header
  // whose paths are written as bullets beneath it (the plan skill's template
  // form: `**Files likely touched:**` followed by `- path — what changes`).
  let inFilesBlock = false;

  // Match task headers and extract task ids (supports comma-separated ids, ranges like 1-3 for numeric)
  // Pattern allows: Task 1-3, rem-adr-001, 1.2: or Task 1-3, rem-adr-001, 1.2
  const taskHeader = /^#{1,6}\s+Task\s+([A-Za-z0-9._,\s-]+?)(?::|$)/;
  const sameShorthand = new RegExp(`^same(?:\\s+as\\s+task\\s+(${TASK_ID_PATTERN}))?\\b`, 'i');

  for (const line of text.split('\n')) {
    const headerMatch = line.match(taskHeader);
    if (headerMatch) {
      current = {
        ids: expandTaskIds(headerMatch[1]),
        filesPaths: new Set(),
        sameRef: null,
        hasFilesLine: false,
        prosePaths: new Set(),
      };
      sections.push(current);
      inFilesBlock = false;
      continue;
    }
    if (!current) continue;

    const filesMatch = line.match(FILES_LINE);
    if (filesMatch) {
      current.hasFilesLine = true;
      inFilesBlock = true;
      const rest = filesMatch[1].trim();
      const same = rest.match(sameShorthand);
      if (same) {
        current.sameRef = same[1] ?? 'prev';
      } else if (!/^(?:none|n\/a)\b/i.test(rest)) {
        for (const p of extractFilesLinePaths(rest)) current.filesPaths.add(p);
      }
      continue;
    }

    if (inFilesBlock) {
      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      if (bullet) {
        for (const p of extractFilesLinePaths(bullet[1])) current.filesPaths.add(p);
        continue;
      }
      inFilesBlock = false;
    }

    // Legacy fallback source: backtick tokens anywhere in the section. Only
    // used when the section has no **Files:** line — Steps prose routinely
    // backticks module-import strings and runtime artifacts that must not
    // become required corroboration paths (#424).
    let m: RegExpExecArray | null;
    while ((m = BACKTICK_TOKEN.exec(line)) !== null) {
      const token = m[1];
      if (!PATH_EXTENSIONS.test(token) && !token.includes('/')) continue;
      const normalized = token.replace(/^\.\//, '');
      if (!normalized || normalized.startsWith('-')) continue;
      current.prosePaths.add(normalized);
    }
  }

  // Resolve in document order so `same` chains (1 ← 2 ← 3) terminate at the
  // last explicit set. An unresolvable `same` (no predecessor / unknown id)
  // resolves empty — trailer-alone corroboration, same as `none`.
  const result = new Map<string, Set<string>>();
  const resolvedBySection: Set<string>[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    let resolved: Set<string>;
    if (s.hasFilesLine) {
      resolved = new Set(s.filesPaths);
      if (s.sameRef) {
        let inherited: Set<string> | undefined;
        if (s.sameRef === 'prev') {
          inherited = resolvedBySection[i - 1];
        } else {
          for (let j = i - 1; j >= 0; j--) {
            if (sections[j].ids.includes(s.sameRef)) {
              inherited = resolvedBySection[j];
              break;
            }
          }
        }
        for (const p of inherited ?? []) resolved.add(p);
      }
    } else {
      resolved = s.prosePaths;
    }
    resolvedBySection.push(resolved);
    for (const id of s.ids) {
      const existing = result.get(id);
      if (existing) {
        for (const p of resolved) existing.add(p);
      } else {
        result.set(id, new Set(resolved));
      }
    }
  }

  return result;
}

function expandTaskIds(raw: string): string[] {
  const ids: string[] = [];
  for (const piece of raw.split(',')) {
    const trimmed = piece.trim();
    if (!trimmed) continue;

    // Try numeric range expansion only for numeric ids (e.g., 1-3)
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let n = start; n <= end; n++) ids.push(String(n));
    } else if (new RegExp(`^${TASK_ID_PATTERN}$`).test(trimmed)) {
      // Accept any id matching the TASK_ID_PATTERN (numeric, dotted, hyphenated, underscore)
      ids.push(trimmed);
    }
  }
  return ids;
}

interface CommitMatch {
  commit: string;
  subject: string;
  matchedFiles: string[];
}

async function findMatchingCommit(
  projectRoot: string,
  task: TaskRecord,
  commits: CommitInfo[],
  planPaths: Map<string, Set<string>>,
): Promise<CommitMatch | null> {
  const taskPaths = planPaths.get(task.id);
  const hasPlanFiles = !!(taskPaths && taskPaths.size > 0);

  for (const commit of commits) {
    const { idMatch, nameMatch } = matchSubject(commit.subject, task);
    if (!idMatch && !nameMatch) continue;

    if (!hasPlanFiles) {
      if (!(idMatch && nameMatch)) continue;
      return { commit: commit.sha, subject: commit.subject, matchedFiles: [] };
    }

    const files = await filesForCommit(projectRoot, commit.sha);
    const overlap = files.filter((f) => taskPaths!.has(f.replace(/^\.\//, '')));
    if (overlap.length === 0) continue;
    return { commit: commit.sha, subject: commit.subject, matchedFiles: overlap };
  }

  return null;
}

function matchSubject(subject: string, task: TaskRecord): { idMatch: boolean; nameMatch: boolean } {
  const idRe = new RegExp(`(?:^|[^0-9A-Za-z])(?:T${escapeRegex(task.id)}|#${escapeRegex(task.id)})(?![0-9A-Za-z])`);
  const idMatch = idRe.test(subject);

  let nameMatch = false;
  if (task.name && task.name.trim().length > 0) {
    const name = task.name.trim();
    if (name.length < 12) {
      const wordRe = new RegExp(`(?:^|\\W)${escapeRegex(name)}(?:\\W|$)`, 'i');
      nameMatch = wordRe.test(subject);
    } else {
      nameMatch = subject.toLowerCase().includes(name.toLowerCase());
    }
  }
  return { idMatch, nameMatch };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function writeAuditFile(projectRoot: string, result: AutoHealResult): Promise<void> {
  const dir = join(projectRoot, '.pipeline', 'audit-trail');
  await mkdir(dir, { recursive: true }).catch(() => {});
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(dir, `autoheal-${stamp}.json`);
  await writeFile(path, JSON.stringify(result, null, 2) + '\n').catch(() => {});
}
